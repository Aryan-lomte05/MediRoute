# MediRoute Telephony & Emergency Telecommunications Subsystem

**Author:** Neil Mishra ([@Neil-1901](https://github.com/Neil-1901))  
**Email:** `neilmishra57@gmail.com`  
**Module:** `telephony-service` / `sms-gateway`  
**Target Milestone:** Offline & Dual-Channel Emergency Response Gateway  

---

## 1. Architectural Overview

The Telephony & SMS Subsystem bridges the digital MediRoute platform with standard cellular networks and public switched telephone networks (PSTN). It guarantees that emergency dispatch remains functional even when citizens or paramedics experience cellular data (4G/5G) dropouts.

```
[ Citizen (No Internet) ]
           │
           ├── (Native SMS Protocol) ──────────┐
           │                                   ▼
[ Inbound Call (Dial 108) ] ──▶ [ Twilio Voice IVR ] ──▶ [ TwiML Speech Engine ]
                                               │                  │
                                               │                  ▼
                                               └───▶ [ MediRoute API Gateway ]
                                                              │
                                                              ▼
                                                    [ Realtime Dispatch ]
                                                              │
                                        ┌─────────────────────┴─────────────────────┐
                                        ▼                                           ▼
                            [ Paramedic HUD Alert ]                     [ Hospital ER Advisory ]
                            (SMS + Geonav Link)                         (SMS Trauma Alert)
```

---

## 2. Core Functional Modules

### A. Next-of-Kin Emergency SMS Broadcast
- **File:** `server/src/services/twilioService.js`
- When a citizen presses SOS, an automated SMS is dispatched to their registered emergency contacts with their exact GPS coordinates and a one-click real-time tracking link.

### B. Inbound IVR Voice Triage (`/api/telephony/voice-sos`)
- **File:** `server/src/routes/telephony.js`
- Interactive voice menu powered by Twilio Voice & Amazon Polly (`Polly.Aditi` Hindi/English voice).
- Automated DTMF keypad classification:
  - **Press 1**: Road Traffic Collision (Auto ESI-1)
  - **Press 2**: Acute Myocardial Infarction / Cardiac (Auto ESI-1)
  - **Press 3**: Maternal Emergency (Auto ESI-2)
  - **Press 9**: Human Dispatch Operator Escalation

### C. Offline Citizen SMS Fallback
- **File:** `client/src/lib/offlineSms.js`
- If `navigator.onLine === false`, the Citizen PWA switches to native emergency SMS mode, constructing pre-filled emergency coordinates and launching the device native SMS messenger.

---

## 3. Configuration & Webhook Endpoints

| Endpoint | Method | Purpose |
| :--- | :--- | :--- |
| `/api/telephony/voice-sos` | `POST` | Inbound Twilio Voice Webhook (TwiML response) |
| `/api/telephony/incoming-sms` | `POST` | Cellular SMS SOS parsing & incident creation |
| `/api/telephony/status-callback` | `POST` | SMS delivery receipts & audit tracking |

### Environment Variables
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
TWILIO_PHONE_NUMBER=+18005550199
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
EMERGENCY_DISPATCH_HOTLINE=108
```

> **Deployment Note:** For the hackathon/demo build deployed on Vercel and Render, live cellular telecom billing is bypassed using the built-in safe simulation dispatcher in `twilioService.js`.
