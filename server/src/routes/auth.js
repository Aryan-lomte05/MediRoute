const express = require('express')
const jwt = require('jsonwebtoken')
const User = require('../models/User')
const { auth } = require('../middleware/auth')

const router = express.Router()

const generateToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' })

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, phone, role, hospitalId, emergencyProfile } = req.body

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Name, email, password and role are required' })
    }

    const existing = await User.findOne({ email })
    if (existing) return res.status(409).json({ message: 'Email already registered' })

    const user = await User.create({
      name,
      email,
      password,
      phone,
      role,
      hospitalId,
      emergencyProfile,
    })

    const token = generateToken(user._id)
    res.status(201).json({ token, user: user.toSafeObject() })
  } catch (err) {
    next(err)
  }
})

// Standard pre-seeded demo accounts for instant evaluation & testing
const DEMO_ACCOUNTS = {
  'admin@mediroute.com': { name: 'Emergency Chief Admin', password: 'admin123', role: 'admin', phone: '+91 99887 76655' },
  'paramedic@mediroute.com': { name: 'EMS Unit Lead', password: 'paramedic123', role: 'paramedic', phone: '+91 98765 43210' },
  'hospital@mediroute.com': { name: 'Dr. Sarah (ER Chief)', password: 'hospital123', role: 'hospital_staff', phone: '+91 91234 56789' },
  'patient@mediroute.com': { name: 'Citizen John Doe', password: 'patient123', role: 'patient', phone: '+91 90000 11111' },
}

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ message: 'Email and password required' })

    const normalizedEmail = email.toLowerCase().trim()
    let user = await User.findOne({ email: normalizedEmail })

    // Auto-provision or sync standard demo account if demo credentials provided
    if (DEMO_ACCOUNTS[normalizedEmail] && DEMO_ACCOUNTS[normalizedEmail].password === password) {
      const demoData = DEMO_ACCOUNTS[normalizedEmail]
      if (!user) {
        user = await User.create({
          name: demoData.name,
          email: normalizedEmail,
          password: demoData.password,
          phone: demoData.phone,
          role: demoData.role,
          isActive: true,
          isOnDuty: true,
        })
      } else {
        user.password = demoData.password
        user.role = demoData.role
        await user.save()
      }
    }

    if (!user) return res.status(401).json({ message: 'Invalid credentials. Use Quick Demo buttons or register.' })

    const isMatch = await user.comparePassword(password)
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' })

    user.lastSeen = new Date()
    await user.save({ validateBeforeSave: false })

    const token = generateToken(user._id)
    res.json({ token, user: user.toSafeObject() })
  } catch (err) {
    next(err)
  }
})

// GET /api/auth/me
router.get('/me', auth, (req, res) => {
  res.json({ user: req.user })
})

// PATCH /api/auth/profile
router.patch('/profile', auth, async (req, res, next) => {
  try {
    const updates = {}
    const allowed = ['name', 'phone', 'emergencyProfile', 'isOnDuty']
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field]
    })

    const user = await User.findByIdAndUpdate(req.userId, updates, { new: true }).select('-password')
    res.json({ user })
  } catch (err) {
    next(err)
  }
})

module.exports = router
