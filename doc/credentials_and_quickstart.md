# MediRoute — Credentials & Quickstart Guide

## 🔐 Pre-Configured Demo Credentials

The backend automatically provisions these default demo accounts if they are not already in your MongoDB database. You can also use the **"1-Click Demo Evaluation Portals"** buttons directly on the login page (`http://localhost:5174/login`)!

| Role | Email | Password | Assigned Portal URL | Purpose / Focus |
|---|---|---|---|---|
| **Admin** | `admin@mediroute.com` | `admin123` | `/admin` | City-wide 3D GIS Map, Fleet status, Surge forecast |
| **Paramedic** | `paramedic@mediroute.com` | `paramedic123` | `/paramedic` | Dispatch alerts, 3D turn-by-turn navigation, Vitals telemetry |
| **Hospital Staff** | `hospital@mediroute.com` | `hospital123` | `/hospital` | Inbound patient triage, bed reservation, ICU capacity |
| **Patient** | `patient@mediroute.com` | `patient123` | `/patient` | 1-tap SOS trigger, AI Voice triage, Live ambulance tracker |

---

## 🚀 Quickstart: Running Locally

### 1. Start Node.js Backend
```bash
cd server
npm install
npm run dev
# Server starts on http://localhost:5000
```

### 2. Start React Frontend
```bash
cd client
npm install
npm run dev
# Vite dev server starts on http://localhost:5174
```

### 3. Accessing the Web Application
Open your browser to:
**`http://localhost:5174`**

---

## 🎯 How to Test Each Role End-to-End

### 1. Admin & City Operations Testing (`/admin`)
1. Go to `http://localhost:5174/login` and click **"Admin"** (or enter `admin@mediroute.com` / `admin123`).
2. Click **"Seed Data"** in the top navigation bar to populate sample Mumbai hospitals and ambulances.
3. Switch to **"City Map"**:
   - Test **3D Isometric View (55°)**
   - Test **3D Horizon View (75°)**
   - Test **Tactical 2D View (0°)**
   - Test **360° Orbit Mode**
   - Click **"Nearest Ambulance"** or **"Active Emergency"** to auto-fly the camera!
4. Switch to **"Fleet"** to view real-time vehicle statuses.
5. Switch to **"Surge"** to view the 12-hour temporal forecasting curve.

### 2. Citizen Emergency SOS Testing (`/patient`)
1. Log in with **Patient** (`patient@mediroute.com` / `patient123`).
2. Click the pulsing **"SOS"** emergency button.
3. Observe browser geolocation acquisition and instant incident logging.
4. Try the **"AI Voice Triage"** modal to test speech-to-text triage.
5. Switch to **"Track"** tab to see live ambulance routing to your location.

### 3. Paramedic Field Navigation Testing (`/paramedic`)
1. Log in with **Paramedic** (`paramedic@mediroute.com` / `paramedic123`).
2. View the incoming emergency dispatch card.
3. Check the **"Navigate"** tab to view the illuminated 3D route and turn-by-turn directions.
4. Open the **"Vitals"** panel, enter patient vitals (Heart Rate, SpO2, BP), and click **"Transmit Vitals"** — watch it stream in real time to the Hospital ER!

### 4. Hospital ER Trauma Bay Testing (`/hospital`)
1. Log in with **Hospital Staff** (`hospital@mediroute.com` / `hospital123`).
2. See active inbound patient cards updating live via WebSocket.
3. Click **"Pre-Accept"** to immediately reserve a trauma bay with zero wait time.
4. Manage ICU/Trauma bed counts in the **"Resources"** tab.
