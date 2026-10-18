/**
 * ==============================================================================
 * MEDIROUTE - HTTP CLIENT (lib/api.js)
 * ==============================================================================
 *
 * WHAT IS WHERE:
 * - Line 20-30:  Axios instance bound to VITE_API_URL
 * - Line 32-50:  Request interceptor - attaches the JWT when one exists
 * - Line 52-85:  Response interceptor - session expiry handling
 * - Line 87-110: publicApi - helpers for anonymous citizen requests
 * ==============================================================================
 */

import axios from 'axios'

/** Routes that anonymous citizens are expected to use without an account. */
const PUBLIC_PATHS = ['/', '/sos', '/login', '/register']

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

function readStoredToken() {
  try {
    const stored = localStorage.getItem('mediroute-auth')
    if (!stored) return null
    return JSON.parse(stored)?.state?.token || null
  } catch {
    // Corrupt or unavailable storage must not break an emergency request.
    return null
  }
}

// Request interceptor — attach the token when the user has a session.
api.interceptors.request.use((config) => {
  const token = readStoredToken()
  if (token) config.headers['Authorization'] = `Bearer ${token}`
  return config
})

// Response interceptor — handle an expired session.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const path = window.location.pathname

      /**
       * Only bounce to the login screen when a *signed-in* session has gone
       * stale on a protected page.
       *
       * This previously redirected on any 401 from anywhere. On the public SOS
       * page that would throw a citizen reporting an emergency out to a login
       * form mid-report, which is the exact wall this flow exists to avoid.
       */
      const hadSession = Boolean(readStoredToken())
      const onPublicPage = PUBLIC_PATHS.includes(path)

      if (hadSession && !onPublicPage) {
        localStorage.removeItem('mediroute-auth')
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

export default api

/**
 * Track an incident as an anonymous reporter, using the one-time token handed
 * back when the report was created. Sent as a header so it never lands in
 * browser history or server access logs the way a query string would.
 */
export function getTrackedIncident(incidentId, trackingToken) {
  return api.get(`/incidents/${incidentId}`, {
    headers: trackingToken ? { 'x-tracking-token': trackingToken } : {},
  })
}

/** Cancel one's own anonymous report. */
export function cancelTrackedIncident(incidentId, trackingToken) {
  return api.patch(
    `/incidents/${incidentId}/status`,
    { status: 'CANCELLED' },
    { headers: trackingToken ? { 'x-tracking-token': trackingToken } : {} }
  )
}

/**
 * Post a recorded audio blob for transcription and triage in one call.
 * Sent as a raw body rather than multipart, matching the server's express.raw
 * handler, which avoids a multipart dependency on the backend.
 */
export function postVoiceReport(blob, reporterType) {
  return api.post('/ai/voice-triage', blob, {
    headers: { 'Content-Type': blob.type || 'audio/webm' },
    params: reporterType ? { reporterType } : {},
    timeout: 60000,
  })
}
