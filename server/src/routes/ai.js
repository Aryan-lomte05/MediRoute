/**
 * ==============================================================================
 * MEDIROUTE - AI ENGINE ROUTES (routes/ai.js)
 * ==============================================================================
 *
 * WHAT IS WHERE:
 * - Line 30-45:   GET  /api/ai/health          - live AI provider status badge
 * - Line 47-80:   POST /api/ai/triage          - clinical triage (ESI 1-5)
 * - Line 82-140:  POST /api/ai/allocation      - hospital ranking for a patient
 * - Line 142-200: POST /api/ai/route           - OSRM turn-by-turn road routing
 * - Line 202-250: POST /api/ai/transcribe      - Groq Whisper speech-to-text
 * - Line 252-290: POST /api/ai/voice-triage    - audio in, triage out (one call)
 * - Line 292-315: GET  /api/ai/surge-forecast  - history-derived surge forecast
 *
 * All model selection lives in services/aiService.js, never here.
 *
 * AUTH POLICY: triage, transcription and routing accept optionalAuth because a
 * citizen reporting an emergency has no account (see routes/incidents.js). They
 * are protected by the global rate limiter instead. Allocation requires a real
 * session because it exposes hospital capacity across the city.
 * ==============================================================================
 */

const express = require('express')
const axios = require('axios')
const { auth, optionalAuth } = require('../middleware/auth')
const Incident = require('../models/Incident')
const aiService = require('../services/aiService')

const router = express.Router()

const OSRM_BASE = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org'

