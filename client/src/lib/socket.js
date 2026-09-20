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
