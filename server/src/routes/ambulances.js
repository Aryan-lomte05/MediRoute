const express = require('express')
const Ambulance = require('../models/Ambulance')
const Incident = require('../models/Incident')
const { auth, authorize, optionalAuth } = require('../middleware/auth')

const router = express.Router()

// GET /api/ambulances — List all ambulances
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { status, lat, lng, radius = 50000 } = req.query
    let query = { isActive: true }

    if (status) query.status = status

    let ambulances
    if (lat && lng) {
      query.currentLocation = {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: parseInt(radius),
        },
      }
    }

    ambulances = await Ambulance.find(query)
      .populate('assignedParamedic', 'name phone')
      .populate('currentIncident', 'incidentNumber status triageData.esiLevel triageData.chiefComplaint location')
      .limit(50)

    res.json({ ambulances, total: ambulances.length })
  } catch (err) {
    next(err)
  }
})

// GET /api/ambulances/my-ambulance — Get ambulance assigned to current paramedic or active lead unit
router.get('/my-ambulance', optionalAuth, async (req, res, next) => {
  try {
    let ambulance = null
    if (req.user?.ambulanceId) {
      ambulance = await Ambulance.findById(req.user.ambulanceId)
        .populate('assignedParamedic', 'name phone')
        .populate({
          path: 'currentIncident',
          populate: [{ path: 'allocatedHospital' }, { path: 'patient', select: 'name phone emergencyProfile' }],
        })
    }

    if (!ambulance) {
      // Find first unit or unit with active incident
      ambulance = await Ambulance.findOne({ currentIncident: { $ne: null } })
        .populate('assignedParamedic', 'name phone')
        .populate({
          path: 'currentIncident',
          populate: [{ path: 'allocatedHospital' }, { path: 'patient', select: 'name phone emergencyProfile' }],
        })
    }

    if (!ambulance) {
      ambulance = await Ambulance.findOne({ isActive: true })
    }

    if (!ambulance) return res.status(404).json({ message: 'No ambulance found' })

    res.json({ ambulance })
  } catch (err) {
    next(err)
  }
})

// GET /api/ambulances/:id
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const ambulance = await Ambulance.findById(req.params.id)
      .populate('assignedParamedic')
      .populate({
        path: 'currentIncident',
        populate: [{ path: 'allocatedHospital' }, { path: 'patient' }],
      })
    if (!ambulance) return res.status(404).json({ message: 'Ambulance not found' })
    res.json({ ambulance })
  } catch (err) {
    next(err)
  }
})

// POST /api/ambulances — Create ambulance (admin)
router.post('/', auth, authorize('admin'), async (req, res, next) => {
  try {
    const ambulance = await Ambulance.create(req.body)
    res.status(201).json({ ambulance })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/ambulances/:id/location — Update GPS location (paramedic/admin)
router.patch('/:id/location', optionalAuth, async (req, res, next) => {
  try {
    const { coordinates, heading, speed } = req.body

    const ambulance = await Ambulance.findByIdAndUpdate(
      req.params.id,
      {
        'currentLocation.coordinates': coordinates,
        'currentLocation.heading': heading,
        'currentLocation.speed': speed,
        'currentLocation.updatedAt': new Date(),
        lastPing: new Date(),
      },
      { new: true }
    )

    if (!ambulance) return res.status(404).json({ message: 'Ambulance not found' })

    // Broadcast location update via socket
    const io = req.app.get('io')
    if (io) {
      const locationUpdate = { ambulanceId: req.params.id, coordinates, heading, speed, timestamp: Date.now() }
      if (ambulance.currentIncident) {
        io.to(`incident_${ambulance.currentIncident}`).emit('ambulance_location', locationUpdate)
      }
      io.to('admin').emit('ambulance_location', locationUpdate)
      io.to('hospital').emit('ambulance_location', locationUpdate)
      io.to('patient').emit('ambulance_location', locationUpdate)
    }

    res.json({ location: ambulance.currentLocation })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/ambulances/:id/status — Update status
router.patch('/:id/status', optionalAuth, async (req, res, next) => {
  try {
    const { status, currentIncident } = req.body
    const update = { status }
    if (currentIncident !== undefined) update.currentIncident = currentIncident

    const ambulance = await Ambulance.findByIdAndUpdate(req.params.id, update, { new: true })
    if (!ambulance) return res.status(404).json({ message: 'Ambulance not found' })

    const io = req.app.get('io')
    if (io) {
      io.to('admin').emit('ambulance_status', { ambulanceId: req.params.id, status, currentIncident })
      io.to('hospital').emit('ambulance_status', { ambulanceId: req.params.id, status, currentIncident })
    }

    res.json({ ambulance })
  } catch (err) {
    next(err)
  }
})

// POST /api/ambulances/seed — Seed sample ambulances (dev)
router.post('/seed', optionalAuth, async (req, res, next) => {
  try {
    const samples = [
      {
        vehicleNumber: 'MH-AMB-001',
        vehicleType: 'ADVANCED_LIFE_SUPPORT',
        status: 'AVAILABLE',
        currentLocation: { type: 'Point', coordinates: [72.8600, 19.0700] },
        equipment: { defibrillator: true, ventilator: true, bloodSupply: true },
      },
      {
        vehicleNumber: 'MH-AMB-002',
        vehicleType: 'MOBILE_ICU',
        status: 'AVAILABLE',
        currentLocation: { type: 'Point', coordinates: [72.8350, 19.0600] },
        equipment: { defibrillator: true, ventilator: true, bloodSupply: true },
      },
      {
        vehicleNumber: 'MH-AMB-003',
        vehicleType: 'BASIC_LIFE_SUPPORT',
        status: 'AVAILABLE',
        currentLocation: { type: 'Point', coordinates: [72.8900, 19.0850] },
        equipment: { defibrillator: true, ventilator: false, bloodSupply: false },
      },
      {
        vehicleNumber: 'MH-AMB-004',
        vehicleType: 'ADVANCED_LIFE_SUPPORT',
        status: 'AVAILABLE',
        currentLocation: { type: 'Point', coordinates: [72.8200, 19.0400] },
        equipment: { defibrillator: true, ventilator: true, bloodSupply: false },
      },
    ]
    await Ambulance.deleteMany({})
    await Ambulance.insertMany(samples)
    res.json({ message: 'Seeded 4 ambulances', count: 4 })
  } catch (err) {
    next(err)
  }
})

module.exports = router
