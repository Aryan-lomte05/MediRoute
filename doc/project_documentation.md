# MediRoute — Technical Project Documentation
### Next-Gen Intelligent Emergency Response & Dynamic Hospital Allocation System
**Academic Year:** 2026 | **Evaluation:** Mini Project (Max 10 Marks)

---

## 1. Project Overview

### 1.1 Problem Statement
Emergency Medical Services (EMS) globally suffer from four critical bottlenecks:
1. **Fragmented communication** between patients, paramedics, and hospitals
2. **Static vehicle routing** that ignores live traffic conditions
3. **No real-time hospital bed visibility** during active dispatch
4. **Manual emergency triage** — slow, inconsistent, and error-prone

These bottlenecks cause delayed response times, ambulances arriving at overcrowded hospitals, and high mortality rates during the critical **"Golden Hour"** — the first 60 minutes after a traumatic injury.

### 1.2 Solution
**MediRoute** is an end-to-end, real-time emergency response platform built on the **MERN Stack** (MongoDB, Express, React, Node.js) with a multi-agent AI ecosystem that:
- Automates emergency intake via AI voice/text triage
- Dynamically routes ambulances using live traffic data
- Optimizes patient-to-hospital allocation through multi-objective AI algorithms
- Provides zero-wait ER handover by pre-reserving beds before ambulance arrival

### 1.3 Key Metrics (Target)
| Metric | Traditional EMS | MediRoute Target |
|---|---|---|
| Average dispatch time | 4–8 minutes | **< 8 seconds** |
| AI triage accuracy | Manual (~70%) | **94%** |
| Hospital allocation time | Manual | **< 3 seconds** |
| Expected mortality reduction | Baseline | **37%** |

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│           React.js PWA (4 Role-Based Portals)               │
│   Patient │ Paramedic │ Hospital ER │ Admin Analytics       │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST API + WebSocket (Socket.io)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│            Node.js / Express.js API Gateway                 │
│    Auth (JWT/RBAC) │ BullMQ Jobs │ Socket Orchestration     │
└────────────┬────────────────────────┬───────────────────────┘
             │                        │
    ┌────────▼──────┐        ┌────────▼────────┐
    │  MongoDB Atlas │        │  Redis Cache    │
    │ Geospatial 2D  │        │  GPS Locations  │
    │ sphere indexes │        │  Socket State   │
    └───────────────┘        └─────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│              AI Services (Node.js + Groq API)               │
│  Triage LLM │ MILP Allocation │ OSRM Routing │ Forecasting  │
└─────────────────────────────────────────────────────────────┘
             │                        │
    ┌────────▼──────┐        ┌────────▼────────┐
    │  Twilio Layer  │        │  Mapbox GL JS   │
    │ WhatsApp Bot   │        │  3D Map Render  │
    │ Voice Calling  │        │  OSRM Routing   │
    └───────────────┘        └─────────────────┘
