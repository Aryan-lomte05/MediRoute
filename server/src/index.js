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
app.use(helmet({ crossOriginEmbedderPolicy: false }))
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
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

const PORT = process.env.PORT || 5000
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║      MediRoute Server Running        ║
║      Port: ${PORT}                       ║
║      ENV: ${process.env.NODE_ENV || 'development'}                 ║
╚══════════════════════════════════════╝
  `)
})
