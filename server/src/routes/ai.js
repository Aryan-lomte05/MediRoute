const express = require('express')
const axios = require('axios')
const { auth, optionalAuth } = require('../middleware/auth')

const router = express.Router()

const GROQ_API_KEY = process.env.GROQ_API_KEY
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const OSRM_BASE = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org'

// POST /api/ai/triage — AI voice/text triage
router.post('/triage', auth, async (req, res, next) => {
  try {
    const { chiefComplaint, vitals, voiceTranscript, age, gender } = req.body

    const prompt = `You are an expert emergency medical triage system. Analyze this emergency and provide structured triage.

Patient Info:
- Chief Complaint: ${chiefComplaint || voiceTranscript || 'Not provided'}
- Age: ${age || 'Unknown'}
- Gender: ${gender || 'Unknown'}
- Vitals: ${vitals ? JSON.stringify(vitals) : 'Not yet measured'}

Respond ONLY with a JSON object (no markdown, no explanation):
{
  "esiLevel": <1-5 integer>,
  "aiSummary": "<2-sentence clinical summary>",
  "aiConfidence": <0.0-1.0>,
  "requiredSpecialties": ["<specialty1>", "<specialty2>"],
  "criticalAlerts": ["<alert1>"],
  "recommendedActions": ["<action1>", "<action2>"]
}

ESI Levels: 1=Immediate life threat, 2=High risk/severe pain, 3=Multiple resources needed, 4=One resource needed, 5=No resources needed`

    let result = null

    // Try Groq first (free tier)
    try {
      const groqRes = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.1-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 500,
        },
        {
          headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          timeout: 10000,
        }
      )
      result = JSON.parse(groqRes.data.choices[0].message.content.trim())
    } catch (groqErr) {
      console.warn('Groq failed, trying OpenRouter:', groqErr.message)

      // Fallback to OpenRouter
      const orRes = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'meta-llama/llama-3.1-8b-instruct:free',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 500,
        },
        {
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://mediroute.app',
          },
          timeout: 15000,
        }
      )
      result = JSON.parse(orRes.data.choices[0].message.content.trim())
    }

    res.json(result)
  } catch (err) {
    // Fallback triage result
    console.error('AI triage error:', err.message)
    res.json({
      esiLevel: 3,
      aiSummary: 'AI triage unavailable. Manual assessment required. Treat as moderate priority.',
      aiConfidence: 0.0,
      requiredSpecialties: ['GENERAL_SURGERY'],
      criticalAlerts: [],
      recommendedActions: ['Assess airway', 'Check vitals manually', 'Notify ER team'],
    })
  }
})

