/**
 * MediRoute Offline SMS Emergency Intent Generator
 * Author: Neil Mishra (Neil-1901)
 * Email: neilmishra57@gmail.com
 * Description: Client-side utility for the Citizen SOS PWA that enables one-tap
 *              native SMS dispatch when cellular internet/4G/5G is unavailable.
 */

const EMERGENCY_SMS_HOTLINE = '108'

/**
 * Generate native SMS URI with pre-filled GPS telemetry
 */
export function generateEmergencySmsUri({ latitude, longitude, complaint, patientName, bloodGroup }) {
  const coordinates = latitude && longitude ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` : 'Location unknown'
  const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })

  const bodyText = `[MEDIROUTE SOS ${time}]
Patient: ${patientName || 'Anonymous Citizen'}
Blood: ${bloodGroup || 'Not specified'}
Emergency: ${complaint || 'Critical Medical Distress'}
GPS: ${coordinates}
Map: https://maps.google.com/?q=${coordinates}`

  // Detect iOS vs Android for correct SMS protocol format
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream
  const separator = isIOS ? '&' : '?'

  return `sms:${EMERGENCY_SMS_HOTLINE}${separator}body=${encodeURIComponent(bodyText)}`
}

/**
 * Check if browser network is currently offline
 */
export function isOfflineEmergency() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * Launch the device native SMS application
 */
export function triggerNativeEmergencySms(payload) {
  const uri = generateEmergencySmsUri(payload)
  window.location.href = uri
  return uri
}
