const twilio = require('twilio')

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER

const EMERGENCY_KEYWORDS = [
  'sos', 'emergency', 'help', 'ambulance', 'accident', 'dying', 'urgent',
  'chest pain', 'heart attack', 'bleeding', 'unconscious', 'fire', 'burn',
  'stroke', 'unresponsive', 'trauma', 'collapsed', 'choking', 'seizure',
]

let cachedClient
let credentialWarningLogged = false

/** Returns a configured Twilio REST client, or null if credentials are missing. */
function getTwilioClient() {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    if (!credentialWarningLogged) {
      console.warn('[Twilio] TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN not set — outbound Twilio REST calls are disabled (webhook replies via TwiML still work).')
      credentialWarningLogged = true
    }
    return null
  }
  if (!cachedClient) {
    cachedClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  }
  return cachedClient
}

/** Simple keyword-based emergency/SOS intent detector for inbound WhatsApp text. */
function detectEmergencyIntent(text = '') {
  const normalized = text.toLowerCase()
  return EMERGENCY_KEYWORDS.some((kw) => normalized.includes(kw))
}

/**
 * Proactively sends a WhatsApp message via the Twilio REST API (used outside
 * of a webhook request/response cycle — e.g. a follow-up status update).
 * Reply-to-webhook flows should prefer returning TwiML directly instead.
 * Never throws; returns { success, error? } so callers can degrade gracefully.
 */
async function sendWhatsAppMessage(to, body) {
  const client = getTwilioClient()
  if (!client || !TWILIO_WHATSAPP_NUMBER) {
    return { success: false, error: 'not_configured' }
  }
  try {
    const normalizedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`
    const message = await client.messages.create({
      from: TWILIO_WHATSAPP_NUMBER,
      to: normalizedTo,
      body,
    })
    return { success: true, sid: message.sid }
  } catch (err) {
    console.warn('[Twilio WhatsApp] Send failed:', err.message)
    return { success: false, error: 'send_failed' }
  }
}

module.exports = {
  getTwilioClient,
  detectEmergencyIntent,
  sendWhatsAppMessage,
  EMERGENCY_KEYWORDS,
}
