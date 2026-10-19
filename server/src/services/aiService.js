/**
 * ==============================================================================
 * MEDIROUTE - CENTRAL AI SERVICE (aiService.js)
 * ==============================================================================
 *
 * WHAT IS WHERE:
 * - Line 36-75:   Model registry + provider configuration (SINGLE source of truth)
 * - Line 77-175:  extractJSON / callLLM - provider cascade with JSON enforcement
 * - Line 177-290: clinicalRuleTriage - deterministic ESI safety net
 * - Line 292-390: triageIncident - AI clinical triage (ESI 1-5)
 * - Line 392-470: rankHospitals - AI hospital allocation scoring
 * - Line 472-510: transcribeAudio - Groq Whisper real speech-to-text
 * - Line 512-600: forecastSurge - data-driven forecast from incident history
 * - Line 602-640: getAIHealth - live provider reachability for status badges
 *
 * WHY THIS FILE EXISTS:
 * Model IDs were previously hardcoded in two separate route files, which drifted
 * apart and both silently decommissioned (llama-3.1-70b-versatile in ai.js and
 * llama-3.3-70b-versatile in incidents.js). Every AI call failed and fell back to
 * keyword matching that was presented to users as AI with 0.94 confidence.
 * All model configuration now lives HERE and nowhere else.
 *
 * HONESTY CONTRACT:
 * Every function returns an `engine` field naming what actually produced the
 * result ('groq:openai/gpt-oss-120b', 'rules', 'history'). Callers must surface
 * this so the UI never claims AI output that came from a fallback.
 * ==============================================================================
 */

const axios = require('axios')

// ──────────────────────────────────────────────────────────────────────────────
// PROVIDER CONFIGURATION - the single source of truth for model IDs
// ──────────────────────────────────────────────────────────────────────────────

const GROQ_API_KEY = process.env.GROQ_API_KEY
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const GROQ_BASE = 'https://api.groq.com/openai/v1'
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

/**
 * Chat model cascade, tried in order. Verified available on the project key
 * on 2026-10-19. The gpt-oss models are reasoning models: reasoning tokens are
 * billed against max_tokens, so the budget must stay well above the visible JSON
 * size or the response truncates and JSON mode fails with json_validate_failed.
 */
const CHAT_MODELS = [
  { provider: 'groq', model: process.env.GROQ_PRIMARY_MODEL || 'openai/gpt-oss-120b', maxTokens: 2500, reasoningEffort: 'low' },
  { provider: 'groq', model: process.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b', maxTokens: 2500, reasoningEffort: 'low' },
  { provider: 'groq', model: 'qwen/qwen3.8-27b', maxTokens: 2000 },
]

// OpenRouter is opt-in only. The previously configured free slug
// (meta-llama/llama-3.1-8b-instruct:free) now returns 404 - the free tier was
// withdrawn. Set OPENROUTER_MODEL to a paid slug to re-enable this tier.
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || null

const AUDIO_MODEL = process.env.GROQ_AUDIO_MODEL || 'whisper-large-v3-turbo'

const LLM_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || '12000', 10)

// Valid specialty tokens the rest of the system understands.
const SPECIALTIES = [
  'CARDIAC_CATH_LAB', 'LEVEL_1_TRAUMA', 'STROKE_CENTER', 'NEUROSURGERY',
  'BURN_UNIT', 'ICU', 'GENERAL_SURGERY', 'ORTHOPEDIC', 'PEDIATRIC_ICU',
]

// ──────────────────────────────────────────────────────────────────────────────
// LLM TRANSPORT
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Extract a JSON value from a model response that may be wrapped in prose or
 * markdown fences. Reasoning models occasionally prepend commentary even in
 * JSON mode, so brace matching is safer than a bare JSON.parse.
 */
