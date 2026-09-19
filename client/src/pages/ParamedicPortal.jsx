import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { getSocket } from '../lib/socket'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'
import toast from 'react-hot-toast'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

export default function ParamedicPortal() {
  const { user, logout } = useAuthStore()

  // Live Clock State
  const [currentTime, setCurrentTime] = useState('20:24')
  const [currentDate, setCurrentDate] = useState('Thu, 19 Sep 2026')

  // Map & Navigation State
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const [mapMode, setMapMode] = useState('3D') // '3D' | '2D'
  const [etaMinutes, setEtaMinutes] = useState('06:45')
  const [distanceKm, setDistanceKm] = useState('3.2')
  const [ambulanceSpeed, setAmbulanceSpeed] = useState(76)

  // Patient & Clinical State
  const [patientVitals, setPatientVitals] = useState({
    heartRate: 118,
    bpSystolic: 85,
    bpDiastolic: 55,
    spO2: 92,
    gcs: 13,
  })
  const [activeChecklist, setActiveChecklist] = useState([
    { id: 1, text: "Administer 500 mL IV crystalloid bolus (e.g. Ringer's Lactate / NS)", done: true },
    { id: 2, text: 'Apply oxygen via non-rebreather mask (15 L/min)', done: true },
    { id: 3, text: 'Control external bleeding, consider tourniquet if needed', done: false },
    { id: 4, text: 'Prep trauma bay for surgical handoff (activate trauma team)', done: false },
  ])

  // Dispatch & Workflow Status
  const [dispatchStatus, setDispatchStatus] = useState('EN_ROUTE_TO_HOSPITAL') // 'DISPATCHED' | 'AT_PATIENT' | 'EN_ROUTE_TO_HOSPITAL' | 'COMPLETED'
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [voiceNotes, setVoiceNotes] = useState([
    'Patient has blunt abdominal trauma with suspected splenic laceration. IV access secured at left antecubital fossa.',
  ])
  const [activeModal, setActiveModal] = useState(null) // 'protocol' | 'drugs' | 'airway' | 'checklist'

  // Digital Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setCurrentTime(now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }))
      setCurrentDate('Thu, 19 Sep 2026')
    }
    updateTime()
    const timer = setInterval(updateTime, 1000)
    return () => clearInterval(timer)
  }, [])

  // Vital Signs Micro-fluctuation for Realism
  useEffect(() => {
    const interval = setInterval(() => {
      setPatientVitals((prev) => ({
        ...prev,
        heartRate: Math.max(110, Math.min(126, prev.heartRate + (Math.floor(Math.random() * 5) - 2))),
        spO2: Math.max(90, Math.min(95, prev.spO2 + (Math.floor(Math.random() * 3) - 1))),
      }))
    }, 3500)
    return () => clearInterval(interval)
  }, [])

  // Live Mapbox Initialization
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    // Centered along Western Express Highway corridor towards Lilavati Hospital Bandra
    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [72.838, 19.042],
      zoom: 13.6,
      pitch: 58,
      bearing: -25,
      antialias: true,
    })

    map.on('load', () => {
      // 3D Building Extrusions
      map.addLayer({
        id: '3d-buildings',
        source: 'composite',
        'source-layer': 'building',
        filter: ['==', 'extrude', 'true'],
        type: 'fill-extrusion',
        minzoom: 12,
        paint: {
          'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['get', 'height'],
            0, '#0d111d',
            40, '#131b2e',
            120, '#1c2847',
            250, '#2b3b68',
          ],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': ['get', 'min_height'],
          'fill-extrusion-opacity': 0.88,
        },
      })

      // Active Green Corridor Priority Route
      map.addSource('paramedic-corridor', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [72.848, 19.022], // Start / Accident origin (Dadar / WEH)
              [72.842, 19.034], // Ambulance current position
              [72.835, 19.046], // Highway junction
              [72.828, 19.052], // Lilavati Trauma Center (Bandra West)
            ],
          },
        },
      })

      // Route Glow
      map.addLayer({
        id: 'corridor-glow',
        type: 'line',
        source: 'paramedic-corridor',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#10B981',
          'line-width': 10,
          'line-opacity': 0.5,
          'line-blur': 4,
        },
      })

      // Route Core Line
      map.addLayer({
        id: 'corridor-core',
        type: 'line',
        source: 'paramedic-corridor',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#00F5FF',
          'line-width': 4,
          'line-opacity': 1,
        },
      })

      // Live Markers:
      // 1. Lilavati Trauma Center Destination
      const hospEl = document.createElement('div')
      hospEl.innerHTML = `
        <div class="px-2.5 py-1.5 rounded-lg bg-[#071324]/95 border border-cyan-400 text-[10px] font-mono shadow-[0_0_25px_rgba(0,245,255,0.7)] flex items-center gap-1.5 cursor-pointer hover:scale-105 transition-transform">
          <span class="w-4 h-4 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-[9px] shadow-[0_0_8px_#3b82f6]">H</span>
          <div>
            <div class="text-cyan-300 font-bold leading-tight">Lilavati Trauma Center</div>
            <div class="text-emerald-400 text-[8px] font-semibold">ETA 6 min · Bay 03</div>
          </div>
        </div>
      `
      new mapboxgl.Marker({ element: hospEl, anchor: 'center' })
        .setLngLat([72.828, 19.052])
        .addTo(map)

      // 2. Ambulance Current Unit EMS-104
      const ambEl = document.createElement('div')
      ambEl.innerHTML = `
        <div class="relative flex items-center justify-center cursor-pointer">
          <span class="absolute -inset-3 rounded-full bg-cyan-500/30 animate-ping"></span>
          <div class="px-2.5 py-1.5 rounded-lg bg-[#061424]/95 border-2 border-cyan-400 text-[9px] font-mono shadow-[0_0_25px_rgba(0,245,255,0.8)] flex items-center gap-1.5">
            <span class="text-sm">🚑</span>
            <div>
              <div class="text-cyan-300 font-bold leading-tight">EMS-104</div>
              <div class="text-emerald-400 text-[8px] font-bold">76 km/h</div>
            </div>
          </div>
        </div>
      `
      new mapboxgl.Marker({ element: ambEl, anchor: 'center' })
        .setLngLat([72.842, 19.034])
        .addTo(map)

      // 3. Accident Origin Marker
      const accEl = document.createElement('div')
      accEl.innerHTML = `
        <div class="px-2 py-1 rounded bg-[#15090e]/90 border border-red-500/70 text-[9px] font-mono text-left shadow-lg">
          <div class="text-red-400 font-bold">Accident</div>
          <div class="text-white/60 text-[8px]">2.1 km ahead (Cleared)</div>
        </div>
      `
      new mapboxgl.Marker({ element: accEl, anchor: 'center' })
        .setLngLat([72.848, 19.022])
        .addTo(map)

      // 4. Green Corridor Badge on Route
      const routeBadgeEl = document.createElement('div')
      routeBadgeEl.innerHTML = `
        <div class="px-2.5 py-1 rounded bg-emerald-950/90 border border-emerald-500/60 shadow-[0_0_20px_rgba(16,185,129,0.5)] text-[9px] font-mono text-emerald-300 font-bold">
          Green Corridor · Signals Synchronized
        </div>
      `
      new mapboxgl.Marker({ element: routeBadgeEl, anchor: 'center' })
        .setLngLat([72.836, 19.044])
        .addTo(map)
    })

    mapInstanceRef.current = map

    return () => {
      map.remove()
      mapInstanceRef.current = null
    }
  }, [])

  // Toggle 3D / 2D Camera
  const toggle3D = (mode) => {
    setMapMode(mode)
    if (!mapInstanceRef.current) return
    if (mode === '3D') {
      mapInstanceRef.current.easeTo({ pitch: 58, bearing: -25, zoom: 13.6, duration: 1000 })
    } else {
      mapInstanceRef.current.easeTo({ pitch: 0, bearing: 0, zoom: 13.0, duration: 1000 })
    }
  }

  // Recenter Map on Ambulance
  const recenter = () => {
    if (!mapInstanceRef.current) return
    mapInstanceRef.current.flyTo({ center: [72.842, 19.034], zoom: 14.5, pitch: 58, duration: 1000 })
    toast('Navigation recentered on EMS-104', { icon: '📍' })
  }

  // Action: Transmit Vitals
  const transmitVitals = () => {
    const socket = getSocket()
    socket.emit('vital_stream', {
      ambulanceId: 'EMS-104',
      vitals: patientVitals,
      incidentId: 'INC-7842',
      timestamp: new Date().toISOString(),
    })
    toast.success('Live vitals telemetry synchronized with Lilavati Trauma Bay 03!')
  }

  // Action: Voice Log with Whisper STT Simulation
  const handleVoiceLog = () => {
    if (!isRecordingVoice) {
      setIsRecordingVoice(true)
      toast('Listening to paramedic voice note via Whisper...', { icon: '🎙️' })
      setTimeout(() => {
        setIsRecordingVoice(false)
        const newNote = `[${currentTime}] Normal saline bolus running wide open. GCS reassessed at 13. Airway patent.`
        setVoiceNotes((prev) => [newNote, ...prev])
        toast.success('Whisper STT: Voice note transcribed & synced to medical chart!')
      }, 3500)
    }
  }

  // Action: Arrived at Patient
  const handleArrived = () => {
    setDispatchStatus('AT_PATIENT')
    toast.success('Status updated: Arrived at Patient (Care timeline active)')
  }

  // Action: Handed over to ER
  const handleHandedOver = () => {
    setDispatchStatus('COMPLETED')
    toast.success('Incident completed: Patient successfully handed to Lilavati Trauma Team!')
  }

  return (
    <div className="min-h-screen bg-[#06080e] text-white flex flex-col font-sans select-none overflow-x-hidden">
      {/* ── TOP COCKPIT STATUS BAR ── */}
      <header className="h-14 border-b border-white/[0.08] bg-[#07090e]/95 backdrop-blur-md px-5 flex items-center justify-between z-40 shrink-0">
        {/* Left: Brand + Realtime Sync Status */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => window.location.href = '/'}>
            <svg className="w-6 h-6 text-[#FF2D4A]" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth={2.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M0 6h6l2.5-6 4 12 2.5-6h9" />
            </svg>
            <div>
              <div className="font-extrabold text-base tracking-tight text-white flex items-center">
                Medi<span className="text-[#FF2D4A]">Route</span>
              </div>
              <div className="text-[9px] font-mono text-white/50 -mt-1 uppercase tracking-widest font-semibold">
                PARAMEDIC FIELD HUD
              </div>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full border border-emerald-500/20 bg-emerald-950/20 text-emerald-400 text-[11px] font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#10b981]" />
            <span>Online</span>
            <span className="text-white/30 text-[9px]">· Syncing in real-time</span>
          </div>
        </div>

        {/* Center: Real-time Date & Time */}
        <div className="hidden md:flex items-center gap-2 text-xs font-mono text-white/80">
          <span className="font-bold text-white text-sm">{currentTime}</span>
          <span className="text-white/30">|</span>
          <span className="text-white/60">{currentDate}</span>
        </div>

        {/* Right: GPS, 4G, Battery, Ambulance Unit ID */}
        <div className="flex items-center gap-3.5 text-xs font-mono">
          <div className="hidden sm:flex items-center gap-3 text-white/60 text-[11px]">
            <span className="flex items-center gap-1 text-emerald-400">GPS 📶</span>
            <span className="flex items-center gap-1 text-cyan-400">4G 📶</span>
            <span className="flex items-center gap-1 text-emerald-400">🔋 87%</span>
          </div>

          <div className="flex items-center gap-2 px-3 py-1 rounded-lg border border-cyan-500/30 bg-cyan-950/20 text-cyan-300 font-semibold text-xs">
            <span className="text-sm">🚑</span>
            <div>
              <div>EMS-104</div>
              <div className="text-[8px] text-cyan-400/60 leading-none hidden sm:block">Advanced Life Support</div>
            </div>
          </div>

          <button
            onClick={logout}
            title="Logout"
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center text-sm transition-all"
          >
            ☰
          </button>
        </div>
      </header>

      {/* ── TOP HUD CARDS ROW (3 Cards: Hospital / Route / Alert) ── */}
      <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 shrink-0">
        {/* Card 1: Destination Hospital Card */}
        <div className="lg:col-span-5 p-3.5 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl flex items-center gap-4">
          <img
            src="/hospital-lilavati.jpg"
            alt="Lilavati Hospital Facade"
            className="w-16 h-16 rounded-xl object-cover border border-white/10 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider font-semibold">
              DESTINATION HOSPITAL
            </div>
            <div className="text-base font-extrabold text-white leading-tight truncate">
              Lilavati Trauma Center <span className="text-cyan-400 font-normal">— Bay 03</span>
            </div>
            <div className="text-xs text-white/50 leading-tight">Bandra (W), Mumbai</div>

            <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[9px] font-mono font-semibold">
              <span className="px-2 py-0.5 rounded bg-red-950/60 border border-red-500/40 text-red-300">
                Level 1 Trauma Center
              </span>
              <span className="px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/40 text-cyan-300">
                6 min ETA
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Trauma Team Notified
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Green Corridor Telemetry & Traffic Light */}
        <div className="lg:col-span-4 p-3.5 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl flex items-center justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-mono text-white/40 uppercase font-semibold">ETA</span>
              <span className="text-3xl font-extrabold text-emerald-400 font-mono tracking-tight">
                {etaMinutes} <span className="text-sm font-sans font-medium text-emerald-300/70">min</span>
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono text-white/60 mt-0.5">
              <span>Distance <strong className="text-white">{distanceKm} km</strong></span>
              <span>·</span>
              <span>Arrival: <strong className="text-white">20:31</strong></span>
            </div>

            <div className="flex items-center gap-2 mt-2">
              <div className="px-2.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] font-bold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#10b981]" />
                <span>Green Corridor ACTIVE</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400/80 flex items-center gap-1">
                <span>✓</span> Signals Synchronized
              </span>
            </div>
          </div>

          {/* Traffic Signal Visual */}
          <div className="w-10 py-2 rounded-xl bg-black/60 border border-white/15 flex flex-col items-center gap-2 shrink-0">
            <div className="w-4 h-4 rounded-full bg-red-950/60 border border-red-900/40" />
            <div className="w-4 h-4 rounded-full bg-yellow-950/60 border border-yellow-900/40" />
            <div className="w-4 h-4 rounded-full bg-emerald-400 border border-emerald-300 shadow-[0_0_12px_#10b981] animate-pulse" />
          </div>
        </div>

        {/* Card 3: Alert Hospital Emergency Button */}
        <div className="lg:col-span-3">
          <button
            onClick={() => {
              toast.error('🚨 Direct High-Priority Alert Broadcast to Lilavati Trauma Bay!')
            }}
            className="w-full h-full p-4 rounded-2xl bg-gradient-to-r from-[#8b1424] via-[#b5172e] to-[#8b1424] hover:from-[#b5172e] hover:to-[#c91a33] border border-red-500/50 shadow-[0_0_30px_rgba(255,45,74,0.35)] flex items-center justify-center gap-3 text-left transition-all group"
          >
            <span className="text-3xl group-hover:scale-110 transition-transform">((•))</span>
            <div>
              <div className="text-base font-extrabold text-white leading-tight">
                Alert Hospital
              </div>
              <div className="text-[11px] text-white/80 font-mono">
                Vitals & ETA shared
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* ── TURN-BY-TURN NAVIGATION INSTRUCTION BAR ── */}
      <div className="mx-4 mb-3 px-4 py-2.5 rounded-xl bg-[#0a0f1d] border border-cyan-500/30 shadow-lg flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3.5">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300 text-xl font-bold shrink-0">
            ↰
          </div>
          <div>
            <div className="text-sm font-extrabold text-white leading-tight">
              In 300 m, keep left on Western Express Flyover
            </div>
            <div className="text-[11px] text-emerald-400 font-mono leading-tight">
              Corridor Priority Open — All signals synchronized
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded bg-white/5 border border-white/10 font-mono text-xs">
            <span className="text-emerald-400 font-bold">↑ ↑ ↑</span>
            <span className="text-white font-semibold">300 m</span>
          </div>

          <button
            onClick={() => recenter()}
            className="px-3 py-1 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-mono text-white/80 transition-all flex items-center gap-1.5"
          >
            <span>View Full Route</span>
            <span>⤢</span>
          </button>
        </div>
      </div>

      {/* ── CENTER: LIVE 3D MAPBOX NAVIGATION ENGINE ── */}
      <div className="mx-4 h-[320px] lg:h-[380px] rounded-2xl overflow-hidden border border-white/[0.08] relative shadow-2xl shrink-0">
        {/* Mapbox Canvas */}
        <div ref={mapRef} className="w-full h-full" />

        {/* Map Left Controls HUD */}
        <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
          <div className="p-1 rounded-xl bg-[#090d16]/90 border border-white/10 shadow-xl backdrop-blur-md flex flex-col gap-1 text-xs font-mono">
            <button
              onClick={() => toggle3D('3D')}
              className={`px-2.5 py-1 rounded-lg transition-all font-bold ${
                mapMode === '3D' ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50' : 'text-white/60 hover:text-white'
              }`}
            >
              3D
            </button>
            <button
              onClick={() => toggle3D('2D')}
              className={`px-2.5 py-1 rounded-lg transition-all font-bold ${
                mapMode === '2D' ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50' : 'text-white/60 hover:text-white'
              }`}
            >
              2D
            </button>
          </div>

          <button
            onClick={() => recenter()}
            title="Recenter Camera"
            className="w-9 h-9 rounded-xl bg-[#090d16]/90 border border-white/10 hover:border-white/25 text-cyan-400 flex items-center justify-center shadow-xl backdrop-blur-md transition-all"
          >
            🎯
          </button>

          <button
            onClick={() => toast('GIS navigation layers toggled', { icon: '🗺️' })}
            title="Layers"
            className="w-9 h-9 rounded-xl bg-[#090d16]/90 border border-white/10 hover:border-white/25 text-white/60 hover:text-white flex items-center justify-center shadow-xl backdrop-blur-md transition-all"
          >
            ◫
          </button>
        </div>

        {/* Map Right Layer Toggles */}
        <div className="absolute top-4 right-4 z-20 hidden sm:flex flex-col gap-1.5 p-2 rounded-xl bg-[#090d16]/90 border border-white/10 shadow-xl backdrop-blur-md text-[10px] font-mono text-white/80">
          <div className="flex items-center gap-2 cursor-pointer hover:text-white">
            <span className="w-2.5 h-2.5 rounded bg-blue-500 text-[8px] flex items-center justify-center text-white font-bold">+</span>
            <span>Hospitals</span>
          </div>
          <div className="flex items-center gap-2 cursor-pointer hover:text-white">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 text-[8px] flex items-center justify-center text-white font-bold">!</span>
            <span>Incidents</span>
          </div>
          <div className="flex items-center gap-2 cursor-pointer hover:text-white">
            <span className="w-2.5 h-2.5 rounded bg-emerald-500" />
            <span>Traffic</span>
          </div>
          <div className="flex items-center gap-2 cursor-pointer hover:text-white">
            <span className="text-[10px]">🚑</span>
            <span>Ambulances</span>
          </div>
        </div>

        {/* Bottom Left Map Overlay */}
        <div className="absolute bottom-3 left-4 z-20 text-[10px] font-mono text-white/50">
          <span className="font-bold text-white text-xs">Mumbai</span> · Live Traffic (Emergency View)
        </div>
      </div>

      {/* ── LOWER SECTION: PATIENT VITALS & MEDIAI CLINICAL ASSISTANT ── */}
      <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1">
        {/* ── LEFT HALF: REAL-TIME PATIENT VITALS HUD (col-span-6) ── */}
        <div className="lg:col-span-6 p-4 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl flex flex-col justify-between">
          <div>
            {/* Header with ESI badge & Patient Demographics */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold tracking-wider text-white uppercase">
                  PATIENT VITALS
                </span>
                <span className="px-2 py-0.5 rounded bg-red-600/30 border border-red-500/50 text-red-400 font-mono text-[10px] font-bold">
                  ESI 1
                </span>
                <span className="text-xs text-white/50 font-medium">Trauma / Critical</span>
              </div>
              <div className="text-[11px] font-mono text-white/50 flex items-center gap-2">
                <span>👤 Male | ~32 yrs</span>
                <span>·</span>
                <span className="text-orange-400">RTA (High Impact)</span>
              </div>
            </div>

            {/* 4 Live Vitals Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              {/* Vital 1: Heart Rate */}
              <div className="p-3 rounded-xl bg-white/[0.02] border border-red-500/30">
                <div className="flex items-center justify-between text-[11px] font-mono text-white/40">
                  <span className="flex items-center gap-1 text-red-400 font-bold">❤️ Heart Rate</span>
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono mt-1">
                  {patientVitals.heartRate} <span className="text-xs font-normal text-white/50">BPM</span>
                </div>
                {/* SVG ECG Waveform */}
                <svg className="w-full h-6 text-red-500 mt-1" viewBox="0 0 100 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M0 12 h15 l3-8 4 16 4-12 3 4 h15 l3-8 4 16 4-12 3 4 h42" />
                </svg>
                <div className="text-[10px] font-mono text-white/30 mt-0.5">(60 - 100)</div>
              </div>

              {/* Vital 2: Blood Pressure */}
              <div className="p-3 rounded-xl bg-white/[0.02] border border-orange-500/30">
                <div className="flex items-center justify-between text-[11px] font-mono text-white/40">
                  <span className="flex items-center gap-1 text-orange-400 font-bold">🩺 Blood Pressure</span>
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-[#FF2D4A] font-mono mt-1 flex items-baseline gap-1">
                  <span>{patientVitals.bpSystolic}/{patientVitals.bpDiastolic}</span>
                  <span className="text-[10px] font-normal text-white/50">mmHg</span>
                </div>
                <div className="flex items-center gap-1 text-red-400 text-[10px] font-mono mt-2">
                  <span>⚠️ Hypotensive</span>
                </div>
                <div className="text-[10px] font-mono text-white/30 mt-1">(90/60 - 120/80)</div>
              </div>

              {/* Vital 3: SpO2 */}
              <div className="p-3 rounded-xl bg-white/[0.02] border border-cyan-500/30">
                <div className="flex items-center justify-between text-[11px] font-mono text-white/40">
                  <span className="flex items-center gap-1 text-cyan-400 font-bold">🫁 SpO₂</span>
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-cyan-300 font-mono mt-1">
                  {patientVitals.spO2}%
                </div>
                {/* SVG Respiratory Waveform */}
                <svg className="w-full h-6 text-cyan-400 mt-1" viewBox="0 0 100 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M0 12 Q25 0 50 12 T100 12" />
                </svg>
                <div className="text-[10px] font-mono text-white/30 mt-0.5">(&gt; 94%)</div>
              </div>

              {/* Vital 4: GCS Score */}
              <div className="p-3 rounded-xl bg-white/[0.02] border border-emerald-500/30">
                <div className="flex items-center justify-between text-[11px] font-mono text-white/40">
                  <span className="flex items-center gap-1 text-emerald-400 font-bold">🧠 GCS Score</span>
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono mt-1">
                  {patientVitals.gcs} <span className="text-xs font-normal text-white/40">/ 15</span>
                </div>
                {/* Segmented Color Bar */}
                <div className="flex gap-1 mt-2">
                  <div className="h-1.5 flex-1 rounded-full bg-emerald-500" />
                  <div className="h-1.5 flex-1 rounded-full bg-yellow-500" />
                  <div className="h-1.5 flex-1 rounded-full bg-white/20" />
                </div>
                <div className="text-[10px] font-mono text-white/40 mt-1">E3 V4 M6</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT HALF: MEDIAI CLINICAL ASSISTANT (col-span-6) ── */}
        <div className="lg:col-span-6 p-4 rounded-2xl bg-[#090d16]/90 border border-purple-500/30 shadow-xl flex flex-col justify-between">
          <div>
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <span className="text-purple-400 text-base">✨</span>
                <span className="text-xs font-mono font-bold tracking-wider text-white uppercase">
                  MediAI Clinical Assistant
                </span>
              </div>
              <div className="text-[10px] font-mono text-white/40">
                Based on patient vitals + mechanism of injury
              </div>
            </div>

            {/* Diagnostic Alert Banner */}
            <div className="mt-3 p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-left">
              <div className="flex items-center gap-2 text-red-300 font-bold text-xs">
                <span>🚨</span>
                <span>Suspected severe hemorrhagic shock.</span>
              </div>
              <div className="text-[11px] text-white/70 mt-0.5">
                Mechanism: High-impact RTA. Hypotension and tachycardia detected.
              </div>
            </div>

            {/* Recommended Protocol Checklist */}
            <div className="mt-3 space-y-1.5 text-left text-xs font-mono">
              <div className="text-[10px] font-mono uppercase text-white/40 font-semibold mb-1">
                Recommended Protocol:
              </div>
              {activeChecklist.map((item) => (
                <div
                  key={item.id}
                  onClick={() => {
                    setActiveChecklist((prev) =>
                      prev.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c))
                    )
                  }}
                  className="flex items-start gap-2.5 p-1.5 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
                >
                  <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] shrink-0 ${
                    item.done ? 'bg-emerald-500 text-black font-bold' : 'border border-white/30 text-white/50'
                  }`}>
                    {item.done ? '✓' : item.id}
                  </span>
                  <span className={`text-[11px] leading-tight ${item.done ? 'line-through text-white/40' : 'text-white/90'}`}>
                    {item.text}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Action Side Buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-white/[0.06] mt-3">
            <button
              onClick={() => toast('📋 Trauma Resuscitation Protocol Loaded', { icon: '📄' })}
              className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono text-white/80 transition-all flex items-center justify-center gap-1"
            >
              <span>📄</span>
              <span>View Protocol</span>
            </button>
            <button
              onClick={() => toast('💊 Pediatric & Adult Dosage Calculator Ready', { icon: '💉' })}
              className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono text-white/80 transition-all flex items-center justify-center gap-1"
            >
              <span>💉</span>
              <span>Drug Dosages</span>
            </button>
            <button
              onClick={() => toast('🫁 Rapid Sequence Intubation Checklist Loaded', { icon: '🫁' })}
              className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono text-white/80 transition-all flex items-center justify-center gap-1"
            >
              <span>🫁</span>
              <span>Airway Mgmt</span>
            </button>
            <button
              onClick={() => toast('📑 High-Impact RTA Assessment Verified', { icon: '📋' })}
              className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono text-white/80 transition-all flex items-center justify-center gap-1"
            >
              <span>📋</span>
              <span>RTA Checklist</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── BOTTOM ACTION DISPATCH CONTROLS DOCK ── */}
      <footer className="h-20 border-t border-white/[0.08] bg-[#07090e]/95 backdrop-blur-md px-5 py-2.5 z-40 shrink-0">
        <div className="h-full grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Button 1: Voice Log Notes (Whisper STT) */}
          <button
            onClick={handleVoiceLog}
            className={`h-full px-4 rounded-xl border flex items-center gap-3 transition-all ${
              isRecordingVoice
                ? 'bg-red-600/30 border-red-500 text-white animate-pulse'
                : 'bg-white/[0.03] hover:bg-white/[0.07] border-white/10 text-white'
            }`}
          >
            <span className="text-xl">🎙️</span>
            <div className="text-left">
              <div className="text-xs font-bold leading-tight">
                {isRecordingVoice ? 'Recording Audio...' : 'Voice Log Notes'}
              </div>
              <div className="text-[10px] text-white/50 font-mono">
                {isRecordingVoice ? 'Whisper transcribing' : 'Powered by Whisper STT'}
              </div>
            </div>
          </button>

          {/* Button 2: Transmit Vitals to ER */}
          <button
            onClick={transmitVitals}
            className="h-full px-4 rounded-xl bg-gradient-to-r from-[#941324] via-[#b5172e] to-[#941324] hover:from-[#b5172e] hover:to-[#c91a33] border border-red-500/50 shadow-[0_0_20px_rgba(255,45,74,0.3)] flex items-center gap-3 transition-all"
          >
            <span className="text-xl">☁️</span>
            <div className="text-left">
              <div className="text-xs font-bold leading-tight text-white">
                Transmit Vitals to ER
              </div>
              <div className="text-[10px] text-white/80 font-mono">
                Send live patient data
              </div>
            </div>
          </button>

          {/* Button 3: Arrived at Patient */}
          <button
            onClick={handleArrived}
            className={`h-full px-4 rounded-xl border flex items-center gap-3 transition-all ${
              dispatchStatus === 'AT_PATIENT'
                ? 'bg-emerald-600/30 border-emerald-400 text-emerald-300 font-bold shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                : 'bg-emerald-950/40 hover:bg-emerald-900/60 border-emerald-500/40 text-emerald-300'
            }`}
          >
            <span className="text-xl">✅</span>
            <div className="text-left">
              <div className="text-xs font-bold leading-tight">
                Arrived at Patient
              </div>
              <div className="text-[10px] text-emerald-400/70 font-mono">
                Start care timeline
              </div>
            </div>
          </button>

          {/* Button 4: Patient Handed to ER */}
          <button
            onClick={handleHandedOver}
            className={`h-full px-4 rounded-xl border flex items-center gap-3 transition-all ${
              dispatchStatus === 'COMPLETED'
                ? 'bg-purple-600/30 border-purple-400 text-purple-300 font-bold'
                : 'bg-white/[0.03] hover:bg-white/[0.07] border-white/10 text-white'
            }`}
          >
            <span className="text-xl">🏁</span>
            <div className="text-left">
              <div className="text-xs font-bold leading-tight">
                Patient Handed to ER
              </div>
              <div className="text-[10px] text-white/50 font-mono">
                Complete incident
              </div>
            </div>
          </button>
        </div>
      </footer>
    </div>
  )
}
