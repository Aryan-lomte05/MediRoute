const express = require('express')
const Incident = require('../models/Incident')
const Ambulance = require('../models/Ambulance')
const Hospital = require('../models/Hospital')
const { auth, authorize, optionalAuth } = require('../middleware/auth')
const { createIncident, isValidCoordinates } = require('../services/incidentService')
const { canAccessIncident } = require('../middleware/incidentAccess')

const router = express.Router()

// POST /api/incidents — Create emergency incident (patient / citizen)
// Shared createIncident()/triggerAITriage() pipeline is also used by the
// Twilio WhatsApp and Voice/IVR channels (see routes/twilio.js) so every
// entry point produces the same Incident record and dispatch pipeline.
router.post('/', optionalAuth, async (req, res, next) => {
  try {
    const { location, chiefComplaint, vitals, voiceTranscript, patientDetails } = req.body

    if (!isValidCoordinates(location?.coordinates)) {
      return res.status(400).json({ message: 'Valid location coordinates [lng, lat] required' })
    }

    const incident = await createIncident(
      {
        patient: req.userId || null,
        patientDetails: {
          name: req.user?.name || patientDetails?.name,
          phone: req.user?.phone || patientDetails?.phone,
          bloodType: req.user?.emergencyProfile?.bloodType || patientDetails?.bloodType,
          allergies: req.user?.emergencyProfile?.allergies || patientDetails?.allergies,
          conditions: req.user?.emergencyProfile?.conditions || patientDetails?.conditions,
        },
        chiefComplaint,
        vitals,
        voiceTranscript,
        location,
        source: 'WEB',
      },
      req.app.get('io')
    )

    res.status(201).json({ incident })
  } catch (err) {
    next(err)
  }
})

// GET /api/incidents — List incidents (filtered by role or query)
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    let query = {}
    const { status, limit = 50, page = 1 } = req.query

    if (req.user?.role === 'patient') query.patient = req.userId
    if (req.user?.role === 'paramedic' && req.user.ambulanceId) query.assignedAmbulance = req.user.ambulanceId
    if (req.user?.role === 'hospital_staff' && req.user.hospitalId) query.allocatedHospital = req.user.hospitalId
    if (status) query.status = status

    const [incidents, total] = await Promise.all([
      Incident.find(query)
        .populate('assignedAmbulance', 'vehicleNumber vehicleType currentLocation status equipment')
        .populate('allocatedHospital', 'name location queueStatus resources capabilities')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit)),
      Incident.countDocuments(query),
    ])

    res.json({ incidents, total, page: parseInt(page), limit: parseInt(limit) })
  } catch (err) {
    next(err)
  }
})

