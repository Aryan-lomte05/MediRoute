const express = require('express')
const http = require('http')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')
require('dotenv').config()

const connectDB = require('./config/db')
const initSockets = require('./sockets')

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

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true)
    } else {
      callback(null, true)
    }
  },
  credentials: true,
}))
app.use(morgan('dev'))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Rate limiting
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }))
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
