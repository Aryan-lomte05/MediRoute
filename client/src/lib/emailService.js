/**
 * MediRoute — Emergency Notification Gateway (EmailJS)
 *
 * Provides real-time email dispatch notifications for:
 * 1. Critical Incident Creation (ESI 1 / ESI 2 alerts to ER Chiefs)
 * 2. Emergency Contact Notification when a citizen triggers SOS
 * 3. Hospital Pre-Arrival Trauma Bay alerts
 *
 * Setup Guide (Assigned to Neil):
 * 1. Create a free account on https://www.emailjs.com
 * 2. Add an Email Service (Gmail / Outlook) -> get SERVICE_ID
 * 3. Create an Email Template -> get TEMPLATE_ID
 * 4. Get Account PUBLIC_KEY from Account -> API Keys
 * 5. Add to client/.env:
 *    VITE_EMAILJS_SERVICE_ID=your_service_id
 *    VITE_EMAILJS_TEMPLATE_ID=your_template_id
 *    VITE_EMAILJS_PUBLIC_KEY=your_public_key
 */

export const emailConfig = {
  serviceId: import.meta.env.VITE_EMAILJS_SERVICE_ID || '',
  templateId: import.meta.env.VITE_EMAILJS_TEMPLATE_ID || '',
  publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY || '',
}

/**
 * Send an emergency alert email
 * @param {Object} alertData
 * @param {string} alertData.recipientEmail
 * @param {string} alertData.recipientName
 * @param {string} alertData.incidentNumber
 * @param {string} alertData.chiefComplaint
 * @param {number} alertData.esiLevel
 * @param {string} alertData.assignedHospital
 * @param {string} alertData.assignedAmbulance
 * @param {string} alertData.locationText
 */
export async function sendEmergencyAlert(alertData) {
  const {
    recipientEmail = 'er-team@mediroute.com',
    recipientName = 'Emergency Response Team',
    incidentNumber = 'INC-DEMO',
    chiefComplaint = 'Trauma Emergency',
    esiLevel = 1,
    assignedHospital = 'Lilavati Hospital',
    assignedAmbulance = 'MH-02-EMS-101',
    locationText = 'Bandra West, Mumbai',
  } = alertData

  const templateParams = {
    to_name: recipientName,
    to_email: recipientEmail,
    incident_number: incidentNumber,
    chief_complaint: chiefComplaint,
    esi_level: `ESI ${esiLevel}`,
    assigned_hospital: assignedHospital,
    assigned_ambulance: assignedAmbulance,
    incident_location: locationText,
    timestamp: new Date().toLocaleString(),
  }

  // If EmailJS credentials are configured and window.emailjs is loaded
  if (emailConfig.serviceId && emailConfig.templateId && emailConfig.publicKey && window.emailjs) {
    try {
      const response = await window.emailjs.send(
        emailConfig.serviceId,
        emailConfig.templateId,
        templateParams,
        emailConfig.publicKey
      )
      console.log('[EmailJS] Alert dispatched successfully:', response.status, response.text)
      return { success: true, status: response.status }
    } catch (err) {
      console.warn('[EmailJS] Dispatched failed, logging locally:', err)
      return { success: false, error: err }
    }
  }

  // Fallback Simulation Mode (when keys are not yet input in .env)
  console.log('[EmailJS Simulation] Dispatching emergency notification:', {
    to: recipientEmail,
    subject: `🚨 [CRITICAL ALERT] ESI ${esiLevel} Incident: ${incidentNumber}`,
    params: templateParams,
  })

  return {
    success: true,
    simulated: true,
    message: 'Alert simulated (configure VITE_EMAILJS_* keys in .env for live SMTP delivery)',
  }
}
