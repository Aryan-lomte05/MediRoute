const mongoose = require('mongoose')

const hospitalSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    registrationNumber: { type: String, unique: true, sparse: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
      address: String,
      city: String,
      state: String,
    },
    capabilities: [
      {
        type: String,
        enum: [
          'CARDIAC_CATH_LAB',
          'STROKE_CENTER',
          'LEVEL_1_TRAUMA',
          'LEVEL_2_TRAUMA',
          'PEDIATRIC_ICU',
          'BURN_UNIT',
          'NEUROSURGERY',
          'NICU',
          'PSYCHIATRIC',
          'ORTHOPEDIC',
          'GENERAL_SURGERY',
        ],
      },
    ],
    resources: {
      icuBeds: { total: { type: Number, default: 0 }, available: { type: Number, default: 0 } },
      traumaBeds: { total: { type: Number, default: 0 }, available: { type: Number, default: 0 } },
      generalBeds: { total: { type: Number, default: 0 }, available: { type: Number, default: 0 } },
      ventilators: { total: { type: Number, default: 0 }, available: { type: Number, default: 0 } },
      bloodBankUnits: { type: Number, default: 0 },
      dutyDoctors: [
        {
          specialty: String,
          name: String,
          onDuty: { type: Boolean, default: false },
        },
      ],
    },
    queueStatus: {
      erWaitTimeMinutes: { type: Number, default: 0 },
      diversionStatus: { type: Boolean, default: false },
      currentPatientLoad: { type: Number, default: 0 },
    },
    contact: { phone: String, emergencyPhone: String, email: String },
    isActive: { type: Boolean, default: true },
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

hospitalSchema.index({ location: '2dsphere' })
hospitalSchema.index({ 'queueStatus.diversionStatus': 1 })

module.exports = mongoose.model('Hospital', hospitalSchema)
