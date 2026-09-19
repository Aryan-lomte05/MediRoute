const express = require('express')
const Incident = require('../models/Incident')
const Ambulance = require('../models/Ambulance')
const Hospital = require('../models/Hospital')
const { auth, authorize } = require('../middleware/auth')
const axios = require('axios')

const router = express.Router()

// POST /api/incidents — Create emergency incident (patient)
router.post('/', auth, async (req, res, next) => {
  try {
    const { location, chiefComplaint, vitals, voiceTranscript } = req.body

    if (!location?.coordinates) {
      return res.status(400).json({ message: 'Location coordinates required' })
    }

    // Create incident
    const incident = await Incident.create({
      patient: req.userId,
      patientDetails: {
        name: req.user.name,
        bloodType: req.user.emergencyProfile?.bloodType,
        allergies: req.user.emergencyProfile?.allergies || [],
        conditions: req.user.emergencyProfile?.conditions || [],
        phone: req.user.phone,
      },
      triageData: {
        chiefComplaint,
        vitals,
        esiLevel: 3, // Will be updated by AI
      },
      location: {
        type: 'Point',
        coordinates: location.coordinates,
        address: location.address || '',
      },
      voiceTranscript,
      status: 'PENDING',
    })

    // Broadcast to admin/dispatch
    const io = req.app.get('io')
    if (io) io.to('admin').emit('new_incident', incident)

    // Trigger AI triage asynchronously
    triggerAITriage(incident._id, { chiefComplaint, vitals, voiceTranscript }, io)

    res.status(201).json({ incident })
  } catch (err) {
    next(err)
  }
})

