const axios = require('axios')
const FormData = require('form-data')
const { MAX_AUDIO_BYTES, validateAudioInput } = require('./twilioSecurity')

const GROQ_API_KEY = process.env.GROQ_API_KEY
const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GROQ_WHISPER_MODEL = 'whisper-large-v3'

/**
 * Reusable speech-to-text service backed by Groq's hosted Whisper endpoint.
 * Used by both the paramedic voice-log UI (POST /api/ai/whisper-transcribe)
 * and the Twilio Voice/IVR recording callback (routes/twilio.js).
 *
 * Accepts exactly one audio source:
 *   - buffer:   a Node Buffer of raw audio bytes (e.g. decoded from a base64 upload)
 *   - url:      a URL to download audio from (e.g. a Twilio RecordingUrl)
 *
 * Never throws — always resolves to { success, text? , error?, message? } so
 * callers (webhooks in particular) can respond safely even when Whisper is
 * unavailable or misconfigured.
 */
async function transcribeAudio({ buffer, url, filename = 'audio.wav', mimeType = 'audio/wav', auth, allowTwilioUrl = false } = {}) {
  if (!GROQ_API_KEY) {
    return {
      success: false,
      error: 'not_configured',
      message: 'Whisper transcription is not configured (GROQ_API_KEY missing).',
    }
  }

  if (!buffer && !url) {
    return { success: false, error: 'no_audio', message: 'No audio buffer or URL provided.' }
  }

  if (url && !allowTwilioUrl) {
    return { success: false, error: 'url_not_allowed', message: 'URL transcription is not available for this endpoint.' }
  }

  if (buffer) {
    const validation = validateAudioInput(buffer, mimeType)
    if (!validation.valid) {
      return { success: false, error: validation.reason, message: 'Audio format or size is not supported.' }
    }
    mimeType = validation.mimeType
  }

  try {
    let audioBuffer = buffer
    if (!audioBuffer && url) {
      const download = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxRedirects: 0,
        maxContentLength: MAX_AUDIO_BYTES,
        maxBodyLength: MAX_AUDIO_BYTES,
        auth: auth || undefined, // e.g. Twilio Basic Auth for protected RecordingUrls
      })
      audioBuffer = Buffer.from(download.data)
      const validation = validateAudioInput(audioBuffer, mimeType)
      if (!validation.valid) {
        return { success: false, error: validation.reason, message: 'Recording format or size is not supported.' }
      }
      mimeType = validation.mimeType
    }

    const form = new FormData()
    form.append('file', audioBuffer, { filename, contentType: mimeType })
    form.append('model', GROQ_WHISPER_MODEL)
    form.append('response_format', 'json')

    const res = await axios.post(GROQ_TRANSCRIPTION_URL, form, {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        ...form.getHeaders(),
      },
      timeout: 20000,
      maxBodyLength: MAX_AUDIO_BYTES + 256 * 1024,
    })

    const text = (res.data?.text || '').trim()
    return { success: true, text }
  } catch (err) {
    // Never leak API keys or stack traces — log a short warning server-side only
    console.warn('[Whisper] Transcription failed:', err.response?.data?.error?.message || err.message)
    return { success: false, error: 'transcription_failed', message: 'Audio transcription failed.' }
  }
}

module.exports = { transcribeAudio }