function extractJSON(raw) {
  if (!raw) return null

  const text = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

  try {
    return JSON.parse(text)
  } catch {
    // Fall back to locating the outermost JSON object or array.
    const shapes = [['{', '}'], ['[', ']']]
    for (const [open, close] of shapes) {
      const start = text.indexOf(open)
      const end = text.lastIndexOf(close)
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(text.substring(start, end + 1))
        } catch {
          // Try the next shape.
        }
      }
    }
  }

  return null
}

/**
 * Run a prompt through the model cascade and return the first valid JSON result.
 *
 * @param {object}   opts
 * @param {string}   opts.system   System instruction.
 * @param {string}   opts.user     User prompt. Must describe the exact JSON shape.
 * @param {function} opts.validate Predicate; a parsed result failing it is
 *                                 rejected and the next model is tried.
 * @returns {Promise<{data: any, engine: string}|null>} null if every tier failed.
 */
async function callLLM({ system, user, validate = () => true }) {
  const attempts = []

  if (GROQ_API_KEY) {
    for (const tier of CHAT_MODELS) {
      attempts.push({ ...tier, base: GROQ_BASE, key: GROQ_API_KEY, headers: {} })
    }
  }

  if (OPENROUTER_API_KEY && OPENROUTER_MODEL) {
    attempts.push({
      provider: 'openrouter',
      model: OPENROUTER_MODEL,
      maxTokens: 1200,
      base: OPENROUTER_BASE,
      key: OPENROUTER_API_KEY,
      headers: { 'HTTP-Referer': 'https://mediroute-five.vercel.app', 'X-Title': 'MediRoute' },
    })
  }

  for (const attempt of attempts) {
    try {
      const body = {
        model: attempt.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.1,
        max_tokens: attempt.maxTokens,
        response_format: { type: 'json_object' },
      }
      if (attempt.reasoningEffort) body.reasoning_effort = attempt.reasoningEffort

      const res = await axios.post(`${attempt.base}/chat/completions`, body, {
        headers: {
          Authorization: `Bearer ${attempt.key}`,
          'Content-Type': 'application/json',
          ...attempt.headers,
        },
        timeout: LLM_TIMEOUT_MS,
      })

      const parsed = extractJSON(res.data?.choices?.[0]?.message?.content)
      if (parsed && validate(parsed)) {
        return { data: parsed, engine: `${attempt.provider}:${attempt.model}` }
      }

      console.warn(`[AI] ${attempt.model} returned an unusable payload; trying next tier`)
    } catch (err) {
      const detail = err.response?.data?.error?.message || err.message
      console.warn(`[AI] ${attempt.provider}:${attempt.model} failed - ${detail}`)
    }
  }

  return null
}

// ──────────────────────────────────────────────────────────────────────────────
// DETERMINISTIC CLINICAL SAFETY NET
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Keyword and vitals based ESI assignment. This is NOT AI and never reports
 * itself as such: it returns engine 'rules' and a deliberately moderate
 * confidence so the UI can label it an offline protocol rather than an AI
 * assessment.
 *
 * It exists so a dispatch is never blocked by an LLM outage - an emergency
 * system must always produce a triage level.
 */
