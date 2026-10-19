const mongoose = require('mongoose')

const ambulanceSchema = new mongoose.Schema(
  {
    vehicleNumber: { type: String, required: true, unique: true, trim: true },
    vehicleType: {
      type: String,
      enum: ['BASIC_LIFE_SUPPORT', 'ADVANCED_LIFE_SUPPORT', 'MOBILE_ICU', 'PATIENT_TRANSPORT'],
      default: 'ADVANCED_LIFE_SUPPORT',
    },
    currentLocation: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
      heading: Number,
      speed: Number,
      updatedAt: { type: Date, default: Date.now },
    },
    status: {
      type: String,
      enum: ['AVAILABLE', 'DISPATCHED', 'EN_ROUTE_TO_PATIENT', 'AT_PATIENT', 'EN_ROUTE_TO_HOSPITAL', 'AT_HOSPITAL', 'OFFLINE', 'MAINTENANCE'],
      default: 'AVAILABLE',
    },
    assignedParamedic: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    currentIncident: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident' },
    equipment: {
      defibrillator: { type: Boolean, default: true },
      ventilator: { type: Boolean, default: false },
      bloodSupply: { type: Boolean, default: false },
    },
    baseStation: {
      name: String,
      location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: [Number],
      },
    },
    isActive: { type: Boolean, default: true },
    lastPing: { type: Date, default: Date.now },

    /**
     * True when this unit's position is being advanced by the server rather
     * than written by a crew device. A real device always takes precedence:
     * the simulator leaves a unit alone while its lastPing is recent.
     */
    isSimulated: { type: Boolean, default: false },
  },
  { timestamps: true }
)

ambulanceSchema.index({ currentLocation: '2dsphere' })
ambulanceSchema.index({ status: 1 })

module.exports = mongoose.model('Ambulance', ambulanceSchema)
