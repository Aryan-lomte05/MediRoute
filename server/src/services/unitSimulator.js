/**
 * ==============================================================================
 * MEDIROUTE - UNMANNED UNIT MOVEMENT (services/unitSimulator.js)
 * ==============================================================================
 *
 * WHAT IS WHERE:
 * - Line 50-95:   Config + route cache
 * - Line 97-150:  fetchRoad() - real OSRM geometry between two points
 * - Line 152-195: advanceAlong() - move a unit N metres along a polyline
 * - Line 197-330: stepIncident() - one tick of one job's state machine
 * - Line 332-400: start/stop + the tick loop
 *
 * WHY THIS EXISTS:
 * An ambulance's position is written by the crew's device through
 * PATCH /ambulances/:id/location. That is the correct source of truth, but it
 * means a unit with nobody signed in never moves: the patient's tracking map
 * showed a vehicle frozen at its base, the ETA never counted down, and the job
 * stayed DISPATCHED forever because no actor advanced it.
 *
 * This drives those unmanned units along the real OSRM road route and through
 * the real status transitions, so the whole lifecycle works end to end without
 * requiring a second person on a phone.
 *
 * HONESTY CONTRACT:
 * A simulated unit is marked `isSimulated` on the ambulance and every broadcast
 * carries `simulated: true`, so the interface can distinguish a demo vehicle
 * from a crew actually on the road. A real device always wins: as soon as a
 * crew posts a position, that unit is left alone (see RECENT_PING_MS).
 *
 * Disable entirely with ENABLE_UNIT_SIMULATION=false.
 * ==============================================================================
 */

const axios = require('axios')
const Incident = require('../models/Incident')
const Ambulance = require('../models/Ambulance')
const Hospital = require('../models/Hospital')

const OSRM_BASE = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org'

const ENABLED = process.env.ENABLE_UNIT_SIMULATION !== 'false'

/** How often the world advances. */
const TICK_MS = parseInt(process.env.SIM_TICK_MS || '5000', 10)

/** Simulated road speed. Deliberately brisk: this is a lights-and-sirens run. */
const SIM_KMH = parseFloat(process.env.SIM_SPEED_KMH || '42')

/**
 * If a unit has had a real position written more recently than this, it has a
 * live crew and the simulator must not touch it.
 */
const RECENT_PING_MS = 45_000

/** How close counts as arrived. */
const ARRIVE_M = 120

/** Pause at the scene while the crew works, before leaving for hospital. */
const ON_SCENE_MS = parseInt(process.env.SIM_ON_SCENE_MS || '25000', 10)

/**
 * Cached road geometry per leg, keyed by incident and phase. OSRM is a public
 * demo server, so a route is fetched once per leg rather than every tick.
 */
const routeCache = new Map()

let timer = null
let running = false

// ──────────────────────────────────────────────────────────────────────────────
// GEOMETRY
// ──────────────────────────────────────────────────────────────────────────────

function haversineM(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Bearing in degrees, so the map can rotate the vehicle marker. */
function bearing(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const toDeg = (r) => (r * 180) / Math.PI
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]))
  const x =
    Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/**
 * Real driving geometry between two points.
 * Falls back to a straight line so a routing outage cannot freeze every unit.
 */
async function fetchRoad(from, to) {
  try {
    const url =
      `${OSRM_BASE}/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}` +
      `?overview=full&geometries=geojson`
    const res = await axios.get(url, { timeout: 9000 })
    const coords = res.data?.routes?.[0]?.geometry?.coordinates
    if (Array.isArray(coords) && coords.length > 1) return coords
  } catch (err) {
    console.warn('[sim] OSRM unavailable, using a direct line:', err.message)
  }
  return [from, to]
}

/**
 * Move `metres` along a polyline starting from `position`.
 *
 * @returns {{position: [number,number], index: number, arrived: boolean, heading: number}}
 */