```

---

## 3. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React 18 + Vite | PWA with offline capability |
| 3D Visualization | Three.js + React Three Fiber | 3D globe on landing page |
| Mapping | Mapbox GL JS | Real-time vehicle tracking, 3D buildings |
| Styling | Tailwind CSS | Utility-first dark cyberpunk UI |
| Animations | Framer Motion + GSAP | Cinematic transitions and scroll effects |
| State Management | Zustand | Lightweight global state |
| Backend | Node.js + Express.js | REST API gateway |
| Real-Time | Socket.io | WebSocket for GPS, vitals, status updates |
| Database | MongoDB Atlas | Geospatial incident/hospital/ambulance data |
| Cache | Redis | Active GPS positions, socket state |
| Job Queue | BullMQ | Async AI triage + dispatch jobs |
| AI LLM | Groq API (Llama 3.1 70B) | Free-tier NLP triage agent |
| STT | Groq Whisper + Web Speech API | Voice-to-text for emergency calls |
| Routing | OSRM Public API | Open-source real-time routing |
| Notifications | EmailJS | Real-time emergency dispatch alerts |
| Communication | Twilio | WhatsApp bot + emergency voice calls |
| Auth | JWT + bcrypt | Secure RBAC authentication |

---

## 4. AI Engine Modules

### Module A — AI Voice Triage Agent
**What it does:** Converts emergency speech/text into a structured clinical assessment within 3 seconds.

**How it works:**
1. Patient speaks or types their emergency
2. Browser's Web Speech API OR Groq Whisper API transcribes audio → text
3. Prompt sent to **Groq Llama 3.1 70B** (free tier)
4. LLM extracts: chief complaint, age, consciousness, bleeding severity, respiratory status
5. Returns **ESI 1–5 score** (Emergency Severity Index) + required specialties + confidence

**ESI Levels:**
- ESI 1: Immediate life threat (cardiac arrest, major trauma)
- ESI 2: High risk / severe pain (chest pain, altered consciousness)
- ESI 3: Multiple resources needed (fractures, lacerations)
- ESI 4: One resource needed (minor wounds)
- ESI 5: No resources (prescription refill)

---

### Module B — Multi-Objective Hospital Allocation Engine
**What it does:** Ranks all nearby hospitals using a weighted optimization formula.

**Formula:**
```
Minimize Z = w1·Ttravel + w2·Twait + w3·(1 − Smedical) − w4·Ccapacity
Where:
  Ttravel   = Real-time travel ETA (OSRM)
  Twait     = Hospital ER queue wait time
  Smedical  = Specialty match score (e.g., patient needs Cardiac Cath Lab)
  Ccapacity = Available ICU/trauma beds and ventilators
  Weights   = [0.35, 0.30, 0.25, 0.10]
