/**
 * ==============================================================================
 * MIGRATION - add ER bays and blood bank stock to existing hospitals
 * ==============================================================================
 *
 * Run:  node scripts/migrate-hospital-resources.cjs
 *
 * Why a migration rather than re-seeding:
 * POST /api/hospitals/seed runs deleteMany({}) and reinserts, which mints new
 * _ids. Existing incidents reference hospitals by _id through
 * allocatedHospital and hospitalAllocationScores, so re-seeding would orphan
 * every historical allocation. This updates documents in place and only
 * inserts hospitals that are genuinely missing.
 *
 * Idempotent: running it twice changes nothing the second time.
 * ==============================================================================
 */

require('dotenv').config()
const mongoose = require('mongoose')
const Hospital = require('../src/models/Hospital')

/** Bay count scaled to the hospital's own trauma capacity. */
function makeBays(count) {
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    status: 'AVAILABLE',
    label: '',
    doctor: '',
    since: null,
  }))
}

/**
 * Starting blood stock derived from the hospital's size, so the numbers are at
 * least internally consistent rather than copied between hospitals.
 */
function makeBloodBank(icuTotal) {
  const scale = Math.max(1, Math.round(icuTotal / 10))
  return {
    oNeg: 6 * scale,
    oPos: 14 * scale,
    aNeg: 3 * scale,
    aPos: 11 * scale,
    bNeg: 3 * scale,
    bPos: 9 * scale,
    abNeg: 1 * scale,
    abPos: 4 * scale,
    plasma: 8 * scale,
    platelets: 5 * scale,
  }
}

/** Regional network hospitals, inserted only if absent by name. */
const NETWORK = [
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
    queueStatus: { erWaitTimeMinutes: 15, diversionStatus: false, currentPatientLoad: 19 },
    contact: { phone: '022-42696969', emergencyPhone: '022-30666666' },
  },
]

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected.\n')

  // ── 1. Backfill bays and blood stock on existing hospitals ────────────────
  const existing = await Hospital.find({})
  let baysAdded = 0
  let bloodAdded = 0

  for (const h of existing) {
    const update = {}

    if (!h.erBays || h.erBays.length === 0) {
      const traumaBeds = h.resources?.traumaBeds?.total || 8
      // Bays outnumber trauma beds: not every bay is a trauma resus bay.
      update.erBays = makeBays(Math.max(8, Math.min(20, traumaBeds + 4)))
      baysAdded++
    }

    const bank = h.bloodBank || {}
    const bankEmpty = !bank.oNeg && !bank.oPos && !bank.plasma
    if (bankEmpty) {
      update.bloodBank = makeBloodBank(h.resources?.icuBeds?.total || 20)
      bloodAdded++
    }

    /**
     * Declare ICU capability wherever ICU beds actually exist. Triage emits
     * 'ICU' as a required specialty for cardiac, unconscious, burn and
     * poisoning presentations, but no hospital record listed it, so those
     * patients matched no hospital on specialty at all.
     */
    const caps = h.capabilities || []
    if ((h.resources?.icuBeds?.total || 0) > 0 && !caps.includes('ICU')) {
      update.capabilities = [...caps, 'ICU']
    }

    if (Object.keys(update).length) {
      await Hospital.updateOne({ _id: h._id }, { $set: update })
      console.log(`  updated ${h.name}: ${Object.keys(update).join(', ')}`)
    }
  }

  // ── 2. Insert regional network hospitals that are missing ─────────────────
  let inserted = 0
  for (const spec of NETWORK) {
    const found = await Hospital.findOne({ name: spec.name })
    if (found) {
      console.log(`  present already: ${spec.name}`)
      continue
    }
    await Hospital.create({
      ...spec,
      erBays: makeBays(Math.max(8, Math.min(20, (spec.resources.traumaBeds.total || 8) + 4))),
      bloodBank: makeBloodBank(spec.resources.icuBeds.total),
      isActive: true,
    })
    inserted++
    console.log(`  inserted: ${spec.name}`)
  }

  const total = await Hospital.countDocuments()
  console.log(
    `\nDone. bays backfilled: ${baysAdded}, blood stock backfilled: ${bloodAdded}, hospitals inserted: ${inserted}. Total hospitals: ${total}`
  )

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
