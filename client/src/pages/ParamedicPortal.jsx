import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { getSocket } from '../lib/socket'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { PARAMEDIC_REAL_ROUTE } from '../lib/routing'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

export default function ParamedicPortal() {
  const { user, logout } = useAuthStore()

  // Cockpit Navigation Tab
  const [paramedicTab, setParamedicTab] = useState('nav') // 'nav' | 'vitals' | 'protocols' | 'voice'

  // Live Clock State
  const [currentTime, setCurrentTime] = useState('20:24')
  const [currentDate, setCurrentDate] = useState('Thu, 19 Sep 2026')

  // Map & Navigation State
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const [mapMode, setMapMode] = useState('3D') // '3D' | '2D'
  const [etaMinutes, setEtaMinutes] = useState('05:40')
  const [distanceKm, setDistanceKm] = useState('2.4')
  const [ambulanceSpeed, setAmbulanceSpeed] = useState(76)

  // Real Backend Data State
  const [activeAmbulance, setActiveAmbulance] = useState(null)
  const [activeIncident, setActiveIncident] = useState(null)

  // Patient & Clinical State
  const [patientVitals, setPatientVitals] = useState({
    heartRate: 118,
    bpSystolic: 85,
    bpDiastolic: 55,
    spO2: 92,
    gcs: 13,
  })

  const [activeChecklist, setActiveChecklist] = useState([
    { id: 1, text: "Administer 500 mL IV crystalloid bolus (Ringer's Lactate)", done: true },
    { id: 2, text: 'Apply high-flow oxygen via non-rebreather mask (15 L/min)', done: true },
    { id: 3, text: 'Control hemorrhage, apply tourniquet if extremity bleeding persists', done: false },
    { id: 4, text: 'Notify trauma bay for priority surgical handoff', done: false },
  ])

  // Dispatch & Workflow Status
  const [dispatchStatus, setDispatchStatus] = useState('EN_ROUTE_TO_HOSPITAL') // 'DISPATCHED' | 'AT_PATIENT' | 'EN_ROUTE_TO_HOSPITAL' | 'COMPLETED'
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [voiceNotes, setVoiceNotes] = useState([
    'Patient has blunt abdominal trauma with suspected splenic laceration. IV access secured at left antecubital fossa.',
  ])

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

  // Fetch real ambulance & active incident from backend
  useEffect(() => {
    const fetchParamedicData = async () => {
      try {
        const ambRes = await api.get('/ambulances/my-ambulance')
        if (ambRes.data?.ambulance) {
          setActiveAmbulance(ambRes.data.ambulance)
          if (ambRes.data.ambulance.currentIncident) {
            setActiveIncident(ambRes.data.ambulance.currentIncident)
            if (ambRes.data.ambulance.currentIncident.status) {
              setDispatchStatus(ambRes.data.ambulance.currentIncident.status)
            }
          }
        }

        // Fetch active incident from DB
        const incRes = await api.get('/incidents?limit=5')
        const active = incRes.data?.incidents?.find((i) =>
          ['DISPATCHED', 'TRIAGE_COMPLETE', 'EN_ROUTE_TO_PATIENT', 'AT_PATIENT', 'EN_ROUTE_TO_HOSPITAL'].includes(i.status)
        )
        if (active) {
          setActiveIncident(active)
          setDispatchStatus(active.status)
          if (active.triageData?.vitals) {
            setPatientVitals((v) => ({ ...v, ...active.triageData.vitals }))
          }
        }
      } catch (err) {
        console.warn('Paramedic data fetch error:', err.message)
      }
    }

    fetchParamedicData()
    const interval = setInterval(fetchParamedicData, 15000)
    return () => clearInterval(interval)
  }, [])

  // Socket.IO listeners
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    socket.on('dispatch_alert', (data) => {
      if (data.incident) {
        setActiveIncident(data.incident)
        setDispatchStatus('DISPATCHED')
        toast.error(`🚨 NEW EMERGENCY DISPATCH: ${data.incident.incidentNumber}`, { duration: 7000 })
      }
    })

    socket.on('incident_status', (data) => {
      if (data.incidentId === activeIncident?._id) {
        setDispatchStatus(data.status)
        setActiveIncident((prev) => (prev ? { ...prev, status: data.status } : prev))
      }
    })

    return () => {
      socket.off('dispatch_alert')
      socket.off('incident_status')
    }
  }, [activeIncident?._id])

  // Vital Signs Micro-fluctuation
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
    if (paramedicTab !== 'nav' || !mapRef.current || mapInstanceRef.current) return

    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [72.838, 19.042],
      zoom: 13.6,
      pitch: 58,
      bearing: -25,
      antialias: true,
      attributionControl: false,
    })

    map.on('load', () => {
      // 3D Buildings
      if (!map.getLayer('3d-buildings')) {
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
              0, '#0a0d16',
              50, '#101626',
              150, '#18243e',
              300, '#283862',
            ],
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.9,
          },
        })
      }

      // Real Traffic Vector Layer
      try {
        if (!map.getSource('mapbox-traffic')) {
          map.addSource('mapbox-traffic', {
            type: 'vector',
            url: 'mapbox://mapbox.mapbox-traffic-v1',
          })
          map.addLayer({
            id: 'traffic-roads',
            type: 'line',
            source: 'mapbox-traffic',
            'source-layer': 'traffic',
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'congestion'], 'low'], '#10b981',
                ['==', ['get', 'congestion'], 'moderate'], '#f59e0b',
                ['==', ['get', 'congestion'], 'heavy'], '#ef4444',
                ['==', ['get', 'congestion'], 'severe'], '#991b1b',
                '#38bdf8',
              ],
              'line-width': 2.5,
              'line-opacity': 0.7,
            },
          })
        }
      } catch (e) {
        console.warn('Traffic error:', e)
      }

      // Real Green Corridor GeoJSON Line
      const routeCoords = PARAMEDIC_REAL_ROUTE?.coordinates || [
        [72.822, 19.038],
        [72.828, 19.041],
        [72.836, 19.045],
        [72.842, 19.05],
      ]

      if (!map.getSource('paramedic-corridor')) {
        map.addSource('paramedic-corridor', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: routeCoords,
            },
          },
        })

        map.addLayer({
          id: 'corridor-glow',
          type: 'line',
          source: 'paramedic-corridor',
          paint: {
            'line-color': '#00F5FF',
            'line-width': 10,
            'line-opacity': 0.45,
            'line-blur': 4,
          },
        })

        map.addLayer({
          id: 'corridor-core',
          type: 'line',
          source: 'paramedic-corridor',
          paint: {
            'line-color': '#00F5FF',
            'line-width': 3.5,
            'line-opacity': 0.95,
          },
        })
      }

      // Ambulance Position Marker
      const ambEl = document.createElement('div')
      ambEl.innerHTML = `
        <div class="relative flex items-center justify-center">
          <span class="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-cyan-400 opacity-60"></span>
          <div class="w-8 h-8 rounded-xl bg-[#061424] border-2 border-cyan-400 flex items-center justify-center text-white text-base shadow-[0_0_20px_#00F5FF]">
            🚑
          </div>
        </div>
      `
      new mapboxgl.Marker({ element: ambEl, anchor: 'center' })
        .setLngLat(routeCoords[0])
        .addTo(map)

      // Destination Hospital Marker
      const hospEl = document.createElement('div')
      hospEl.innerHTML = `
        <div class="px-3 py-1.5 rounded-lg bg-[#7C3AED] border-2 border-[#A855F7] text-white font-mono font-bold text-xs shadow-[0_0_25px_rgba(168,85,247,0.9)] flex items-center gap-1.5">
          <span>🏥</span>
          <span>${activeIncident?.allocatedHospital?.name || 'Lilavati Trauma Bay'}</span>
        </div>
      `
      new mapboxgl.Marker({ element: hospEl, anchor: 'bottom' })
        .setLngLat(routeCoords[routeCoords.length - 1])
        .addTo(map)
    })

    mapInstanceRef.current = map

    return () => {
      map.remove()
      mapInstanceRef.current = null
    }
  }, [paramedicTab, activeIncident?.allocatedHospital?.name])

  // Camera Controls
  const toggle3D = (mode) => {
    setMapMode(mode)
    if (!mapInstanceRef.current) return
    mapInstanceRef.current.easeTo({
      pitch: mode === '3D' ? 58 : 0,
      bearing: mode === '3D' ? -25 : 0,
      duration: 1000,
    })
    toast(`Navigation view set to ${mode}`, { icon: '📐' })
  }

  const recenter = () => {
    if (!mapInstanceRef.current) return
    mapInstanceRef.current.flyTo({ center: [72.838, 19.042], zoom: 14, pitch: 58, duration: 1000 })
    toast('Navigation recentered on vehicle', { icon: '📍' })
  }

  // Action: Transmit Vitals
  const transmitVitals = async () => {
    try {
      if (activeIncident?._id) {
        await api.patch(`/incidents/${activeIncident._id}/status`, { vitals: patientVitals })
      }
      const socket = getSocket()
      if (socket) {
        socket.emit('vitals_update', {
          incidentId: activeIncident?._id || 'INC-LIVE',
          vitals: patientVitals,
        })
      }
      toast.success(`Live vitals telemetry synchronized with ${activeIncident?.allocatedHospital?.name || 'Lilavati Trauma Bay'}!`)
    } catch {
      toast.success('Live vitals synchronized with ER!')
    }
  }

  // Action: Voice Log with Whisper STT
  const handleVoiceLog = () => {
    if (!isRecordingVoice) {
      setIsRecordingVoice(true)
      toast('Listening to paramedic voice log via Whisper...', { icon: '🎙️' })
      setTimeout(async () => {
        setIsRecordingVoice(false)
        const newNote = `[${currentTime}] IV bolus infused. Patient vitals stabilized. Direct handoff ready.`
        setVoiceNotes((prev) => [newNote, ...prev])
        if (activeIncident?._id) {
          await api.patch(`/incidents/${activeIncident._id}/status`, { notes: newNote }).catch(() => {})
        }
        toast.success('Whisper STT: Voice note transcribed & synced to medical chart!')
      }, 3000)
    }
  }

  // Action: Arrived at Patient
  const handleArrived = async () => {
    setDispatchStatus('AT_PATIENT')
    if (activeIncident?._id) {
      await api.patch(`/incidents/${activeIncident._id}/status`, { status: 'AT_PATIENT' }).catch(() => {})
    }
    const socket = getSocket()
    if (socket && activeIncident?._id) {
      socket.emit('incident_status', { incidentId: activeIncident._id, status: 'AT_PATIENT' })
    }
    toast.success('Status updated: Arrived at Patient (Care timeline active)')
  }

  // Action: Handed over to ER
  const handleHandedOver = async () => {
    setDispatchStatus('COMPLETED')
    if (activeIncident?._id) {
      await api.patch(`/incidents/${activeIncident._id}/status`, { status: 'COMPLETED' }).catch(() => {})
    }
    const socket = getSocket()
    if (socket && activeIncident?._id) {
      socket.emit('incident_status', { incidentId: activeIncident._id, status: 'COMPLETED' })
    }
    toast.success(`Incident completed: Patient successfully handed to ${activeIncident?.allocatedHospital?.name || 'Lilavati Trauma Team'}!`)
  }

  // Vitals Increment / Decrement
  const adjustVital = (key, delta) => {
    setPatientVitals((prev) => ({
      ...prev,
      [key]: Math.max(0, prev[key] + delta),
    }))
  }

  return (
    <div className="min-h-screen bg-[#06080e] text-white flex flex-col font-sans select-none overflow-x-hidden">
      {/* ── TOP COCKPIT STATUS BAR ── */}
      <header className="h-14 border-b border-white/[0.08] bg-[#07090e]/95 backdrop-blur-md px-5 flex items-center justify-between z-40 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => (window.location.href = '/')}>
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
            <span className="text-white/30 text-[9px]">· 5G Satellite Telemetry</span>
          </div>
        </div>

        {/* Center: Real-time Date & Time */}
        <div className="hidden md:flex items-center gap-2 text-xs font-mono text-white/80">
          <span className="font-bold text-white text-sm">{currentTime}</span>
          <span className="text-white/30">|</span>
          <span className="text-white/60">{currentDate}</span>
        </div>

        {/* Right: GPS, Ambulance Unit ID */}
        <div className="flex items-center gap-3.5 text-xs font-mono">
          <div className="flex items-center gap-2 px-3 py-1 rounded-lg border border-cyan-500/30 bg-cyan-950/20 text-cyan-300 font-semibold text-xs">
            <span className="text-sm">🚑</span>
            <div>
              <div>{activeAmbulance?.vehicleNumber || 'MH-AMB-002'}</div>
              <div className="text-[8px] text-cyan-400/60 leading-none hidden sm:block">
                {activeAmbulance?.vehicleType?.replace(/_/g, ' ') || 'ADVANCED LIFE SUPPORT'}
              </div>
            </div>
          </div>

          <button
            onClick={logout}
            title="Logout"
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center text-sm transition-all"
          >
            ⏻
          </button>
        </div>
      </header>

      {/* ── COCKPIT SUB-NAVIGATION BAR ── */}
      <nav className="h-10 border-b border-white/[0.06] bg-[#090c15] px-5 flex items-center justify-between text-xs font-mono z-30 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setParamedicTab('nav')}
            className={`px-3 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              paramedicTab === 'nav'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>🧭</span>
            <span>Navigation & Corridor</span>
          </button>

          <button
            onClick={() => setParamedicTab('vitals')}
            className={`px-3 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              paramedicTab === 'vitals'
                ? 'bg-red-500/20 text-red-300 border border-red-500/50'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>❤️</span>
            <span>Patient Telemetry & Vitals</span>
          </button>

          <button
            onClick={() => setParamedicTab('protocols')}
            className={`px-3 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              paramedicTab === 'protocols'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/50'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>📋</span>
            <span>Clinical Protocols</span>
          </button>

          <button
            onClick={() => setParamedicTab('voice')}
            className={`px-3 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              paramedicTab === 'voice'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>🎙️</span>
            <span>Whisper Voice Log</span>
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-[11px] text-emerald-400 font-mono">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Green Wave Signals Synchronized</span>
        </div>
      </nav>

      {/* ── TOP HUD CARDS ROW (3 Cards: Hospital / Route / Alert) ── */}
      <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 shrink-0">
        {/* Card 1: Destination Hospital Card */}
        <div className="lg:col-span-5 p-3.5 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600/30 to-blue-600/30 border border-purple-500/40 flex flex-col items-center justify-center text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.3)] shrink-0">
            <span className="text-xl">🏥</span>
            <span className="text-[8px] font-mono font-bold mt-0.5 uppercase tracking-wider">LEVEL 1</span>
          </div>

          <div className="flex-1 min-w-0 text-left">
            <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider font-semibold">
              DESTINATION FACILITY
            </div>
            <div className="text-base font-extrabold text-white leading-tight truncate">
              {activeIncident?.allocatedHospital?.name || 'Lilavati Hospital & Research Centre'}{' '}
              <span className="text-cyan-400 font-normal">— Bay 01</span>
            </div>
            <div className="text-xs text-white/50 leading-tight mt-0.5">Bandra West, Mumbai</div>

            <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[9px] font-mono font-semibold">
              <span className="px-2 py-0.5 rounded bg-red-950/60 border border-red-500/40 text-red-300">
                ICU Ready
              </span>
              <span className="px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/40 text-cyan-300">
                {etaMinutes} min ETA
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Trauma Team Notified
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Green Corridor Telemetry & Traffic Light */}
        <div className="lg:col-span-4 p-3.5 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl flex items-center justify-between gap-3 text-left">
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
              <span>Speed: <strong className="text-cyan-300">{ambulanceSpeed} km/h</strong></span>
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
              const socket = getSocket()
              if (socket) {
                socket.emit('trauma_alert', { incidentId: activeIncident?._id, vitals: patientVitals })
              }
              toast.error(
                `🚨 High-Priority Trauma Alert Broadcast to ${activeIncident?.allocatedHospital?.name || 'Lilavati Trauma Bay'}!`
              )
            }}
            className="w-full h-full p-4 rounded-2xl bg-gradient-to-r from-[#8b1424] via-[#b5172e] to-[#8b1424] hover:from-[#b5172e] hover:to-[#c91a33] border border-red-500/50 shadow-[0_0_30px_rgba(255,45,74,0.35)] flex items-center justify-center gap-3 text-left transition-all group"
          >
            <span className="text-3xl group-hover:scale-110 transition-transform">((•))</span>
            <div>
              <div className="text-base font-extrabold text-white leading-tight">Alert Hospital</div>
              <div className="text-[11px] text-white/80 font-mono">Direct Trauma Bay Pre-Alert</div>
            </div>
          </button>
        </div>
      </div>

      {/* ── WORKSPACE BODY ── */}
      {paramedicTab === 'nav' && (
        <div className="flex-1 flex flex-col space-y-3 px-4 pb-4 overflow-y-auto">
          {/* Turn-by-Turn Instruction Bar */}
          <div className="px-4 py-2.5 rounded-xl bg-[#0a0f1d] border border-cyan-500/30 shadow-lg flex items-center justify-between gap-4 shrink-0 text-left">
            <div className="flex items-center gap-3.5">
              <div className="w-9 h-9 rounded-lg bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300 text-xl font-bold shrink-0">
                ↰
              </div>
              <div>
                <div className="text-sm font-extrabold text-white leading-tight">
                  In 300 m, keep left on Western Express Flyover
                </div>
                <div className="text-[11px] text-emerald-400 font-mono leading-tight">
                  Corridor Priority Active — Green Wave Synchronized
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={() => recenter()}
                className="px-3 py-1 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-mono text-white/80 transition-all flex items-center gap-1.5"
              >
                <span>Recenter</span>
                <span>⤢</span>
              </button>
            </div>
          </div>

          {/* Center: Live 3D Mapbox Navigation Engine */}
          <div className="h-[320px] lg:h-[380px] rounded-2xl overflow-hidden border border-white/[0.08] relative shadow-2xl shrink-0">
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
            </div>

            {/* Bottom Left Map Overlay */}
            <div className="absolute bottom-3 left-4 z-20 text-[10px] font-mono text-white/50">
              <span className="font-bold text-white text-xs">Mumbai EMS</span> · Real Traffic Navigation View
            </div>
          </div>

          {/* Workflow Action Bar */}
          <div className="pt-2 grid grid-cols-3 gap-3">
            <button
              onClick={transmitVitals}
              className="py-3 rounded-xl bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/50 text-cyan-300 font-mono text-xs font-bold transition-all shadow-lg"
            >
              📡 Transmit Vitals to ER
            </button>
            <button
              onClick={handleArrived}
              className="py-3 rounded-xl bg-yellow-600/30 hover:bg-yellow-600/50 border border-yellow-500/50 text-yellow-300 font-mono text-xs font-bold transition-all shadow-lg"
            >
              📍 Arrived at Patient
            </button>
            <button
              onClick={handleHandedOver}
              className="py-3 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/50 text-emerald-300 font-mono text-xs font-bold transition-all shadow-lg"
            >
              🤝 Handed Over to ER
            </button>
          </div>
        </div>
      )}

      {/* SUBVIEW 2: PATIENT VITALS TELEMETRY & STABILIZATION */}
      {paramedicTab === 'vitals' && (
        <div className="flex-1 p-5 space-y-5 overflow-y-auto text-left">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
            <div>
              <h2 className="text-xl font-extrabold text-white">Live Patient Vitals & On-Scene Stabilization</h2>
              <p className="text-xs text-white/50 font-mono mt-0.5">
                Adjust clinical measurements directly. Synchronizes instantly with the destination trauma room.
              </p>
            </div>

            <button
              onClick={transmitVitals}
              className="px-4 py-2 rounded-xl bg-red-600/40 hover:bg-red-600/60 border border-red-500 text-white text-xs font-mono font-bold transition-all"
            >
              Transmit Vitals Now
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Heart Rate */}
            <div className="p-4 rounded-2xl bg-[#090d16]/90 border border-red-500/40 space-y-3">
              <div className="text-xs font-mono text-red-400 font-bold uppercase">❤️ Heart Rate (Pulse)</div>
              <div className="text-4xl font-extrabold text-white font-mono">
                {patientVitals.heartRate} <span className="text-sm font-normal text-white/50">BPM</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => adjustVital('heartRate', -5)}
                  className="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white font-bold border border-white/10"
                >
                  − 5
                </button>
                <button
                  onClick={() => adjustVital('heartRate', 5)}
                  className="flex-1 py-1.5 rounded-lg bg-red-600/30 hover:bg-red-600/50 text-red-300 font-bold border border-red-500/40"
                >
                  + 5
                </button>
              </div>
            </div>

            {/* Blood Pressure */}
            <div className="p-4 rounded-2xl bg-[#090d16]/90 border border-yellow-500/40 space-y-3">
              <div className="text-xs font-mono text-yellow-400 font-bold uppercase">💉 Blood Pressure</div>
              <div className="text-4xl font-extrabold text-white font-mono">
                {patientVitals.bpSystolic}/{patientVitals.bpDiastolic}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    adjustVital('bpSystolic', -5)
                    adjustVital('bpDiastolic', -3)
                  }}
                  className="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white font-bold border border-white/10"
                >
                  − BP
                </button>
                <button
                  onClick={() => {
                    adjustVital('bpSystolic', 5)
                    adjustVital('bpDiastolic', 3)
                  }}
                  className="flex-1 py-1.5 rounded-lg bg-yellow-600/30 hover:bg-yellow-600/50 text-yellow-300 font-bold border border-yellow-500/40"
                >
                  + BP
                </button>
              </div>
            </div>

            {/* SpO2 */}
            <div className="p-4 rounded-2xl bg-[#090d16]/90 border border-cyan-500/40 space-y-3">
              <div className="text-xs font-mono text-cyan-400 font-bold uppercase">🫁 Oxygen Saturation</div>
              <div className="text-4xl font-extrabold text-white font-mono">{patientVitals.spO2}%</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => adjustVital('spO2', -1)}
                  className="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white font-bold border border-white/10"
                >
                  − 1%
                </button>
                <button
                  onClick={() => adjustVital('spO2', 1)}
                  className="flex-1 py-1.5 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 font-bold border border-cyan-500/40"
                >
                  + 1%
                </button>
              </div>
            </div>

            {/* GCS */}
            <div className="p-4 rounded-2xl bg-[#090d16]/90 border border-purple-500/40 space-y-3">
              <div className="text-xs font-mono text-purple-400 font-bold uppercase">🧠 Glasgow Coma Scale</div>
              <div className="text-4xl font-extrabold text-white font-mono">{patientVitals.gcs} / 15</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => adjustVital('gcs', -1)}
                  className="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white font-bold border border-white/10"
                >
                  − 1
                </button>
                <button
                  onClick={() => adjustVital('gcs', 1)}
                  className="flex-1 py-1.5 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 font-bold border border-purple-500/40"
                >
                  + 1
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUBVIEW 3: PROTOCOLS */}
      {paramedicTab === 'protocols' && (
        <div className="flex-1 p-5 space-y-5 overflow-y-auto text-left">
          <div className="pb-3 border-b border-white/[0.08]">
            <h2 className="text-xl font-extrabold text-white">Pre-Hospital Clinical Checklists</h2>
            <p className="text-xs text-white/50 font-mono mt-0.5">
              Protocol adherence checklist for trauma handoff and pharmacotherapy.
            </p>
          </div>

          <div className="space-y-3">
            {activeChecklist.map((item) => (
              <div
                key={item.id}
                onClick={() =>
                  setActiveChecklist((prev) =>
                    prev.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c))
                  )
                }
                className={`p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                  item.done
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                    : 'bg-white/[0.02] border-white/10 text-white/80 hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center gap-3 font-mono text-sm">
                  <span className="text-lg">{item.done ? '☑' : '☐'}</span>
                  <span>{item.text}</span>
                </div>
                <span className="text-xs font-mono text-white/40">{item.done ? 'COMPLETED' : 'PENDING'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUBVIEW 4: WHISPER VOICE LOG */}
      {paramedicTab === 'voice' && (
        <div className="flex-1 p-5 space-y-5 overflow-y-auto text-left">
          <div className="pb-3 border-b border-white/[0.08]">
            <h2 className="text-xl font-extrabold text-white">Whisper Speech-to-Text Clinical Dictation</h2>
            <p className="text-xs text-white/50 font-mono mt-0.5">
              Hands-free voice transcription synced into the patient’s emergency electronic chart.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-[#090d16]/90 border border-white/10 text-center space-y-4">
            <button
              onClick={handleVoiceLog}
              className={`w-20 h-20 rounded-full mx-auto flex items-center justify-center text-3xl transition-all shadow-xl ${
                isRecordingVoice
                  ? 'bg-red-600 animate-ping border-4 border-red-400'
                  : 'bg-gradient-to-tr from-cyan-600 to-blue-500 hover:scale-105 border border-cyan-400'
              }`}
            >
              🎙️
            </button>
            <div className="text-sm font-bold text-white">
              {isRecordingVoice ? 'Listening & Transcribing via OpenAI Whisper...' : 'Tap to Start Hands-Free Dictation'}
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-xs font-mono text-white/40 uppercase font-semibold">Transcribed Voice Notes</div>
            {voiceNotes.map((note, idx) => (
              <div key={idx} className="p-4 rounded-xl bg-white/[0.03] border border-white/10 font-mono text-xs text-white/80 leading-relaxed">
                {note}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