function clinicalRuleTriage(complaintText = '', vitals = {}) {
  const text = String(complaintText).toLowerCase()

  let esiLevel = 3
  let aiSummary = 'Moderate urgency presentation. Vitals pending; secondary evaluation recommended on arrival.'
  let requiredSpecialties = ['GENERAL_SURGERY']
  let criticalAlerts = []
  let recommendedActions = ['Check vitals manually', 'Establish IV access', 'Transport to nearest appropriate ER']

  const match = (...terms) => terms.some((t) => text.includes(t))

  if (match('cardiac', 'chest pain', 'heart attack', 'angina', 'palpitation')) {
    esiLevel = 1
    aiSummary = 'Suspected acute coronary syndrome with possible active myocardial ischemia. Immediate cardiac catheterization pathway indicated.'
    requiredSpecialties = ['CARDIAC_CATH_LAB', 'ICU']
    criticalAlerts = ['Risk of ventricular fibrillation', 'Possible STEMI']
    recommendedActions = ['High-flow O2 if SpO2 below 94%', 'Aspirin 325mg chewable if not contraindicated', 'Continuous 12-lead ECG', 'Pre-alert cardiac cath lab']
  } else if (match('accident', 'trauma', 'collision', 'bleeding', 'fracture', 'fell', 'crash', 'hit by')) {
    esiLevel = 1
    aiSummary = 'Blunt or penetrating polytrauma with hemorrhage and fracture risk. Trauma surgical activation warranted.'
    requiredSpecialties = ['LEVEL_1_TRAUMA', 'GENERAL_SURGERY', 'ORTHOPEDIC']
    criticalAlerts = ['Hemorrhagic shock risk', 'Possible spinal injury']
    recommendedActions = ['C-spine immobilization', 'Large-bore bilateral IV access', 'Direct pressure or tourniquet for external bleeding', 'Pre-alert trauma bay']
  } else if (match('unconscious', 'unresponsive', 'fainting', 'syncope', 'coma', 'not breathing', 'no pulse')) {
    esiLevel = 1
    aiSummary = 'Unresponsive patient with severe altered mental status. Critical airway compromise risk.'
    requiredSpecialties = ['ICU', 'NEUROSURGERY']
    criticalAlerts = ['Airway compromise', 'Severe hypoxia risk']
    recommendedActions = ['Open and secure airway', 'Begin CPR if no pulse', 'Point-of-care glucose check', 'Prepare for advanced airway']
  } else if (match('stroke', 'speech', 'paralysis', 'facial droop', 'slurred')) {
    esiLevel = 1
    aiSummary = 'Acute neurological deficit consistent with possible ischemic stroke within the therapeutic window. Time-critical.'
    requiredSpecialties = ['STROKE_CENTER', 'NEUROSURGERY']
    criticalAlerts = ['Possible ischemic penumbra', 'Window for thrombolysis or thrombectomy']
    recommendedActions = ['F.A.S.T. assessment and record onset time', 'Keep patient nil by mouth', 'Pre-alert stroke team for priority CT']
  } else if (match('fire', 'burn', 'scald', 'electrocut')) {
    esiLevel = 2
    aiSummary = 'Thermal or chemical burn injury with potential inhalation component. Fluid resuscitation and burn care required.'
    requiredSpecialties = ['BURN_UNIT', 'ICU', 'GENERAL_SURGERY']
    criticalAlerts = ['Possible inhalation injury', 'Hypovolemia risk']
    recommendedActions = ['Cool with clean running water', 'Sterile non-adherent dressing', 'Begin fluid resuscitation', 'Monitor airway for soot or edema']
  } else if (match('breath', 'respiratory', 'asthma', 'choking', 'suffocat', 'wheez')) {
    esiLevel = 2
    aiSummary = 'Acute respiratory distress with risk of respiratory failure. Bronchodilator therapy and supplemental oxygen required.'
    requiredSpecialties = ['ICU']
    criticalAlerts = ['Bronchospasm', 'Falling SpO2']
    recommendedActions = ['Humidified O2 via non-rebreather', 'Nebulized bronchodilator', 'Prepare bag-valve-mask']
  } else if (match('pregnan', 'labour', 'childbirth', 'delivery')) {
    esiLevel = 2
    aiSummary = 'Obstetric emergency with possible imminent delivery or complication. Maternal and neonatal support required.'
    requiredSpecialties = ['ICU', 'GENERAL_SURGERY']
    criticalAlerts = ['Possible imminent delivery', 'Hemorrhage risk']
    recommendedActions = ['Position left lateral', 'Prepare delivery kit', 'Pre-alert obstetrics team']
  } else if (match('poison', 'overdose', 'snake', 'bite', 'allerg', 'anaphyla')) {
    esiLevel = 1
    aiSummary = 'Toxicological or anaphylactic emergency with risk of rapid cardiovascular collapse.'
    requiredSpecialties = ['ICU', 'GENERAL_SURGERY']
    criticalAlerts = ['Airway edema risk', 'Cardiovascular collapse risk']
    recommendedActions = ['Administer intramuscular epinephrine if anaphylaxis suspected', 'Secure airway early', 'Identify and retain the agent if safely possible']
  }

  // Objective vitals override keyword inference.
  const v = vitals || {}
  if (v.spO2 != null && v.spO2 < 88) {
    esiLevel = 1
    criticalAlerts.push(`Severe hypoxemia (SpO2 ${v.spO2}%)`)
  }
  if (v.heartRate != null && (v.heartRate > 140 || v.heartRate < 45)) {
    esiLevel = 1
    criticalAlerts.push(`Hemodynamic instability (HR ${v.heartRate} bpm)`)
  }
  if (v.gcsScore != null && v.gcsScore <= 8) {
    esiLevel = 1
    criticalAlerts.push(`Severe impairment of consciousness (GCS ${v.gcsScore})`)
  }
  if (v.bloodPressureSystolic != null && v.bloodPressureSystolic < 90) {
    esiLevel = 1
    criticalAlerts.push(`Hypotension (systolic ${v.bloodPressureSystolic} mmHg)`)
  }

  return {
    esiLevel,
    aiSummary,
    // Deliberately moderate: this is pattern matching, not clinical reasoning.
    aiConfidence: 0.55,
    requiredSpecialties,
    criticalAlerts,
    recommendedActions,
    engine: 'rules',
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Normalise the punctuation a model emits.
 *
 * Language models reach for em dashes, en dashes and non-breaking hyphens, all
 * of which end up rendered verbatim in clinical summaries and in the
 * recommended actions shown to citizens. The house style is a plain hyphen, so
 * model output is normalised here rather than at every display site.
 */
function cleanText(value) {
  return String(value)
    .replace(/\s[—–]\s/g, ' - ')
    .replace(/[—–‒―‑]/g, '-')
    // Smart quotes travel with them and break monospaced clinical text.
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim()
}

/** Clamp and sanitise a model triage payload into the Incident schema shape. */
function normaliseTriage(raw, engine) {
  const esi = parseInt(raw.esiLevel, 10)
  const confidence = parseFloat(raw.aiConfidence)
  const asArray = (val) => (Array.isArray(val) ? val.filter(Boolean).map((v) => cleanText(v)) : [])

  return {
    esiLevel: Number.isFinite(esi) ? Math.min(5, Math.max(1, esi)) : 3,
    aiSummary: cleanText(raw.aiSummary || 'Clinical summary unavailable.').slice(0, 600),
    aiConfidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.8,
    // Keep only specialties the allocation engine can actually act on.
    requiredSpecialties: asArray(raw.requiredSpecialties)
      .map((s) => s.toUpperCase().replace(/[\s-]+/g, '_'))
      .filter((s) => SPECIALTIES.includes(s)),
    criticalAlerts: asArray(raw.criticalAlerts).slice(0, 6),
    recommendedActions: asArray(raw.recommendedActions).slice(0, 8),
    engine,
  }
}

/**
 * AI clinical triage. Always resolves - falls back to clinicalRuleTriage so a
 * dispatch is never blocked. Inspect `.engine` to know which produced it.
 */
async function triageIncident({ chiefComplaint, vitals, voiceTranscript, age, gender, reporterType }) {
  const complaint = chiefComplaint || voiceTranscript || 'Emergency assistance requested'

  const system =
    'You are an emergency medicine triage physician applying the Emergency Severity Index (ESI). ' +
    'You reply with a single JSON object and nothing else. Be decisive: this drives real ambulance dispatch.'

  const reportedBy =
    reporterType === 'BYSTANDER'
      ? 'a bystander who is not the patient (details may be incomplete or second-hand)'
      : 'the patient themselves'

  const user = `Triage this emergency call.

Chief complaint / caller transcript: "${complaint}"
Patient age: ${age || 'unknown'}
Patient gender: ${gender || 'unknown'}
Measured vitals: ${vitals && Object.keys(vitals).length ? JSON.stringify(vitals) : 'none yet - call just received'}
Reported by: ${reportedBy}

Return exactly this JSON shape:
{
  "esiLevel": <integer 1-5; 1=resuscitation, 2=emergent, 3=urgent, 4=semi-urgent, 5=non-urgent>,
  "aiSummary": "<two sentences: likely clinical picture, then why this ESI level>",
  "aiConfidence": <number 0-1 reflecting genuine certainty given how little you were told>,
  "requiredSpecialties": [<subset of ${SPECIALTIES.join(', ')}>],
  "criticalAlerts": ["<immediate hazard>"],
  "recommendedActions": ["<concrete pre-hospital action>"]
}

If the information is thin, say so in aiSummary and lower aiConfidence rather than
inventing detail. When a bystander reports, prefer the more severe plausible
interpretation.`

  const result = await callLLM({
    system,
    user,
    validate: (p) => p && p.esiLevel != null,
  })

  if (result) return normaliseTriage(result.data, result.engine)

  console.warn('[AI] All triage tiers unavailable - using deterministic clinical rules')
  return clinicalRuleTriage(complaint, vitals)
}

/**
 * Rank candidate hospitals for a patient. Falls back to a transparent weighted
 * score when the LLM is unreachable.
 *
 * @param {object} opts
 * @param {number} opts.esiLevel
 * @param {string[]} opts.requiredSpecialties
 * @param {Array} opts.hospitals Plain objects shaped
 *   {id, name, icuAvailable, traumaAvailable, erWaitTime, capabilities[], distanceKm}
 */
async function rankHospitals({ esiLevel, requiredSpecialties = [], hospitals = [] }) {
  if (!hospitals.length) return { rankedHospitals: [], engine: 'none' }

  const system = 'You allocate emergency patients to hospitals. You reply with a single JSON object and nothing else.'

  const candidateLines = hospitals
    .map((h, i) => {
      const distance = h.distanceKm != null ? `distance: ${h.distanceKm}km` : 'distance unknown'
      const caps = (h.capabilities || []).join(',') || 'none listed'
      return `${i + 1}. id=${h.id} | ${h.name} | ICU free: ${h.icuAvailable} | trauma free: ${h.traumaAvailable} | ER wait: ${h.erWaitTime}min | ${distance} | capabilities: ${caps}`
    })
    .join('\n')

  const user = `Rank these hospitals for one emergency patient, best first.

Patient ESI level: ${esiLevel} (1 = most critical)
Required specialties: ${requiredSpecialties.join(', ') || 'general emergency care'}

Candidates:
${candidateLines}

Balance travel distance, ER wait, specialty match and spare capacity. A specialty
match matters more as ESI approaches 1. Never rank a hospital first if it lacks a
specialty this patient critically needs.

Return: {"rankedHospitals":[{"id":"<id>","score":<0-1>,"travelEta":<minutes>,"waitTime":<minutes>,"specialtyMatch":<0-1>,"capacityScore":<0-1>,"reason":"<one short clause>"}]}
Include every candidate.`

  const result = await callLLM({
    system,
    user,
    validate: (p) => Array.isArray(p?.rankedHospitals) && p.rankedHospitals.length > 0,
  })

  if (result) return { rankedHospitals: result.data.rankedHospitals, engine: result.engine }

  // Transparent deterministic scoring.
  const ranked = hospitals
    .map((h) => {
      const specialtyMatch = requiredSpecialties.length
        ? requiredSpecialties.filter((s) => (h.capabilities || []).includes(s)).length / requiredSpecialties.length
        : 0.7
      const capacityScore = Math.min(((h.icuAvailable || 0) + (h.traumaAvailable || 0)) / 10, 1)
      const waitScore = 1 - Math.min((h.erWaitTime || 30) / 60, 1)
      const distanceScore = h.distanceKm != null ? 1 - Math.min(h.distanceKm / 25, 1) : 0.5
      const score = 0.3 * distanceScore + 0.25 * waitScore + 0.25 * specialtyMatch + 0.2 * capacityScore

      return {
        id: h.id,
        score: parseFloat(score.toFixed(3)),
        // Derived from distance at an urban ambulance average of ~28 km/h, not random.
        travelEta: h.distanceKm != null ? Math.max(3, Math.round((h.distanceKm / 28) * 60)) : null,
        waitTime: h.erWaitTime ?? null,
        specialtyMatch: parseFloat(specialtyMatch.toFixed(2)),
        capacityScore: parseFloat(capacityScore.toFixed(2)),
        reason: 'Weighted score over distance, ER wait, specialty match and spare capacity',
      }
    })
    .sort((a, b) => b.score - a.score)

  return { rankedHospitals: ranked, engine: 'weighted-fallback' }
}

/**
 * Real speech-to-text via Groq Whisper. Replaces the browser-only Web Speech API
 * so voice triage works from the PWA on any mobile device.
 *
 * @param {Buffer} audioBuffer Raw audio (webm/ogg/mp4/wav/m4a).
 * @param {string} filename    Original filename; its extension drives format detection.
 */
async function transcribeAudio(audioBuffer, filename = 'audio.webm') {
  if (!GROQ_API_KEY) throw new Error('Speech-to-text unavailable: GROQ_API_KEY not configured')

  // Node 18+ provides FormData and Blob as globals.
  const form = new FormData()
  form.append('file', new Blob([audioBuffer]), filename)
  form.append('model', AUDIO_MODEL)
  form.append('response_format', 'json')
  form.append('temperature', '0')
  // Priming the decoder with domain vocabulary measurably improves accuracy on
  // Indian place names and clinical terms over a noisy phone mic.
  form.append(
    'prompt',
    'Emergency call in India. Possible terms: ambulance, chest pain, unconscious, bleeding, accident, Mumbai, Bandra, Andheri, Dadar, SpO2, blood pressure.'
  )

  const res = await axios.post(`${GROQ_BASE}/audio/transcriptions`, form, {
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    timeout: 30000,
  })

  return { text: cleanText(res.data?.text || ''), engine: `groq:${AUDIO_MODEL}` }
}

/**
 * Surge forecast derived from the project's own incident history.
 *
 * Method: bucket historical incidents by hour of day to get each hour's mean
 * call volume, scale to a 0-100 load index against the busiest observed hour,
 * then blend in the last 24h trend so the curve reacts to current conditions.
 * Confidence comes from how many real samples back each hour - never random.
 *
 * @param {import('mongoose').Model} IncidentModel
 * @param {number} hoursAhead
 */
async function forecastSurge(IncidentModel, hoursAhead = 12) {
  const now = new Date()

  /**
   * Both the history buckets and the forecast labels must be computed in ONE
   * timezone, the city's. Mongo's $hour defaults to UTC while JS getHours()
   * uses the server's local zone, so mixing them reads the wrong bucket -
   * silently correct on a UTC host like Render and wrong everywhere else.
   */
  const tz = process.env.CITY_TIMEZONE || 'Asia/Kolkata'
  const hourInTz = (date) =>
    parseInt(
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(date),
      10
    ) % 24

  // Mean incidents per clock hour across all history, with sample counts.
  const byHour = await IncidentModel.aggregate([
    { $match: { createdAt: { $exists: true, $ne: null } } },
    {
      $group: {
        _id: {
          hour: { $hour: { date: '$createdAt', timezone: tz } },
          day: { $dayOfYear: { date: '$createdAt', timezone: tz } },
          year: { $year: { date: '$createdAt', timezone: tz } },
        },
        count: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: '$_id.hour',
        // Mean calls in this clock hour, averaged over the days observed.
        avgCount: { $avg: '$count' },
        samples: { $sum: 1 },
        peak: { $max: '$count' },
      },
    },
  ])

  const profile = new Map(byHour.map((h) => [h._id, h]))
  const observedPeak = Math.max(1, ...byHour.map((h) => h.avgCount))

  // Recent pressure, used to shift the whole curve up or down.
  const activeNow = await IncidentModel.countDocuments({
    status: { $nin: ['COMPLETED', 'CANCELLED'] },
  })
  const last24h = await IncidentModel.countDocuments({
    createdAt: { $gte: new Date(now.getTime() - 86400000) },
  })

  // Expected calls in a full day is the sum of the hourly means - not peak*24,
  // which overstates a normal day by the ratio of peak to mean and pinned the
  // trend factor to its lower clamp on any realistic dataset.
  const expectedDaily = byHour.reduce((sum, h) => sum + h.avgCount, 0)
  const trendFactor =
    expectedDaily > 0 && last24h > 0
      ? Math.min(1.5, Math.max(0.6, last24h / expectedDaily))
      : 1

  const totalSamples = byHour.reduce((sum, h) => sum + h.samples, 0)

  const forecast = []
  for (let i = 0; i < hoursAhead; i++) {
    const at = new Date(now.getTime() + i * 3600000)
    const hour = hourInTz(at)
    const bucket = profile.get(hour)

    // Load index relative to the busiest observed hour.
    const baseLoad = bucket ? (bucket.avgCount / observedPeak) * 100 : 35
    const predictedLoad = Math.round(Math.min(100, Math.max(5, baseLoad * trendFactor)))

    // Confidence scales with real sample depth for this hour, capped honestly.
    const samples = bucket?.samples || 0
    const confidence = Math.round(Math.min(92, 35 + samples * 12))

    forecast.push({
      time: at.toISOString(),
      hour: `${String(hour).padStart(2, '0')}:00`,
      predictedLoad,
      confidence,
      samples,
      riskLevel: predictedLoad > 70 ? 'HIGH' : predictedLoad > 45 ? 'MEDIUM' : 'LOW',
    })
  }

  return {
    forecast,
    generatedAt: now.toISOString(),
    // Surfaced so the Admin chart can warn when history is too thin to trust.
    basis: {
      historicalSamples: totalSamples,
      activeNow,
      last24h,
      observedPeakPerHour: Math.round(observedPeak * 10) / 10,
      expectedDaily: Math.round(expectedDaily * 10) / 10,
      trendFactor: Math.round(trendFactor * 100) / 100,
      timezone: tz,
    },
    engine: totalSamples > 0 ? 'history' : 'insufficient-data',
  }
}

/** Live provider reachability, for the AI status badge in the UI. */
async function getAIHealth() {
  const configured = {
    groq: Boolean(GROQ_API_KEY),
    openrouter: Boolean(OPENROUTER_API_KEY && OPENROUTER_MODEL),
  }

  if (!GROQ_API_KEY) {
    return { ok: false, configured, model: null, message: 'GROQ_API_KEY is not set' }
  }

  try {
    const res = await axios.get(`${GROQ_BASE}/models`, {
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      timeout: 6000,
    })

    const available = (res.data?.data || []).map((m) => m.id)
    const primary = CHAT_MODELS[0].model
    const reachable = available.includes(primary)

    return {
      ok: reachable,
      configured,
      model: primary,
      audioModel: AUDIO_MODEL,
      message: reachable ? 'AI triage online' : `Configured model ${primary} is not available on this key`,
    }
  } catch (err) {
    return { ok: false, configured, model: CHAT_MODELS[0].model, message: err.message }
  }
}

module.exports = {
  triageIncident,
  rankHospitals,
  transcribeAudio,
  forecastSurge,
  clinicalRuleTriage,
  getAIHealth,
  CHAT_MODELS,
  SPECIALTIES,
}
