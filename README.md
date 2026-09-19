# MediRoute 🚑⚡
### Next-Gen Intelligent Emergency Response & Dynamic Hospital Allocation System
> Powered by MERN Stack, Multi-Agent AI Ecosystem, Three.js 3D Visualizer & Mapbox GL 3D Digital Twin

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Stack](https://img.shields.io/badge/Stack-MERN%20+%20Three.js%20+%20Mapbox-00F5FF)](https://github.com/Aryan-lomte05/MediRoute)
[![AI Engine](https://img.shields.io/badge/AI-Groq%20Llama%203.1%2070B-FF2D4A)](https://groq.com)
[![Evaluation](https://img.shields.io/badge/Evaluation-Mini%20Project%20(Max%2010M)-7C3AED)]()

---

## 🌟 Executive Summary

Emergency Medical Services (EMS) globally face critical bottlenecks due to fragmented communication, static vehicle routing, lack of real-time hospital bed visibility, and manual emergency triage. This results in delayed response times and high mortality rates during the **"Golden Hour"**.

**MediRoute** automates the entire emergency lifecycle:
1. **Intake & Triage**: 1-tap SOS, voice intake via Groq Whisper & clinical triage via Groq Llama 3.1 70B assigning ESI 1–5 triage levels within 3 seconds.
2. **Intelligent Dispatch**: Geospatial proximity engine finding the closest available Advanced/Basic Life Support ambulance.
3. **Dynamic Hospital Allocation**: Mixed Integer Linear Programming (MILP) algorithm matching patients to hospitals based on travel ETA, ER wait time, and required clinical specialties (e.g. Cath Lab, Trauma 1).
4. **Green Corridor Routing**: OSRM road network routing with live traffic simulation.
5. **Zero-Wait Handover**: Hospital trauma desks receive live telemetry before the ambulance arrives, pre-reserving beds and mobilizing doctors.

---

## 🔐 1-Click Demo Evaluation Credentials

When you launch the web application at `http://localhost:5174/login`, you can either click any of the **1-Click Demo Evaluation Portals** buttons or use the credentials below:

| Role | Email | Password | Dedicated Portal | Focus / Features |
|---|---|---|---|---|
| **Admin / Dispatcher** | `admin@mediroute.com` | `admin123` | `/admin` | City Operations 3D Map, Camera HUD, Fleet status, Surge forecast |
| **Paramedic / EMT** | `paramedic@mediroute.com` | `paramedic123` | `/paramedic` | Real-time dispatch, 3D turn-by-turn navigation, Vitals telemetry stream |
| **Hospital ER Staff** | `hospital@mediroute.com` | `hospital123` | `/hospital` | Live inbound ambulance feed, Pre-accept & zero-wait bed reservation |
| **Citizen / Patient** | `patient@mediroute.com` | `patient123` | `/patient` | 1-Tap SOS trigger, AI Voice triage, Live ambulance tracker |

---

## 🚀 Quickstart Guide

### Prerequisites
- Node.js (v18+)
- MongoDB Atlas connection string (pre-configured in `server/.env`)

### 1. Start Server (Backend)
```bash
cd server
npm install
npm run dev
# Running on http://localhost:5000
```

### 2. Start Client (Frontend)
```bash
cd client
npm install
npm run dev
# Running on http://localhost:5174
```

### 3. Open Web App
Open [http://localhost:5174](http://localhost:5174) in your browser.

---

## 🗺️ 3D City Operations Command Center

The Admin Portal features a full-screen 3D GIS vector digital twin powered by Mapbox GL JS:
- **📐 3D Isometric View (55°)**: Angled aerial perspective showing 3D building heights.
- **🌆 3D Horizon View (75°)**: Low-angle skyline perspective.
- **🧭 Tactical 2D View (0°)**: Orthographic dispatch view for tactical city routing.
- **🔄 360° Orbit Mode**: Continuous cinematic rotation around active emergency corridors.
- **🎯 Quick Focus Buttons**: Instant camera fly-to for City Center, Nearest Ambulance, or Active Emergencies.

---

## 📂 Documentation Library (`/doc`)

Detailed technical documentation and submission deliverables are located in the [`doc/`](./doc) folder:

| Document | Description |
|---|---|
| 📄 [`doc/team_division.md`](./doc/team_division.md) | Collaborative architecture matrix and team milestone roadmap |
| 📄 [`doc/use_cases.md`](./doc/use_cases.md) | Software engineering use case specifications with Mermaid diagrams |
| 📄 [`doc/figma_guide.md`](./doc/figma_guide.md) | Step-by-step 12-screen UI/UX Figma prototype creation guide |
| 📄 [`doc/notebooklm_ppt_context.md`](./doc/notebooklm_ppt_context.md) | Rich context document for generating 5-slide PPT with speaker notes |
| 📄 [`doc/project_documentation.md`](./doc/project_documentation.md) | Full technical specification, REST APIs, Schemas, and WebSocket events |
| 📄 [`doc/ui_design_prompts.md`](./doc/ui_design_prompts.md) | ChatGPT prompt engineering system for AI image & UI generation |
| 📄 [`doc/credentials_and_quickstart.md`](./doc/credentials_and_quickstart.md) | Step-by-step evaluation guide and role walkthrough |
| 📄 [`doc/walkthrough.md`](./doc/walkthrough.md) | System deployment verification and live feature check |

---

## 👥 Collaborative Team Ownership

| System Layer | Primary Modules | Focus Areas |
|---|---|---|
| **Core Architecture & Platform** | Aryan | MERN Stack, 3D Globe, 3D GIS Mapbox Center, AI Triage & Allocation, 4 Portals |
| **Emergency Communications** | Neil | Twilio WhatsApp Bot, Twilio Voice IVR, Whisper STT, EmailJS Alerts, Figma Prototype |

---

## 🛡️ License
Licensed under the MIT License.
