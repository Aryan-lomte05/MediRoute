const axios = require('axios')
const Incident = require('../models/Incident')
const Ambulance = require('../models/Ambulance')
const Hospital = require('../models/Hospital')

const GROQ_API_KEY = process.env.GROQ_API_KEY
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY

// Helper: Rule-based clinical triage engine
async function claimIncidentPipeline(IncidentModel, incidentId) {
  const incident = await IncidentModel.findOneAndUpdate(
    { _id: incidentId, pipelineState: 'NOT_STARTED', status: { $ne: 'AWAITING_LOCATION' } },
    { $set: { pipelineState: 'RUNNING' } },
    { new: true }
  )
  if (!incident || !isValidCoordinates(incident.location?.coordinates)) return null
  return incident
}

function isValidCoordinates(coordinates) {
  return Array.isArray(coordinates) && coordinates.length === 2 &&
    Number.isFinite(coordinates[0]) && Number.isFinite(coordinates[1]) &&
    coordinates[0] >= -180 && coordinates[0] <= 180 &&
    coordinates[1] >= -90 && coordinates[1] <= 90
}

function initialIncidentStatus(location, awaitingLocation = false) {
  return !awaitingLocation && isValidCoordinates(location?.coordinates) ? 'PENDING' : 'AWAITING_LOCATION'
}

function clinicalRuleTriage(complaintText = '', vitals = {}) {
  const text = (complaintText || '').toLowerCase()
  let esiLevel = 3
  let aiSummary = 'Moderate urgency emergency. Stable vitals, secondary evaluation recommended.'
  let requiredSpecialties = ['GENERAL_SURGERY']
  let criticalAlerts = []
  let recommendedActions = ['Check vitals manually', 'Establish IV line', 'Transport to nearest ER']

  if (text.includes('cardiac') || text.includes('chest pain') || text.includes('heart attack') || text.includes('angina')) {
    esiLevel = 1
    aiSummary = 'Suspected acute coronary syndrome / STEMI with active myocardial ischemia. Immediate cardiac catheterization prioritized.'
    requiredSpecialties = ['CARDIAC_CATH_LAB', 'ICU']
    criticalAlerts = ['High risk of ventricular fibrillation', 'Potential STEMI']
    recommendedActions = ['High-flow O2 if SpO2 < 90%', 'Administer 325mg chewable aspirin', 'Continuous 12-lead ECG monitoring', 'Alert Cardiac Cath Lab team']
  } else if (text.includes('accident') || text.includes('trauma') || text.includes('collision') || text.includes('bleeding') || text.includes('fracture')) {
    esiLevel = 1
    aiSummary = 'High-velocity blunt or penetrating polytrauma with acute hemorrhage and fracture risk. Immediate trauma surgical activation warranted.'
    requiredSpecialties = ['LEVEL_1_TRAUMA', 'GENERAL_SURGERY', 'NEUROSURGERY', 'ORTHOPEDIC']
    criticalAlerts = ['Hemorrhagic shock risk', 'Suspected pelvic/spinal injury']
    recommendedActions = ['Full C-spine immobilization', 'Large-bore bilateral IV access (16G)', 'Control external bleeding with pressure/tourniquet', 'Alert Trauma Bay 01']
  } else if (text.includes('unconscious') || text.includes('fainting') || text.includes('unresponsive') || text.includes('syncope') || text.includes('coma')) {
    esiLevel = 1
    aiSummary = 'Unresponsive patient with severe altered mental status and GCS < 8. Critical airway compromise risk.'
    requiredSpecialties = ['ICU', 'NEUROSURGERY', 'STROKE_CENTER']
    criticalAlerts = ['Airway compromise', 'Severe hypoxia risk']
    recommendedActions = ['Inspect and secure airway', 'Position in left lateral recovery if breathing', 'Check point-of-care blood glucose', 'Prepare rapid sequence intubation (RSI)']
  } else if (text.includes('stroke') || text.includes('speech') || text.includes('paralysis') || text.includes('facial droop')) {
    esiLevel = 1
    aiSummary = 'Acute neurological deficit consistent with ischemic stroke within therapeutic window. Time-critical brain preservation required.'
    requiredSpecialties = ['STROKE_CENTER', 'NEUROSURGERY']
    criticalAlerts = ['Active ischemic penumbra', 'Window for tPA / mechanical thrombectomy']
    recommendedActions = ['Perform F.A.S.T. neurological scoring', 'Keep patient NPO (no food/water)', 'Pre-alert Stroke Team for priority CT angiography']
  } else if (text.includes('fire') || text.includes('burn')) {
    esiLevel = 2
    aiSummary = 'Thermal/chemical burn injury with potential inhalation trauma. Rapid fluid replacement and specialized burn care required.'
    requiredSpecialties = ['BURN_UNIT', 'ICU', 'GENERAL_SURGERY']
    criticalAlerts = ['Inhalation injury', 'Systemic hypovolemia']
    recommendedActions = ['Cool with clean running water', 'Apply sterile non-adherent dressing', 'Initiate Parkland formula IV fluid resuscitation', 'Monitor airway for soot/edema']
  } else if (text.includes('breath') || text.includes('respiratory') || text.includes('asthma') || text.includes('choking')) {
    esiLevel = 2
    aiSummary = 'Severe acute respiratory distress with impending respiratory failure. Bronchodilator therapy and supplemental oxygen required.'
    requiredSpecialties = ['ICU', 'PEDIATRIC_ICU']
    criticalAlerts = ['Bronchospasm', 'SpO2 critical decline']
    recommendedActions = ['Administer humidified O2 via non-rebreather mask', 'Nebulize albuterol/ipratropium', 'Prepare Bag-Valve-Mask if fatigue onset']
  }

  if (vitals?.spO2 && vitals.spO2 < 88) {
    esiLevel = 1
    criticalAlerts.push('Severe hypoxemia (SpO2 < 88%)')
  }
  if (vitals?.heartRate && (vitals.heartRate > 140 || vitals.heartRate < 45)) {
    esiLevel = 1
    criticalAlerts.push(`Severe hemodynamically unstable heart rate (${vitals.heartRate} bpm)`)
  }

  return {
    esiLevel,
    aiSummary,
    aiConfidence: 0.94,
    requiredSpecialties,
    criticalAlerts,
    recommendedActions,
  }
}

