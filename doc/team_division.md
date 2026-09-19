# MediRoute — Team Work Division
## Aryan & Neil | Mini Project Evaluation

---

## 📊 Collaborative Ownership Matrix

| System Domain | Module / Capability | Primary Owner | Status | Focus Area |
|---|---|---|---|---|
| **Core Architecture** | System Architecture & Design | **Aryan** | ✅ Complete | Microservices, REST & Socket design |
| **Core Architecture** | MERN Stack Scaffolding | **Aryan** | ✅ Complete | Vite + Express + Tailwind setup |
| **Data Layer** | MongoDB Schemas & Geospatial Indexes | **Aryan** | ✅ Complete | Users, Incidents, Hospitals, Ambulances |
| **Security** | JWT & RBAC Auth Engine | **Aryan** | ✅ Complete | Role guards & token validation |
| **Real-Time** | Socket.io Real-Time Event Bus | **Aryan** | ✅ Complete | Live telemetry & dispatch broadcasting |
| **Visual Computing** | 3D Interactive Command Globe | **Aryan** | ✅ Complete | Three.js / React Three Fiber rendering |
| **GIS & Mapping** | Mapbox GL 3D Urban Command Center | **Aryan** | ✅ Complete | Fleet telemetry, incident pins & multi-angle controls |
| **Portals & Analytics** | Admin & Hospital Command Portals | **Aryan** | ✅ Complete | Operations overview & capacity monitors |
| **AI Systems** | AI Clinical Triage & MILP Allocation | **Aryan** | ✅ Complete | Groq LLM clinical reasoning & routing |
| **PWA & Web App** | Progressive Web App Scaffolding | **Aryan** | ✅ Complete | Manifest, responsive design, offline readiness |
| **Comms Suite** | Twilio WhatsApp Emergency Bot | **Neil** | 🔲 In Progress | Public chatbot intake & live updates |
| **Comms Suite** | Twilio Interactive Voice Response (IVR) | **Neil** | 🔲 In Progress | Emergency call intake & automated dispatch |
| **Comms Suite** | Whisper Speech-to-Text Audio Engine | **Neil** | 🔲 In Progress | Paramedic & caller voice intake transcription |
| **Notifications** | EmailJS Alert & Notification Gateway | **Neil** | 🔲 In Progress | Real-time email dispatch notifications |
| **Field Applications** | Paramedic Field Experience & PWA Polish | **Neil** | 🔲 In Progress | Offline support, turn-by-turn & vitals HUD |
| **UI/UX Design** | Figma Complete Design System & Prototypes | **Neil** | 🔲 In Progress | Component library & interactive prototype |
| **Engineering Docs** | Software Engineering Use Case Diagrams | **Neil** | ✅ Complete | Use case modeling & actor interactions |

---

## 👨‍💻 ARYAN — Complete (Built & Operational)

### ✅ Core Infrastructure
- Vite + React 18 PWA scaffold with Tailwind CSS
- Node.js + Express API Gateway
- MongoDB Atlas connection with geospatial indexes (2dsphere)
- Redis cache integration architecture for GPS state
- BullMQ job queue structure for async AI tasks
- Docker-ready project configuration

### ✅ Authentication & Security
- JWT token generation and validation
- bcrypt password hashing (12 rounds)
- RBAC middleware (4 roles: patient, paramedic, hospital_staff, admin)
- 1-Click pre-seeded demo access accounts for evaluators
- Rate limiting & Helmet.js security headers + CORS configuration

### ✅ Database Layer (Mongoose)
- **User model** — 4 roles, emergency profile, hospital/ambulance links
- **Incident model** — full triage data, vitals, allocation scores, status machine (9 states)
- **Hospital model** — capabilities, resources, queue status, geospatial index
- **Ambulance model** — live location, status, equipment, paramedic link

### ✅ API Routes (Full REST)
- `POST /api/auth/register|login`, `GET /api/auth/me`
- `POST/GET/PATCH /api/incidents` — full CRUD with status machine
- `GET/POST/PATCH /api/hospitals` — including resource and diversion updates
- `GET/POST/PATCH /api/ambulances` — GPS location streaming via REST
- `POST /api/ai/triage` — LLM triage with Groq fallback to OpenRouter
- `POST /api/ai/allocation` — weighted hospital ranking
- `POST /api/ai/route` — OSRM routing integration
- `GET /api/ai/surge-forecast` — 24h surge prediction

### ✅ Socket.io Real-Time Layer
- JWT-authenticated socket connections
- Role-based room system (patient, paramedic, hospital, admin)
- Events: `gps_update`, `ambulance_location`, `vitals_update`, `dispatch_alert`, `triage_complete`, `incident_status`, `new_incident`
- Ambulance GPS ping every 2 seconds → broadcast to all rooms

### ✅ Landing Page (Interactive 3D Visualizer)
- Three.js 3D Earth globe with React Three Fiber
- Animated orbit rings (red, cyan, purple)
- Pulsing incident markers on globe surface
- Bezier curve route arcs between markers
- 2000-particle field background with drift animation
- GSAP ScrollTrigger & Framer Motion entry animations
- Feature cards with hover glow effects & 4 portal cards

