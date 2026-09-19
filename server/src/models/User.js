const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    phone: { type: String, trim: true },
    role: {
      type: String,
      enum: ['patient', 'paramedic', 'hospital_staff', 'admin'],
      required: true,
      default: 'patient',
    },
    // Patient-specific
    emergencyProfile: {
      bloodType: String,
      allergies: [String],
      conditions: [String],
      emergencyContact: { name: String, phone: String },
    },
    // Paramedic-specific
    ambulanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ambulance' },
    certificationNumber: String,
    // Hospital staff-specific
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital' },
    specialty: String,
    isOnDuty: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    lastSeen: Date,
  },
  { timestamps: true }
)

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 12)
  next()
})

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password)
}

userSchema.methods.toSafeObject = function () {
  const obj = this.toObject()
  delete obj.password
  return obj
}

module.exports = mongoose.model('User', userSchema)
