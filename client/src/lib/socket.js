/**
 * ==============================================================================
 * MEDIROUTE - SOCKET.IO CLIENT (lib/socket.js)
 *
 * WHAT IS WHERE:
 * - getSocket()        Lazily creates and returns the one shared connection
 * - disconnectSocket() Tears it down on logout
 *
 * WHY A SINGLETON:
 * Each portal mounts several effects that listen for events. Creating a socket
 * per effect would open half a dozen connections per tab and multiply every
 * broadcast, so one connection is shared and the listeners attach to it.
 *
 * AUTHENTICATION:
 * The JWT is read from the persisted auth store and sent in the handshake, which
 * the server verifies before the connection is accepted. An anonymous citizen on
 * /sos therefore cannot hold a socket, which is why the public tracking view
 * polls over HTTP instead.
 *
 * EVENTS THIS CLIENT RECEIVES (emitted by server/src/sockets/index.js and the
 * dispatch pipeline in server/src/routes/incidents.js):
 *   new_incident, triage_complete, hospital_allocated, incoming_patient,
 *   dispatch_alert, ambulance_assigned, ambulance_location, incident_status,
 *   checklist_updated, field_note_added, triage_escalated, dispatch_blocked
 * ==============================================================================
 */
import { io } from 'socket.io-client'

let socket = null

export function getSocket() {
  if (!socket) {
    const stored = localStorage.getItem('mediroute-auth')
    const token = stored ? JSON.parse(stored)?.state?.token : null

    const socketUrl = import.meta.env.VITE_SOCKET_URL || '/'
    socket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      autoConnect: true,
    })

    socket.on('connect', () => console.log('[Socket] Connected:', socket.id))
    socket.on('disconnect', (reason) => console.log('[Socket] Disconnected:', reason))
    socket.on('connect_error', (err) => console.error('[Socket] Error:', err.message))
  }
  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