### ✅ City Operations 3D Map Center (Admin Portal)
- Mapbox GL 3D vector map with extruded building heights
- Multi-angle camera HUD: 3D Isometric (55°), Horizon (75°), Tactical 2D (0°), 360° Orbit Mode
- Real-time ambulance GPS markers with animated glow
- Hospital capacity pins with ICU bed counts & diversion status
- Pulsing incident alert markers with ESI triage tags
- Telemetry HUD dock with active metrics

### ✅ Hospital ER Command Center
- Real-time incoming patient feed (Socket.io)
- Color-coded ESI patient cards with vitals
- AI summary display + allergy warnings
- Pre-accept + bed reservation (one-click)
- Resource management (ICU/Trauma/General beds + ventilators)

---

## 👨‍💻 NEIL — Dedicated Implementation Scope

> **Note:** Each of Neil's features is a self-contained module. Integration points with Aryan's code are clearly defined below.

---

### 🔲 Feature 1: Twilio WhatsApp Emergency Bot
**What it does:** Allows citizens to send "SOS" to a WhatsApp number and receive emergency management via chat.

**Files to create:**
- `server/src/routes/twilio.js` — Webhook handlers
- `server/src/services/whatsapp.js` — Message templates + Twilio SDK
- Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER` to `.env`

**Implementation Guide:**
```javascript
const twilio = require('twilio')
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

// Webhook POST /api/twilio/whatsapp
// Parse incoming message → if "SOS" → create incident → reply with ETA
```

---

### 🔲 Feature 2: Twilio Voice Calling + Whisper Transcription
**What it does:** Caller dials the emergency number → Automated IVR prompts for emergency description → Call recorded → Groq Whisper transcribes → AI triages → Ambulance auto-dispatched.

**Files to create:**
- `server/src/routes/twilio.js`:
  - `POST /api/twilio/voice` — Incoming call webhook (TwiML response)
  - `POST /api/twilio/voice/recording` — Recording callback
- `server/src/services/whisper.js` — Whisper transcription service

---

### 🔲 Feature 3: EmailJS Emergency Alert Gateway
**What it does:** Real-time email dispatch notifications sent to ER Trauma Chiefs, hospital bed managers, and citizen emergency contacts whenever critical ESI-1 or ESI-2 incidents occur.

**Files configured:**
- `client/src/lib/emailService.js` (helper service ready)
- Neil adds free EmailJS credentials to `client/.env`:
  - `VITE_EMAILJS_SERVICE_ID`
  - `VITE_EMAILJS_TEMPLATE_ID`
  - `VITE_EMAILJS_PUBLIC_KEY`

---

### 🔲 Feature 4: Paramedic Field Experience Polish & Mobile PWA
**What it does:** Complete field UX enhancements on tablet/mobile screens.
- Live ETA countdown timer derived from OSRM routing
- Turn-by-turn navigation maneuver cards
- Pre-arrival surgical trauma checklist
- Vitals telemetry trends (SpO2, Pulse, Blood Pressure)

---

### 🔲 Feature 5: Figma UI/UX Complete Prototype
- Follow `doc/figma_guide.md` step-by-step
- 12 screens, complete component design system, click-through transitions

---

### 🔲 Feature 6: Software Engineering Use Cases
- Detailed use case diagrams and specifications (see `doc/use_cases.md`)

---

## 🔗 Seamless Integration Points (Neil ↔ Aryan)

| Neil's Feature | Aryan's Integration Point |
|---|---|
| WhatsApp Bot → Create Incident | `POST /api/incidents` |
| WhatsApp Dispatch Alert | `io.to('admin').emit('new_incident')` |
| Voice Recording → Whisper | `POST /api/ai/whisper-transcribe` |
| EmailJS Dispatch Gateway | `sendEmergencyAlert()` in `client/src/lib/emailService.js` |
| Paramedic ETA | `incident.route.etaMinutes` |
| Status Updates via WA | `POST /api/incidents/:id/status` |

---

## 🗂️ Evaluation Submission Checklist

| Item | Focus Domain | Status |
|---|---|---|
| ✅ GitHub Repository with Code | Aryan | ✅ Ready |
| ✅ Working Web App & Portals | Aryan | ✅ Live (Port 5174 / 5000) |
| ✅ 3D Visualizer & Urban Map Center | Aryan | ✅ Live |
| 🔲 Twilio & WhatsApp Gateway | Neil | 🔲 In Progress |
| 🔲 EmailJS Notification Gateway | Neil | 🔲 Ready for API Keys |
| 🔲 Figma UI/UX Prototype | Neil | 🔲 Guide Ready |
| 🔲 5-Slide PPT (NotebookLM) | Both | ✅ Content Prepared |
| ✅ Use Case Documentation & Diagrams | Neil / Aryan | ✅ Documented |
