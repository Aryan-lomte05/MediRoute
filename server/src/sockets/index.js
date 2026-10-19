const { Server } = require('socket.io')
const jwt = require('jsonwebtoken')
const User = require('../models/User')
const Ambulance = require('../models/Ambulance')
const Incident = require('../models/Incident')

let io

function initSockets(server) {
  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        callback(null, true)
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

    // Join incident room (patient tracking)
    socket.on('join_incident', (incidentId) => {
      socket.join(`incident_${incidentId}`)
      console.log(`[Socket] ${user.name} joined incident_${incidentId}`)
    })

    socket.on('leave_incident', (incidentId) => {
      socket.leave(`incident_${incidentId}`)
    })

    // Live GPS ping from paramedic app
    socket.on('gps_update', async (data) => {
      const { ambulanceId, coordinates, heading, speed } = data
      try {
        await Ambulance.findByIdAndUpdate(ambulanceId, {
          'currentLocation.coordinates': coordinates,
          'currentLocation.heading': heading,
          'currentLocation.speed': speed,
          'currentLocation.updatedAt': new Date(),
          lastPing: new Date(),
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

    // Hospital resource update
    socket.on('resource_update', (data) => {
      socket.to('admin').emit('hospital_resources_update', data)
      socket.to('paramedic').emit('hospital_resources_update', data)
    })

    // Paramedic vitals update
    socket.on('vitals_update', async (data, acknowledge) => {
      const { incidentId, vitals } = data || {}
      const incident = await Incident.findById(incidentId).catch(() => null)
      if (!incident || user.role !== 'paramedic' || String(incident.assignedAmbulance) !== String(user.ambulanceId)) {
        if (typeof acknowledge === 'function') acknowledge({ success: false, message: 'Incident assignment could not be verified.' })
        return
      }
      socket.to(`incident_${incidentId}`).emit('vitals_update', { incidentId, vitals })
      socket.to('hospital').emit('vitals_update', { incidentId, vitals })
      socket.to('admin').emit('vitals_update', { incidentId, vitals })
      if (typeof acknowledge === 'function') acknowledge({ success: true })
    })

    socket.on('trauma_alert', async (data, acknowledge) => {
      const { incidentId, vitals } = data || {}
      const incident = await Incident.findById(incidentId).catch(() => null)
      if (!incident || user.role !== 'paramedic' || String(incident.assignedAmbulance) !== String(user.ambulanceId)) {
        if (typeof acknowledge === 'function') acknowledge({ success: false, message: 'Incident assignment could not be verified.' })
        return
      }
      const alert = { incidentId: String(incident._id), incidentNumber: incident.incidentNumber, vitals, sender: user.name, timestamp: Date.now() }
      io.to(`incident_${incident._id}`).emit('trauma_alert', alert)
      io.to('hospital').emit('trauma_alert', alert)
      io.to('admin').emit('trauma_alert', alert)
      if (typeof acknowledge === 'function') acknowledge({ success: true })
    })

    // Chat/notes in incident channel
    socket.on('incident_message', (data) => {
      const { incidentId, message } = data
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
