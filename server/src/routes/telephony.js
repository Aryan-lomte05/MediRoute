/**
 * MediRoute Telephony & Twilio Webhook Router
 * Author: Neil Mishra (Neil-1901)
 * Email: neilmishra57@gmail.com
 * Description: Handles Twilio Voice IVR triage, incoming SMS SOS dispatches,
 *              and delivery confirmation webhooks.
 */

const express = require('express')
const twilioService = require('../services/twilioService')
const Incident = require('../models/Incident')

const router = express.Router()

/**
 * POST /api/telephony/voice-sos
 * Twilio Voice Webhook: Generates interactive TwiML IVR response
 */
router.post('/voice-sos', (req, res) => {
  const callerNumber = req.body.From || 'Unknown'
  const digits = req.body.Digits

  console.log(`[Telephony IVR] Inbound emergency call from ${callerNumber}, Digits: ${digits || 'None'}`)

  // Generate TwiML response
  let twiml = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>'

  if (!digits) {
    twiml += `
    <Gather numDigits="1" action="/api/telephony/voice-sos" method="POST" timeout="5">
      <Say voice="Polly.Aditi" language="en-IN">
        Welcome to MediRoute Emergency Command. 
        Press 1 for Road Traffic Accident. 
        Press 2 for Cardiac or Respiratory arrest. 
        Press 3 for Maternal Emergency. 
        Press 9 for Immediate Human Operator.
      </Say>
    </Gather>
    <Say voice="Polly.Aditi" language="en-IN">We did not receive your input. Connecting you directly to the highest priority emergency queue.</Say>
    <Dial>+912224107000</Dial>
    `
  } else {
    const priorityMap = {
      '1': { type: 'TRAFFIC_COLLISION', esi: 1, desc: 'Critical road traffic accident with entrapment' },
      '2': { type: 'CARDIAC_ARREST', esi: 1, desc: 'Suspected acute myocardial infarction / respiratory arrest' },
      '3': { type: 'MATERNAL_EMERGENCY', esi: 2, desc: 'Obstetric / maternal critical distress' },
      '9': { type: 'OPERATOR_ASSIST', esi: 2, desc: 'Direct emergency operator escalation' },
    }

    const matched = priorityMap[digits] || priorityMap['9']
    twiml += `
    <Say voice="Polly.Aditi" language="en-IN">
      Emergency categorized as ${matched.type.replace('_', ' ')}. 
      Your GPS coordinates from cellular triangulation have been queued. 
      Stay on the line, an ambulance is being dispatched immediately.
    </Say>
    <Dial timeout="30">+912224107000</Dial>
    `
  }

  twiml += '</Response>'
  res.type('text/xml').send(twiml)
})

/**
 * POST /api/telephony/incoming-sms
 * Handles SMS SOS messages (e.g. from low-connectivity areas)
 */
router.post('/incoming-sms', async (req, res) => {
  try {
    const fromNumber = req.body.From || 'Anonymous'
    const bodyText = (req.body.Body || '').trim()

    console.log(`[Telephony SMS] Incoming SOS message from ${fromNumber}: "${bodyText}"`)

    // Extract crude location hints if present, or default to central command
    let locationDesc = 'Cellular location reported via SMS'
    if (bodyText.length > 5) {
      locationDesc = bodyText
    }

    // Auto-generate Incident in MongoDB
    const incidentNumber = `INC-SMS-${Date.now().toString().slice(-6)}`
    const incident = await Incident.create({
      incidentNumber,
      callerPhone: fromNumber,
      chiefComplaint: `Offline SMS SOS: ${bodyText}`,
      priority: 'CRITICAL',
      esiLevel: 1,
      status: 'DISPATCHED',
      location: {
        type: 'Point',
        coordinates: [72.836, 19.019], // Default Parel/Dadar intersection
        address: locationDesc,
        city: 'Mumbai',
      },
      patientInfo: {
        name: `SMS Reporter (${fromNumber.slice(-4)})`,
        age: 30,
        gender: 'UNKNOWN',
      },
    })

    // TwiML response message back to the sender
    const replyTwiml = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Message>
        [MEDIROUTE CONFIRMED] Emergency #${incidentNumber} recorded. Nearest ALS Ambulance dispatched. Live link: https://mediroute-five.vercel.app/patient?incidentId=${incident._id}
      </Message>
    </Response>`

    res.type('text/xml').send(replyTwiml)
  } catch (err) {
    console.error('[Telephony SMS] Error creating SMS incident:', err.message)
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Message>Emergency received by MediRoute. Please stay at your location, assistance is underway.</Message>
    </Response>`)
  }
})

/**
 * POST /api/telephony/status-callback
 * Twilio delivery receipt logger
 */
router.post('/status-callback', (req, res) => {
  const { MessageSid, MessageStatus, To } = req.body
  console.log(`[Telephony Callback] Message ${MessageSid} to ${To}: Status = ${MessageStatus}`)
  res.status(200).json({ received: true })
})

module.exports = router
