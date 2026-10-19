/**
 * ==============================================================================
 * MEDIROUTE - TELEPHONY WEBHOOKS (routes/telephony.js)
 * ==============================================================================
 * Original author: Neil Mishra (Neil-1901)
 *
 * WHAT IS WHERE:
 * - Line 45-95:    verifyTwilioSignature - rejects requests Twilio did not send
 * - Line 97-135:   geocodeText - turns a typed landmark into real coordinates
 * - Line 137-250:  POST /voice-sos      Twilio Voice IVR, creates a real incident
 * - Line 252-350:  POST /incoming-sms   SMS SOS, creates a real incident
 * - Line 352-380:  POST /status-callback Delivery receipts
 *
 * HOW THIS CONNECTS TO DISPATCH:
 * Both intake paths call runDispatchPipeline from routes/incidents.js, the same
 * path the web SOS page uses. That is what performs triage, hospital allocation
 * and unit assignment, and broadcasts each stage over Socket.IO.
 *
 * They previously built an incident by hand and set status DISPATCHED without
 * dispatching anything: no triage ran, no ambulance was assigned, and the reply
 * told the caller an ambulance was on its way. The IVR did not create an
 * incident at all while telling the caller one was being sent.
 *
 * SECURITY:
 * These endpoints are public by necessity, since Twilio must reach them without
 * a session. Every request is therefore checked against Twilio's signature, so
 * an arbitrary POST cannot drive a dispatch. With no auth token configured the
 * service is in simulation mode and signature checking is skipped, which is
 * safe only because nothing is then reachable from the public internet by
 * design; see twilioService.isConfigured.
 * ==============================================================================
 */

const express = require('express')
const axios = require('axios')
const twilio = require('twilio')

const twilioConfig = require('../config/twilio')
const twilioService = require('../services/twilioService')
const Incident = require('../models/Incident')
const { runDispatchPipeline } = require('./incidents')

const router = express.Router()

// Mumbai city centre, used only to bias geocoding towards the right city.
/**
 * The service area. Geocoder results outside it are rejected rather than
 * dispatched to, because a wrong city is far worse than no coordinates.
 */
const CITY_BIAS = { lng: 72.8777, lat: 19.076 }
const SERVICE_RADIUS_KM = parseFloat(process.env.SERVICE_RADIUS_KM || '70')

/** Great-circle distance in km between two [lng, lat] pairs. */
function distanceKm(a, b) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Pull the part of a message that names a place.
 *
 * Passing a whole sentence to a geocoder is unsafe: "Accident near Bandra
 * station, man unconscious bleeding" resolved to Banda in Uttar Pradesh, about
 * a thousand kilometres from the service area, because the geocoder matched a
 * single word. Taking the phrase after a locational preposition, and dropping
 * the clinical words, gives it something to work with.
 */
