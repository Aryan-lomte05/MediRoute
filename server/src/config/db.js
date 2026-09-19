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
