/**
 * ==============================================================================
 * MEDIROUTE - INCIDENT ROUTES & DISPATCH PIPELINE (routes/incidents.js)
 * ==============================================================================
 *
 * WHAT IS WHERE:
 * - Line 40-95:    Shared helpers (haversine, ETA, hospital candidate shaping)
 * - Line 97-175:   allocateHospital() - ONE allocation implementation
 * - Line 177-290:  runDispatchPipeline() - triage -> hospital -> ambulance
 * - Line 292-390:  POST   /                  Create incident (PUBLIC - anonymous SOS)
 * - Line 392-430:  GET    /                  List incidents (staff only)
 * - Line 432-520:  GET    /stats/summary     Live operational summary
 * - Line 522-570:  GET    /:id               Single incident (owner or staff)
 * - Line 572-650:  PATCH  /:id/status        Status / vitals / notes update
 * - Line 652-690:  POST   /:id/allocate      Re-run hospital allocation
 *
 * AUTH POLICY (deliberate, read before changing):
 * - POST / is PUBLIC. A citizen reporting an emergency must never hit a login
 *   wall. Creation returns a one-time `trackingToken`.
 * - GET /:id accepts that token, or a staff session. An anonymous caller sees a
 *   reduced tracking view with no third-party medical detail.
 * - GET / and POST /:id/allocate are staff-only: they expose city-wide PII.
 * - PATCH /:id/status accepts staff sessions, or the reporter's own token for
 *   cancellation only.
 *
 * All model selection and triage reasoning lives in services/aiService.js.
 * ==============================================================================
 */

const express = require('express')
const crypto = require('crypto')
const Incident = require('../models/Incident')
const Ambulance = require('../models/Ambulance')
const Hospital = require('../models/Hospital')
const { auth, authorize, optionalAuth } = require('../middleware/auth')
const aiService = require('../services/aiService')

const router = express.Router()

const STAFF_ROLES = ['admin', 'paramedic', 'hospital_staff']

const ACTIVE_STATUSES = [
  'PENDING',
  'TRIAGE_COMPLETE',
  'DISPATCHING',
  'DISPATCHED',
  'EN_ROUTE_TO_PATIENT',
  'AT_PATIENT',
  'EN_ROUTE_TO_HOSPITAL',
]

// Average urban ambulance speed under lights, used to turn a real distance into
// an ETA. Previously these ETAs were Math.random().
const AMBULANCE_KMH = parseFloat(process.env.AMBULANCE_AVG_KMH || '28')

// ──────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ──────────────────────────────────────────────────────────────────────────────

/** Great-circle distance in km between two [lng, lat] pairs. */
function haversineKm(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 2 || b.length !== 2) return null
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10
}

/** Minutes to cover a distance at ambulance speed. Null distance yields null. */
function etaMinutes(distanceKm) {
  if (distanceKm == null) return null
  return Math.max(3, Math.round((distanceKm / AMBULANCE_KMH) * 60))
}

