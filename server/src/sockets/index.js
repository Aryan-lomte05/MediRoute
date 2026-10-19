/**
 * ==============================================================================
 * MEDIROUTE - REAL-TIME EVENT SERVER (sockets/index.js)
 *
 * WHAT IS WHERE:
 * - initSockets()   Creates the server, authenticates, and wires the rooms
 * - io.use(...)     Handshake auth: every socket must present a valid JWT
 * - Room joins      role room, personal room, ambulance room, hospital room
 * - Event handlers  join_incident, leave_incident, and the telemetry relays
 *
 * ROOM MODEL:
 *   <role>                 'admin' | 'paramedic' | 'hospital_staff' | 'patient'
 *   user_<userId>          a single person
 *   ambulance_<id>         the crew working that vehicle
 *   hospital_<id>          staff at that hospital
 *   incident_<id>          everyone following one case
 *
 * Broadcasts are addressed to rooms rather than to all sockets, so a hospital
 * only receives the cases allocated to it and a crew only its own dispatch.
 *
 * WHO EMITS WHAT:
 * The dispatch pipeline in routes/incidents.js emits triage_complete,
 * hospital_allocated, ambulance_assigned and incident_status.
 * services/unitSimulator.js emits ambulance_location while a unit is moving.
 * routes/hospitals.js emits blood_bank_update and er_bays_update.
 *
 * NOTE ON ANONYMOUS USERS: a citizen reporting through /sos holds no JWT and so
 * cannot open a socket. Their tracking screen polls GET /api/incidents/:id with
 * a tracking token instead.
 * ==============================================================================
 */
const { Server } = require('socket.io')
const jwt = require('jsonwebtoken')
const User = require('../models/User')
const Ambulance = require('../models/Ambulance')
const Incident = require('../models/Incident')

let io

/** Roles trusted with operational data across patients. */
const STAFF_ROLES = ['admin', 'paramedic', 'hospital_staff']

/**
 * Client-supplied ids reach the database directly, so they are shape-checked
 * first. A malformed id would otherwise throw inside a handler and, because
 * these run outside Express, bypass the error middleware entirely.
 */
const isObjectId = (value) => typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value)

const isCoordinatePair = (value) =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((n) => Number.isFinite(Number(n))) &&
  Math.abs(Number(value[1])) <= 90 &&
  Math.abs(Number(value[0])) <= 180

