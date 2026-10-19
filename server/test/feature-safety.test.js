const test = require('node:test')
const assert = require('node:assert/strict')
const twilio = require('twilio')

const {
  validateTwilioWebhook,
  validateRecordingUrl,
  validateAudioInput,
  parseSharedLocation,
  isValidRecordingDuration,
} = require('../src/services/twilioSecurity')
const { canAccessIncident } = require('../src/middleware/incidentAccess')
const { claimIncidentPipeline, isValidCoordinates, initialIncidentStatus } = require('../src/services/incidentService')

test('Twilio webhook signature rejects missing and invalid signatures and accepts valid signatures', () => {
  const old = { token: process.env.TWILIO_AUTH_TOKEN, base: process.env.PUBLIC_BASE_URL, nodeEnv: process.env.NODE_ENV }
  process.env.TWILIO_AUTH_TOKEN = 'test-auth-token'
  process.env.PUBLIC_BASE_URL = 'https://hooks.example.test'
  process.env.NODE_ENV = 'test'
  const body = { From: 'whatsapp:+15551234567', Body: 'SOS' }
  const req = {
    body,
    originalUrl: '/api/twilio/whatsapp?source=test',
    protocol: 'http',
    url: '/ignored',
    get: (key) => key === 'host' ? 'localhost:5000' : undefined,
  }
  assert.equal(validateTwilioWebhook(req), false)
  const validSignature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, `${process.env.PUBLIC_BASE_URL}${req.originalUrl}`, body)
  req.get = (key) => key === 'X-Twilio-Signature' ? validSignature : key === 'host' ? 'localhost:5000' : undefined
  process.env.NODE_ENV = 'production'
  delete process.env.PUBLIC_BASE_URL
  assert.equal(validateTwilioWebhook(req), false)
  process.env.PUBLIC_BASE_URL = 'https://hooks.example.test'
  process.env.NODE_ENV = 'test'
  req.get = (key) => key === 'X-Twilio-Signature'
    ? twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, `${process.env.PUBLIC_BASE_URL}${req.originalUrl}`, body)
    : key === 'host' ? 'localhost:5000' : undefined
  assert.equal(validateTwilioWebhook(req), true)
  req.get = (key) => key === 'X-Twilio-Signature' ? 'invalid' : key === 'host' ? 'localhost:5000' : undefined
  assert.equal(validateTwilioWebhook(req), false)
  if (old.token === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = old.token
  if (old.base === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = old.base
  if (old.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old.nodeEnv
})

test('location parsing requires a valid pin and does not invent a fallback', () => {
  assert.equal(parseSharedLocation({}), null)
  assert.equal(parseSharedLocation({ Latitude: '91', Longitude: '2' }), null)
  assert.deepEqual(parseSharedLocation({ Latitude: '0', Longitude: '0' }), [0, 0])
  assert.equal(isValidCoordinates(undefined), false)
  assert.equal(isValidCoordinates([181, 0]), false)
  assert.equal(isValidCoordinates([72.8, 19.0]), true)
  assert.equal(initialIncidentStatus(undefined), 'AWAITING_LOCATION')
  assert.equal(initialIncidentStatus({ coordinates: [72.8, 19.0] }), 'PENDING')
  assert.equal(initialIncidentStatus({ coordinates: [72.8, 19.0] }, true), 'AWAITING_LOCATION')
})

test('recording downloads accept only authenticated Twilio recording URLs', () => {
  assert.equal(validateRecordingUrl('https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE456.wav', 'AC123'), true)
  assert.equal(validateRecordingUrl('http://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE456.wav', 'AC123'), false)
  assert.equal(validateRecordingUrl('https://example.com/2010-04-01/Accounts/AC123/Recordings/RE456.wav', 'AC123'), false)
  assert.equal(validateRecordingUrl('https://api.twilio.com/2010-04-01/Accounts/AC123/Recordings/RE456.wav?x=1', 'AC123'), false)
})

test('audio validation rejects empty, oversized, and unsupported uploads', () => {
  assert.equal(validateAudioInput(Buffer.alloc(0), 'audio/webm').valid, false)
  assert.equal(validateAudioInput(Buffer.alloc(8 * 1024 * 1024 + 1), 'audio/webm').reason, 'audio_too_large')
  assert.equal(validateAudioInput(Buffer.from('x'), 'application/octet-stream').reason, 'unsupported_audio_type')
  assert.equal(validateAudioInput(Buffer.from('x'), 'audio/webm;codecs=opus').valid, true)
  assert.equal(isValidRecordingDuration(30), true)
  assert.equal(isValidRecordingDuration(31), false)
  assert.equal(isValidRecordingDuration(undefined), false)
})

test('incident transcript access follows patient, paramedic, hospital, and admin assignment', () => {
  const incident = { patient: 'p1', assignedAmbulance: 'a1', allocatedHospital: 'h1' }
  assert.equal(canAccessIncident({ role: 'patient', _id: 'p1' }, incident), true)
  assert.equal(canAccessIncident({ role: 'paramedic', ambulanceId: 'a1' }, incident), true)
  assert.equal(canAccessIncident({ role: 'paramedic', ambulanceId: 'a2' }, incident), false)
  assert.equal(canAccessIncident({ role: 'hospital_staff', hospitalId: 'h1' }, incident), true)
  assert.equal(canAccessIncident({ role: 'admin' }, incident), true)
})

test('pipeline claim is atomic and only one concurrent caller can claim an incident', async () => {
  let state = 'NOT_STARTED'
  const Model = {
    async findOneAndUpdate(filter) {
      if (state !== filter.pipelineState) return null
      state = 'RUNNING'
      return { location: { coordinates: [72.8, 19.0] } }
    },
  }
  const [first, second] = await Promise.all([
    claimIncidentPipeline(Model, 'incident-1'),
    claimIncidentPipeline(Model, 'incident-1'),
  ])
  assert.equal(Number(Boolean(first)) + Number(Boolean(second)), 1)
})

test('Whisper reports missing configuration without making a network request', async () => {
  const previous = process.env.GROQ_API_KEY
  delete process.env.GROQ_API_KEY
  const { transcribeAudio } = require('../src/services/whisper')
  const result = await transcribeAudio({ buffer: Buffer.from('audio'), mimeType: 'audio/webm' })
  assert.equal(result.success, false)
  assert.equal(result.error, 'not_configured')
  if (previous !== undefined) process.env.GROQ_API_KEY = previous
})
