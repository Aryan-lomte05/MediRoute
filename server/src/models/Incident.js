const mongoose = require('mongoose')

const incidentSchema = new mongoose.Schema(
  {
    incidentNumber: { type: String, unique: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    patientDetails: {
      name: String,
      age: Number,
      gender: String,
      bloodType: String,
      allergies: [String],
      conditions: [String],
      phone: String,
    },
    triageData: {
      esiLevel: { type: Number, min: 1, max: 5 },
      chiefComplaint: String,
      aiConfidence: { type: Number, min: 0, max: 1 },
      aiSummary: String,
      requiredSpecialties: [String],
      vitals: {
        heartRate: Number,
        spO2: Number,
        respiratoryRate: Number,
        bloodPressureSystolic: Number,
        bloodPressureDiastolic: Number,
        gcsScore: Number,
        temperature: Number,
      },
    },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
      address: String,
    },
    assignedAmbulance: { type: mongoose.Schema.Types.ObjectId, ref: 'Ambulance' },
    allocatedHospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },
    hospitalAllocationScores: [
      {
        hospital: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },
        score: Number,
        travelEta: Number,
        waitTime: Number,
        specialtyMatch: Number,
        capacityScore: Number,
      },
    ],
    route: {
      geometry: Object, // GeoJSON LineString
      distanceKm: Number,
      etaMinutes: Number,
      osrmRoute: Object,
    },
    status: {
      type: String,
      enum: [
        'PENDING',
        'TRIAGE_COMPLETE',
        'DISPATCHING',
        'EN_ROUTE_TO_PATIENT',
        'AT_PATIENT',
        'EN_ROUTE_TO_HOSPITAL',
        'ARRIVED_AT_HOSPITAL',
        'COMPLETED',
        'CANCELLED',
      ],
      default: 'PENDING',
    },
    timestamps: {
      created: { type: Date, default: Date.now },
      triageCompleted: Date,
      dispatched: Date,
      pickedUp: Date,
      arrivedAtHospital: Date,
      completed: Date,
    },
    voiceTranscript: String,
    notes: String,
  },
  { timestamps: true }
)

incidentSchema.index({ location: '2dsphere' })
incidentSchema.index({ status: 1 })
incidentSchema.index({ createdAt: -1 })

// Generate incident number before save
incidentSchema.pre('save', async function (next) {
  if (!this.incidentNumber) {
    const date = new Date()
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '')
    const count = await mongoose.model('Incident').countDocuments()
    this.incidentNumber = `INC-${dateStr}-${String(count + 1).padStart(4, '0')}`
  }
  next()
})

module.exports = mongoose.model('Incident', incidentSchema)
