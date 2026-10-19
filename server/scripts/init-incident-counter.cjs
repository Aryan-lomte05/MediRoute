/**
 * Seed the atomic incident counter past every number already issued.
 *
 * Run once after deploying the counter-based numbering:
 *   node scripts/init-incident-counter.cjs
 *
 * Incident numbers used to come from countDocuments(), so the existing rows
 * carry numbers the fresh counter would otherwise reissue. This reads the
 * highest sequence actually in use for each day and sets the counter above it.
 * Idempotent: it never lowers a counter.
 */
require('dotenv').config()
const mongoose = require('mongoose')
const Incident = require('../src/models/Incident')
const Counter = require('../src/models/Counter')

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)

  const incidents = await Incident.find({ incidentNumber: { $ne: null } }).select('incidentNumber')
  const highest = new Map()

  for (const i of incidents) {
    // INC-YYYYMMDD-NNNN
    const m = /^INC-(\d{8})-(\d+)/.exec(i.incidentNumber || '')
    if (!m) continue
    const key = `incident-${m[1]}`
    const seq = parseInt(m[2], 10)
    if (!highest.has(key) || seq > highest.get(key)) highest.set(key, seq)
  }

  if (highest.size === 0) {
    console.log('No existing incident numbers found. Nothing to seed.')
    await mongoose.disconnect()
    return
  }

  for (const [key, seq] of highest) {
    const current = await Counter.findById(key)
    if (current && current.seq >= seq) {
      console.log(`  ${key}: already at ${current.seq} (>= ${seq}), left alone`)
      continue
    }
    await Counter.findOneAndUpdate({ _id: key }, { $set: { seq } }, { upsert: true })
    console.log(`  ${key}: set to ${seq}`)
  }

  console.log(`\nDone. Seeded ${highest.size} day counter(s).`)
  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
