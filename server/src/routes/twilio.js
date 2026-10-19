const express = require('express')
const twilio = require('twilio')
const Incident = require('../models/Incident')
const { createIncident } = require('../services/incidentService')
const { detectEmergencyIntent } = require('../services/whatsapp')
const { transcribeAudio } = require('../services/whisper')
const { validateTwilioWebhook, validateRecordingUrl, webhookUrl, parseSharedLocation, isValidRecordingDuration } = require('../services/twilioSecurity')

const router = express.Router()
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN

router.use((req, res, next) => {
  if (!validateTwilioWebhook(req)) return res.status(403).type('text/plain').send('Invalid Twilio signature')
  next()
})

function reply(res, message) {
  const twiml = new twilio.twiml.MessagingResponse()
  twiml.message(message)
  return res.type('text/xml').send(twiml.toString())
}

router.post('/whatsapp', async (req, res) => {
  try {
    const from = String(req.body.From || '').replace(/^whatsapp:/, '')
    const body = String(req.body.Body || '').trim()
    const coordinates = parseSharedLocation(req.body)
    const messageSid = req.body.MessageSid
    const emergency = detectEmergencyIntent(body)

    if (messageSid) {
      const duplicate = await Incident.findOne({ 'channelMeta.whatsappMessageSid': messageSid })
      if (duplicate) {
        const statusText = duplicate.status === 'AWAITING_LOCATION'
          ? 'This request is recorded and still needs your precise location. No dispatch is confirmed.'
          : 'This request was already received and is entering triage and dispatch review. This message does not confirm that an ambulance is en route.'
        return reply(res, `Incident ${duplicate.incidentNumber}: ${statusText}`)
      }
    }

    if (coordinates && from) {
      const waiting = await Incident.findOne({
        'patientDetails.phone': from,
        source: { $in: ['WHATSAPP', 'VOICE_IVR'] },
        status: 'AWAITING_LOCATION',
      }).sort({ createdAt: -1 })
      if (waiting) {
        waiting.location = { type: 'Point', coordinates, address: 'Shared via WhatsApp location pin' }
        waiting.status = 'PENDING'
        if (messageSid) waiting.channelMeta.whatsappMessageSid = messageSid
        await waiting.save()
        // A voice call may have already supplied useful transcript data.
        const { triggerAITriage } = require('../services/incidentService')
        triggerAITriage(waiting._id, {
          chiefComplaint: waiting.triageData?.chiefComplaint,
          voiceTranscript: waiting.voiceTranscript,
          vitals: waiting.triageData?.vitals,
        }, req.app.get('io'))
        return reply(res, `Location received for incident ${waiting.incidentNumber}. The request is now entering triage and dispatch review. This message does not confirm that an ambulance is en route.`)
      }
    }

    if (!emergency && !coordinates) {
      return reply(res, 'MediRoute Emergency Bot: reply SOS or describe an emergency. To add a location, use the attachment menu → Location after starting an emergency request.')
    }

    const incident = await createIncident({
      patientDetails: { name: req.body.ProfileName || 'WhatsApp Emergency Contact', phone: from || undefined },
      chiefComplaint: body || 'Emergency reported via WhatsApp',
      location: coordinates ? { coordinates, address: 'Shared via WhatsApp location pin' } : undefined,
      awaitingLocation: !coordinates,
      source: 'WHATSAPP',
      channelMeta: { whatsappFrom: from || undefined, whatsappMessageSid: messageSid || undefined },
    }, req.app.get('io'))

    if (!coordinates) {
      return reply(res, `Emergency request ${incident.incidentNumber} is recorded, but we do not have your precise location and no dispatch is confirmed. Share your live location using attachment → Location, or call local emergency services now.`)
    }
    return reply(res, `Location received for incident ${incident.incidentNumber}. The request is entering triage and dispatch review. This message does not confirm that an ambulance is en route.`)
  } catch (err) {
    console.error('[Twilio WhatsApp] Handler error:', err.message)
    return reply(res, 'We could not confirm that your emergency request was recorded. Call local emergency services directly now if you need immediate help.')
  }
})