function advanceAlong(line, index, position, metres) {
  let remaining = metres
  let i = Math.max(0, Math.min(index, line.length - 1))
  let current = position || line[i]
  let heading = 0

  while (remaining > 0 && i < line.length - 1) {
    const next = line[i + 1]
    const segment = haversineM(current, next)

    if (segment <= remaining) {
      // Consume the whole segment and continue from its end.
      remaining -= segment
      heading = bearing(current, next)
      current = next
      i += 1
    } else {
      // Land part-way along this segment.
      const ratio = remaining / segment
      heading = bearing(current, next)
      current = [
        current[0] + (next[0] - current[0]) * ratio,
        current[1] + (next[1] - current[1]) * ratio,
      ]
      remaining = 0
    }
  }

  const arrived = i >= line.length - 1 && remaining > 0
  return { position: current, index: i, arrived, heading: Math.round(heading) }
}

// ──────────────────────────────────────────────────────────────────────────────
// STATE MACHINE
// ──────────────────────────────────────────────────────────────────────────────

/** Statuses the simulator is responsible for driving forward. */
const DRIVABLE = [
  'DISPATCHED',
  'EN_ROUTE_TO_PATIENT',
  'AT_PATIENT',
  'EN_ROUTE_TO_HOSPITAL',
  // Included so the handover can finish and the unit be released. Without it
  // the lifecycle stopped on arrival and the vehicle never came back into
  // service, quietly shrinking the dispatchable fleet.
  'ARRIVED_AT_HOSPITAL',
]

/** How long the crew spends handing the patient over before going clear. */
const HANDOVER_MS = parseInt(process.env.SIM_HANDOVER_MS || '45000', 10)

/**
 * Advance one incident by one tick.
 * @returns {Promise<boolean>} whether anything changed.
 */
