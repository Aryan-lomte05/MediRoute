/**
 * ==============================================================================
 * MAINTENANCE - close abandoned incidents and release their ambulances
 * ==============================================================================
 *
 * Run:  node scripts/close-stale-incidents.cjs            # dry run, changes nothing
 *       node scripts/close-stale-incidents.cjs --apply     # performs the update
 *       node scripts/close-stale-incidents.cjs --apply --days 3
 *
 * WHY THIS IS NEEDED:
 * An incident holds its assigned ambulance until it reaches COMPLETED or
 * CANCELLED. Any run that is abandoned part-way - a demo nobody closed, a
 * crashed process - leaves the unit marked DISPATCHED forever. Those units are
 * then invisible to the dispatcher, which looks for status AVAILABLE, so the
 * fleet silently shrinks until no ambulance can be assigned at all and new
 * emergencies queue with no explanation.
 *
 * Stale cases also distort the command centre: they are counted as active, they
 * inflate the ESI breakdown, and they feed the surge forecast.
 *
 * Nothing is deleted. Incidents are marked CANCELLED rather than COMPLETED,
 * because they were abandoned, not treated - COMPLETED would overstate the
 * service's completion rate.
 * ==============================================================================
 */

require('dotenv').config()
const mongoose = require('mongoose')
const Incident = require('../src/models/Incident')
const Ambulance = require('../src/models/Ambulance')

const APPLY = process.argv.includes('--apply')
const daysArg = process.argv.indexOf('--days')
const DAYS = daysArg !== -1 ? parseFloat(process.argv[daysArg + 1]) : 7

const OPEN_STATUSES = [
  'PENDING',
  'TRIAGE_COMPLETE',
  'DISPATCHING',
  'DISPATCHED',
  'EN_ROUTE_TO_PATIENT',
  'AT_PATIENT',
  'EN_ROUTE_TO_HOSPITAL',
  'ARRIVED_AT_HOSPITAL',
]

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)

  const cutoff = new Date(Date.now() - DAYS * 86400000)
  console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN (pass --apply to commit)'}`)
  console.log(`Closing open incidents created before ${cutoff.toISOString()} (${DAYS} days)\n`)

  const stale = await Incident.find({
    status: { $in: OPEN_STATUSES },
    createdAt: { $lt: cutoff },
  }).select('incidentNumber status createdAt assignedAmbulance')

  if (stale.length === 0) {
    console.log('No stale incidents. Nothing to do.')
    await mongoose.disconnect()
    return
  }

  console.log(`Found ${stale.length} abandoned incident(s):`)
  for (const i of stale) {
    const age = Math.round((Date.now() - i.createdAt) / 86400000)
    console.log(`  ${i.incidentNumber}  ${i.status.padEnd(20)} ${age}d old`)
  }

  // Any unit pointing at an incident that is closed, stale or missing.
  const staleIds = stale.map((i) => String(i._id))
  const assigned = await Ambulance.find({ currentIncident: { $ne: null } })
  const openIds = (
    await Incident.find({ status: { $in: OPEN_STATUSES }, createdAt: { $gte: cutoff } }).select('_id')
  ).map((i) => String(i._id))

  const toRelease = assigned.filter((a) => {
    const ref = String(a.currentIncident)
    return staleIds.includes(ref) || !openIds.includes(ref)
  })

  console.log(`\n${toRelease.length} ambulance(s) to release:`)
  for (const a of toRelease) console.log(`  ${a.vehicleNumber}  ${a.status} -> AVAILABLE`)

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to commit these changes.')
    await mongoose.disconnect()
    return
  }

  const res = await Incident.updateMany(
    { _id: { $in: stale.map((i) => i._id) } },
    {
      $set: {
        status: 'CANCELLED',
        'timestamps.completed': new Date(),
        notes: 'Automatically closed: abandoned without being completed.',
      },
    }
  )

  let released = 0
  for (const a of toRelease) {
    await Ambulance.findByIdAndUpdate(a._id, { status: 'AVAILABLE', currentIncident: null })
    released++
  }

  const available = await Ambulance.countDocuments({ status: 'AVAILABLE' })
  const total = await Ambulance.countDocuments()
  const active = await Incident.countDocuments({ status: { $in: OPEN_STATUSES } })

  console.log(`\nDone. Incidents cancelled: ${res.modifiedCount}, ambulances released: ${released}`)
  console.log(`Fleet now ${available}/${total} available. Active incidents: ${active}`)

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
