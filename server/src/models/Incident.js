const mongoose = require('mongoose')

const incidentSchema = new mongoose.Schema(
  {
    incidentNumber: { type: String, unique: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    /**
     * Opaque ownership token for anonymous reports. Returned to the reporter
     * exactly once at creation and held in their browser, it lets a citizen with
     * no account track or cancel their own report without granting access to
     * anyone else's. Never included in list responses.
     */
    trackingToken: { type: String, index: true, select: false },
    patientDetails: {
      name: String,
      age: Number,
      gender: String,
      bloodType: String,
      allergies: [String],
      conditions: [String],
      phone: String,
    },
    /**
     * Who raised this call. Both paths are open to anonymous citizens: SELF is
     * the patient reporting their own emergency, BYSTANDER is someone reporting
     * on behalf of a stranger, where patient details are second-hand or absent.
     * Triage weights a BYSTANDER report toward the more severe interpretation.
     */
    reporterType: { type: String, enum: ['SELF', 'BYSTANDER'], default: 'SELF' },

    /**
     * Callback details for an anonymous reporter. Kept separate from
     * patientDetails because for a BYSTANDER report these describe a different
     * person from the patient, and dispatch needs to reach the caller at scene.
     */
    reporterContact: {
      name: String,
      phone: String,
    },

    /**
     * Scene observations a bystander can answer without medical knowledge.
     * These feed triage directly and are far more reliable than asking an
     * untrained caller for a blood group or a GCS score.
     */
    sceneInfo: {
      victimCount: { type: Number, min: 1, default: 1 },
      isConscious: { type: Boolean, default: null },
      isBreathing: { type: Boolean, default: null },
      hazards: [String], // e.g. 'TRAFFIC', 'FIRE', 'WATER', 'ELECTRICAL'
      description: String,
    },

    triageData: {
      esiLevel: { type: Number, min: 1, max: 5 },
      chiefComplaint: String,
      aiConfidence: { type: Number, min: 0, max: 1 },
      aiSummary: String,
      requiredSpecialties: [String],
      // Previously written by the triage pipeline but absent from this schema,
      // so Mongoose strict mode silently discarded them and the UI could never
      // display them. Declared here so clinical alerts actually persist.
      criticalAlerts: [String],
      recommendedActions: [String],
      // Names what produced this triage: a model id such as
      // 'groq:openai/gpt-oss-120b', or 'rules' for the deterministic fallback.
      // The UI must not present a 'rules' result as an AI assessment.
      engine: String,
      triagedAt: Date,
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

    /**
     * Pre-arrival preparation steps worked by the receiving hospital, and the
     * field interventions worked by the crew.
     *
     * Both boards were previously hardcoded arrays in their respective
     * portals, so ticking an item persisted nowhere, reset on reload, and was
     * invisible to the other side of the handover. The field list is seeded
     * from the triage engine's recommendedActions for this specific patient,
     * so it reflects the actual presentation rather than a fixed protocol.
     */
    prepChecklist: [
      {
        key: String,
        label: String,
        done: { type: Boolean, default: false },
        doneAt: Date,
        doneBy: String,
      },
    ],
    fieldChecklist: [
      {
        key: String,
        label: String,
        done: { type: Boolean, default: false },
        doneAt: Date,
        doneBy: String,
      },
    ],

    /** Timestamped crew observations, including dictated notes. */
    fieldNotes: [
      {
        text: String,
        at: { type: Date, default: Date.now },
        by: String,
        source: { type: String, enum: ['TYPED', 'VOICE'], default: 'TYPED' },
      },
    ],
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