/** Shape a Hospital document into the plain candidate the AI service expects. */
function toCandidate(hospital, patientCoords) {
  const coords = hospital.location?.coordinates
  const distanceKm = patientCoords ? haversineKm(patientCoords, coords) : null
  return {
    id: String(hospital._id),
    name: hospital.name,
    icuAvailable: hospital.resources?.icuBeds?.available ?? 0,
    traumaAvailable: hospital.resources?.traumaBeds?.available ?? 0,
    erWaitTime: hospital.queueStatus?.erWaitTimeMinutes ?? 20,
    capabilities: hospital.capabilities || [],
    diversion: Boolean(hospital.queueStatus?.diversionStatus),
    location: coords,
    distanceKm,
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// HOSPITAL ALLOCATION - single implementation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Rank every active hospital for an incident and persist the scores.
 *
 * This previously existed three times over (here, in the dispatch pipeline, and
 * in routes/ai.js) with three different weightings and random travel ETAs, so
 * the same patient could be allocated differently depending on which path ran.
 * There is now one implementation.
 *
 * @returns {Promise<{ranked: Array, top: object|null, engine: string}>}
 */
async function allocateHospital(incident) {
  const patientCoords = incident.location?.coordinates
  const hospitals = await Hospital.find({ isActive: true }).limit(15)
  if (!hospitals.length) return { ranked: [], top: null, engine: 'none' }

  const candidates = hospitals.map((h) => toCandidate(h, patientCoords))

  const { rankedHospitals, engine } = await aiService.rankHospitals({
    esiLevel: incident.triageData?.esiLevel || 3,
    requiredSpecialties: incident.triageData?.requiredSpecialties || [],
    hospitals: candidates,
  })

  const byId = new Map(hospitals.map((h) => [String(h._id), h]))
  const candidateById = new Map(candidates.map((c) => [c.id, c]))

  // Re-attach the hospital documents and enforce hard operational constraints
  // the model is not allowed to override: a diverting hospital can never rank
  // first unless every option is diverting.
  let ranked = rankedHospitals
    .filter((r) => byId.has(String(r.id)))
    .map((r) => {
      const candidate = candidateById.get(String(r.id))
      return {
        id: String(r.id),
        hospital: byId.get(String(r.id)),
        score: Number.isFinite(Number(r.score)) ? parseFloat(Number(r.score).toFixed(3)) : 0,
        // Trust our own geometry over a model-estimated ETA.
        travelEta: etaMinutes(candidate?.distanceKm) ?? r.travelEta ?? null,
        distanceKm: candidate?.distanceKm ?? null,
        waitTime: candidate?.erWaitTime ?? r.waitTime ?? null,
        specialtyMatch: Number(r.specialtyMatch) || 0,
        capacityScore: Number(r.capacityScore) || 0,
        diversion: candidate?.diversion || false,
        reason: String(r.reason || '').slice(0, 200),
      }
    })
    .sort((a, b) => b.score - a.score)

  const open = ranked.filter((r) => !r.diversion)
  if (open.length) ranked = [...open, ...ranked.filter((r) => r.diversion)]

  const top = ranked[0] || null

  if (top) {
    await Incident.findByIdAndUpdate(incident._id, {
      allocatedHospital: top.id,
      hospitalAllocationScores: ranked.map((r) => ({
        hospital: r.id,
        score: r.score,
        travelEta: r.travelEta,
        waitTime: r.waitTime,
        specialtyMatch: r.specialtyMatch,
        capacityScore: r.capacityScore,
      })),
    })
  }

  return { ranked, top, engine }
}

// ──────────────────────────────────────────────────────────────────────────────
// HANDOVER CHECKLISTS
// ──────────────────────────────────────────────────────────────────────────────

const slug = (text, i) =>
  `${String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${i}`

/**
 * Field interventions for the crew, taken from the triage engine's
 * recommendations for this specific patient.
 */
function buildFieldChecklist(triage) {
  const items = (triage.recommendedActions || []).map((label, i) => ({
    key: slug(label, i),
    label,
    done: false,
  }))

  // Always close with the handover step, whatever the presentation.
  items.push({ key: 'handover', label: 'Hand over to receiving ER team', done: false })
  return items
}

/**
 * Pre-arrival preparation for the receiving hospital. Steps are added based on
 * the specialties and hazards this patient actually needs, so a cardiac case
 * does not get a laparotomy suite reserved.
 */
function buildPrepChecklist(triage) {
  const specialties = triage.requiredSpecialties || []
  const items = [{ key: 'team-alerted', label: 'Receiving team alerted and briefed', done: false }]

  if (specialties.includes('CARDIAC_CATH_LAB')) {
    items.push({ key: 'cath-lab', label: 'Cardiac cath lab placed on standby', done: false })
    items.push({ key: 'ecg', label: '12-lead ECG ready at the bay', done: false })
  }
  if (specialties.includes('LEVEL_1_TRAUMA')) {
    items.push({ key: 'trauma-bay', label: 'Trauma bay cleared and equipped', done: false })
    items.push({ key: 'blood-crossmatch', label: 'Crossmatch samples and O-negative units ready', done: false })
  }
  if (specialties.includes('STROKE_CENTER')) {
    items.push({ key: 'ct-priority', label: 'CT scanner cleared for priority imaging', done: false })
    items.push({ key: 'stroke-team', label: 'Stroke team paged for thrombolysis decision', done: false })
  }
  if (specialties.includes('BURN_UNIT')) {
    items.push({ key: 'burn-unit', label: 'Burn unit notified, warmed fluids prepared', done: false })
  }
  if (specialties.includes('NEUROSURGERY')) {
    items.push({ key: 'neuro-oncall', label: 'Neurosurgery on-call consultant contacted', done: false })
  }
  if (specialties.includes('ICU')) {
    items.push({ key: 'icu-bed', label: 'ICU bed and ventilator reserved', done: false })
  }
  if (triage.esiLevel <= 2) {
    items.push({ key: 'resus-bay', label: 'Resuscitation bay assigned', done: false })
  }

  return items
}

// ──────────────────────────────────────────────────────────────────────────────
// DISPATCH PIPELINE
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Triage, allocate a hospital, then dispatch the nearest ambulance.
 *
 * Runs detached from the HTTP response so the citizen's SOS returns instantly;
 * every stage broadcasts over Socket.IO as it completes.
 */
async function runDispatchPipeline(incidentId, io) {
  try {
    const incident = await Incident.findById(incidentId)
    if (!incident) return

    // ── 1. Clinical triage ───────────────────────────────────────────────────
    const triage = await aiService.triageIncident({
      chiefComplaint: incident.triageData?.chiefComplaint,
      vitals: incident.triageData?.vitals,
      voiceTranscript: incident.voiceTranscript,
      age: incident.patientDetails?.age,
      gender: incident.patientDetails?.gender,
      reporterType: incident.reporterType,
    })

    await Incident.findByIdAndUpdate(incidentId, {
      'triageData.esiLevel': triage.esiLevel,
      'triageData.aiSummary': triage.aiSummary,
      'triageData.aiConfidence': triage.aiConfidence,
      'triageData.requiredSpecialties': triage.requiredSpecialties,
      'triageData.criticalAlerts': triage.criticalAlerts,
      'triageData.recommendedActions': triage.recommendedActions,
      'triageData.engine': triage.engine,
      'triageData.triagedAt': new Date(),
      status: 'TRIAGE_COMPLETE',
      'timestamps.triageCompleted': new Date(),
      // Seed both handover boards from this patient's actual triage, so the
      // crew and the receiving ER work the same case-specific list instead of
      // a fixed protocol hardcoded in each portal.
      fieldChecklist: buildFieldChecklist(triage),
      prepChecklist: buildPrepChecklist(triage),
    })

    console.log(`[Dispatch] ${incident.incidentNumber} triaged ESI ${triage.esiLevel} via ${triage.engine}`)

    const triagePayload = { incidentId, ...triage }
    if (io) {
      for (const room of [`incident_${incidentId}`, 'admin', 'hospital']) {
        io.to(room).emit('triage_complete', triagePayload)
      }
    }

    // ── 2. Hospital allocation ───────────────────────────────────────────────
    const fresh = await Incident.findById(incidentId)
    const { top, engine: allocEngine } = await allocateHospital(fresh)

    if (top && io) {
      io.to('hospital').emit('incoming_patient', { incidentId, incident: fresh, hospital: top.hospital })
      io.to(`incident_${incidentId}`).emit('hospital_allocated', {
        incidentId,
        allocatedHospital: top.hospital,
        travelEta: top.travelEta,
        engine: allocEngine,
      })
      io.to('admin').emit('hospital_allocated', { incidentId, allocatedHospital: top.hospital })
    }

    // ── 3. Nearest available ambulance ───────────────────────────────────────
    let ambulance = null
    try {
      ambulance = await Ambulance.findOne({
        status: 'AVAILABLE',
        isActive: true,
        currentLocation: { $nearSphere: { $geometry: fresh.location, $maxDistance: 50000 } },
      })
    } catch (geoErr) {
      // A missing 2dsphere index must not block a dispatch.
      console.warn('[Dispatch] Geospatial query failed, falling back to any available unit:', geoErr.message)
    }

    if (!ambulance) ambulance = await Ambulance.findOne({ status: 'AVAILABLE', isActive: true })

    if (!ambulance) {
      console.warn(`[Dispatch] No available ambulance for ${fresh.incidentNumber} - queued`)
      if (io) {
        io.to('admin').emit('dispatch_blocked', {
          incidentId,
          reason: 'No available ambulance in range',
          esiLevel: triage.esiLevel,
        })
      }
      return
    }

    const distanceKm = haversineKm(fresh.location?.coordinates, ambulance.currentLocation?.coordinates)

    await Promise.all([
      Incident.findByIdAndUpdate(incidentId, {
        assignedAmbulance: ambulance._id,
        status: 'DISPATCHED',
        'timestamps.dispatched': new Date(),
        'route.distanceKm': distanceKm,
        'route.etaMinutes': etaMinutes(distanceKm),
      }),
      Ambulance.findByIdAndUpdate(ambulance._id, {
        status: 'DISPATCHED',
        currentIncident: incidentId,
      }),
    ])

    console.log(`[Dispatch] Unit ${ambulance.vehicleNumber} -> ${fresh.incidentNumber} (${distanceKm ?? '?'}km)`)

    if (io) {
      const payload = { incidentId, incident: fresh, ambulance, etaMinutes: etaMinutes(distanceKm), distanceKm }
      io.to(`ambulance_${ambulance._id}`).emit('dispatch_alert', payload)
      io.to('paramedic').emit('dispatch_alert', payload)
      io.to('admin').emit('ambulance_dispatched', payload)
      io.to(`incident_${incidentId}`).emit('ambulance_assigned', payload)
    }
  } catch (err) {
    console.error('[Dispatch] Pipeline error:', err)
    // An incident must never be left silently stuck in PENDING. Fall back to the
    // deterministic protocol so responders still get a severity to act on.
    try {
      const incident = await Incident.findById(incidentId)
      const fallback = aiService.clinicalRuleTriage(
        incident?.triageData?.chiefComplaint || incident?.voiceTranscript || '',
        incident?.triageData?.vitals
      )
      await Incident.findByIdAndUpdate(incidentId, {
        'triageData.esiLevel': fallback.esiLevel,
        'triageData.aiSummary': fallback.aiSummary,
        'triageData.aiConfidence': fallback.aiConfidence,
        'triageData.criticalAlerts': fallback.criticalAlerts,
        'triageData.recommendedActions': fallback.recommendedActions,
        'triageData.engine': 'rules-after-error',
        status: 'TRIAGE_COMPLETE',
      })
      if (io) io.to('admin').emit('dispatch_degraded', { incidentId, reason: err.message })
    } catch (inner) {
      console.error('[Dispatch] Fallback triage also failed:', inner.message)
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/incidents - create an emergency incident (PUBLIC)
// ──────────────────────────────────────────────────────────────────────────────
// Open to anonymous citizens by design. Supports both reporting branches:
//   SELF      - the patient is reporting their own emergency
//   BYSTANDER - someone is reporting for a stranger; patient details are absent
//               and sceneInfo carries what an untrained caller can actually see.
router.post('/', optionalAuth, async (req, res, next) => {
  try {
    const {
      location,
      chiefComplaint,
      vitals,
      voiceTranscript,
      patientDetails,
      reporterType,
      reporterContact,
      sceneInfo,
    } = req.body

    const coords = location?.coordinates
    const validCoords =
      Array.isArray(coords) &&
      coords.length === 2 &&
      coords.every((n) => Number.isFinite(Number(n))) &&
      Math.abs(Number(coords[1])) <= 90 &&
      Math.abs(Number(coords[0])) <= 180

    if (!validCoords) {
      return res.status(400).json({
        message: 'A valid location is required as coordinates [longitude, latitude].',
      })
    }

    const isBystander = reporterType === 'BYSTANDER'

    // For a bystander report we must not borrow the reporter's own medical
    // profile: the patient is a different person entirely.
    const profile = isBystander ? {} : req.user?.emergencyProfile || {}

    // Build the complaint text triage will reason over, folding in the scene
    // observations a bystander can give.
    const complaintParts = [chiefComplaint || voiceTranscript].filter(Boolean)
    if (sceneInfo?.isConscious === false) complaintParts.push('patient is unconscious')
    if (sceneInfo?.isBreathing === false) complaintParts.push('patient is not breathing')
    if (sceneInfo?.victimCount > 1) complaintParts.push(`${sceneInfo.victimCount} people injured`)
    if (sceneInfo?.hazards?.length) complaintParts.push(`scene hazards: ${sceneInfo.hazards.join(', ')}`)
    if (sceneInfo?.description) complaintParts.push(sceneInfo.description)

    const complaint = complaintParts.join('; ') || 'Emergency assistance requested'

    // One-time ownership token so an anonymous reporter can follow their own
    // report without an account.
    const trackingToken = crypto.randomBytes(24).toString('hex')

    const incident = await Incident.create({
      patient: req.userId || null,
      trackingToken,
      reporterType: isBystander ? 'BYSTANDER' : 'SELF',
      reporterContact: {
        name: reporterContact?.name || req.user?.name || (isBystander ? 'Anonymous bystander' : 'Citizen in distress'),
        phone: reporterContact?.phone || req.user?.phone || null,
      },
      sceneInfo: {
        victimCount: sceneInfo?.victimCount || 1,
        isConscious: sceneInfo?.isConscious ?? null,
        isBreathing: sceneInfo?.isBreathing ?? null,
        hazards: sceneInfo?.hazards || [],
        description: sceneInfo?.description || '',
      },
      patientDetails: {
        // Unknown is the honest value for a bystander report; inventing a name
        // or blood group here would be clinically dangerous downstream.
        name: isBystander ? 'Unidentified patient' : req.user?.name || patientDetails?.name || 'Citizen in distress',
        age: patientDetails?.age ?? profile.age ?? null,
        gender: patientDetails?.gender || profile.gender || null,
        bloodType: isBystander ? null : patientDetails?.bloodType || profile.bloodType || null,
        allergies: isBystander ? [] : patientDetails?.allergies || profile.allergies || [],
        conditions: isBystander ? [] : patientDetails?.conditions || profile.conditions || [],
        phone: isBystander ? null : req.user?.phone || patientDetails?.phone || null,
      },
      triageData: {
        chiefComplaint: complaint,
        vitals: vitals || null,
        // Severity is left unset until triage runs, rather than asserting a
        // provisional ESI the UI would display as though it were assessed.
        aiSummary: 'Triage in progress.',
        requiredSpecialties: [],
      },
      location: {
        type: 'Point',
        coordinates: [Number(coords[0]), Number(coords[1])],
        address: location.address || 'Location pending reverse geocode',
        // Precision matters: unit selection is a $nearSphere query on these
        // coordinates, so the crew needs to know whether they came from a
        // device fix or from geocoding what the caller typed.
        source: ['GPS', 'GEOCODED', 'MANUAL'].includes(location.source) ? location.source : 'UNKNOWN',
        reportedAs: location.reportedAs || null,
      },
      voiceTranscript: voiceTranscript || '',
      status: 'PENDING',
      timestamps: { created: new Date() },
    })

    const io = req.app.get('io')
    if (io) {
      io.to('admin').emit('new_incident', incident)
      io.to('hospital').emit('new_incident', incident)
    }

    // Detached: the citizen gets an immediate acknowledgement.
    runDispatchPipeline(incident._id, io)

    const body = incident.toObject()
    delete body.trackingToken

    res.status(201).json({
      incident: body,
      // Returned exactly once. The client stores this to track or cancel.
      trackingToken,
    })
  } catch (err) {
    next(err)
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/incidents - list incidents (staff only)
// ──────────────────────────────────────────────────────────────────────────────
// Staff-only: this returns patient names, phone numbers and clinical detail
// across the whole city. An anonymous reporter uses GET /:id with their token.
router.get('/', auth, authorize(...STAFF_ROLES), async (req, res, next) => {
  try {
    const { status, limit = 50, page = 1 } = req.query
    const query = {}

    // Scope each role to what it is responsible for.
    if (req.user.role === 'paramedic' && req.user.ambulanceId) query.assignedAmbulance = req.user.ambulanceId
    if (req.user.role === 'hospital_staff' && req.user.hospitalId) query.allocatedHospital = req.user.hospitalId
    if (status) query.status = status

    const perPage = Math.min(200, Math.max(1, parseInt(limit, 10) || 50))
    const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * perPage

    const [incidents, total] = await Promise.all([
      Incident.find(query)
        .populate('assignedAmbulance', 'vehicleNumber vehicleType currentLocation status equipment')
        .populate('allocatedHospital', 'name location queueStatus resources capabilities')
        .sort({ createdAt: -1 })
        .limit(perPage)
        .skip(skip),
      Incident.countDocuments(query),
    ])

    res.json({ incidents, total, page: parseInt(page, 10) || 1, limit: perPage })
  } catch (err) {
    next(err)
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/incidents/stats/summary - live operational summary
// ──────────────────────────────────────────────────────────────────────────────
router.get('/stats/summary', optionalAuth, async (req, res, next) => {
  try {
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0))

    const [
      total,
      active,
      completed,
      today,
      esiAgg,
      ambulances,
      hospitals,
      responseAgg,
      surge,
    ] = await Promise.all([
      Incident.countDocuments(),
      Incident.countDocuments({ status: { $in: ACTIVE_STATUSES } }),
      Incident.countDocuments({ status: 'COMPLETED' }),
      Incident.countDocuments({ createdAt: { $gte: startOfToday } }),
      Incident.aggregate([
        { $match: { status: { $nin: ['COMPLETED', 'CANCELLED'] } } },
        { $group: { _id: '$triageData.esiLevel', count: { $sum: 1 } } },
      ]),
      Ambulance.find({ isActive: true }),
      Hospital.find({ isActive: true }),
      // Real mean dispatch latency: created -> dispatched, in seconds.
      // This replaced a hardcoded avgDelaySeconds: 42.
      Incident.aggregate([
        { $match: { 'timestamps.dispatched': { $ne: null }, 'timestamps.created': { $ne: null } } },
        {
          $project: {
            delaySeconds: {
              $divide: [{ $subtract: ['$timestamps.dispatched', '$timestamps.created'] }, 1000],
            },
          },
        },
        { $match: { delaySeconds: { $gte: 0, $lt: 86400 } } },
        { $group: { _id: null, avg: { $avg: '$delaySeconds' }, n: { $sum: 1 } } },
      ]),
      aiService.forecastSurge(Incident, 12),
    ])

    const esiCounts = { esi1: 0, esi2: 0, esi3: 0, esi4: 0, esi5: 0 }
    for (const row of esiAgg) {
      if (row._id >= 1 && row._id <= 5) esiCounts[`esi${row._id}`] = row.count
    }

    const inRouteStatuses = ['DISPATCHED', 'EN_ROUTE_TO_PATIENT', 'AT_PATIENT', 'EN_ROUTE_TO_HOSPITAL']
    const fleet = {
      total: ambulances.length,
      available: ambulances.filter((a) => a.status === 'AVAILABLE').length,
      inRoute: ambulances.filter((a) => inRouteStatuses.includes(a.status)).length,
      maintenance: ambulances.filter((a) => a.status === 'MAINTENANCE').length,
    }

    // Bed figures summed from real hospital documents, with no invented
    // defaults standing in for missing data.
    const beds = hospitals.reduce(
      (acc, h) => {
        const r = h.resources || {}
        acc.icuTotal += r.icuBeds?.total || 0
        acc.icuAvailable += r.icuBeds?.available || 0
        acc.traumaTotal += r.traumaBeds?.total || 0
        acc.traumaAvailable += r.traumaBeds?.available || 0
        acc.ventilatorsTotal += r.ventilators?.total || 0
        acc.ventilatorsAvailable += r.ventilators?.available || 0
        return acc
      },
      { icuTotal: 0, icuAvailable: 0, traumaTotal: 0, traumaAvailable: 0, ventilatorsTotal: 0, ventilatorsAvailable: 0 }
    )

    const bedTotal = beds.icuTotal + beds.traumaTotal
    const bedAvailable = beds.icuAvailable + beds.traumaAvailable
    const occupied = Math.max(0, bedTotal - bedAvailable)

    const responseStats = responseAgg[0] || null

    res.json({
      summary: {
        total,
        active,
        completed,
        today,
        esiCounts,
        fleet,
        beds: {
          ...beds,
          total: bedTotal,
          available: bedAvailable,
          occupied,
          utilizationRate: bedTotal > 0 ? Math.round((occupied / bedTotal) * 100) : null,
        },
        // null, not a placeholder number, when nothing has been dispatched yet.
        avgDispatchSeconds: responseStats ? Math.round(responseStats.avg) : null,
        avgDispatchSampleSize: responseStats ? responseStats.n : 0,
        hospitalsOnDiversion: hospitals.filter((h) => h.queueStatus?.diversionStatus).length,
        surgeForecast: surge.forecast,
        surgeBasis: surge.basis,
        surgeEngine: surge.engine,
      },
    })
  } catch (err) {
    next(err)
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/incidents/:id - single incident
// ──────────────────────────────────────────────────────────────────────────────
// Staff and the signed-in patient see the full record. An anonymous reporter
// presenting the correct tracking token gets a reduced view: enough to follow
// their ambulance, without any other person's medical detail.
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const token = req.get('x-tracking-token') || req.query.token

    const incident = await Incident.findById(req.params.id)
      .select('+trackingToken')
      .populate('assignedAmbulance', 'vehicleNumber vehicleType currentLocation status equipment assignedCrew')
      .populate('allocatedHospital', 'name location queueStatus resources capabilities contact')

    if (!incident) return res.status(404).json({ message: 'Incident not found' })

    const isStaff = req.user && STAFF_ROLES.includes(req.user.role)
    const isOwner = req.userId && String(incident.patient) === String(req.userId)
    const hasToken = Boolean(token) && token === incident.trackingToken

    if (!isStaff && !isOwner && !hasToken) {
      return res.status(403).json({ message: 'Not authorised to view this incident' })
    }

    const body = incident.toObject()
    delete body.trackingToken

    if (isStaff || isOwner) return res.json({ incident: body })

    // Token-only tracking view.
    res.json({
      incident: {
        _id: body._id,
        incidentNumber: body.incidentNumber,
        status: body.status,
        reporterType: body.reporterType,
        location: body.location,
        triageData: {
          esiLevel: body.triageData?.esiLevel,
          aiSummary: body.triageData?.aiSummary,
          engine: body.triageData?.engine,
          recommendedActions: body.triageData?.recommendedActions,
        },
        assignedAmbulance: body.assignedAmbulance,
        allocatedHospital: body.allocatedHospital,
        route: body.route,
        timestamps: body.timestamps,
      },
    })
  } catch (err) {
    next(err)
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /api/incidents/:id/status - update status, vitals or notes
// ──────────────────────────────────────────────────────────────────────────────
// Staff may drive the full workflow. A reporter holding the tracking token may
// only cancel their own report, so an open endpoint cannot be used to mark
// other people's emergencies resolved.
router.patch('/:id/status', optionalAuth, async (req, res, next) => {
  try {
    const { status, vitals, notes } = req.body
    const token = req.get('x-tracking-token') || req.query.token

    const existing = await Incident.findById(req.params.id).select('+trackingToken')
    if (!existing) return res.status(404).json({ message: 'Incident not found' })

    const isStaff = req.user && STAFF_ROLES.includes(req.user.role)
    const isOwner = req.userId && String(existing.patient) === String(req.userId)
    const hasToken = Boolean(token) && token === existing.trackingToken

    if (!isStaff && !isOwner && !hasToken) {
      return res.status(403).json({ message: 'Not authorised to update this incident' })
    }

    // Reporters can cancel, and nothing else.
    if (!isStaff && status && status !== 'CANCELLED') {
      return res.status(403).json({ message: 'Only emergency staff can change an incident to that status' })
    }
    if (!isStaff && (vitals || notes)) {
      return res.status(403).json({ message: 'Only emergency staff can record vitals or clinical notes' })
    }

    const update = {}
    if (status) update.status = status
    if (notes) update.notes = notes
    if (vitals) update['triageData.vitals'] = vitals

    const tsMap = {
      TRIAGE_COMPLETE: 'timestamps.triageCompleted',
      DISPATCHED: 'timestamps.dispatched',
      EN_ROUTE_TO_PATIENT: 'timestamps.dispatched',
      AT_PATIENT: 'timestamps.pickedUp',
      ARRIVED_AT_HOSPITAL: 'timestamps.arrivedAtHospital',
      COMPLETED: 'timestamps.completed',
      CANCELLED: 'timestamps.completed',
    }
    if (tsMap[status]) update[tsMap[status]] = new Date()

    const incident = await Incident.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('assignedAmbulance')
      .populate('allocatedHospital')

    // Release the unit once the job ends, so the fleet count stays truthful.
    if ((status === 'COMPLETED' || status === 'CANCELLED') && incident.assignedAmbulance) {
      await Ambulance.findByIdAndUpdate(incident.assignedAmbulance._id || incident.assignedAmbulance, {
        status: 'AVAILABLE',
        currentIncident: null,
      })
    }

    // Re-triage when a paramedic records real vitals: measured observations can
    // escalate a case the initial phone description understated.
    if (vitals && isStaff) {
      const retriage = await aiService.triageIncident({
        chiefComplaint: incident.triageData?.chiefComplaint,
        vitals,
        age: incident.patientDetails?.age,
        gender: incident.patientDetails?.gender,
        reporterType: incident.reporterType,
      })
      if (retriage.esiLevel < (incident.triageData?.esiLevel || 5)) {
        await Incident.findByIdAndUpdate(req.params.id, {
          'triageData.esiLevel': retriage.esiLevel,
          'triageData.aiSummary': retriage.aiSummary,
          'triageData.criticalAlerts': retriage.criticalAlerts,
          'triageData.engine': retriage.engine,
        })
        const io = req.app.get('io')
        if (io) {
          io.to('hospital').emit('triage_escalated', {
            incidentId: incident._id,
            esiLevel: retriage.esiLevel,
            reason: retriage.aiSummary,
            engine: retriage.engine,
          })
        }
      }
    }

    const io = req.app.get('io')
    if (io) {
      const payload = { incidentId: incident._id, status, incident }
      for (const room of [`incident_${incident._id}`, 'hospital', 'admin']) {
        io.to(room).emit('incident_status', payload)
      }
      if (incident.assignedAmbulance) {
        io.to(`ambulance_${incident.assignedAmbulance._id || incident.assignedAmbulance}`).emit('incident_status', payload)
      }
    }

    res.json({ incident })
  } catch (err) {
    next(err)
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /api/incidents/:id/checklist - tick a handover step (staff only)
// ──────────────────────────────────────────────────────────────────────────────
// Body: { board: 'field' | 'prep', key: string, done: boolean }
// Both boards are shared state across the handover: when the crew completes an
// intervention the receiving ER sees it, and vice versa.
router.patch('/:id/checklist', auth, authorize(...STAFF_ROLES), async (req, res, next) => {
  try {
    const { board, key, done } = req.body

    if (!['field', 'prep'].includes(board)) {
      return res.status(400).json({ message: "board must be 'field' or 'prep'" })
    }
    if (!key) return res.status(400).json({ message: 'key is required' })

    const field = board === 'field' ? 'fieldChecklist' : 'prepChecklist'

    const incident = await Incident.findOneAndUpdate(
      { _id: req.params.id, [`${field}.key`]: key },
      {
        $set: {
          [`${field}.$.done`]: Boolean(done),
          [`${field}.$.doneAt`]: done ? new Date() : null,
          [`${field}.$.doneBy`]: done ? req.user.name : null,
        },
      },
      { new: true }
    )

    if (!incident) return res.status(404).json({ message: 'Incident or checklist item not found' })

    const io = req.app.get('io')
    if (io) {
      const payload = { incidentId: incident._id, board, key, done: Boolean(done), by: req.user.name }
      for (const room of [`incident_${incident._id}`, 'hospital', 'paramedic', 'admin']) {
        io.to(room).emit('checklist_updated', payload)
      }
    }

    res.json({ [field]: incident[field] })
  } catch (err) {
    next(err)
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/incidents/:id/notes - record a crew observation (staff only)
// ──────────────────────────────────────────────────────────────────────────────
router.post('/:id/notes', auth, authorize(...STAFF_ROLES), async (req, res, next) => {
  try {
    const { text, source } = req.body
    if (!text || !String(text).trim()) return res.status(400).json({ message: 'text is required' })

    const note = {
      text: String(text).trim().slice(0, 2000),
      at: new Date(),
      by: req.user.name,
      source: source === 'VOICE' ? 'VOICE' : 'TYPED',
    }

    const incident = await Incident.findByIdAndUpdate(
      req.params.id,
      { $push: { fieldNotes: note } },
      { new: true }
    )

    if (!incident) return res.status(404).json({ message: 'Incident not found' })

    const io = req.app.get('io')
    if (io) {
      // The receiving ER wants crew notes as they are dictated, not at handover.
      for (const room of [`incident_${incident._id}`, 'hospital', 'admin']) {
        io.to(room).emit('field_note_added', { incidentId: incident._id, note })
      }
    }

    res.status(201).json({ fieldNotes: incident.fieldNotes })
  } catch (err) {
    next(err)
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/incidents/:id/allocate - re-run hospital allocation (staff only)
// ──────────────────────────────────────────────────────────────────────────────
router.post('/:id/allocate', auth, authorize(...STAFF_ROLES), async (req, res, next) => {
  try {
    const incident = await Incident.findById(req.params.id)
    if (!incident) return res.status(404).json({ message: 'Incident not found' })

    const { ranked, top, engine } = await allocateHospital(incident)
    if (!top) return res.status(404).json({ message: 'No active hospitals available for allocation' })

    const io = req.app.get('io')
    if (io) {
      io.to(`incident_${incident._id}`).emit('hospital_allocated', { incidentId: incident._id, allocatedHospital: top })
      io.to('hospital').emit('incoming_patient', { incidentId: incident._id, incident, allocatedHospital: top })
      io.to('admin').emit('hospital_allocated', { incidentId: incident._id, allocatedHospital: top })
    }

    res.json({ rankedHospitals: ranked, allocatedHospital: top, engine })
  } catch (err) {
    next(err)
  }
})

module.exports = router