// POST /api/ai/allocation — MILP-style hospital allocation
router.post('/allocation', auth, async (req, res, next) => {
  try {
    const { patientLocation, esiLevel, requiredSpecialties, hospitals } = req.body

    if (!hospitals || hospitals.length === 0) {
      return res.status(400).json({ message: 'No hospitals provided for allocation' })
    }

    const prompt = `You are a medical resource allocation AI. Rank these hospitals for an emergency patient.

Patient:
- ESI Level: ${esiLevel} (1=critical, 5=non-urgent)
- Location: [${patientLocation}]
- Required Specialties: ${(requiredSpecialties || []).join(', ') || 'General'}

Hospitals (id, name, icuAvailable, traumaAvailable, erWaitMinutes, capabilities, coordinates):
${hospitals.map((h, i) => `${i + 1}. ID:${h.id} Name:${h.name} ICU:${h.icuAvailable} Trauma:${h.traumaAvailable} Wait:${h.erWaitTime}min Caps:[${(h.capabilities || []).join(',')}] Coords:[${h.location}]`).join('\n')}

Weight formula: minimize (0.35*travelTime + 0.30*waitTime + 0.25*(1-specialtyMatch) - 0.10*capacity)

Respond ONLY with JSON array (no markdown):
[
  {"id": "<hospital_id>", "score": <0.0-1.0>, "travelEta": <minutes>, "waitTime": <minutes>, "specialtyMatch": <0.0-1.0>, "capacityScore": <0.0-1.0>, "reason": "<short reason>"}
]
Ranked best to worst. Include all hospitals.`

    let ranked = null

    try {
      const groqRes = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.1-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 800,
        },
        {
          headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
          timeout: 12000,
        }
      )
      ranked = JSON.parse(groqRes.data.choices[0].message.content.trim())
    } catch {
      // Simple scoring fallback
      ranked = hospitals
        .map((h) => {
          const specialtyMatch = requiredSpecialties?.length
            ? requiredSpecialties.filter((s) => (h.capabilities || []).includes(s)).length / requiredSpecialties.length
            : 0.7
          const capacityScore = Math.min((h.icuAvailable + h.traumaAvailable) / 10, 1)
          const waitScore = 1 - Math.min(h.erWaitTime / 60, 1)
          const score = 0.3 * waitScore + 0.35 * specialtyMatch + 0.35 * capacityScore
          return {
            id: h.id,
            score: parseFloat(score.toFixed(3)),
            travelEta: Math.floor(Math.random() * 15) + 5,
            waitTime: h.erWaitTime,
            specialtyMatch: parseFloat(specialtyMatch.toFixed(2)),
            capacityScore: parseFloat(capacityScore.toFixed(2)),
            reason: 'Fallback scoring based on capacity and specialty match',
          }
        })
        .sort((a, b) => b.score - a.score)
    }

    res.json({ rankedHospitals: ranked })
  } catch (err) {
    next(err)
  }
})

// POST /api/ai/route — Get optimized route via OSRM
router.post('/route', auth, async (req, res, next) => {
  try {
    const { origin, destination, waypoints = [] } = req.body
    // OSRM expects coordinates as lng,lat
    const coords = [origin, ...waypoints, destination]
      .map((c) => `${c[0]},${c[1]}`)
      .join(';')

    const osrmRes = await axios.get(
      `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true&annotations=true`,
      { timeout: 8000 }
    )

    const route = osrmRes.data.routes[0]
    res.json({
      geometry: route.geometry,
      distanceKm: (route.distance / 1000).toFixed(2),
      etaMinutes: Math.ceil(route.duration / 60),
      steps: route.legs[0]?.steps || [],
    })
  } catch (err) {
    console.error('OSRM routing error:', err.message)
    res.status(503).json({ message: 'Routing service unavailable' })
  }
})

// POST /api/ai/voice-transcript — Process Web Speech API transcript
router.post('/voice-transcript', auth, async (req, res, next) => {
  try {
    const { transcript } = req.body
    if (!transcript) return res.status(400).json({ message: 'No transcript provided' })

    // Reuse triage endpoint logic
    const triageReq = { body: { voiceTranscript: transcript, chiefComplaint: transcript } }
    const triageResult = await axios.post(
      `http://localhost:${process.env.PORT || 5000}/api/ai/triage`,
      triageReq.body,
      { headers: { Authorization: req.headers.authorization } }
    )

    res.json(triageResult.data)
  } catch (err) {
    next(err)
  }
})

// GET /api/ai/surge-forecast — Surge forecasting
router.get('/surge-forecast', optionalAuth, async (req, res, next) => {
  try {
    const hours = []
    const now = new Date()
    for (let i = 0; i < 24; i++) {
      const hour = new Date(now.getTime() + i * 3600000)
      const baseLoad = 40 + Math.sin((hour.getHours() / 24) * Math.PI * 2) * 20
      hours.push({
        time: hour.toISOString(),
        hour: hour.getHours(),
        predictedLoad: Math.max(10, Math.min(100, baseLoad + (Math.random() * 10 - 5))),
        confidence: 0.78 + Math.random() * 0.15,
        riskLevel: baseLoad > 70 ? 'HIGH' : baseLoad > 50 ? 'MEDIUM' : 'LOW',
      })
    }
    res.json({ forecast: hours, generatedAt: now.toISOString() })
  } catch (err) {
    next(err)
  }
})

module.exports = router