router.post('/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse()
  const requestUrl = webhookUrl(req)
  const callbackBase = requestUrl?.slice(0, requestUrl.length - (req.originalUrl || req.url).length)
  if (!callbackBase) return res.status(503).type('text/plain').send('Twilio public URL is not configured')
  twiml.say({ voice: 'Polly.Joanna' }, 'Welcome to MediRoute. After the tone, briefly describe your emergency. We will record your request, but cannot determine your precise location from this call. Please share your location through MediRoute WhatsApp or call local emergency services for immediate help.')
  twiml.record({
    maxLength: 30,
    playBeep: true,
    action: `${callbackBase}/api/twilio/voice/recording`,
    method: 'POST',
    trim: 'trim-silence',
  })
  twiml.say({ voice: 'Polly.Joanna' }, 'No recording was received. Please call local emergency services directly.')
  return res.type('text/xml').send(twiml.toString())
})

router.post('/voice/recording', async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse()
  try {
    const from = req.body.From || undefined
    const callSid = req.body.CallSid
    const recordingUrl = req.body.RecordingUrl
    let incident = callSid ? await Incident.findOne({ 'channelMeta.callSid': callSid }) : null
    if (!incident) {
      incident = await createIncident({
        patientDetails: { name: 'Voice IVR Caller', phone: from },
        chiefComplaint: 'Emergency reported via voice call; transcription pending',
        awaitingLocation: true,
        source: 'VOICE_IVR',
        channelMeta: { callSid, recordingUrl },
      }, req.app.get('io'))
    }

    twiml.say({ voice: 'Polly.Joanna' }, `Your recording was received for request ${incident.incidentNumber}. No ambulance dispatch is confirmed because we do not have your precise location. Share your location via MediRoute WhatsApp or call local emergency services now.`)

    if (recordingUrl && validateRecordingUrl(recordingUrl, TWILIO_ACCOUNT_SID) && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && isValidRecordingDuration(req.body.RecordingDuration)) {
      const transcriptionClaim = await Incident.findOneAndUpdate(
        {
          _id: incident._id,
          'channelMeta.recordingTranscriptionState': { $nin: ['PROCESSING', 'COMPLETE'] },
        },
        { $set: { 'channelMeta.recordingTranscriptionState': 'PROCESSING' } },
        { new: true }
      )
      if (!transcriptionClaim) return res.type('text/xml').send(twiml.toString())
      transcribeAudio({
      url: `${recordingUrl.replace(/\/$/, '').replace(/\.wav$/i, '')}.wav`,
        auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN },
        filename: 'recording.wav',
        mimeType: 'audio/wav',
        allowTwilioUrl: true,
      }).then(async (result) => {
        if (!result.success || !result.text) {
          await Incident.findByIdAndUpdate(incident._id, { 'channelMeta.recordingTranscriptionState': 'FAILED' })
          console.warn(`[Twilio Voice] Transcription unavailable for incident ${incident._id}: ${result.message || result.error}`)
          return
        }
        await Incident.findByIdAndUpdate(incident._id, {
          voiceTranscript: result.text,
          'triageData.chiefComplaint': result.text,
          'channelMeta.recordingTranscriptionState': 'COMPLETE',
        })
      }).catch(async (err) => {
        await Incident.findByIdAndUpdate(incident._id, { 'channelMeta.recordingTranscriptionState': 'FAILED' }).catch(() => {})
        console.error('[Twilio Voice] Async transcription error:', err.message)
      })
    } else if (recordingUrl) {
      await Incident.findByIdAndUpdate(incident._id, { 'channelMeta.recordingTranscriptionState': 'FAILED' })
      console.warn('[Twilio Voice] Recording rejected: expected an authenticated Twilio URL and a duration from 1 to 30 seconds.')
    }
    return res.type('text/xml').send(twiml.toString())
  } catch (err) {
    console.error('[Twilio Voice Recording] Handler error:', err.message)
    twiml.say('We could not confirm that your request was recorded. Please call local emergency services directly.')
    return res.type('text/xml').send(twiml.toString())
  }
})

module.exports = router