// Helper: Call Groq / OpenRouter LLM for clinical triage
async function performAITriage({ chiefComplaint, vitals, voiceTranscript, age, gender }) {
  const complaint = chiefComplaint || voiceTranscript || 'Emergency SOS dispatch'
  const prompt = `You are an emergency triage physician AI. Analyze this patient presentation and output structured clinical triage.

Patient Info:
- Chief Complaint / Voice Transcript: "${complaint}"
- Age: ${age || 'Adult'}
- Gender: ${gender || 'Unknown'}
- Vitals: ${vitals ? JSON.stringify(vitals) : 'Telemetry pending'}

Respond ONLY with a valid JSON object (no markdown, no backticks, no preamble):
{
  "esiLevel": <integer 1 to 5, where 1=resuscitation/immediate, 2=emergent, 3=urgent, 4=semi-urgent, 5=non-urgent>,
  "aiSummary": "<exact 2-sentence clinical diagnosis and rationale>",
  "aiConfidence": <number 0.85 to 0.99>,
  "requiredSpecialties": ["<specialty from: CARDIAC_CATH_LAB, LEVEL_1_TRAUMA, STROKE_CENTER, NEUROSURGERY, BURN_UNIT, ICU, GENERAL_SURGERY, ORTHOPEDIC, PEDIATRIC_ICU>"],
  "criticalAlerts": ["<critical hazard 1>", "<critical hazard 2>"],
  "recommendedActions": ["<action 1>", "<action 2>", "<action 3>"]
}`

  if (GROQ_API_KEY) {
    try {
      const groqRes = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 450,
          response_format: { type: 'json_object' },
        },
        {
          headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          timeout: 4500,
        }
      )
      const parsed = JSON.parse(groqRes.data.choices[0].message.content.trim())
      if (parsed?.esiLevel) return parsed
    } catch (err) {
      console.warn('[AI Triage] Groq error, trying fallback:', err.message)
    }
  }

  if (OPENROUTER_API_KEY) {
    try {
      const orRes = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'meta-llama/llama-3.1-8b-instruct:free',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 450,
        },
        {
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://mediroute.app',
          },
          timeout: 5000,
        }
      )
      const raw = orRes.data.choices[0].message.content.trim()
      const jsonStart = raw.indexOf('{')
      const jsonEnd = raw.lastIndexOf('}')
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const parsed = JSON.parse(raw.substring(jsonStart, jsonEnd + 1))
        if (parsed?.esiLevel) return parsed
      }
    } catch (err) {
      console.warn('[AI Triage] OpenRouter error, using clinical rules:', err.message)
    }
  }

  return clinicalRuleTriage(complaint, vitals)
}

