/**
 * ==============================================================================
 * PLAYWRIGHT GLOBAL SETUP / TEARDOWN
 * ==============================================================================
 *
 * Every dispatch test needs a free ambulance, and an incident holds its unit
 * until it is closed. Without this, a suite exhausts the four-vehicle fleet
 * after a couple of runs and every later dispatch assertion fails for a reason
 * that has nothing to do with the code under test.
 *
 * Setup closes leftover test incidents and releases any unit pointing at an
 * incident that is finished or gone. Teardown does the same, so a run leaves
 * the database as it found it.
 *
 * CommonJS on purpose: the repository root is CJS and the server models it
 * loads are CJS, so an ESM wrapper would fail to require them.
 * ==============================================================================
 */

const path = require('path')
const mongoose = require(path.join(__dirname, '..', '..', 'server', 'node_modules', 'mongoose'))

const dotenv = require(path.join(__dirname, '..', '..', 'server', 'node_modules', 'dotenv'))
dotenv.config({ path: path.join(__dirname, '..', '..', 'server', '.env') })

const MODELS = path.join(__dirname, '..', '..', 'server', 'src', 'models')

const OPEN = [
  'PENDING',
  'TRIAGE_COMPLETE',
  'DISPATCHING',
  'DISPATCHED',
  'EN_ROUTE_TO_PATIENT',
  'AT_PATIENT',
  'EN_ROUTE_TO_HOSPITAL',
  'ARRIVED_AT_HOSPITAL',
]

/** Markers written by the suites into incidents they create. */
const TEST_MARKER = /\[E2E TEST\]|concurrent|lifecycle/i

/**
 * Reports filed through the UI carry a real geocoded address, so they cannot be
 * matched on text. The suites write this into the optional phone field instead.
 */
const TEST_PHONE = '+91 00000 00000'

async function cleanTestState(label) {
  if (!process.env.MONGODB_URI) {
    console.warn(`[${label}] MONGODB_URI not set; skipping database cleanup`)
    return
  }

  await mongoose.connect(process.env.MONGODB_URI)

  // Register every model before anything populates.
  require(path.join(MODELS, 'Hospital.js'))
  require(path.join(MODELS, 'Counter.js'))
  const Incident = require(path.join(MODELS, 'Incident.js'))
  const Ambulance = require(path.join(MODELS, 'Ambulance.js'))

  const removed = await Incident.deleteMany({
    $or: [
      { 'location.address': TEST_MARKER },
      { 'triageData.chiefComplaint': /\[E2E TEST\]|test \d/i },
      { 'reporterContact.phone': TEST_PHONE },
    ],
  })

  // Release units whose incident is closed or gone. This is what keeps the
  // fleet dispatchable across repeated runs.
  const liveIds = (await Incident.find({ status: { $in: OPEN } }).select('_id')).map((i) => String(i._id))
  let released = 0
  for (const a of await Ambulance.find({ currentIncident: { $ne: null } })) {
    if (!liveIds.includes(String(a.currentIncident))) {
      await Ambulance.findByIdAndUpdate(a._id, {
        status: 'AVAILABLE',
        currentIncident: null,
        isSimulated: false,
      })
      released++
    }
  }

  const available = await Ambulance.countDocuments({ status: 'AVAILABLE' })
  const total = await Ambulance.countDocuments()
  console.log(
    `[${label}] removed ${removed.deletedCount} test incident(s), released ${released} unit(s). Fleet ${available}/${total} available.`
  )

  if (available === 0) {
    console.warn(
      `[${label}] WARNING: no ambulance is free, so dispatch assertions will fail for operational reasons. ` +
        `Run: node server/scripts/close-stale-incidents.cjs --apply`
    )
  }

  await mongoose.disconnect()
}

module.exports = cleanTestState
module.exports.cleanTestState = cleanTestState
module.exports.default = async function globalSetup() {
  await cleanTestState('setup')
}
