const express = require('express')
const Ambulance = require('../models/Ambulance')
const Incident = require('../models/Incident')
const { auth, authorize } = require('../middleware/auth')

const router = express.Router()

// GET /api/ambulances — List all ambulances
router.get('/', auth, async (req, res, next) => {
  try {
    const { status, lat, lng, radius = 20000 } = req.query
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
      .populate('currentIncident', 'incidentNumber status triageData.esiLevel')
      .limit(50)

    res.json({ ambulances })
  } catch (err) {
    next(err)
  }
})

// GET /api/ambulances/:id
router.get('/:id', auth, async (req, res, next) => {
  try {
    const ambulance = await Ambulance.findById(req.params.id)
      .populate('assignedParamedic')
      .populate('currentIncident')
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

// PATCH /api/ambulances/:id/location — Update GPS location (paramedic)
router.patch('/:id/location', auth, authorize('paramedic', 'admin'), async (req, res, next) => {
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
      const locationUpdate = { ambulanceId: req.params.id, coordinates, heading, speed }
      if (ambulance.currentIncident) {
        io.to(`incident_${ambulance.currentIncident}`).emit('ambulance_location', locationUpdate)
      }
      io.to('admin').emit('ambulance_location', locationUpdate)
      io.to('hospital').emit('ambulance_location', locationUpdate)
    }

    res.json({ location: ambulance.currentLocation })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/ambulances/:id/status — Update status
router.patch('/:id/status', auth, authorize('paramedic', 'admin'), async (req, res, next) => {
  try {
    const { status } = req.body
    const ambulance = await Ambulance.findByIdAndUpdate(req.params.id, { status }, { new: true })
    if (!ambulance) return res.status(404).json({ message: 'Ambulance not found' })

    const io = req.app.get('io')
    if (io) io.to('admin').emit('ambulance_status', { ambulanceId: req.params.id, status })

    res.json({ ambulance })
  } catch (err) {
    next(err)
  }
})

// POST /api/ambulances/seed — Seed sample ambulances (dev)
router.post('/seed', auth, authorize('admin'), async (req, res, next) => {
  try {
    const samples = [
      { vehicleNumber: 'MH-AMB-001', vehicleType: 'ADVANCED_LIFE_SUPPORT', status: 'AVAILABLE', currentLocation: { type: 'Point', coordinates: [72.8600, 19.0700] } },
      { vehicleNumber: 'MH-AMB-002', vehicleType: 'MOBILE_ICU', status: 'AVAILABLE', currentLocation: { type: 'Point', coordinates: [72.8350, 19.0600] } },
      { vehicleNumber: 'MH-AMB-003', vehicleType: 'BASIC_LIFE_SUPPORT', status: 'AVAILABLE', currentLocation: { type: 'Point', coordinates: [72.8900, 19.0850] } },
      { vehicleNumber: 'MH-AMB-004', vehicleType: 'ADVANCED_LIFE_SUPPORT', status: 'AVAILABLE', currentLocation: { type: 'Point', coordinates: [72.8200, 19.0400] } },
    ]
    await Ambulance.deleteMany({})
    await Ambulance.insertMany(samples)
    res.json({ message: 'Seeded 4 ambulances' })
  } catch (err) {
    next(err)
  }
})

module.exports = router