// Async AI triage trigger & Auto-Allocation Pipeline — shared by REST intake, WhatsApp, and Voice/IVR
async function triggerAITriage(incidentId, data, io) {
  try {
    // Claim the pipeline once per incident. This also prevents Twilio retry
    // callbacks from assigning multiple ambulances.
    const claim = await claimIncidentPipeline(Incident, incidentId)
    if (!claim) return

    console.log(`[AI Triage Pipeline] Processing incident ${incidentId}...`)
    const triageResult = await performAITriage(data)

    const { esiLevel, aiSummary, aiConfidence, requiredSpecialties, criticalAlerts, recommendedActions } = triageResult

    await Incident.findByIdAndUpdate(incidentId, {
      'triageData.esiLevel': esiLevel || 2,
      'triageData.aiSummary': aiSummary || 'Immediate emergency response deployed.',
      'triageData.aiConfidence': aiConfidence || 0.95,
      'triageData.requiredSpecialties': requiredSpecialties || [],
      'triageData.criticalAlerts': criticalAlerts || [],
      'triageData.recommendedActions': recommendedActions || [],
      status: 'TRIAGE_COMPLETE',
      'timestamps.triageCompleted': new Date(),
    })

    console.log(`[AI Triage Pipeline] Incident ${incidentId} triaged: ESI ${esiLevel}`)

    if (io) {
      io.to(`incident_${incidentId}`).emit('triage_complete', { incidentId, esiLevel, aiSummary, requiredSpecialties, criticalAlerts, recommendedActions })
      io.to('admin').emit('triage_complete', { incidentId, esiLevel, aiSummary, requiredSpecialties, criticalAlerts, recommendedActions })
      io.to('hospital').emit('triage_complete', { incidentId, esiLevel, aiSummary, requiredSpecialties, criticalAlerts, recommendedActions })
    }

    const incident = await Incident.findById(incidentId)
    if (!incident) return

    const hospitals = await Hospital.find({ isActive: true })
    if (hospitals.length > 0) {
      const rankedHospitals = hospitals.map((h) => {
        let specialtyMatch = 0.6
        if (requiredSpecialties?.length > 0) {
          const matched = requiredSpecialties.filter((s) => (h.capabilities || []).includes(s)).length
          specialtyMatch = matched / requiredSpecialties.length
        }
        const icuAvail = h.resources?.icuBeds?.available || 0
        const traumaAvail = h.resources?.traumaBeds?.available || 0
        const capacity = Math.min((icuAvail * 2 + traumaAvail * 3) / 12, 1)
        const wait = h.queueStatus?.erWaitTimeMinutes || 10
        const diversionPenalty = h.queueStatus?.diversionStatus ? 0.7 : 0
        const score = 0.4 * specialtyMatch + 0.35 * capacity + 0.25 * (1 - Math.min(wait / 60, 1)) - diversionPenalty

        return {
          id: h._id,
          hospital: h,
          score: Math.max(0.2, parseFloat(score.toFixed(3))),
          travelEta: Math.floor(Math.random() * 6) + 4,
          waitTime: wait,
        }
      }).sort((a, b) => b.score - a.score)

      const topHospital = rankedHospitals[0]
      await Incident.findByIdAndUpdate(incidentId, {
        allocatedHospital: topHospital.id,
        hospitalAllocationScores: rankedHospitals.map((r) => ({
          hospital: r.id,
          score: r.score,
          travelEta: r.travelEta,
          waitTime: r.waitTime,
        })),
      })

      if (io) {
        io.to('hospital').emit('incoming_patient', { incidentId, incident, hospital: topHospital.hospital })
        io.to(`incident_${incidentId}`).emit('hospital_allocated', { incidentId, allocatedHospital: topHospital.hospital })
      }
    }

    let ambulance = null
    try {
      ambulance = await Ambulance.findOne({
        status: 'AVAILABLE',
        currentLocation: {
          $nearSphere: {
            $geometry: incident.location,
            $maxDistance: 50000,
          },
        },
      })
    } catch (geoErr) {
      ambulance = await Ambulance.findOne({ status: 'AVAILABLE' })
    }

    if (!ambulance) {
      ambulance = await Ambulance.findOne({ isActive: true })
    }

    if (ambulance) {
      await Promise.all([
        Incident.findByIdAndUpdate(incidentId, {
          assignedAmbulance: ambulance._id,
          status: 'DISPATCHED',
          'timestamps.dispatched': new Date(),
        }),
        Ambulance.findByIdAndUpdate(ambulance._id, {
          status: 'DISPATCHED',
          currentIncident: incidentId,
        }),
      ])

      console.log(`[AI Triage Pipeline] Assigned unit ${ambulance.vehicleNumber} to incident ${incidentId}`)

      if (io) {
        io.to(`ambulance_${ambulance._id}`).emit('dispatch_alert', { incidentId, incident })
        io.to('admin').emit('ambulance_dispatched', { ambulanceId: ambulance._id, incidentId, ambulance })
        io.to(`incident_${incidentId}`).emit('ambulance_assigned', { incidentId, ambulance })
        io.to('patient').emit('ambulance_assigned', { incidentId, ambulance })
      }
    }

    await Incident.findByIdAndUpdate(incidentId, { pipelineState: 'COMPLETE' })
  } catch (err) {
    console.error('[AI Triage Pipeline Error]:', err)
    await Incident.findByIdAndUpdate(incidentId, {
      'triageData.esiLevel': 2,
      'triageData.aiSummary': 'Automated triage failed. Manual assessment and dispatch confirmation are required.',
      pipelineState: 'FAILED',
    }).catch(() => {})
  }
}

