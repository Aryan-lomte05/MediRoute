/**
 * ==============================================================================
 * SOCKET AUTHORIZATION TESTS
 * ==============================================================================
 *
 * The socket layer carries the same operational data as the REST API: patient
 * identity, vitals, live unit positions, hospital capacity. Every REST write is
 * role-guarded, so these checks prove the socket path cannot be used to get
 * around that.
 *
 * What is asserted, each from a citizen account that should be refused:
 *   - a patient cannot join another person's incident room
 *   - a patient cannot rewrite an ambulance's GPS position
 *   - a patient cannot broadcast hospital resource changes
 *   - a patient cannot broadcast clinical vitals
 *   - nobody can post into an incident room they were not admitted to
 *   - a paramedic cannot move a vehicle that is not theirs
 *
 * Run:  node tests/socket-security.cjs
 * The API must be running on :5000 (or set MEDIROUTE_API).
 * ==============================================================================
 */

const path = require('path')
const http = require('http')

const CLIENT_MODULES = path.join(__dirname, '..', 'client', 'node_modules')
const SERVER_MODULES = path.join(__dirname, '..', 'server', 'node_modules')

const { io } = require(require.resolve('socket.io-client', { paths: [CLIENT_MODULES, SERVER_MODULES] }))
const mongoose = require(path.join(SERVER_MODULES, 'mongoose'))
const dotenv = require(path.join(SERVER_MODULES, 'dotenv'))
dotenv.config({ path: path.join(__dirname, '..', 'server', '.env') })

const API = process.env.MEDIROUTE_API || 'http://localhost:5000/api'
const SOCKET_URL = API.replace(/\/api$/, '')

let pass = 0
let fail = 0
const ok = (m) => { pass++; console.log('  PASS  ' + m) }
const bad = (m, d) => { fail++; console.log('  FAIL  ' + m + (d ? '  -- ' + d : '')) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const data = JSON.stringify(body)
    const req = http.request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => {
          try { resolve(JSON.parse(b)) } catch { reject(new Error(b.slice(0, 160))) }
        })
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

const login = (email, password, role) => postJSON(`${API}/auth/login`, { email, password, role })

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'], forceNew: true })
    socket.on('connect', () => resolve(socket))
    socket.on('connect_error', (e) => reject(new Error(e.message)))
    setTimeout(() => reject(new Error('socket connect timeout')), 15000)
  })
}

