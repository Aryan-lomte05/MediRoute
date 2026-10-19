const twilio = require('twilio')

// Kept below the 10 MB JSON request ceiling after base64 encoding.
const MAX_AUDIO_BYTES = 7 * 1024 * 1024
const AUDIO_TYPES = new Set([
  'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3',
  'audio/mp4', 'audio/m4a', 'audio/ogg', 'audio/flac', 'audio/x-flac',
  'video/mp4',
])

function webhookUrl(req) {
  const base = process.env.PUBLIC_BASE_URL
  if (process.env.NODE_ENV === 'production' && !base) return null
  const pathAndQuery = req.originalUrl || req.url
  return `${(base || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}${pathAndQuery}`
}

function validateTwilioWebhook(req) {
  const token = process.env.TWILIO_AUTH_TOKEN
  const signature = req.get('X-Twilio-Signature')
  const url = webhookUrl(req)
  if (!token || !signature || !url) return false
  return twilio.validateRequest(token, signature, url, req.body || {})
}

function validateRecordingUrl(rawUrl, accountSid) {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' || url.hostname !== 'api.twilio.com' || url.port) return false
    const expected = new RegExp(`^/2010-04-01/Accounts/${accountSid}/Recordings/RE[A-Za-z0-9]+(?:\\.wav)?/?$`)
    return expected.test(url.pathname) && !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}

function parseSharedLocation(body = {}) {
  if (body.Latitude == null || body.Longitude == null || body.Latitude === '' || body.Longitude === '') return null
  const latitude = Number(body.Latitude)
  const longitude = Number(body.Longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return [longitude, latitude]
}

function isValidRecordingDuration(value, maxSeconds = 30) {
  const duration = Number(value)
  return Number.isFinite(duration) && duration > 0 && duration <= maxSeconds
}

function validateAudioInput(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { valid: false, reason: 'empty_audio' }
  if (buffer.length > MAX_AUDIO_BYTES) return { valid: false, reason: 'audio_too_large' }
  const type = String(mimeType || '').split(';')[0].trim().toLowerCase()
  if (!AUDIO_TYPES.has(type)) return { valid: false, reason: 'unsupported_audio_type' }
  return { valid: true, mimeType: type }
}

module.exports = { MAX_AUDIO_BYTES, AUDIO_TYPES, webhookUrl, validateTwilioWebhook, validateRecordingUrl, validateAudioInput, parseSharedLocation, isValidRecordingDuration }
