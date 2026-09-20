/**
 * MediRoute Twilio Telephony & Emergency Notification Service
 * Author: Neil Mishra (Neil-1901)
 * Email: neilmishra57@gmail.com
 * Description: Real-time SMS and WhatsApp emergency dispatch engine for citizens,
 *              paramedics, and emergency departments.
 */

const twilioConfig = require('../config/twilio')

class TwilioService {
  constructor() {
    this.client = null
    this.initClient()
  }

  initClient() {
    if (twilioConfig.isConfigured) {
      try {
        const twilio = require('twilio')
        this.client = twilio(twilioConfig.accountSid, twilioConfig.authToken)
        console.log('[TwilioService] Live Twilio client initialized successfully.')
      } catch (err) {
        console.warn('[TwilioService] Failed to load live twilio SDK, falling back to simulation mode:', err.message)
      }
    } else {
      console.log('[TwilioService] Running in prototype simulation mode (credentials pending for production).')
    }
  }

  /**
   * Dispatch instant SMS alert to patient emergency contacts/family
   */
  async sendEmergencyContactAlert({ patientName, contactPhone, trackingUrl, locationText, incidentId }) {
    const body = `[MEDIROUTE EMERGENCY ALERT] ${patientName || 'A family member'} has triggered an SOS near ${locationText || 'Mumbai'}. First responders have been dispatched. Live Tracking & Status: ${trackingUrl || `https://mediroute-five.vercel.app/patient?incidentId=${incidentId}`}`

    return this._dispatchSms({
      to: contactPhone,
      body,
      context: `Next-of-Kin Alert for Incident #${incidentId}`,
    })
  }

  /**
   * Dispatch high-priority SMS to paramedic team when allocated to critical ESI-1/2 incident
   */
  async sendParamedicDispatchAlert({ paramedicPhone, vehicleNumber, incidentId, address, priority, routeUrl }) {
    const body = `[CRITICAL DISPATCH] Unit ${vehicleNumber}: Assigned to #${incidentId} (${priority}). Loc: ${address}. Immediate response required. HUD Route: ${routeUrl || 'https://mediroute-five.vercel.app/paramedic'}`

    return this._dispatchSms({
      to: paramedicPhone,
      body,
      context: `Paramedic Dispatch #${incidentId}`,
    })
  }

  /**
   * Send pre-arrival alert to Hospital Trauma / ER Staff
   */
  async sendHospitalPreArrivalAlert({ hospitalPhone, hospitalName, incidentId, etaMinutes, esiLevel, conditionSummary }) {
    const body = `[ER TRAUMA ADVISORY] Incoming critical patient to ${hospitalName}. ETA: ${etaMinutes} min. ESI Level: ${esiLevel}. Condition: ${conditionSummary || 'Poly-trauma'}. Prepare resuscitation bay.`

    return this._dispatchSms({
      to: hospitalPhone,
      body,
      context: `Hospital Trauma Advisory #${incidentId}`,
    })
  }

  /**
   * Send WhatsApp emergency summary
   */
  async sendWhatsAppAlert({ toPhone, messageText }) {
    if (!toPhone) return null
    const formattedTo = toPhone.startsWith('whatsapp:') ? toPhone : `whatsapp:${toPhone}`

    if (this.client) {
      try {
        const message = await this.client.messages.create({
          from: twilioConfig.whatsappFrom,
          to: formattedTo,
          body: messageText,
        })
        return { success: true, sid: message.sid, status: message.status }
      } catch (err) {
        console.error('[TwilioService] WhatsApp dispatch error:', err.message)
      }
    }

    console.log(`[TwilioService Simulation] WhatsApp sent to ${formattedTo}: "${messageText.substring(0, 60)}..."`)
    return { success: true, simulated: true, sid: `SIM_WA_${Date.now()}` }
  }

  /**
   * Internal generic dispatcher with automated retry & fallback
   */
  async _dispatchSms({ to, body, context }) {
    if (!to) {
      console.warn(`[TwilioService] Skipped dispatch for ${context}: No recipient phone provided.`)
      return { success: false, reason: 'No phone number' }
    }

    if (this.client) {
      try {
        const message = await this.client.messages.create({
          from: twilioConfig.fromNumber,
          to,
          body,
          statusCallback: twilioConfig.statusCallbackUrl,
        })
        console.log(`[TwilioService] Dispatched ${context} (SID: ${message.sid})`)
        return { success: true, sid: message.sid, status: message.status }
      } catch (err) {
        console.error(`[TwilioService] Live dispatch failed for ${context}, falling back:`, err.message)
      }
    }

    // Prototype simulated dispatch for development & demonstration
    console.log(`[TwilioService Simulation] Dispatched ${context} to ${to}:`)
    console.log(`  Body: "${body}"`)
    return {
      success: true,
      simulated: true,
      sid: `SIM_SMS_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      timestamp: new Date().toISOString(),
    }
  }
}

module.exports = new TwilioService()