function initSockets(server) {
  /**
   * The socket layer carries the same live operational data as the REST API -
   * patient details, unit positions, hospital capacity - so it is held to the
   * same origin policy. This previously called callback(null, true)
   * unconditionally, which accepted a socket from any site on the internet.
   */
  const allowedOrigins = [
    process.env.CLIENT_URL,
    'https://mediroute-five.vercel.app',
    'http://localhost:5173',
    'http://localhost:5174',
  ].filter(Boolean)

  const isProduction = process.env.NODE_ENV === 'production'

  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        const loopback = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
        const allowed =
          !origin ||
          allowedOrigins.includes(origin) ||
          /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin) ||
          (!isProduction && loopback)

        if (allowed) return callback(null, true)
        console.warn(`[Socket] Blocked origin: ${origin}`)
        return callback(null, false)
      },
      credentials: true,
    },
    pingTimeout: 30000,
    pingInterval: 10000,
  })

  // Auth middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
      if (!token) return next(new Error('No token'))
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      const user = await User.findById(decoded.userId).select('-password')
      if (!user) return next(new Error('User not found'))
      socket.user = user
      next()
    } catch (err) {
      next(new Error('Authentication error'))
    }
  })

  io.on('connection', (socket) => {
    const user = socket.user
    console.log(`[Socket] ${user.name} (${user.role}) connected: ${socket.id}`)

    // Join role-based rooms
    socket.join(user.role)
    socket.join(`user_${user._id}`)

    // Paramedic joins ambulance room
    if (user.role === 'paramedic' && user.ambulanceId) {
      socket.join(`ambulance_${user.ambulanceId}`)
    }
    // Hospital staff joins hospital room
    if (user.role === 'hospital_staff' && user.hospitalId) {
      socket.join(`hospital_${user.hospitalId}`)
    }

    // ── Events ──────────────────────────────────────────────

    /**
     * Join the room for one incident.
     *
     * Incident rooms carry patient identity, vitals and live position, so
     * membership is checked rather than granted on request. This previously
     * joined whatever id the client sent, which let any signed-in account -
     * including a citizen one - follow a stranger's emergency in full.
     */
    socket.on('join_incident', async (incidentId) => {
      try {
        if (!isObjectId(incidentId)) return

        // Staff see the cases they are responsible for.
        if (STAFF_ROLES.includes(user.role)) {
          socket.join(`incident_${incidentId}`)
          return
        }

        // A citizen may follow only their own report.
        const incident = await Incident.findById(incidentId).select('patient')
        if (incident && String(incident.patient) === String(user._id)) {
          socket.join(`incident_${incidentId}`)
          return
        }

        console.warn(`[Socket] ${user.name} (${user.role}) refused incident_${incidentId}`)
      } catch (err) {
        console.error('[Socket] join_incident error:', err.message)
      }
    })

    socket.on('leave_incident', (incidentId) => {
      socket.leave(`incident_${incidentId}`)
    })

    /**
     * Live GPS ping from the crew's device.
     *
     * Requires a responder role AND that the vehicle is the one this user is
     * crewing. Without both checks any signed-in account could rewrite any
     * ambulance's position, which is what the tracking map and the command
     * centre treat as truth. The REST equivalent
     * (PATCH /ambulances/:id/location) is guarded the same way; leaving the
     * socket open would simply have moved the hole rather than closing it.
     */
    socket.on('gps_update', async (data) => {
      const { ambulanceId, coordinates, heading, speed } = data || {}

      if (!['paramedic', 'admin'].includes(user.role)) {
        console.warn(`[Socket] ${user.name} (${user.role}) refused gps_update`)
        return
      }
      if (!isObjectId(ambulanceId) || !isCoordinatePair(coordinates)) return
      if (user.role === 'paramedic' && String(user.ambulanceId) !== String(ambulanceId)) {
        console.warn(`[Socket] ${user.name} refused gps_update for another unit`)
        return
      }

      try {
        await Ambulance.findByIdAndUpdate(ambulanceId, {
          'currentLocation.coordinates': coordinates,
          'currentLocation.heading': heading,
          'currentLocation.speed': speed,
          'currentLocation.updatedAt': new Date(),
          lastPing: new Date(),
          // A real crew device owns this unit from now on, so the server-side
          // movement simulator steps aside.
          isSimulated: false,
        })

        // Broadcast to all listeners of this ambulance
        const locationUpdate = { ambulanceId, coordinates, heading, speed, timestamp: Date.now() }
        socket.to(`ambulance_${ambulanceId}`).emit('ambulance_location', locationUpdate)
        socket.to('admin').emit('ambulance_location', locationUpdate)
        socket.to('hospital').emit('ambulance_location', locationUpdate)

        // Also broadcast to any active incident room
        const ambulance = await Ambulance.findById(ambulanceId).select('currentIncident')
        if (ambulance?.currentIncident) {
          socket.to(`incident_${ambulance.currentIncident}`).emit('ambulance_location', locationUpdate)
        }
      } catch (err) {
        console.error('[Socket] GPS update error:', err.message)
      }
    })

    /**
     * Hospital resource update.
     * Restricted to the people who can actually change capacity: a fake
     * broadcast here would alter what the command centre believes is free.
     */
    socket.on('resource_update', (data) => {
      if (!['hospital_staff', 'admin'].includes(user.role)) {
        console.warn(`[Socket] ${user.name} (${user.role}) refused resource_update`)
        return
      }
      socket.to('admin').emit('hospital_resources_update', data)
      socket.to('paramedic').emit('hospital_resources_update', data)
    })

    /**
     * Vitals measured by the crew.
     * Responder-only: these are clinical readings the receiving ER acts on, so
     * an unprivileged sender could put invented numbers in front of a trauma
     * team. Broadcast only, never stored; vitals are persisted through
     * PATCH /api/incidents/:id/status, which re-triages on worsening numbers.
     */
    socket.on('vitals_update', (data) => {
      const { incidentId, vitals } = data || {}

      if (!['paramedic', 'admin'].includes(user.role)) {
        console.warn(`[Socket] ${user.name} (${user.role}) refused vitals_update`)
        return
      }
      if (!isObjectId(incidentId)) return

      const payload = { incidentId, vitals, by: user.name }
      socket.to(`incident_${incidentId}`).emit('vitals_update', payload)
      socket.to('hospital').emit('vitals_update', payload)
      socket.to('admin').emit('vitals_update', payload)
    })

    /**
     * Messages in an incident channel.
     * Only to a room this socket has already been admitted to, so the
     * membership check in join_incident cannot be sidestepped by posting to an
     * arbitrary id.
     */
    socket.on('incident_message', (data) => {
      const { incidentId, message } = data || {}
      if (!isObjectId(incidentId)) return

      if (!socket.rooms.has(`incident_${incidentId}`)) {
        console.warn(`[Socket] ${user.name} refused incident_message to a room they are not in`)
        return
      }

      io.to(`incident_${incidentId}`).emit('incident_message', {
        ...message,
        sender: { id: user._id, name: user.name, role: user.role },
        timestamp: Date.now(),
      })
    })

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`[Socket] ${user.name} disconnected`)
    })
  })

  // Attach io to app for use in routes
  return io
}

function getIO() {
  return io
}

module.exports = initSockets
module.exports.getIO = getIO