// Accept raw audio bodies for the speech-to-text endpoints without pulling in
// a multipart dependency. Groq caps uploads at 25MB.
const rawAudio = express.raw({
  type: ['audio/*', 'video/webm', 'application/octet-stream'],
  limit: '25mb',
})

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/ai/health - is the AI genuinely reachable right now?
// ──────────────────────────────────────────────────────────────────────────────
// The UI uses this to show an honest "AI online / degraded" badge rather than
// implying AI is working when every call is silently falling back to rules.
router.get('/health', async (req, res, next) => {
  try {
    res.json(await aiService.getAIHealth())
  } catch (err) {
    next(err)
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/ai/triage - clinical triage
// ──────────────────────────────────────────────────────────────────────────────
router.post('/triage', optionalAuth, async (req, res, next) => {
  try {
    const { chiefComplaint, vitals, voiceTranscript, age, gender, reporterType } = req.body

    if (!chiefComplaint && !voiceTranscript) {
      return res.status(400).json({ message: 'chiefComplaint or voiceTranscript is required' })
    }

    const triage = await aiService.triageIncident({
      chiefComplaint,
      vitals,
      voiceTranscript,
      age: age || req.user?.emergencyProfile?.age,
      gender: gender || req.user?.emergencyProfile?.gender,
      reporterType,
    })

    // `engine` tells the client whether this came from a model or the rule
    // fallback, so the UI can label it accurately.
    res.json(triage)
  } catch (err) {
    next(err)
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/ai/allocation - rank hospitals for a patient
// ──────────────────────────────────────────────────────────────────────────────
router.post('/allocation', auth, async (req, res, next) => {
  try {
    const { esiLevel, requiredSpecialties, hospitals, patientLocation } = req.body

    if (!Array.isArray(hospitals) || hospitals.length === 0) {
      return res.status(400).json({ message: 'hospitals array is required for allocation' })
    }

    // Compute real great-circle distance when the patient location is known, so
    // the ranking is grounded in geography rather than guessed by the model.
    const withDistance = hospitals.map((h) => {
      if (!patientLocation || !Array.isArray(h.location) || h.location.length !== 2) return h
      return { ...h, distanceKm: haversineKm(patientLocation, h.location) }
    })

    const result = await aiService.rankHospitals({
      esiLevel: esiLevel || 3,
      requiredSpecialties: requiredSpecialties || [],
      hospitals: withDistance,
    })

    res.json(result)
  } catch (err) {
    next(err)
  }
})

/** Great-circle distance in km between two [lng, lat] pairs. */
function haversineKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/ai/route - OSRM road routing
// ──────────────────────────────────────────────────────────────────────────────
router.post('/route', optionalAuth, async (req, res, next) => {
  try {
    const { origin, destination, waypoints = [] } = req.body

    const valid = (c) => Array.isArray(c) && c.length === 2 && c.every((n) => Number.isFinite(Number(n)))
    if (!valid(origin) || !valid(destination)) {
      return res.status(400).json({ message: 'origin and destination must each be [lng, lat]' })
    }

    // OSRM expects lng,lat pairs separated by semicolons.
    const coords = [origin, ...waypoints.filter(valid), destination]
      .map((c) => `${c[0]},${c[1]}`)
      .join(';')

    const osrmRes = await axios.get(
      `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`,
      { timeout: 10000 }
    )

    const route = osrmRes.data?.routes?.[0]
    if (!route) return res.status(502).json({ message: 'No route found between those points' })

    res.json({
      geometry: route.geometry,
      distanceKm: parseFloat((route.distance / 1000).toFixed(2)),
      etaMinutes: Math.ceil(route.duration / 60),
      steps: (route.legs?.[0]?.steps || []).map((s) => ({
        instruction: s.maneuver?.modifier
          ? `${s.maneuver.type} ${s.maneuver.modifier}`
          : s.maneuver?.type || 'continue',
        name: s.name || '',
        distanceM: Math.round(s.distance),
        durationS: Math.round(s.duration),
      })),
      engine: 'osrm',
    })
  } catch (err) {
    console.error('[AI] OSRM routing error:', err.message)
    res.status(503).json({ message: 'Routing service unavailable', engine: 'osrm' })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/ai/transcribe - raw audio to text (Groq Whisper)
// ──────────────────────────────────────────────────────────────────────────────
// Body: raw audio bytes with an audio/* Content-Type. Works from MediaRecorder
// in the PWA, so voice reporting no longer depends on the browser's Web Speech
// API (which is unavailable in several mobile browsers).
router.post('/transcribe', optionalAuth, rawAudio, async (req, res, next) => {
  try {
    if (!req.body || !req.body.length) {
      return res.status(400).json({ message: 'Audio body is empty. Send raw audio bytes with an audio/* Content-Type.' })
    }

    const ext = (req.headers['content-type'] || '').includes('mp4') ? 'mp4' : 'webm'
    const { text, engine } = await aiService.transcribeAudio(req.body, `report.${ext}`)

    if (!text) return res.status(422).json({ message: 'No speech detected in the recording' })

    res.json({ transcript: text, engine })
  } catch (err) {
    console.error('[AI] Transcription error:', err.message)
    res.status(503).json({ message: 'Speech-to-text unavailable' })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/ai/voice-triage - audio in, clinical triage out
// ──────────────────────────────────────────────────────────────────────────────
// Replaces the previous implementation, which issued an HTTP request to its own
// process on http://localhost:PORT. That self-call consumed the service's own
// rate limit and broke behind Render's proxy. Both steps now run in-process.
router.post('/voice-triage', optionalAuth, rawAudio, async (req, res, next) => {
  try {
    if (!req.body || !req.body.length) {
      return res.status(400).json({ message: 'Audio body is empty' })
    }

    const ext = (req.headers['content-type'] || '').includes('mp4') ? 'mp4' : 'webm'
    const { text, engine: sttEngine } = await aiService.transcribeAudio(req.body, `report.${ext}`)

    if (!text) return res.status(422).json({ message: 'No speech detected in the recording' })

    const triage = await aiService.triageIncident({
      voiceTranscript: text,
      reporterType: req.query.reporterType,
    })

    res.json({ transcript: text, sttEngine, triage })
  } catch (err) {
    console.error('[AI] Voice triage error:', err.message)
    res.status(503).json({ message: 'Voice triage unavailable' })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/ai/surge-forecast - forecast derived from real incident history
// ──────────────────────────────────────────────────────────────────────────────
// Previously returned Math.sin() + Math.random(), which looked like a forecast
// but carried no information. Now aggregated from this deployment's own
// incidents, with confidence scaled to the sample depth behind each hour.
router.get('/surge-forecast', optionalAuth, async (req, res, next) => {
  try {
    const hours = Math.min(48, Math.max(1, parseInt(req.query.hours, 10) || 12))
    res.json(await aiService.forecastSurge(Incident, hours))
  } catch (err) {
    next(err)
  }
})

module.exports = router