async function stepIncident(incident, io) {
  const ambulance = await Ambulance.findById(incident.assignedAmbulance)
  if (!ambulance) return false

  // A live crew owns their own position. Never fight a real device.
  const lastPing = ambulance.lastPing ? new Date(ambulance.lastPing).getTime() : 0
  if (!ambulance.isSimulated && Date.now() - lastPing < RECENT_PING_MS) return false

  // The unit must still be assigned to THIS incident. A released or
  // reassigned vehicle is left alone.
  if (String(ambulance.currentIncident) !== String(incident._id)) {
    console.warn(
      `[sim] ${incident.incidentNumber} no longer holds ${ambulance.vehicleNumber}, skipping`
    )
    return false
  }

  const unitAt = ambulance.currentLocation?.coordinates
  if (!Array.isArray(unitAt) || unitAt.length !== 2) return false

  const status = incident.status
  const metresPerTick = (SIM_KMH * 1000 / 3600) * (TICK_MS / 1000)

  // ── Handover finished: close the job and return the unit to service ─────
  if (status === 'ARRIVED_AT_HOSPITAL') {
    const since = incident.timestamps?.arrivedAtHospital
      ? new Date(incident.timestamps.arrivedAtHospital).getTime()
      : 0
    if (Date.now() - since < HANDOVER_MS) return false

    await Promise.all([
      Incident.findByIdAndUpdate(incident._id, {
        status: 'COMPLETED',
        'timestamps.completed': new Date(),
      }),
      Ambulance.findByIdAndUpdate(ambulance._id, {
        status: 'AVAILABLE',
        currentIncident: null,
        isSimulated: false,
      }),
    ])

    emit(io, incident, 'incident_status', { status: 'COMPLETED' })
    console.log(
      `[sim] ${incident.incidentNumber} complete, ${ambulance.vehicleNumber} back in service`
    )
    return true
  }

  // ── Waiting at the scene ─────────────────────────────────────────────────
  if (status === 'AT_PATIENT') {
    const since = incident.timestamps?.pickedUp ? new Date(incident.timestamps.pickedUp).getTime() : 0
    if (Date.now() - since < ON_SCENE_MS) return false

    const hospital = incident.allocatedHospital
      ? await Hospital.findById(incident.allocatedHospital)
      : null
    if (!hospital?.location?.coordinates) return false

    await Incident.findByIdAndUpdate(incident._id, {
      status: 'EN_ROUTE_TO_HOSPITAL',
      'timestamps.pickedUp': incident.timestamps?.pickedUp || new Date(),
    })
    await Ambulance.findByIdAndUpdate(ambulance._id, { status: 'EN_ROUTE_TO_HOSPITAL' })

    emit(io, incident, 'incident_status', { status: 'EN_ROUTE_TO_HOSPITAL' })
    console.log(`[sim] ${incident.incidentNumber} leaving scene for ${hospital.name}`)
    return true
  }

  // ── Choose the destination for this phase ────────────────────────────────
  const goingToHospital = status === 'EN_ROUTE_TO_HOSPITAL'
  let destination

  if (goingToHospital) {
    const hospital = incident.allocatedHospital
      ? await Hospital.findById(incident.allocatedHospital)
      : null
    destination = hospital?.location?.coordinates
  } else {
    destination = incident.location?.coordinates
  }

  if (!Array.isArray(destination) || destination.length !== 2) return false

  // ── Road geometry for this leg ───────────────────────────────────────────
  const cacheKey = `${incident._id}:${goingToHospital ? 'hosp' : 'scene'}`
  let leg = routeCache.get(cacheKey)
  if (!leg) {
    const line = await fetchRoad(unitAt, destination)
    leg = { line, index: 0 }
    routeCache.set(cacheKey, leg)

    /**
     * Persist the road geometry for this leg.
     *
     * Without this the clients have no idea what path the vehicle is taking,
     * so the command centre could only draw a moving dot with no route behind
     * it. The map previously filled that gap with a decorative hardcoded
     * corridor, which looked like a route but led nowhere near the patient.
     */
    await Incident.findByIdAndUpdate(incident._id, {
      'route.geometry': { type: 'LineString', coordinates: line },
      'route.leg': goingToHospital ? 'TO_HOSPITAL' : 'TO_PATIENT',
    })

    if (io) {
      const routePayload = {
        incidentId: String(incident._id),
        ambulanceId: String(ambulance._id),
        geometry: { type: 'LineString', coordinates: line },
        leg: goingToHospital ? 'TO_HOSPITAL' : 'TO_PATIENT',
        simulated: true,
      }
      for (const room of [`incident_${incident._id}`, 'admin', 'hospital', 'patient']) {
        io.to(room).emit('route_updated', routePayload)
      }
    }
  }

  // ── Move ─────────────────────────────────────────────────────────────────
  const step = advanceAlong(leg.line, leg.index, unitAt, metresPerTick)
  leg.index = step.index

  const metresLeft = haversineM(step.position, destination)
  const etaMinutes = Math.max(1, Math.round(metresLeft / 1000 / SIM_KMH * 60))

  await Ambulance.findByIdAndUpdate(ambulance._id, {
    'currentLocation.coordinates': step.position,
    'currentLocation.heading': step.heading,
    'currentLocation.speed': SIM_KMH,
    'currentLocation.updatedAt': new Date(),
    lastPing: new Date(),
    isSimulated: true,
    status: goingToHospital ? 'EN_ROUTE_TO_HOSPITAL' : 'EN_ROUTE_TO_PATIENT',
  })

  await Incident.findByIdAndUpdate(incident._id, {
    'route.distanceKm': Math.round((metresLeft / 1000) * 10) / 10,
    'route.etaMinutes': etaMinutes,
    // DISPATCHED means assigned; once it is rolling the status should say so.
    ...(status === 'DISPATCHED' ? { status: 'EN_ROUTE_TO_PATIENT' } : {}),
  })

  const payload = {
    ambulanceId: String(ambulance._id),
    incidentId: String(incident._id),
    coordinates: step.position,
    heading: step.heading,
    speed: SIM_KMH,
    etaMinutes,
    distanceKm: Math.round((metresLeft / 1000) * 10) / 10,
    simulated: true,
  }

  if (io) {
    io.to(`incident_${incident._id}`).emit('ambulance_location', payload)
    io.to('admin').emit('ambulance_location', payload)
    io.to('hospital').emit('ambulance_location', payload)
    io.to('patient').emit('ambulance_location', payload)
  }

  if (status === 'DISPATCHED') emit(io, incident, 'incident_status', { status: 'EN_ROUTE_TO_PATIENT' })

  // ── Arrival ──────────────────────────────────────────────────────────────
  if (metresLeft <= ARRIVE_M || step.arrived) {
    routeCache.delete(cacheKey)

    if (goingToHospital) {
      await Promise.all([
        Incident.findByIdAndUpdate(incident._id, {
          status: 'ARRIVED_AT_HOSPITAL',
          'timestamps.arrivedAtHospital': new Date(),
        }),
        Ambulance.findByIdAndUpdate(ambulance._id, { status: 'AT_HOSPITAL' }),
      ])
      emit(io, incident, 'incident_status', { status: 'ARRIVED_AT_HOSPITAL' })
      console.log(`[sim] ${incident.incidentNumber} arrived at hospital`)
    } else {
      await Promise.all([
        Incident.findByIdAndUpdate(incident._id, {
          status: 'AT_PATIENT',
          'timestamps.pickedUp': new Date(),
        }),
        Ambulance.findByIdAndUpdate(ambulance._id, { status: 'AT_PATIENT' }),
      ])
      emit(io, incident, 'incident_status', { status: 'AT_PATIENT' })
      console.log(`[sim] ${incident.incidentNumber} crew reached the patient`)
    }
  }

  return true
}

