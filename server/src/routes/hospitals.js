const express = require('express')
const Hospital = require('../models/Hospital')
const { auth, authorize, optionalAuth } = require('../middleware/auth')

const router = express.Router()

// GET /api/hospitals — List all hospitals (with optional geo filter)
router.get('/', optionalAuth, async (req, res, next) => {
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

// GET /api/hospitals/primary — Get primary / staff hospital
router.get('/primary', optionalAuth, async (req, res, next) => {
  try {
    let hospital = null
    if (req.user?.hospitalId) {
      hospital = await Hospital.findById(req.user.hospitalId)
    }
    if (!hospital) {
      hospital = await Hospital.findOne({ isActive: true })
    }
    if (!hospital) return res.status(404).json({ message: 'No active hospital found' })
    res.json({ hospital })
  } catch (err) {
    next(err)
  }
})

// GET /api/hospitals/:id
router.get('/:id', optionalAuth, async (req, res, next) => {
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

// PATCH /api/hospitals/:id/resources — Update bed/resource counts
// Staff-only: bed availability drives live ambulance allocation across the city,
// so an unauthenticated writer here could redirect real dispatches.
router.patch('/:id/resources', auth, authorize('hospital_staff', 'admin'), async (req, res, next) => {
  try {
    const { resources, queueStatus } = req.body
    const update = { lastUpdated: new Date() }
    if (resources) update.resources = resources
    if (queueStatus) update.queueStatus = queueStatus

    const hospital = await Hospital.findByIdAndUpdate(req.params.id, update, { new: true })
    if (!hospital) return res.status(404).json({ message: 'Hospital not found' })

    // Broadcast resource update across Socket.IO
    const io = req.app.get('io')
    if (io) {
      io.to('admin').emit('hospital_resources_update', { hospitalId: hospital._id, resources: hospital.resources, queueStatus: hospital.queueStatus })
      io.to('hospital').emit('hospital_resources_update', { hospitalId: hospital._id, resources: hospital.resources, queueStatus: hospital.queueStatus })
    }

    res.json({ hospital })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/hospitals/:id/diversion — Toggle diversion status
// Staff-only: diverting a hospital removes it from allocation city-wide.
router.patch('/:id/diversion', auth, authorize('hospital_staff', 'admin'), async (req, res, next) => {
  try {
    const { diversionStatus } = req.body
    const hospital = await Hospital.findByIdAndUpdate(
      req.params.id,
      { 'queueStatus.diversionStatus': diversionStatus, lastUpdated: new Date() },
      { new: true }
    )

    if (!hospital) return res.status(404).json({ message: 'Hospital not found' })

    const io = req.app.get('io')
    if (io) {
      io.to('admin').emit('hospital_diversion', { hospitalId: hospital._id, diversionStatus, hospitalName: hospital.name })
      io.to('hospital').emit('hospital_diversion', { hospitalId: hospital._id, diversionStatus, hospitalName: hospital.name })
    }

    res.json({ hospital })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/hospitals/:id/blood — Adjust blood bank stock
// Body: { component: 'oNeg'|'plasma'|…, delta: number } for a relative change,
// or { bloodBank: {…} } to set several counts at once.
// Relative changes are the normal path: two staff members receiving units at
// the same time would otherwise overwrite each other with a stale absolute.
router.patch('/:id/blood', auth, authorize('hospital_staff', 'admin'), async (req, res, next) => {
  try {
    const { component, delta, bloodBank } = req.body
    const COMPONENTS = ['oNeg', 'oPos', 'aNeg', 'aPos', 'bNeg', 'bPos', 'abNeg', 'abPos', 'plasma', 'platelets']

    let update
    if (component) {
      if (!COMPONENTS.includes(component)) {
        return res.status(400).json({ message: `component must be one of: ${COMPONENTS.join(', ')}` })
      }
      if (!Number.isFinite(Number(delta))) {
        return res.status(400).json({ message: 'delta must be a number' })
      }
      update = { $inc: { [`bloodBank.${component}`]: Number(delta) }, $set: { lastUpdated: new Date() } }
    } else if (bloodBank && typeof bloodBank === 'object') {
      const set = { lastUpdated: new Date() }
      for (const [k, v] of Object.entries(bloodBank)) {
        if (COMPONENTS.includes(k) && Number.isFinite(Number(v))) {
          set[`bloodBank.${k}`] = Math.max(0, Number(v))
        }
      }
      update = { $set: set }
    } else {
      return res.status(400).json({ message: 'Provide either {component, delta} or {bloodBank}' })
    }

    const hospital = await Hospital.findByIdAndUpdate(req.params.id, update, { new: true })
    if (!hospital) return res.status(404).json({ message: 'Hospital not found' })

    // Never let a stock count go negative through a concurrent decrement.
    const negatives = Object.entries(hospital.bloodBank?.toObject?.() || hospital.bloodBank || {})
      .filter(([, v]) => typeof v === 'number' && v < 0)
    if (negatives.length) {
      const fix = {}
      for (const [k] of negatives) fix[`bloodBank.${k}`] = 0
      await Hospital.findByIdAndUpdate(req.params.id, { $set: fix })
      for (const [k] of negatives) hospital.bloodBank[k] = 0
    }

    const io = req.app.get('io')
    if (io) {
      const payload = { hospitalId: hospital._id, bloodBank: hospital.bloodBank }
      io.to('hospital').emit('blood_bank_update', payload)
      io.to('admin').emit('blood_bank_update', payload)
    }

    res.json({ bloodBank: hospital.bloodBank })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/hospitals/:id/bays/:number — Update one resuscitation bay
router.patch('/:id/bays/:number', auth, authorize('hospital_staff', 'admin'), async (req, res, next) => {
  try {
    const { status, label, doctor, incident } = req.body
    const VALID = ['AVAILABLE', 'OCCUPIED', 'INCOMING', 'CLEANING', 'CLOSED']

    if (status && !VALID.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${VALID.join(', ')}` })
    }

    const bayNumber = parseInt(req.params.number, 10)
    if (!Number.isFinite(bayNumber)) return res.status(400).json({ message: 'Invalid bay number' })

    const set = { lastUpdated: new Date() }
    if (status) {
      set['erBays.$.status'] = status
      set['erBays.$.since'] = new Date()
      // Releasing a bay clears whoever was in it, so a freed bay never keeps a
      // previous patient's label.
      if (status === 'AVAILABLE') {
        set['erBays.$.label'] = ''
        set['erBays.$.doctor'] = ''
        set['erBays.$.incident'] = null
      }
    }
    if (label !== undefined) set['erBays.$.label'] = String(label).slice(0, 120)
    if (doctor !== undefined) set['erBays.$.doctor'] = String(doctor).slice(0, 80)
    if (incident !== undefined) set['erBays.$.incident'] = incident || null

    const hospital = await Hospital.findOneAndUpdate(
      { _id: req.params.id, 'erBays.number': bayNumber },
      { $set: set },
      { new: true }
    )

    if (!hospital) return res.status(404).json({ message: 'Hospital or bay not found' })

    const io = req.app.get('io')
    if (io) {
      const payload = { hospitalId: hospital._id, erBays: hospital.erBays }
      io.to('hospital').emit('er_bays_update', payload)
      io.to('admin').emit('er_bays_update', payload)
    }

    res.json({ erBays: hospital.erBays })
  } catch (err) {
    next(err)
  }
})

// POST /api/hospitals/seed — Seed sample Mumbai hospitals
// Admin-only and destructive: this deletes every hospital before inserting.
// It was previously reachable unauthenticated, meaning any caller on the
// internet could empty the collection.
router.post('/seed', auth, authorize('admin'), async (req, res, next) => {
  try {
    /**
     * Bay boards are generated per hospital from its own trauma bed count, so
     * each ER has a plausible number of bays rather than the fixed 20 the
     * client used to hardcode for everyone. All bays start AVAILABLE: real
     * occupancy arrives from live incident allocation, not from seed data.
     */
    const makeBays = (count) =>
      Array.from({ length: count }, (_, i) => ({
        number: i + 1,
        status: 'AVAILABLE',
        label: '',
        doctor: '',
        since: null,
      }))

    const sampleHospitals = [
      {
        name: 'City General Trauma Center',
        location: { type: 'Point', coordinates: [72.8777, 19.076], address: 'Parel, Mumbai', city: 'Mumbai' },
        capabilities: ['LEVEL_1_TRAUMA', 'CARDIAC_CATH_LAB', 'STROKE_CENTER', 'NEUROSURGERY'],
        resources: {
          icuBeds: { total: 20, available: 5 },
          traumaBeds: { total: 10, available: 2 },
          generalBeds: { total: 100, available: 30 },
          ventilators: { total: 15, available: 4 },
        },
        bloodBank: { oNeg: 18, oPos: 40, aNeg: 9, aPos: 32, bNeg: 7, bPos: 28, abNeg: 3, abPos: 11, plasma: 24, platelets: 14 },
        erBays: makeBays(14),
        queueStatus: { erWaitTimeMinutes: 12, diversionStatus: false, currentPatientLoad: 14 },
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
        bloodBank: { oNeg: 12, oPos: 35, aNeg: 6, aPos: 29, bNeg: 5, bPos: 22, abNeg: 2, abPos: 8, plasma: 19, platelets: 10 },
        erBays: makeBays(12),
        queueStatus: { erWaitTimeMinutes: 8, diversionStatus: false, currentPatientLoad: 22 },
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
        bloodBank: { oNeg: 9, oPos: 26, aNeg: 4, aPos: 21, bNeg: 4, bPos: 18, abNeg: 1, abPos: 6, plasma: 15, platelets: 8 },
        erBays: makeBays(12),
        queueStatus: { erWaitTimeMinutes: 20, diversionStatus: false, currentPatientLoad: 18 },
        contact: { phone: '022-24452222', emergencyPhone: '022-24459999' },
      },
      // The regional mutual-aid network was a hardcoded list in the hospital
      // portal. These are real records so that panel can read from the database
      // like every other view.
      {
        name: 'KEM Hospital',
        location: { type: 'Point', coordinates: [72.8426, 19.0024], address: 'Parel, Mumbai', city: 'Mumbai' },
        capabilities: ['LEVEL_1_TRAUMA', 'GENERAL_SURGERY', 'NEUROSURGERY', 'ORTHOPEDIC'],
        resources: {
          icuBeds: { total: 32, available: 3 },
          traumaBeds: { total: 15, available: 6 },
          generalBeds: { total: 350, available: 70 },
          ventilators: { total: 28, available: 6 },
        },
        bloodBank: { oNeg: 22, oPos: 48, aNeg: 11, aPos: 38, bNeg: 9, bPos: 31, abNeg: 4, abPos: 13, plasma: 30, platelets: 16 },
        erBays: makeBays(18),
        queueStatus: { erWaitTimeMinutes: 35, diversionStatus: false, currentPatientLoad: 41 },
        contact: { phone: '022-24107000', emergencyPhone: '022-24136051' },
      },
      {
        name: 'Sion Hospital (LTMGH)',
        location: { type: 'Point', coordinates: [72.8656, 19.0395], address: 'Sion, Mumbai', city: 'Mumbai' },
        capabilities: ['LEVEL_2_TRAUMA', 'GENERAL_SURGERY', 'PEDIATRIC_ICU', 'NICU'],
        resources: {
          icuBeds: { total: 24, available: 6 },
          traumaBeds: { total: 12, available: 4 },
          generalBeds: { total: 280, available: 55 },
          ventilators: { total: 22, available: 8 },
        },
        bloodBank: { oNeg: 14, oPos: 33, aNeg: 7, aPos: 25, bNeg: 6, bPos: 20, abNeg: 2, abPos: 9, plasma: 21, platelets: 11 },
        erBays: makeBays(16),
        queueStatus: { erWaitTimeMinutes: 28, diversionStatus: false, currentPatientLoad: 36 },
        contact: { phone: '022-24076381', emergencyPhone: '022-24063000' },
      },
      {
        name: 'Kokilaben Dhirubhai Ambani Hospital',
        location: { type: 'Point', coordinates: [72.8268, 19.1307], address: 'Andheri West, Mumbai', city: 'Mumbai' },
        capabilities: ['CARDIAC_CATH_LAB', 'STROKE_CENTER', 'NEUROSURGERY', 'BURN_UNIT', 'ICU'],
        resources: {
          icuBeds: { total: 20, available: 4 },
          traumaBeds: { total: 10, available: 5 },
          generalBeds: { total: 160, available: 38 },
          ventilators: { total: 16, available: 5 },
        },
        bloodBank: { oNeg: 11, oPos: 29, aNeg: 5, aPos: 23, bNeg: 4, bPos: 19, abNeg: 2, abPos: 7, plasma: 17, platelets: 9 },
        erBays: makeBays(10),
        queueStatus: { erWaitTimeMinutes: 15, diversionStatus: false, currentPatientLoad: 19 },
        contact: { phone: '022-42696969', emergencyPhone: '022-30666666' },
      },
    ]

    await Hospital.deleteMany({})
    const created = await Hospital.insertMany(sampleHospitals)
    res.json({ message: `Seeded ${created.length} hospitals`, count: created.length })
  } catch (err) {
    next(err)
  }
})

module.exports = router
