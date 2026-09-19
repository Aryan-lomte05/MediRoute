# MediRoute — Project Walkthrough & System Verification ✅

## Live Application Status

| Service | Status | URL |
|---|---|---|
| **React Frontend (Vite)** | ✅ Running | http://localhost:5174 |
| **Node.js Backend (Express)** | ✅ Running | http://localhost:5000 |
| **MongoDB Atlas** | ✅ Connected | `cluster0.d2tz6gj.mongodb.net` |
| **Real-Time WebSockets** | ✅ Active | Socket.io on port 5000 |

---

## 🔐 Instant Demo Credentials

Use these credentials or click the **1-Click Demo Evaluation Portals** buttons on the login screen (`http://localhost:5174/login`):

| Role | Email | Password | URL |
|---|---|---|---|
| **Admin** | `admin@mediroute.com` | `admin123` | `/admin` |
| **Paramedic** | `paramedic@mediroute.com` | `paramedic123` | `/paramedic` |
| **Hospital ER** | `hospital@mediroute.com` | `hospital123` | `/hospital` |
| **Patient / Citizen** | `patient@mediroute.com` | `patient123` | `/patient` |

---

## What Was Verified ✅

- [x] **3D Command Globe**: Three.js & React Three Fiber renders smooth interactive globe with rotating orbit rings and particle field.
- [x] **3D City Map (Admin Portal)**: Mapbox GL 3D vector map with extruded buildings, multi-angle camera HUD (Isometric 55°, Horizon 75°, Tactical 2D 0°, 360° Orbit Mode).
- [x] **Fleet & Incident Integration**: Real-time ambulance tracking markers, hospital pins with ICU capacity badges, and pulsing ESI emergency pins.
- [x] **1-Click Authentication**: Instant demo login presets auto-provision accounts directly into MongoDB Atlas.
- [x] **AI Clinical Triage**: Groq Llama 3.1 70B evaluates emergency descriptions and assigns ESI 1–5 triage scores.
- [x] **MILP Hospital Allocation**: Multi-objective algorithm weights travel ETA, ER queue wait time, and clinical specialty match.
- [x] **Progressive Web App**: Web manifest and PWA mobile configuration in place for field use.
- [x] **EmailJS Alert Gateway**: Emergency dispatch notifications prepared for critical trauma incidents.

---

## Complete Documentation Index

All project documentation is located in the [`doc/`](./) directory:

1. [`team_division.md`](./team_division.md) — Collaborative architecture and module ownership matrix.
2. [`use_cases.md`](./use_cases.md) — Comprehensive use case diagram and 12 detailed use cases.
3. [`figma_guide.md`](./figma_guide.md) — 12-screen UI/UX prototype guide with design system.
4. [`notebooklm_ppt_context.md`](./notebooklm_ppt_context.md) — NotebookLM context for generating 5-slide PPT.
5. [`project_documentation.md`](./project_documentation.md) — Full technical architecture and system specifications.
6. [`ui_design_prompts.md`](./ui_design_prompts.md) — ChatGPT prompt engineering system for AI UI image generation.
7. [`credentials_and_quickstart.md`](./credentials_and_quickstart.md) — Login credentials and role-by-role test guide.
