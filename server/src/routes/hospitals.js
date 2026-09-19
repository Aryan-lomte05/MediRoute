const express = require('express')
const Hospital = require('../models/Hospital')
const { auth, authorize } = require('../middleware/auth')

const router = express.Router()

// GET /api/hospitals — List all hospitals (with optional geo filter)
router.get('/', auth, async (req, res, next) => {
  try {
    const { lat, lng, radius = 30000, capabilities } = req.query
    let query = { isActive: true }

    let hospitals
    if (lat && lng) {
      query.location = {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: parseInt(radius),
        },
      }
    }

    if (capabilities) {
      query.capabilities = { $in: capabilities.split(',') }
    }

    hospitals = await Hospital.find(query).limit(20)
    res.json({ hospitals, total: hospitals.length })
  } catch (err) {
    next(err)
  }
})

// GET /api/hospitals/:id
router.get('/:id', auth, async (req, res, next) => {
  try {
    const hospital = await Hospital.findById(req.params.id)
    if (!hospital) return res.status(404).json({ message: 'Hospital not found' })
    res.json({ hospital })
  } catch (err) {
    next(err)
  }
})

// POST /api/hospitals — Create hospital (admin only)
router.post('/', auth, authorize('admin'), async (req, res, next) => {
  try {
    const hospital = await Hospital.create(req.body)
    res.status(201).json({ hospital })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/hospitals/:id/resources — Update bed/resource counts (hospital staff)
router.patch('/:id/resources', auth, authorize('hospital_staff', 'admin'), async (req, res, next) => {
  try {
    const { resources, queueStatus } = req.body
    const update = { lastUpdated: new Date() }
    if (resources) update.resources = resources
    if (queueStatus) update.queueStatus = queueStatus

    const hospital = await Hospital.findByIdAndUpdate(req.params.id, update, { new: true })
    if (!hospital) return res.status(404).json({ message: 'Hospital not found' })

    // Broadcast resource update
    const io = req.app.get('io')
    if (io) io.to('admin').emit('hospital_resources_update', { hospitalId: hospital._id, resources: hospital.resources, queueStatus: hospital.queueStatus })

    res.json({ hospital })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/hospitals/:id/diversion — Toggle diversion status
router.patch('/:id/diversion', auth, authorize('hospital_staff', 'admin'), async (req, res, next) => {
  try {
    const { diversionStatus } = req.body
    const hospital = await Hospital.findByIdAndUpdate(
      req.params.id,
      { 'queueStatus.diversionStatus': diversionStatus },
      { new: true }
    )

    const io = req.app.get('io')
    if (io) io.to('admin').emit('hospital_diversion', { hospitalId: hospital._id, diversionStatus })

    res.json({ hospital })
  } catch (err) {
    next(err)
  }
})

// POST /api/hospitals/seed — Seed sample Mumbai hospitals (dev only)
router.post('/seed', auth, authorize('admin'), async (req, res, next) => {
  try {
    const sampleHospitals = [
      {
        name: 'City General Trauma Center',
        location: { type: 'Point', coordinates: [72.8777, 19.0760], address: 'Mumbai, Maharashtra', city: 'Mumbai' },
        capabilities: ['LEVEL_1_TRAUMA', 'CARDIAC_CATH_LAB', 'STROKE_CENTER', 'NEUROSURGERY'],
        resources: {
          icuBeds: { total: 20, available: 5 },
          traumaBeds: { total: 10, available: 2 },
          generalBeds: { total: 100, available: 30 },
          ventilators: { total: 15, available: 4 },
        },
        queueStatus: { erWaitTimeMinutes: 12, diversionStatus: false },
        contact: { phone: '022-12345678', emergencyPhone: '022-99999999' },
      },
      {
        name: 'Lilavati Hospital',
        location: { type: 'Point', coordinates: [72.8265, 19.0599], address: 'Bandra West, Mumbai', city: 'Mumbai' },
        capabilities: ['CARDIAC_CATH_LAB', 'GENERAL_SURGERY', 'ORTHOPEDIC', 'PEDIATRIC_ICU'],
        resources: {
          icuBeds: { total: 30, available: 8 },
          traumaBeds: { total: 8, available: 3 },
          generalBeds: { total: 200, available: 60 },
          ventilators: { total: 20, available: 7 },
        },
        queueStatus: { erWaitTimeMinutes: 8, diversionStatus: false },
        contact: { phone: '022-26451111', emergencyPhone: '022-26459999' },
      },
      {
        name: 'Hinduja Hospital',
        location: { type: 'Point', coordinates: [72.8304, 19.0483], address: 'Mahim, Mumbai', city: 'Mumbai' },
        capabilities: ['STROKE_CENTER', 'NEUROSURGERY', 'CARDIAC_CATH_LAB', 'BURN_UNIT'],
        resources: {
          icuBeds: { total: 25, available: 3 },
          traumaBeds: { total: 12, available: 1 },
          generalBeds: { total: 180, available: 45 },
          ventilators: { total: 18, available: 5 },
        },
        queueStatus: { erWaitTimeMinutes: 20, diversionStatus: false },
        contact: { phone: '022-24452222', emergencyPhone: '022-24459999' },
      },
    ]

    await Hospital.deleteMany({})
    await Hospital.insertMany(sampleHospitals)
    res.json({ message: 'Seeded 3 sample hospitals', count: 3 })
  } catch (err) {
    next(err)
  }
})

module.exports = router
