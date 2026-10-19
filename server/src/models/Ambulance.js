/**
 * ==============================================================================
 * MEDIROUTE - AMBULANCE MODEL (models/Ambulance.js)
 *
 * WHAT IS WHERE:
 * - vehicleNumber / vehicleType  Identity and capability tier
 * - status                       Dispatch state machine, see below
 * - currentLocation              GeoJSON Point, 2dsphere indexed
 * - currentIncident              The job holding this unit
 * - isSimulated                  Position is advanced by the server, not a crew
 * - lastPing                     When a position was last written
 *
 * STATUS LIFECYCLE:
 *   AVAILABLE -> DISPATCHED -> EN_ROUTE_TO_PATIENT -> AT_PATIENT
 *             -> EN_ROUTE_TO_HOSPITAL -> AT_HOSPITAL -> AVAILABLE
 *
 * Only AVAILABLE units are considered by dispatch, so a unit left in any other
 * state is effectively out of service. An incident holds its ambulance until it
 * reaches COMPLETED or CANCELLED, which is why abandoned jobs shrink the fleet;
 * scripts/close-stale-incidents.cjs releases them.
 *
 * WHO WRITES currentLocation:
 * A crew device through PATCH /api/ambulances/:id/location, or
 * services/unitSimulator.js when no crew is signed in. The simulator defers to a
 * real device whenever lastPing is recent.
 * ==============================================================================
 */
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
