const express = require('express')
const http = require('http')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')
require('dotenv').config()

const connectDB = require('./config/db')
const initSockets = require('./sockets')
const { startUnitSimulator } = require('./services/unitSimulator')

// Routes
const authRoutes = require('./routes/auth')
const incidentRoutes = require('./routes/incidents')
const hospitalRoutes = require('./routes/hospitals')
const ambulanceRoutes = require('./routes/ambulances')
const aiRoutes = require('./routes/ai')

const app = express()
const server = http.createServer(app)

// Connect DB
connectDB()

// Middleware
const allowedOrigins = [
  process.env.CLIENT_URL,
  'https://mediroute-five.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
].filter(Boolean)

const isProduction = process.env.NODE_ENV === 'production'

app.use(cors({
  origin: (origin, callback) => {
    // Vercel gives every preview deployment its own subdomain, so those are
    // matched by suffix rather than listed. Requests with no Origin header
    // (curl, server-to-server, health probes) are allowed through.
    //
    // Outside production any loopback port is accepted, so `vite dev` (5173),
    // `vite preview` (4173) and ad-hoc ports all work without editing this
    // list. In production only the explicit origins above are permitted.
    const isLoopback = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)

    const allowed =
      !origin ||
      allowedOrigins.includes(origin) ||
      /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin) ||
      (!isProduction && isLoopback)

    // Both branches previously returned callback(null, true), which allowed
    // every origin on the internet and made the allowlist decorative.
    if (allowed) return callback(null, true)

    console.warn(`[CORS] Blocked origin: ${origin}`)
    return callback(null, false)
  },
  credentials: true,
}))

// Security headers. helmet was imported but never mounted.
// crossOriginEmbedderPolicy is disabled because Mapbox GL loads cross-origin
// workers and tiles, which COEP would block.
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}))

app.use(morgan('dev'))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Rate limiting ────────────────────────────────────────────────────────────
// Render terminates TLS upstream, so the client IP arrives in X-Forwarded-For.
// Without this, express-rate-limit sees one proxy IP and limits all users as one.
app.set('trust proxy', 1)

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }))

// Speech-to-text is the most expensive endpoint per call and is open to
// anonymous citizens, so it gets its own tighter bucket.
app.use('/api/ai/transcribe', rateLimit({ windowMs: 10 * 60 * 1000, max: 15 }))
app.use('/api/ai/voice-triage', rateLimit({ windowMs: 10 * 60 * 1000, max: 15 }))

/**
 * Emergency reporting is deliberately public, which means it needs abuse
 * protection - but throttling a genuine emergency is far worse than absorbing
 * some junk. The ceiling is therefore set well above plausible real use (a
 * person reporting one incident, retrying a few times on a bad connection)
 * and only applies to creation, never to tracking an existing report.
 */
const sosLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: {
    message:
      'Too many emergency reports from this connection. If this is a real emergency, call 108 immediately.',
  },
})

app.use('/api/incidents', (req, res, next) => {
  if (req.method !== 'POST') return next()
  return sosLimiter(req, res, next)
})

app.use('/api', rateLimit({ windowMs: 1 * 60 * 1000, max: 200 }))

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/incidents', incidentRoutes)
app.use('/api/hospitals', hospitalRoutes)
app.use('/api/ambulances', ambulanceRoutes)
app.use('/api/ai', aiRoutes)

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'MediRoute API' })
})

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  })
})

// Init Socket.io
const io = initSockets(server)
app.set('io', io)

/**
 * Drive ambulances that have no crew device signed in.
 *
 * Position is normally written by the crew through PATCH
 * /ambulances/:id/location. Without that, an assigned unit never moved: the
 * patient's tracking map showed a vehicle parked at its base, the ETA never
 * counted down, and the job stayed DISPATCHED because nothing advanced it.
 * A real device always wins - see RECENT_PING_MS in the service.
 */
startUnitSimulator(io)

let currentPort = Number(process.env.PORT) || 5000

function startServer(port) {
  currentPort = port
  server.listen(port, () => {
    console.log(`
╔══════════════════════════════════════╗
║      MediRoute Server Running        ║
║      Port: ${port}                       ║
║      ENV: ${process.env.NODE_ENV || 'development'}                 ║
╚══════════════════════════════════════╝
    `)
  })
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const nextPort = currentPort + 1
    console.warn(`[MediRoute] Port ${currentPort} is in use, dynamically trying port ${nextPort}...`)
    setTimeout(() => {
      startServer(nextPort)
    }, 500)
  } else {
    console.error('[MediRoute Server Error]', err)
  }
})

startServer(currentPort)