// GET /api/incidents — List incidents (filtered by role)
router.get('/', auth, async (req, res, next) => {
  try {
    let query = {}
    const { status, limit = 20, page = 1 } = req.query

    if (req.user.role === 'patient') query.patient = req.userId
    if (req.user.role === 'paramedic') query.assignedAmbulance = req.user.ambulanceId
    if (req.user.role === 'hospital_staff') query.allocatedHospital = req.user.hospitalId
    if (status) query.status = status

    const [incidents, total] = await Promise.all([
      Incident.find(query)
        .populate('assignedAmbulance', 'vehicleNumber vehicleType currentLocation status')
        .populate('allocatedHospital', 'name location queueStatus resources')
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

// GET /api/incidents/:id — Get single incident
router.get('/:id', auth, async (req, res, next) => {
  try {
    const incident = await Incident.findById(req.params.id)
      .populate('patient', 'name phone emergencyProfile')
      .populate('assignedAmbulance')
      .populate('allocatedHospital')
      .populate('hospitalAllocationScores.hospital', 'name location resources queueStatus')
    if (!incident) return res.status(404).json({ message: 'Incident not found' })
    res.json({ incident })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/incidents/:id/status — Update status (paramedic/hospital)
router.patch('/:id/status', auth, authorize('paramedic', 'hospital_staff', 'admin'), async (req, res, next) => {
  try {
    const { status, vitals, notes } = req.body
    const update = { status, notes }

    // Update timestamps
    const tsMap = {
      TRIAGE_COMPLETE: 'timestamps.triageCompleted',
      EN_ROUTE_TO_PATIENT: 'timestamps.dispatched',
      AT_PATIENT: 'timestamps.pickedUp',
      ARRIVED_AT_HOSPITAL: 'timestamps.arrivedAtHospital',
      COMPLETED: 'timestamps.completed',
    }
    if (tsMap[status]) update[tsMap[status]] = new Date()
    if (vitals) update['triageData.vitals'] = vitals

    const incident = await Incident.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('assignedAmbulance')
      .populate('allocatedHospital')

    if (!incident) return res.status(404).json({ message: 'Incident not found' })

    // Broadcast status update
    const io = req.app.get('io')
    if (io) {
      io.to(`incident_${incident._id}`).emit('incident_status', { incidentId: incident._id, status })
      io.to('hospital').emit('incident_status', { incidentId: incident._id, status, incident })
      io.to('admin').emit('incident_status', { incidentId: incident._id, status })
    }

    res.json({ incident })
  } catch (err) {
    next(err)
  }
})

// POST /api/incidents/:id/allocate — Trigger hospital allocation
router.post('/:id/allocate', auth, authorize('admin', 'paramedic'), async (req, res, next) => {
  try {
    const incident = await Incident.findById(req.params.id)
    if (!incident) return res.status(404).json({ message: 'Incident not found' })

    // Find nearby hospitals
    const nearbyHospitals = await Hospital.find({
      location: {
        $nearSphere: {
          $geometry: incident.location,
          $maxDistance: 30000, // 30km
        },
      },
      isActive: true,
      'queueStatus.diversionStatus': false,
    }).limit(10)

    if (nearbyHospitals.length === 0) {
      return res.status(404).json({ message: 'No nearby hospitals found' })
    }

    // Call AI allocation service
    try {
      const aiResponse = await axios.post(`${process.env.AI_SERVICE_URL || 'http://localhost:8000'}/allocation/optimize`, {
        incidentId: incident._id,
        patientLocation: incident.location.coordinates,
        esiLevel: incident.triageData.esiLevel,
        requiredSpecialties: incident.triageData.requiredSpecialties || [],
        hospitals: nearbyHospitals.map((h) => ({
          id: h._id,
          name: h.name,
          location: h.location.coordinates,
          capabilities: h.capabilities,
          icuAvailable: h.resources.icuBeds.available,
          traumaAvailable: h.resources.traumaBeds.available,
          erWaitTime: h.queueStatus.erWaitTimeMinutes,
          diversionStatus: h.queueStatus.diversionStatus,
        })),
      }, { timeout: 10000 })

      const { rankedHospitals } = aiResponse.data
      const topHospital = rankedHospitals[0]

      await Incident.findByIdAndUpdate(incident._id, {
        allocatedHospital: topHospital.id,
        hospitalAllocationScores: rankedHospitals.map((h) => ({
          hospital: h.id,
          score: h.score,
          travelEta: h.travelEta,
          waitTime: h.waitTime,
          specialtyMatch: h.specialtyMatch,
          capacityScore: h.capacityScore,
        })),
      })

      return res.json({ rankedHospitals, allocatedHospital: topHospital })
    } catch (aiErr) {
      // Fallback: simple nearest hospital
      console.warn('AI allocation failed, using fallback:', aiErr.message)
      await Incident.findByIdAndUpdate(incident._id, {
        allocatedHospital: nearbyHospitals[0]._id,
      })
      return res.json({ allocatedHospital: nearbyHospitals[0], fallback: true })
    }
  } catch (err) {
    next(err)
  }
})

// GET /api/incidents/stats/summary — Admin stats
router.get('/stats/summary', auth, authorize('admin'), async (req, res, next) => {
  try {
    const [total, active, completed, today] = await Promise.all([
      Incident.countDocuments(),
      Incident.countDocuments({ status: { $in: ['PENDING', 'DISPATCHING', 'EN_ROUTE_TO_PATIENT', 'AT_PATIENT', 'EN_ROUTE_TO_HOSPITAL'] } }),
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

// Async AI triage trigger
async function triggerAITriage(incidentId, data, io) {
  try {
    const response = await axios.post(
      `${process.env.AI_SERVICE_URL || 'http://localhost:8000'}/triage/analyze`,
      { incidentId, ...data },
      { timeout: 15000 }
    )

    const { esiLevel, aiSummary, aiConfidence, requiredSpecialties } = response.data

    await Incident.findByIdAndUpdate(incidentId, {
      'triageData.esiLevel': esiLevel,
      'triageData.aiSummary': aiSummary,
      'triageData.aiConfidence': aiConfidence,
      'triageData.requiredSpecialties': requiredSpecialties,
      status: 'TRIAGE_COMPLETE',
      'timestamps.triageCompleted': new Date(),
    })

    if (io) {
      io.to(`incident_${incidentId}`).emit('triage_complete', { incidentId, esiLevel, aiSummary })
      io.to('admin').emit('triage_complete', { incidentId, esiLevel, aiSummary })
    }

    // Auto-find nearest available ambulance
    const incident = await Incident.findById(incidentId)
    const ambulance = await Ambulance.findOne({
      status: 'AVAILABLE',
      currentLocation: {
        $nearSphere: {
          $geometry: incident.location,
          $maxDistance: 20000,
        },
      },
    })

    if (ambulance) {
      await Promise.all([
        Incident.findByIdAndUpdate(incidentId, {
          assignedAmbulance: ambulance._id,
          status: 'DISPATCHING',
          'timestamps.dispatched': new Date(),
        }),
        Ambulance.findByIdAndUpdate(ambulance._id, {
          status: 'DISPATCHED',
          currentIncident: incidentId,
        }),
      ])

      if (io) {
        io.to(`ambulance_${ambulance._id}`).emit('dispatch_alert', { incidentId, incident })
        io.to('admin').emit('ambulance_dispatched', { ambulanceId: ambulance._id, incidentId })
      }
    }
  } catch (err) {
    console.error('AI triage error:', err.message)
    // Update with fallback ESI
    await Incident.findByIdAndUpdate(incidentId, {
      'triageData.esiLevel': 3,
      'triageData.aiSummary': 'Manual triage required',
      status: 'TRIAGE_COMPLETE',
    }).catch(() => {})
  }
}

module.exports = router