function emit(io, incident, event, extra) {
  if (!io) return
  const payload = { incidentId: String(incident._id), simulated: true, ...extra }
  for (const room of [`incident_${incident._id}`, 'admin', 'hospital', 'paramedic', 'patient']) {
    io.to(room).emit(event, payload)
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// LOOP
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Return any vehicle stuck in a driving state while holding no incident.
 *
 * Such a unit is invisible to dispatch, which only considers AVAILABLE, and
 * nothing else would ever free it. This is a safety net rather than a fix:
 * the ownership check in stepIncident is what stops it happening.
 */
async function releaseStrandedUnits() {
  const stranded = await Ambulance.find({
    status: { $in: ['DISPATCHED', 'EN_ROUTE_TO_PATIENT', 'AT_PATIENT', 'EN_ROUTE_TO_HOSPITAL', 'AT_HOSPITAL'] },
    currentIncident: null,
  })

  for (const a of stranded) {
    await Ambulance.findByIdAndUpdate(a._id, {
      status: 'AVAILABLE',
      isSimulated: false,
    })
    console.warn(`[sim] Released stranded unit ${a.vehicleNumber} (was ${a.status} with no job)`)
  }

  return stranded.length
}

async function tick(io) {
  if (running) return // never overlap ticks
  running = true
  try {
    await releaseStrandedUnits()
    const jobs = await Incident.find({
      status: { $in: DRIVABLE },
      assignedAmbulance: { $ne: null },
    }).limit(25)

    for (const job of jobs) {
      try {
        await stepIncident(job, io)
      } catch (err) {
        console.warn(`[sim] ${job.incidentNumber} step failed:`, err.message)
      }
    }
  } catch (err) {
    console.warn('[sim] tick failed:', err.message)
  } finally {
    running = false
  }
}

/**
 * Begin advancing unmanned units.
 * @param {import('socket.io').Server} io
 */
function startUnitSimulator(io) {
  if (!ENABLED) {
    console.log('[sim] unit movement disabled (ENABLE_UNIT_SIMULATION=false)')
    return null
  }
  if (timer) return timer

  console.log(`[sim] unit movement every ${TICK_MS}ms at ${SIM_KMH}km/h`)
  timer = setInterval(() => tick(io), TICK_MS)
  // Do not hold the process open on shutdown.
  if (timer.unref) timer.unref()
  return timer
}

function stopUnitSimulator() {
  if (timer) clearInterval(timer)
  timer = null
  routeCache.clear()
}

module.exports = { startUnitSimulator, stopUnitSimulator, advanceAlong, haversineM }
