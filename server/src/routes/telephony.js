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
const aiService = require('../services/aiService')
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
// POST /api/telephony/whatsapp - inbound WhatsApp SOS
// ──────────────────────────────────────────────────────────────────────────────
// Twilio delivers WhatsApp through the same message webhook shape as SMS, with
// a "whatsapp:" prefix on the addresses. It gets its own route so the reply
// goes back over WhatsApp rather than as an SMS the sender never asked for.
router.post('/whatsapp', verifyTwilioSignature, async (req, res) => {
  const from = req.body.From || ''
  const body = (req.body.Body || '').trim()
  const io = req.app.get('io')

  console.log(`[Telephony WhatsApp] From ${from}: "${body.slice(0, 80)}"`)

  try {
    const incident = await createTelephonyIncident({
      // Store the bare number; the whatsapp: prefix is a transport detail.
      phone: from.replace(/^whatsapp:/, ''),
      complaint: body || 'Emergency reported over WhatsApp, no detail given',
      locationText: body,
      channel: 'whatsapp',
      io,
    })

    const base = process.env.CLIENT_URL || 'https://mediroute-five.vercel.app'

    return res.type('text/xml').send(
      twiml(
        `<Message>MediRoute: emergency ${incident.incidentNumber} received. Help is being arranged. Track it here: ${base}/sos . If this is life-threatening, call ${twilioConfig.emergencyDispatchNumber} now.</Message>`
      )
    )
  } catch (err) {
    console.error('[Telephony WhatsApp] Failed to create incident:', err.message)
    return res.type('text/xml').send(
      twiml(
        `<Message>MediRoute could not log your emergency automatically. Please call ${twilioConfig.emergencyDispatchNumber} immediately.</Message>`
      )
    )
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/telephony/voice-ai - conversational, multilingual voice intake
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Languages the voice agent understands and answers in.
 *
 * `stt` is what Twilio listens for, `tts` picks the Polly voice. A caller is
 * answered in the language they used, because someone in distress should not
 * have to switch languages to be understood.
 */
const VOICE_LANGS = {
  en: { stt: 'en-IN', tts: 'Polly.Aditi', label: 'English' },
  hi: { stt: 'hi-IN', tts: 'Polly.Aditi', label: 'Hindi' },
  mr: { stt: 'mr-IN', tts: 'Polly.Aditi', label: 'Marathi' },
  gu: { stt: 'gu-IN', tts: 'Polly.Aditi', label: 'Gujarati' },
  ta: { stt: 'ta-IN', tts: 'Polly.Raveena', label: 'Tamil' },
  bn: { stt: 'bn-IN', tts: 'Polly.Raveena', label: 'Bengali' },
}

const DEFAULT_VOICE_LANG = 'en'

/** XML-escape anything spoken, so a transcript cannot break the TwiML. */
const sayEscape = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The AI voice agent.
 *
 * Twilio transcribes the caller, the model decides what to say back and
 * whether enough is known to dispatch, and the reply is spoken in the
 * caller's own language. The conversation state rides in the query string
 * because Twilio webhooks are stateless between legs.
 *
 * Deliberately bounded: after a few turns it dispatches on what it has and
 * connects a human, rather than interviewing someone who needs an ambulance.
 */
router.post('/voice-ai', verifyTwilioSignature, async (req, res) => {
  const caller = req.body.From || 'Unknown'
  const speech = (req.body.SpeechResult || '').trim()
  const io = req.app.get('io')

  const lang = VOICE_LANGS[req.query.lang] ? req.query.lang : DEFAULT_VOICE_LANG
  const turn = parseInt(req.query.turn, 10) || 0
  // Express has already decoded the query string; decoding again would
  // corrupt any text containing a literal percent sign.
  const sofar = req.query.sofar || ''

  const voice = VOICE_LANGS[lang]
  const nextUrl = (params) =>
    // The result goes into an XML attribute, where a bare & is invalid markup.
    `/api/telephony/voice-ai?${new URLSearchParams(params).toString()}`.replace(/&/g, '&amp;')

  // ── Opening leg: offer a language, then listen ──────────────────────────
  if (turn === 0 && !speech) {
    return res.type('text/xml').send(
      twiml(`
    <Gather input="speech dtmf" numDigits="1" language="en-IN" speechTimeout="auto"
            action="${nextUrl({ lang: 'en', turn: 1 })}" method="POST">
      <Say voice="Polly.Aditi" language="en-IN">MediRoute Emergency. Tell me what has happened.</Say>
      <Say voice="Polly.Aditi" language="hi-IN">आप हिंदी में भी बोल सकते हैं। बताइए क्या हुआ है।</Say>
      <Say voice="Polly.Aditi" language="mr-IN">तुम्ही मराठीत सुद्धा बोलू शकता.</Say>
    </Gather>
    <Say voice="Polly.Aditi" language="en-IN">I did not hear anything. Connecting you to an operator.</Say>
    <Dial timeout="30">${twilioConfig.emergencyDispatchNumber}</Dial>`)
    )
  }

  // Nothing heard on a later leg: do not loop forever on a silent line.
  if (!speech) {
    return res.type('text/xml').send(
      twiml(`
    <Say voice="${voice.tts}" language="${voice.stt}">Connecting you to an operator now.</Say>
    <Dial timeout="30">${twilioConfig.emergencyDispatchNumber}</Dial>`)
    )
  }

  const transcript = [sofar, speech].filter(Boolean).join(' ')

  try {
    /*
     * One model call does three jobs: detect the language actually spoken,
     * decide whether enough is known to send an ambulance, and compose the
     * spoken reply in that same language.
     */
    const decision = await aiService.converseEmergencyCall({
      transcript,
      turn,
      assumedLanguage: lang,
    })

    const replyLang = VOICE_LANGS[decision.language] ? decision.language : lang
    const replyVoice = VOICE_LANGS[replyLang]

    // Enough information, or the conversation has run long enough.
    if (decision.readyToDispatch || turn >= 3) {
      const incident = await createTelephonyIncident({
        phone: caller,
        complaint: decision.complaint || transcript,
        locationText: decision.location || '',
        channel: 'call',
        io,
      })

      console.log(
        `[Telephony AI] ${incident.incidentNumber} from a ${replyVoice.label} call after ${turn + 1} turns`
      )

      return res.type('text/xml').send(
        twiml(`
    <Say voice="${replyVoice.tts}" language="${replyVoice.stt}">${sayEscape(decision.reply)}</Say>
    <Say voice="${replyVoice.tts}" language="${replyVoice.stt}">${sayEscape(decision.closing || '')}</Say>
    <Dial timeout="30">${twilioConfig.emergencyDispatchNumber}</Dial>`)
      )
    }

    // Keep listening: ask the one thing still missing.
    return res.type('text/xml').send(
      twiml(`
    <Gather input="speech" language="${replyVoice.stt}" speechTimeout="auto"
            action="${nextUrl({ lang: replyLang, turn: turn + 1, sofar: transcript })}" method="POST">
      <Say voice="${replyVoice.tts}" language="${replyVoice.stt}">${sayEscape(decision.reply)}</Say>
    </Gather>
    <Say voice="${replyVoice.tts}" language="${replyVoice.stt}">Connecting you to an operator.</Say>
    <Dial timeout="30">${twilioConfig.emergencyDispatchNumber}</Dial>`)
    )
  } catch (err) {
    console.error('[Telephony AI] Voice agent failed:', err.message)

    /*
     * The model is not allowed to be a single point of failure on an emergency
     * line. Dispatch on what was heard and hand the caller to a human.
     */
    try {
      await createTelephonyIncident({
        phone: caller,
        complaint: transcript || 'Emergency call, details unclear',
        locationText: '',
        channel: 'call',
        io,
      })
    } catch (inner) {
      console.error('[Telephony AI] Fallback incident also failed:', inner.message)
    }

    return res.type('text/xml').send(
      twiml(`
    <Say voice="${voice.tts}" language="${voice.stt}">Your emergency has been logged. Connecting you to an operator now.</Say>
    <Dial timeout="30">${twilioConfig.emergencyDispatchNumber}</Dial>`)
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