function extractPlace(text) {
  if (!text) return null
  const clean = String(text).replace(/\s+/g, ' ').trim()

  // "near X", "at X", "opposite X", "outside X" up to the next clause break.
  const m = clean.match(/(?:near|at|opposite|outside|beside|behind|in front of|on)\s+([^,.;]{3,60})/i)
  if (m) return m[1].trim()

  // Otherwise take the first clause and strip obvious clinical vocabulary,
  // which otherwise drags the match towards unrelated place names.
  const first = clean.split(/[,.;]/)[0]
  const stripped = first
    .replace(
      /(accident|crash|unconscious|bleeding|injured|hurt|emergency|help|pain|chest|breathing|fell|collapsed|man|woman|person|someone)/gi,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim()

  return stripped.length >= 3 ? stripped : null
}

/**
 * Resolve a caller's words into coordinates inside the service area.
 *
 * The SMS handler previously used a fixed pair of coordinates described as the
 * "Default Parel/Dadar intersection". Unit selection is a $nearSphere query on
 * whatever is stored, so every SMS emergency would have dispatched the
 * ambulance nearest Parel regardless of where the caller was.
 *
 * @returns {Promise<{coordinates: [number, number], address: string}|null>}
 */
async function geocodeText(text) {
  const token = process.env.MAPBOX_TOKEN
  const place = extractPlace(text)
  if (!token || !place) return null

  try {
    /*
     * bbox confines the search to the metropolitan area, and proximity ranks
     * within it. Both are needed: proximity alone only reorders results, it
     * does not exclude a match in another state.
     */
    const bbox = '72.70,18.85,73.15,19.35'
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(place)}.json` +
      `?access_token=${token}&proximity=${CITY_BIAS.lng},${CITY_BIAS.lat}` +
      `&bbox=${bbox}&country=IN&limit=1`

    const res = await axios.get(url, { timeout: 8000 })
    const hit = res.data?.features?.[0]
    if (!hit?.center) return null

    const coordinates = [hit.center[0], hit.center[1]]

    // Belt and braces: reject anything outside the service radius even if the
    // bbox let it through.
    const away = distanceKm([CITY_BIAS.lng, CITY_BIAS.lat], coordinates)
    if (away > SERVICE_RADIUS_KM) {
      console.warn(
        `[Telephony] Rejected geocode "${place}" -> ${hit.place_name} (${Math.round(away)}km away)`
      )
      return null
    }

    return { coordinates, address: hit.place_name }
  } catch (err) {
    console.warn('[Telephony] Geocoding failed:', err.message)
    return null
  }
}

/**
 * Reject anything Twilio did not sign.
 *
 * Without this, a public POST could create an incident and tie up an ambulance.
 * Skipped when no auth token is configured, because there is then no live
 * carrier integration to protect.
 */
function verifyTwilioSignature(req, res, next) {
  if (!twilioConfig.isConfigured) return next()

  const signature = req.headers['x-twilio-signature']
  const proto = req.headers['x-forwarded-proto'] || req.protocol
  const url = `${proto}://${req.get('host')}${req.originalUrl}`

  const valid = twilio.validateRequest(twilioConfig.authToken, signature, url, req.body || {})

  if (!valid) {
    console.warn(`[Telephony] Rejected unsigned request to ${req.originalUrl}`)
    return res
      .status(403)
      .type('text/xml')
      .send('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>')
  }

  return next()
}

/** TwiML helper. */
const twiml = (inner) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${inner}</Response>`

/**
 * Create an incident from a telephony intake and start the real dispatch.
 *
 * @returns {Promise<object|null>} the created incident
 */
async function createTelephonyIncident({ phone, complaint, locationText, channel, io }) {
  const resolved = await geocodeText(locationText)

  /*
   * A caller who gives no usable location still needs help, so the report is
   * created rather than refused, but the coordinates are marked UNKNOWN. The
   * crew then knows to call back rather than trusting the position, and the
   * city centre is used only so the geospatial query has something to work
   * with. This is recorded, not hidden.
   */
  const coordinates = resolved ? resolved.coordinates : [CITY_BIAS.lng, CITY_BIAS.lat]
  const source = resolved ? 'GEOCODED' : 'UNKNOWN'

  const incident = await Incident.create({
    // Reported by phone, so treat as the patient unless the text says otherwise.
    reporterType: 'SELF',
    reporterContact: { phone },
    channel,
    triageData: {
      // Nested, as the schema defines it. These were previously written at the
      // top level, where Mongoose strict mode discarded them silently, so the
      // incident reached the database with no complaint and no severity.
      chiefComplaint: complaint,
    },
    location: {
      type: 'Point',
      coordinates,
      address: resolved ? resolved.address : locationText || 'Location not given by caller',
      source,
      reportedAs: locationText || null,
    },
    // PENDING, so the pipeline advances it. Setting DISPATCHED here claimed a
    // dispatch that had not happened.
    status: 'PENDING',
    timestamps: { created: new Date() },
  })

  // Same path the web SOS uses: triage, hospital allocation, unit assignment.
  runDispatchPipeline(incident._id, io)

  return incident
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/telephony/voice-sos - Twilio Voice IVR
// ──────────────────────────────────────────────────────────────────────────────

const IVR_OPTIONS = {
  1: { label: 'road traffic accident', complaint: 'Road traffic accident reported by phone, casualty at scene' },
  2: { label: 'cardiac or breathing emergency', complaint: 'Suspected cardiac arrest or respiratory arrest reported by phone' },
  3: { label: 'maternal emergency', complaint: 'Obstetric emergency reported by phone, possible imminent delivery' },
  9: { label: 'operator assistance', complaint: 'Emergency reported by phone, caller requested an operator' },
}

router.post('/voice-sos', verifyTwilioSignature, async (req, res) => {
  const caller = req.body.From || 'Unknown'
  const digits = req.body.Digits
  const io = req.app.get('io')

  console.log(`[Telephony IVR] Call from ${caller}, digits: ${digits || 'none'}`)

  // First leg: read the menu.
  if (!digits) {
    return res.type('text/xml').send(
      twiml(`
    <Gather numDigits="1" action="/api/telephony/voice-sos" method="POST" timeout="6">
      <Say voice="Polly.Aditi" language="en-IN">
        Welcome to MediRoute Emergency Command.
        Press 1 for a road accident.
        Press 2 for a cardiac or breathing emergency.
        Press 3 for a maternal emergency.
        Press 9 to speak to an operator.
      </Say>
    </Gather>
    <Say voice="Polly.Aditi" language="en-IN">We did not receive your input. Connecting you to an operator.</Say>
    <Dial timeout="30">${twilioConfig.emergencyDispatchNumber}</Dial>`)
    )
  }

  const choice = IVR_OPTIONS[digits] || IVR_OPTIONS[9]

  try {
    /*
     * Create a real incident. The previous version returned TwiML saying "an
     * ambulance is being dispatched immediately" without creating anything at
     * all, so nothing was ever sent.
     *
     * Twilio provides approximate caller location on some carriers; where it
     * does not, the location is recorded as unknown and the operator leg below
     * lets the caller give it verbally.
     */
    const locationText = [req.body.FromCity, req.body.FromState].filter(Boolean).join(', ')

    const incident = await createTelephonyIncident({
      phone: caller,
      complaint: choice.complaint,
      locationText,
      channel: 'call',
      io,
    })

    console.log(`[Telephony IVR] Created ${incident.incidentNumber} for ${caller}`)

    return res.type('text/xml').send(
      twiml(`
    <Say voice="Polly.Aditi" language="en-IN">
      Your emergency has been logged as ${choice.label}. Reference ${incident.incidentNumber.replace(/-/g, ' ')}.
      Stay on the line. An operator will confirm your exact location.
    </Say>
    <Dial timeout="30">${twilioConfig.emergencyDispatchNumber}</Dial>`)
    )
  } catch (err) {
    console.error('[Telephony IVR] Failed to create incident:', err.message)

    // Never leave a caller with nothing: connect them to a human.
    return res.type('text/xml').send(
      twiml(`
    <Say voice="Polly.Aditi" language="en-IN">
      We could not log your emergency automatically. Connecting you to an operator now.
    </Say>
    <Dial timeout="30">${twilioConfig.emergencyDispatchNumber}</Dial>`)
    )
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/telephony/incoming-sms - SMS SOS
// ──────────────────────────────────────────────────────────────────────────────

router.post('/incoming-sms', verifyTwilioSignature, async (req, res) => {
  const from = req.body.From || 'Unknown'
  const body = (req.body.Body || '').trim()
  const io = req.app.get('io')

  console.log(`[Telephony SMS] From ${from}: "${body.slice(0, 80)}"`)

  try {
    const incident = await createTelephonyIncident({
      phone: from,
      complaint: body || 'Emergency reported by SMS, no detail given',
      // The whole message is the best location hint available; the geocoder
      // picks out a place name if there is one.
      locationText: body,
      channel: 'sms',
      io,
    })

    /*
     * The tracking link points at /sos, which is public. It previously pointed
     * at /patient, which is behind authentication, so a caller following it
     * would have met a login form.
     */
    const base = process.env.CLIENT_URL || 'https://mediroute-five.vercel.app'

    return res.type('text/xml').send(
      twiml(`
      <Message>MediRoute: emergency ${incident.incidentNumber} received. Help is being arranged. Track it here: ${base}/sos . If this is life-threatening, call ${twilioConfig.emergencyDispatchNumber} now.</Message>`)
    )
  } catch (err) {
    console.error('[Telephony SMS] Failed to create incident:', err.message)

    // Say what is true: we could not log it, so call instead.
    return res.type('text/xml').send(
      twiml(`
      <Message>MediRoute could not log your emergency automatically. Please call ${twilioConfig.emergencyDispatchNumber} immediately.</Message>`)
    )
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/telephony/status-callback - delivery receipts
// ──────────────────────────────────────────────────────────────────────────────

router.post('/status-callback', verifyTwilioSignature, (req, res) => {
  const { MessageSid, MessageStatus, ErrorCode } = req.body || {}

  if (ErrorCode) {
    console.warn(`[Telephony] Message ${MessageSid} failed: status ${MessageStatus}, error ${ErrorCode}`)
  } else {
    console.log(`[Telephony] Message ${MessageSid}: ${MessageStatus}`)
  }

  res.sendStatus(204)
})

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/telephony/health - is telephony actually live?
// ──────────────────────────────────────────────────────────────────────────────
// Mirrors /api/ai/health. The whole reason the AI outage went unnoticed is that
// nothing reported whether an integration was genuinely working.
router.get('/health', (req, res) => {
  res.json({
    configured: twilioConfig.isConfigured,
    mode: twilioConfig.isConfigured ? 'live' : 'simulation',
    from: twilioConfig.isConfigured ? twilioConfig.fromNumber : null,
    whatsappFrom: twilioConfig.isConfigured ? twilioConfig.whatsappFrom : null,
    signatureVerification: twilioConfig.isConfigured ? 'enforced' : 'skipped (no auth token)',
    message: twilioConfig.isConfigured
      ? 'Twilio credentials present. Messages will be sent for real.'
      : 'No Twilio credentials. Messages are logged, not sent, and are reported as not sent.',
    clientReady: twilioService.isReady(),
  })
})

module.exports = router