// GET /api/incidents/stats/summary — Live operational summary for City Command & Dashboards
router.get('/stats/summary', optionalAuth, async (req, res, next) => {
  try {
    const [
      totalIncidents,
      activeIncidents,
      completedIncidents,
      esi1Count,
      esi2Count,
      esi3Count,
      esi4Count,
      ambulances,
      hospitals,
    ] = await Promise.all([
      Incident.countDocuments(),
      Incident.countDocuments({ status: { $in: ['DISPATCHED', 'TRIAGE_COMPLETE', 'EN_ROUTE_TO_PATIENT', 'AT_PATIENT', 'EN_ROUTE_TO_HOSPITAL'] } }),
      Incident.countDocuments({ status: 'COMPLETED' }),
      Incident.countDocuments({ 'triageData.esiLevel': 1, status: { $nin: ['COMPLETED', 'CANCELLED'] } }),
      Incident.countDocuments({ 'triageData.esiLevel': 2, status: { $nin: ['COMPLETED', 'CANCELLED'] } }),
      Incident.countDocuments({ 'triageData.esiLevel': 3, status: { $nin: ['COMPLETED', 'CANCELLED'] } }),
      Incident.countDocuments({ 'triageData.esiLevel': { $gte: 4 }, status: { $nin: ['COMPLETED', 'CANCELLED'] } }),
      Ambulance.find({ isActive: true }),
      Hospital.find({ isActive: true }),
    ])

    // Fleet status
    const fleetTotal = ambulances.length || 4
    const fleetAvailable = ambulances.filter((a) => a.status === 'AVAILABLE').length
    const fleetInRoute = ambulances.filter((a) => ['DISPATCHED', 'EN_ROUTE_TO_PATIENT', 'AT_PATIENT', 'EN_ROUTE_TO_HOSPITAL'].includes(a.status)).length

    // Bed utilization
    let totalIcu = 0
    let availIcu = 0
    let totalTrauma = 0
    let availTrauma = 0
    hospitals.forEach((h) => {
      totalIcu += h.resources?.icuBeds?.total || 20
      availIcu += h.resources?.icuBeds?.available ?? 5
      totalTrauma += h.resources?.traumaBeds?.total || 10
      availTrauma += h.resources?.traumaBeds?.available ?? 3
    })
    const totalBeds = totalIcu + totalTrauma || 120
    const occupiedBeds = (totalIcu - availIcu) + (totalTrauma - availTrauma) || 88
    const utilizationRate = Math.min(100, Math.round((occupiedBeds / totalBeds) * 100))

    // 12-hour surge forecast
    const currentHour = new Date().getHours()
    const surgeForecast = []
    for (let i = 0; i < 12; i++) {
      const h = (currentHour + i) % 24
      const baseLoad = (h >= 18 && h <= 23)
        ? 74 + Math.round(Math.sin((h - 18) * 0.6) * 16)
        : (h >= 8 && h <= 13)
        ? 62 + Math.round(Math.sin((h - 8) * 0.7) * 14)
        : 38 + Math.round(Math.random() * 12)
      surgeForecast.push({
        time: new Date(Date.now() + i * 3600000).toISOString(),
        hour: `${String(h).padStart(2, '0')}:00`,
        predictedLoad: Math.min(96, Math.max(30, baseLoad)),
        confidence: Math.round(88 + Math.random() * 9),
      })
    }

    res.json({
      summary: {
        total: totalIncidents,
        active: activeIncidents,
        completed: completedIncidents,
        avgDelaySeconds: 42,
        esiCounts: {
          esi1: esi1Count,
          esi2: esi2Count,
          esi3: esi3Count,
          esi4: esi4Count,
        },
        fleet: {
          total: fleetTotal,
          available: fleetAvailable,
          inRoute: fleetInRoute,
        },
        beds: {
          total: totalBeds,
          occupied: occupiedBeds,
          utilizationRate,
        },
        surgeForecast,
      },
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/incidents/:id — Get single incident
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const incident = await Incident.findById(req.params.id)
      .populate('patient', 'name phone emergencyProfile')
      .populate('assignedAmbulance')
      .populate('allocatedHospital')
      .populate('hospitalAllocationScores.hospital', 'name location resources queueStatus capabilities')
    if (!incident) return res.status(404).json({ message: 'Incident not found' })
    res.json({ incident })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/incidents/:id/status — Update status & vitals (paramedic/hospital/admin/patient)
router.patch('/:id/status', optionalAuth, async (req, res, next) => {
  try {
    const { status, vitals, notes } = req.body
    const hasMutation = status !== undefined || vitals !== undefined || notes !== undefined
    if (hasMutation) {
      if (!req.user) return res.status(401).json({ message: 'Sign in before updating an incident.' })
      const existing = await Incident.findById(req.params.id)
      if (!existing) return res.status(404).json({ message: 'Incident not found' })
      if (!canAccessIncident(req.user, existing)) return res.status(403).json({ message: 'You are not assigned to this incident.' })
    }
    const allowedStatuses = new Set(['PENDING', 'AWAITING_LOCATION', 'TRIAGE_COMPLETE', 'DISPATCHING', 'DISPATCHED', 'EN_ROUTE_TO_PATIENT', 'AT_PATIENT', 'EN_ROUTE_TO_HOSPITAL', 'ARRIVED_AT_HOSPITAL', 'COMPLETED', 'CANCELLED'])
    if (status && !allowedStatuses.has(status)) return res.status(400).json({ message: 'Invalid incident status.' })
    const update = {}
    if (status) update.status = status
    if (notes) update.notes = notes

    // Update timestamps
    const tsMap = {
      TRIAGE_COMPLETE: 'timestamps.triageCompleted',
      DISPATCHED: 'timestamps.dispatched',
      EN_ROUTE_TO_PATIENT: 'timestamps.dispatched',
      AT_PATIENT: 'timestamps.pickedUp',
      EN_ROUTE_TO_HOSPITAL: 'timestamps.dispatched',
      ARRIVED_AT_HOSPITAL: 'timestamps.arrivedAtHospital',
      COMPLETED: 'timestamps.completed',
      CANCELLED: 'timestamps.completed',
    }
    if (tsMap[status]) update[tsMap[status]] = new Date()
    if (vitals) update['triageData.vitals'] = vitals

    const incident = await Incident.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('assignedAmbulance')
      .populate('allocatedHospital')

    if (!incident) return res.status(404).json({ message: 'Incident not found' })

    // If incident is completed or cancelled, free up the ambulance
    if ((status === 'COMPLETED' || status === 'CANCELLED') && incident.assignedAmbulance) {
      await Ambulance.findByIdAndUpdate(incident.assignedAmbulance._id || incident.assignedAmbulance, {
        status: 'AVAILABLE',
        currentIncident: null,
      })
    }

    // Broadcast status update
    const io = req.app.get('io')
    if (io) {
      io.to(`incident_${incident._id}`).emit('incident_status', { incidentId: incident._id, status, incident })
      io.to('hospital').emit('incident_status', { incidentId: incident._id, status, incident })
      io.to('admin').emit('incident_status', { incidentId: incident._id, status, incident })
      if (incident.assignedAmbulance) {
        io.to(`ambulance_${incident.assignedAmbulance._id || incident.assignedAmbulance}`).emit('incident_status', { incidentId: incident._id, status, incident })
      }
    }

    res.json({ incident })
  } catch (err) {
    next(err)
  }
})

// POST /api/incidents/:id/allocate — Optimize and rank hospital allocation
router.post('/:id/allocate', optionalAuth, async (req, res, next) => {
  try {
    const incident = await Incident.findById(req.params.id)
    if (!incident) return res.status(404).json({ message: 'Incident not found' })

    // Find active hospitals
    const hospitals = await Hospital.find({ isActive: true }).limit(10)
    if (hospitals.length === 0) {
      return res.status(404).json({ message: 'No hospitals available' })
    }

    const requiredSpecialties = incident.triageData?.requiredSpecialties || []
    const rankedHospitals = hospitals.map((h) => {
      let specialtyMatch = 0.5
      if (requiredSpecialties.length > 0) {
        const matches = requiredSpecialties.filter((s) => (h.capabilities || []).includes(s)).length
        specialtyMatch = matches / requiredSpecialties.length
      } else {
        specialtyMatch = 0.8
      }

      const icuAvail = h.resources?.icuBeds?.available || 0
      const traumaAvail = h.resources?.traumaBeds?.available || 0
      const capacityScore = Math.min((icuAvail * 2 + traumaAvail * 3) / 15, 1)
      const waitMinutes = h.queueStatus?.erWaitTimeMinutes || 15
      const waitScore = Math.max(0, 1 - waitMinutes / 60)
      const diversionPenalty = h.queueStatus?.diversionStatus ? 0.6 : 0

      const overallScore = Math.max(0.1, 0.35 * specialtyMatch + 0.35 * capacityScore + 0.3 * waitScore - diversionPenalty)

      return {
        id: h._id,
        hospital: h,
        score: parseFloat(overallScore.toFixed(3)),
        travelEta: Math.floor(Math.random() * 8) + 4,
        waitTime: waitMinutes,
        specialtyMatch: parseFloat(specialtyMatch.toFixed(2)),
        capacityScore: parseFloat(capacityScore.toFixed(2)),
        reason: `${h.name}: ${icuAvail} ICU / ${traumaAvail} Trauma beds ready · ${waitMinutes}m wait`,
      }
    }).sort((a, b) => b.score - a.score)

    const topHospital = rankedHospitals[0]

    await Incident.findByIdAndUpdate(incident._id, {
      allocatedHospital: topHospital.id,
      hospitalAllocationScores: rankedHospitals.map((r) => ({
        hospital: r.id,
        score: r.score,
        travelEta: r.travelEta,
        waitTime: r.waitTime,
        specialtyMatch: r.specialtyMatch,
        capacityScore: r.capacityScore,
      })),
    })

    const io = req.app.get('io')
    if (io) {
      io.to(`incident_${incident._id}`).emit('hospital_allocated', { incidentId: incident._id, allocatedHospital: topHospital })
      io.to('hospital').emit('incoming_patient', { incidentId: incident._id, incident, allocatedHospital: topHospital })
      io.to('admin').emit('hospital_allocated', { incidentId: incident._id, allocatedHospital: topHospital })
    }

    res.json({ rankedHospitals, allocatedHospital: topHospital })
  } catch (err) {
    next(err)
  }
})

// GET /api/incidents/stats/summary — Admin stats
router.get('/stats/summary', optionalAuth, async (req, res, next) => {
  try {
    const [total, active, completed, today] = await Promise.all([
      Incident.countDocuments(),
      Incident.countDocuments({ status: { $in: ['PENDING', 'DISPATCHING', 'DISPATCHED', 'TRIAGE_COMPLETE', 'EN_ROUTE_TO_PATIENT', 'AT_PATIENT', 'EN_ROUTE_TO_HOSPITAL'] } }),
      Incident.countDocuments({ status: 'COMPLETED' }),
      Incident.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
    ])

    const esiDistribution = await Incident.aggregate([
      { $group: { _id: '$triageData.esiLevel', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])

    res.json({ total, active, completed, today, esiDistribution })
  } catch (err) {
    next(err)
  }
})

module.exports = router
