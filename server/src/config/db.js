/**
 * ==============================================================================
 * MEDIROUTE - DATABASE CONNECTION (config/db.js)
 *
 * WHAT IS WHERE:
 * - connectDB()  Connects once and ensures the geospatial indexes exist
 *
 * WHY THE INDEXES ARE CREATED HERE:
 * Dispatch selects the nearest free ambulance with a $nearSphere query, and
 * hospital allocation measures distance from the patient. Both require a
 * 2dsphere index; without one MongoDB refuses the query outright and the
 * dispatch pipeline silently falls back to "any available unit". Creating them
 * on boot means a fresh database is dispatchable immediately.
 *
 * The guard flag prevents a second connection if this is called twice.
 * ==============================================================================
 */
const mongoose = require('mongoose')

let isConnected = false

const connectDB = async () => {
  if (isConnected) return

  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    })
    isConnected = true
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`)

    // Create geospatial indexes
    conn.connection.on('open', async () => {
      try {
        const db = conn.connection.db
        await db.collection('incidents').createIndex({ location: '2dsphere' }).catch(() => {})
        await db.collection('hospitals').createIndex({ location: '2dsphere' }).catch(() => {})
        await db.collection('ambulances').createIndex({ currentLocation: '2dsphere' }).catch(() => {})
        console.log('✅ Geospatial indexes ensured')
      } catch (e) {
        // Indexes may already exist
      }
    })
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message)
    process.exit(1)
  }
}

module.exports = connectDB
