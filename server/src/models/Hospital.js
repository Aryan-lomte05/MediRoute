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
        /**
         * Must stay a superset of SPECIALTIES in services/aiService.js, which
         * is the vocabulary triage emits. 'ICU' was missing here while triage
         * returned it for cardiac, unconscious, burn and poisoning cases, so
         * those patients scored zero specialty match against every hospital
         * and allocation silently fell back to distance and capacity alone.
         */
        enum: [
          'CARDIAC_CATH_LAB',
          'STROKE_CENTER',
          'LEVEL_1_TRAUMA',
          'LEVEL_2_TRAUMA',
          'ICU',
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

    /**
     * Blood bank stock by component. The ER console previously held these
     * counts in component state, so a staff member requesting units saw the
     * number change and then lose it on the next refresh, and no other portal
     * ever learned about it.
     */
    bloodBank: {
      oNeg: { type: Number, default: 0 },
      oPos: { type: Number, default: 0 },
      aNeg: { type: Number, default: 0 },
      aPos: { type: Number, default: 0 },
      bNeg: { type: Number, default: 0 },
      bPos: { type: Number, default: 0 },
      abNeg: { type: Number, default: 0 },
      abPos: { type: Number, default: 0 },
      plasma: { type: Number, default: 0 },
      platelets: { type: Number, default: 0 },
    },

    /**
     * Physical resuscitation bays. The ER board was a hardcoded array of 20
     * bays in the client, identical for every hospital and reset on reload.
     * `incident` links a bay to the real case occupying it.
     */
    erBays: [
      {
        number: { type: Number, required: true },
        status: {
          type: String,
          enum: ['AVAILABLE', 'OCCUPIED', 'INCOMING', 'CLEANING', 'CLOSED'],
          default: 'AVAILABLE',
        },
        label: String, // Free-text note, e.g. presenting complaint
        incident: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident' },
        doctor: String,
        since: Date,
      },
    ],
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