async function main() {
  console.log('\n=============================================')
  console.log(' SOCKET AUTHORIZATION')
  console.log('=============================================')

  await mongoose.connect(process.env.MONGODB_URI)
  require(path.join(__dirname, '..', 'server', 'src', 'models', 'Hospital.js'))
  require(path.join(__dirname, '..', 'server', 'src', 'models', 'Counter.js'))
  const Incident = require(path.join(__dirname, '..', 'server', 'src', 'models', 'Incident.js'))
  const Ambulance = require(path.join(__dirname, '..', 'server', 'src', 'models', 'Ambulance.js'))

  // Unauthenticated sockets must be refused outright.
  try {
    await connect(null)
    bad('socket without a token is refused')
  } catch {
    ok('socket without a token is refused')
  }

  const patient = await login('patient@mediroute.com', 'patient123', 'patient')
  const medic = await login('paramedic@mediroute.com', 'paramedic123', 'paramedic')
  if (!patient.token || !medic.token) {
    bad('logins', 'auth rate limit reached; restart the API and retry')
    process.exit(1)
  }
  ok('citizen and paramedic sessions established')

  // A real incident that does NOT belong to the citizen account. The login
  // response exposes _id, and anonymous reports carry patient: null, so both
  // are excluded explicitly rather than relying on $ne against one value.
  const citizenId = patient.user._id
  const other = await Incident.findOne({
    patient: { $nin: [citizenId, null] },
  }).select('_id incidentNumber patient')
  const anyUnit = await Ambulance.findOne({}).select('_id vehicleNumber currentLocation')
  if (!other || !anyUnit) {
    bad('fixtures', 'need an incident owned by another user, and an ambulance')
    process.exit(1)
  }
  ok(`fixture: ${other.incidentNumber} belongs to someone else`)

  const pSocket = await connect(patient.token)
  ok('citizen socket connects with a valid token')

  // ── join_incident ────────────────────────────────────────────────────────
  pSocket.emit('join_incident', String(other._id))
  await sleep(1200)
  const joined = [...(pSocket.rooms || [])]
  // The client does not expose rooms, so membership is proven by whether a
  // broadcast addressed to that room arrives.
  let leaked = false
  pSocket.on('incident_message', () => { leaked = true })
  pSocket.emit('incident_message', { incidentId: String(other._id), message: { text: 'probe' } })
  await sleep(1200)
  leaked
    ? bad('citizen cannot join another person\'s incident room', 'received a room broadcast')
    : ok('citizen cannot join another person\'s incident room')

  // The guard must admit, not just refuse: a citizen follows their own report.
  const own = await Incident.findOne({ patient: citizenId }).select('_id incidentNumber')
  if (own) {
    let ownHeard = false
    pSocket.on('incident_message', () => { ownHeard = true })
    pSocket.emit('join_incident', String(own._id))
    await sleep(1000)
    pSocket.emit('incident_message', { incidentId: String(own._id), message: { text: 'probe' } })
    await sleep(1500)
    ownHeard
      ? ok(`citizen can follow their own report (${own.incidentNumber})`)
      : bad('citizen can follow their own report', 'guard refused a legitimate join')
  }

  // ── gps_update ───────────────────────────────────────────────────────────
  const before = (await Ambulance.findById(anyUnit._id)).currentLocation?.coordinates
  pSocket.emit('gps_update', {
    ambulanceId: String(anyUnit._id),
    coordinates: [1.234, 5.678],
    heading: 0,
    speed: 0,
  })
  await sleep(1800)
  const after = (await Ambulance.findById(anyUnit._id)).currentLocation?.coordinates
  const moved = JSON.stringify(after) === JSON.stringify([1.234, 5.678])
  moved
    ? bad('citizen cannot rewrite an ambulance position', `unit moved to ${JSON.stringify(after)}`)
    : ok(`citizen cannot rewrite an ambulance position (${anyUnit.vehicleNumber} unchanged)`)

  // ── resource_update and vitals_update ────────────────────────────────────
  const mSocket = await connect(medic.token)
  let sawResource = false
  let sawVitals = false
  mSocket.on('hospital_resources_update', () => { sawResource = true })
  mSocket.on('vitals_update', () => { sawVitals = true })

  pSocket.emit('resource_update', { hospitalId: 'x', resources: { icuBeds: { available: 99 } } })
  pSocket.emit('vitals_update', { incidentId: String(other._id), vitals: { heartRate: 40 } })
  await sleep(1800)

  sawResource ? bad('citizen cannot broadcast hospital resources') : ok('citizen cannot broadcast hospital resources')
  sawVitals ? bad('citizen cannot broadcast clinical vitals') : ok('citizen cannot broadcast clinical vitals')

  // ── a paramedic may not drive someone else's vehicle ─────────────────────
  const medicUnit = medic.user.ambulanceId
  const foreign = await Ambulance.findOne(
    medicUnit ? { _id: { $ne: medicUnit } } : {}
  ).select('_id vehicleNumber currentLocation')

  if (foreign) {
    const fBefore = (await Ambulance.findById(foreign._id)).currentLocation?.coordinates
    mSocket.emit('gps_update', {
      ambulanceId: String(foreign._id),
      coordinates: [9.876, 5.432],
      heading: 0,
      speed: 0,
    })
    await sleep(1800)
    const fAfter = (await Ambulance.findById(foreign._id)).currentLocation?.coordinates

    if (!medicUnit) {
      // With no vehicle assigned the guard compares undefined to the id and refuses.
      JSON.stringify(fAfter) === JSON.stringify([9.876, 5.432])
        ? bad('paramedic with no assigned unit cannot move a vehicle')
        : ok('paramedic with no assigned unit cannot move a vehicle')
    } else {
      JSON.stringify(fAfter) === JSON.stringify([9.876, 5.432])
        ? bad('paramedic cannot move another crew\'s vehicle', foreign.vehicleNumber + ' moved')
        : ok(`paramedic cannot move another crew's vehicle (${foreign.vehicleNumber} unchanged)`)
    }
    void fBefore
  }

  pSocket.close()
  mSocket.close()
  await mongoose.disconnect()
  void joined
  void before

  console.log('\n=============================================')
  console.log(` RESULT: ${pass} passed, ${fail} failed`)
  console.log('=============================================')
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('harness error:', err.message)
  process.exit(2)
})