```

**How it works:**
1. Geospatial query finds all hospitals within 30km
2. For each hospital, LLM calculates weighted score
3. Returns ranked list with clinical rationale
4. Top hospital auto-allocated; paramedic notified

---

### Module C — Dynamic Green-Corridor Route Optimizer
**What it does:** Finds the fastest, congestion-avoiding route for the ambulance.

**How it works:**
1. OSRM Public API calculates traffic-aware route (driving profile)
2. Route geometry (GeoJSON LineString) returned with ETA
3. Route rendered as glowing animated line on Mapbox GL map
4. En-route: monitors GPS position, re-routes if deviation detected

---

### Module D — Surge Capacity Forecasting
**What it does:** Predicts hospital patient load 6–24 hours ahead.

**How it works:**
1. Sinusoidal time-series model simulates realistic demand patterns
2. Identifies HIGH/MEDIUM/LOW risk hours
3. Admin portal shows 12-hour surge forecast chart (Area chart)
4. Hospitals can pre-staff based on predicted surge

---

## 5. Database Schemas

### 5.1 Incident Schema (MongoDB)
```json
{
  "incidentNumber": "INC-20260919-0001",
  "patient": "ObjectId → User",
  "patientDetails": {
    "name": "Jane Doe", "age": 45, "bloodType": "O+",
    "allergies": ["Penicillin"], "conditions": ["Hypertension"]
  },
  "triageData": {
    "esiLevel": 2,
    "chiefComplaint": "Acute chest pain radiating to left arm",
    "aiSummary": "High-risk cardiac event. Immediate Cath Lab required.",
    "aiConfidence": 0.94,
    "requiredSpecialties": ["CARDIAC_CATH_LAB"],
    "vitals": {
      "heartRate": 118, "spO2": 92,
      "respiratoryRate": 24, "gcsScore": 15
    }
  },
  "location": { "type": "Point", "coordinates": [72.8777, 19.076] },
  "assignedAmbulance": "ObjectId → Ambulance",
  "allocatedHospital": "ObjectId → Hospital",
  "status": "EN_ROUTE_TO_HOSPITAL",
  "timestamps": {
    "created": "2026-09-19T15:30:00Z",
    "dispatched": "2026-09-19T15:30:08Z",
    "pickedUp": "2026-09-19T15:38:12Z",
    "estimatedArrival": "2026-09-19T15:49:00Z"
  }
}
```

### 5.2 Hospital Schema (MongoDB)
```json
{
  "name": "City General Trauma Center",
  "location": { "type": "Point", "coordinates": [72.882, 19.082] },
  "capabilities": ["CARDIAC_CATH_LAB", "STROKE_CENTER", "LEVEL_1_TRAUMA"],
  "resources": {
    "icuBeds": { "total": 20, "available": 3 },
    "traumaBeds": { "total": 10, "available": 1 },
    "ventilators": { "total": 15, "available": 4 }
  },
  "queueStatus": { "erWaitTimeMinutes": 12, "diversionStatus": false }
}
```

### 5.3 Ambulance Schema (MongoDB)
```json
{
  "vehicleNumber": "MH-AMB-001",
  "vehicleType": "ADVANCED_LIFE_SUPPORT",
  "currentLocation": { "type": "Point", "coordinates": [72.86, 19.07] },
  "status": "EN_ROUTE_TO_PATIENT",
  "assignedParamedic": "ObjectId → User",
  "currentIncident": "ObjectId → Incident"
}
```

---

## 6. API Endpoints

### Authentication
| Method | Endpoint | Description | Role |
|---|---|---|---|
| POST | `/api/auth/register` | Register new user | Public |
| POST | `/api/auth/login` | Login → JWT token (supports auto demo) | Public |
| GET | `/api/auth/me` | Get current user | All |
| PATCH | `/api/auth/profile` | Update profile | All |

### Incidents
| Method | Endpoint | Description | Role |
|---|---|---|---|
| POST | `/api/incidents` | Create emergency SOS | Patient |
| GET | `/api/incidents` | List incidents (filtered) | All |
| GET | `/api/incidents/:id` | Get incident details | All |
| PATCH | `/api/incidents/:id/status` | Update status + vitals | Paramedic, Hospital |
| POST | `/api/incidents/:id/allocate` | Trigger AI hospital allocation | Admin, Paramedic |
| GET | `/api/incidents/stats/summary` | System-wide stats | Admin |

### Hospitals
| Method | Endpoint | Description | Role |
|---|---|---|---|
| GET | `/api/hospitals` | List (with geo filter) | All |
| POST | `/api/hospitals` | Create hospital | Admin |
| POST | `/api/hospitals/seed` | Seed Mumbai hospitals | Admin |
| PATCH | `/api/hospitals/:id/resources` | Update bed counts | Hospital Staff |
| PATCH | `/api/hospitals/:id/diversion` | Toggle diversion | Hospital Staff |

### Ambulances
| Method | Endpoint | Description | Role |
|---|---|---|---|
| GET | `/api/ambulances` | List ambulances | All |
| POST | `/api/ambulances/seed` | Seed Mumbai ambulances | Admin |
| PATCH | `/api/ambulances/:id/location` | Update GPS | Paramedic |
| PATCH | `/api/ambulances/:id/status` | Update status | Paramedic |

---

## 7. Real-Time WebSocket Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `gps_update` | Client→Server | `{ambulanceId, coordinates, heading, speed}` | Paramedic broadcasts GPS |
| `ambulance_location` | Server→Client | `{ambulanceId, coordinates}` | Broadcast to patient + hospital + admin |
| `new_incident` | Server→Client | `incident` | New SOS to hospital + admin |
| `triage_complete` | Server→Client | `{incidentId, esiLevel, aiSummary}` | AI triage result ready |
| `dispatch_alert` | Server→Client | `{incidentId, incident}` | Dispatch notification to paramedic |
| `incident_status` | Server→Client | `{incidentId, status}` | Status change broadcast |
| `vitals_update` | Client→Server | `{incidentId, vitals}` | Paramedic sends vitals to hospital |
| `resource_update` | Client→Server | `{hospitalId, resources}` | Hospital updates bed counts |