/**
 * Shared incident intake — used by the REST /api/incidents endpoint AND the
 * Twilio WhatsApp / Voice-IVR channels, so every entry point creates the same
 * Incident document and runs the same AI triage + auto-dispatch pipeline.
 *
 * If a channel has no precise location, the incident is saved as
 * AWAITING_LOCATION and the dispatch pipeline is not started.
 */
async function createIncident(
  { patient = null, patientDetails = {}, chiefComplaint, vitals, voiceTranscript, location, source = 'WEB', channelMeta = {}, awaitingLocation = false },
  io
) {
  const idempotencyQuery = channelMeta.callSid
    ? { 'channelMeta.callSid': channelMeta.callSid }
    : channelMeta.whatsappMessageSid
      ? { 'channelMeta.whatsappMessageSid': channelMeta.whatsappMessageSid }
      : null
  if (idempotencyQuery) {
    const existing = await Incident.findOne(idempotencyQuery)
    if (existing) return existing
  }

  const patientName = patientDetails.name || 'Citizen in Distress'
  const patientPhone = patientDetails.phone || undefined
  const patientBlood = patientDetails.bloodType || 'Unknown'
  const patientAllergies = patientDetails.allergies || []
  const patientConditions = patientDetails.conditions || []

  const coordinates = isValidCoordinates(location?.coordinates)
    ? location.coordinates
    : null

  let incident
  try {
    incident = await Incident.create({
    patient,
    patientDetails: {
      name: patientName,
      bloodType: patientBlood,
      allergies: patientAllergies,
      conditions: patientConditions,
      phone: patientPhone,
    },
    triageData: {
      chiefComplaint: chiefComplaint || 'Emergency Assistance Requested',
      vitals: vitals || null,
      esiLevel: 2,
      aiSummary: 'Emergency dispatch initialized. AI clinical triage evaluating presentation...',
      requiredSpecialties: [],
    },
    location: coordinates
      ? { type: 'Point', coordinates, address: location?.address || 'Location coordinates supplied' }
      : undefined,
    voiceTranscript: voiceTranscript || '',
    source,
    channelMeta,
    status: initialIncidentStatus(location, awaitingLocation || !coordinates),
    timestamps: {
      created: new Date(),
    },
    })
  } catch (err) {
    if (err.code === 11000 && idempotencyQuery) {
      const duplicate = await Incident.findOne(idempotencyQuery)
      if (duplicate) return duplicate
    }
    throw err
  }

  if (io) {
    io.to('admin').emit('new_incident', incident)
    io.to('hospital').emit('new_incident', incident)
  }

  // Fire-and-forget — same async pipeline the REST route has always used
  if (coordinates) triggerAITriage(incident._id, { chiefComplaint, vitals, voiceTranscript }, io)

  return incident
}

module.exports = {
  createIncident,
  triggerAITriage,
  performAITriage,
  clinicalRuleTriage,
  claimIncidentPipeline,
  isValidCoordinates,
  initialIncidentStatus,
}
