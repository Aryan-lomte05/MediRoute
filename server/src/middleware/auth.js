/**
 * ==============================================================================
 * MEDIROUTE - AUTHENTICATION MIDDLEWARE (middleware/auth.js)
 *
 * WHAT IS WHERE:
 * - auth           Requires a valid token; rejects with 401 otherwise
 * - authorize(...) Requires one of the listed roles; rejects with 403
 * - optionalAuth   Attaches the user when a token is present, never rejects
 *
 * WHICH TO USE:
 * Use `auth` plus `authorize` on anything that writes, and on any read that
 * returns data across patients. Use `optionalAuth` only where an anonymous
 * citizen must be able to act: creating an emergency report, reading public
 * hospital data, and triage.
 *
 * Routes guarded this way are listed in each route file's own header. The
 * tracking token that lets an anonymous reporter follow their own incident is
 * checked inside routes/incidents.js, not here, because it grants access to one
 * record rather than establishing a session.
 * ==============================================================================
 */
const jwt = require('jsonwebtoken')
const User = require('../models/User')

const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' })
    }

    const token = authHeader.substring(7)
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    const user = await User.findById(decoded.userId).select('-password')
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Invalid token or user inactive' })
    }

    req.user = user
    req.userId = user._id
    next()
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return res.status(401).json({ message: 'Invalid token' })
    if (err.name === 'TokenExpiredError') return res.status(401).json({ message: 'Token expired' })
    next(err)
  }
}

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Role '${req.user.role}' is not authorized to access this resource`,
      })
    }
    next()
  }
}

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next()
    }

    const token = authHeader.substring(7)
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(decoded.userId).select('-password')
    if (user && user.isActive) {
      req.user = user
      req.userId = user._id
    }
    next()
  } catch (err) {
    // For optional auth, continue even if token is invalid or expired
    next()
  }
}

module.exports = { auth, authorize, optionalAuth }
