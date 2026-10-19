/**
 * MediRoute Twilio Telephony & SMS Gateway Configuration
 * Author: Neil Mishra (Neil-1901)
 * Component: Telephony Service Layer
 */

require('dotenv').config()

const twilioConfig = {
  accountSid: process.env.TWILIO_ACCOUNT_SID || 'AC_mock_twilio_account_sid_mediroute',
  authToken: process.env.TWILIO_AUTH_TOKEN || 'mock_twilio_auth_token_mediroute',
  fromNumber: process.env.TWILIO_PHONE_NUMBER || '+18005550199',
  whatsappFrom: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
  emergencyDispatchNumber: process.env.EMERGENCY_DISPATCH_HOTLINE || '108',
  statusCallbackUrl: process.env.TWILIO_STATUS_CALLBACK || 'https://mediroute-fodu.onrender.com/api/telephony/status-callback',
  isConfigured: Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    !process.env.TWILIO_ACCOUNT_SID.startsWith('AC_mock')
  ),
  retryLimit: 3,
  timeoutMs: 10000,
}

module.exports = twilioConfig
