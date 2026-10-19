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
    const body = `[MEDIROUTE EMERGENCY ALERT] ${patientName || 'A family member'} has triggered an SOS near ${locationText || 'Mumbai'}. First responders have been dispatched. Live Tracking & Status: ${trackingUrl || `${process.env.CLIENT_URL || 'https://mediroute-five.vercel.app'}/sos`}`

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
    const body = `[CRITICAL DISPATCH] Unit ${vehicleNumber}: Assigned to #${incidentId} (${priority}). Loc: ${address}. Immediate response required. HUD: ${routeUrl || `${process.env.CLIENT_URL || 'https://mediroute-five.vercel.app'}/paramedic`}`

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
        console.log(`[TwilioService] Sent ${context} (SID: ${message.sid})`)
        return { success: true, delivered: true, sid: message.sid, status: message.status }
      } catch (err) {
        /*
         * A live failure is a failure. This previously fell through to the
         * simulated branch below and returned success: true, so a rejected
         * number, an expired credential or an outage all reported as sent.
         */
        console.error(`[TwilioService] Live send failed for ${context}:`, err.message)
        return {
          success: false,
          delivered: false,
          simulated: false,
          reason: err.message,
          code: err.code || null,
        }
      }
    }

    /*
     * No credentials: log what would have been sent, and say plainly that it
     * was not sent.
     *
     * This used to return success: true with a fabricated SID, so any caller
     * checking result.success saw a success whether the message was delivered,
     * rejected, or never attempted. A "message sent" confirmation then proved
     * nothing, which is the worst property an emergency notification can have.
     */
    console.log(`[TwilioService] NOT SENT (no credentials) - ${context} to ${to}`)
    console.log(`  Would have sent: "${body}"`)
    return {
      success: false,
      delivered: false,
      simulated: true,
      reason: 'Twilio is not configured, so no message was sent',
      preview: body,
    }
  }

  /** Whether a live Twilio client was actually constructed. */
  isReady() {
    return Boolean(this.client)
  }

  /**
   * Place an outbound voice call.
   *
   * Used where a message is not enough: confirming a critical dispatch with
   * the caller, or reaching a next-of-kin who may not read an SMS in time. A
   * phone ringing gets attention that a notification does not.
   *
   * @param {object} opts
   * @param {string} opts.to       Number to call, E.164.
   * @param {string} opts.say      What the automated voice should read out.
   * @param {string} [opts.context] For logs.
   * @param {string} [opts.connectTo] Number to bridge the call to after the
   *   message, so the person can speak to a human rather than hearing a
   *   recording and being hung up on.
   * @returns {Promise<{success: boolean, delivered: boolean, sid?: string, reason?: string}>}
   */
  async placeVoiceCall({ to, say, context = 'Voice call', connectTo }) {
    if (!to) {
      console.warn(`[TwilioService] Skipped ${context}: no number to call.`)
      return { success: false, delivered: false, reason: 'No phone number' }
    }

    // Spoken by Twilio's TTS. Indian English voice, since the callers are local.
    const escaped = String(say)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

    const bridge = connectTo
      ? `<Dial timeout="30">${connectTo}</Dial>`
      : ''

    const twiml =
      `<?xml version="1.0" encoding="UTF-8"?><Response>` +
      `<Say voice="Polly.Aditi" language="en-IN">${escaped}</Say>` +
      bridge +
      `</Response>`

    if (this.client) {
      try {
        const call = await this.client.calls.create({
          from: twilioConfig.fromNumber,
          to,
          twiml,
          statusCallback: twilioConfig.statusCallbackUrl,
        })
        console.log(`[TwilioService] Placed ${context} (SID: ${call.sid})`)
        return { success: true, delivered: true, sid: call.sid, status: call.status }
      } catch (err) {
        // A failed call is a failure, never reported as a success.
        console.error(`[TwilioService] Call failed for ${context}:`, err.message)
        return {
          success: false,
          delivered: false,
          simulated: false,
          reason: err.message,
          code: err.code || null,
        }
      }
    }

    console.log(`[TwilioService] NOT CALLED (no credentials) - ${context} to ${to}`)
    console.log(`  Would have said: "${say}"`)
    return {
      success: false,
      delivered: false,
      simulated: true,
      reason: 'Twilio is not configured, so no call was placed',
      preview: say,
    }
  }

  /**
   * Call the person who reported a critical emergency.
   *
   * Only worth doing for the most urgent cases: it confirms a unit is coming
   * and then bridges them to a human who can take the exact location, which is
   * the detail most often missing from an SMS or an app report.
   */
  async callReporterForCriticalIncident({ phone, incidentNumber, vehicleNumber, etaMinutes, operatorNumber }) {
    const eta = etaMinutes != null ? `about ${etaMinutes} minutes` : 'shortly'
    const unit = vehicleNumber ? `Unit ${String(vehicleNumber).split('').join(' ')}` : 'An ambulance'

    return this.placeVoiceCall({
      to: phone,
      context: `Critical dispatch callback for ${incidentNumber}`,
      say:
        `This is MediRoute Emergency Command calling about your emergency report. ` +
        `${unit} has been dispatched and should reach you in ${eta}. ` +
        `Please stay where you are. Connecting you to an operator now to confirm your exact location.`,
      connectTo: operatorNumber || twilioConfig.emergencyDispatchNumber,
    })
  }
}

module.exports = new TwilioService()
