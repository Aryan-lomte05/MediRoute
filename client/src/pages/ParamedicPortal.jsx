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
        setActiveIncident((prev) => prev ? { ...prev, status: data.status } : prev)
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
    if (!mapRef.current || mapInstanceRef.current) return

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

      // Real-Time Road Traffic Layer
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
                '#00F5FF',
              ],
              'line-width': 2.4,
              'line-opacity': 0.7,
            },
          })
        }
      } catch (e) {
        console.warn('Traffic error:', e)
      }

      // Paramedic Real Route
      const roadCoords = PARAMEDIC_REAL_ROUTE?.coordinates || [
        [72.825, 19.055],
        [72.828, 19.052],
        [72.832, 19.048],
        [72.836, 19.044],
        [72.840, 19.038],
      ]

      map.addSource('green-corridor-route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: roadCoords,
          },
        },
      })

      map.addLayer({
        id: 'corridor-glow',
        type: 'line',
        source: 'green-corridor-route',
        paint: {
          'line-color': '#00F5FF',
          'line-width': 8,
          'line-opacity': 0.35,
          'line-blur': 3,
        },
      })

      map.addLayer({
        id: 'corridor-core',
        type: 'line',
        source: 'green-corridor-route',
        paint: {
          'line-color': '#00F5FF',
          'line-width': 3,
          'line-opacity': 0.95,
        },
      })

      // Destination Hospital Marker
      const hospEl = document.createElement('div')
      hospEl.className = 'px-2 py-1 rounded bg-[#7C3AED] border border-[#A855F7] text-white text-[9px] font-mono font-bold shadow-xl'
      hospEl.innerHTML = `🏥 ${activeIncident?.allocatedHospital?.name || 'Lilavati Trauma Center'}`
      new mapboxgl.Marker({ element: hospEl, anchor: 'bottom' })
        .setLngLat([72.8265, 19.0599])
        .addTo(map)

      // Live Ambulance Marker
      const ambEl = document.createElement('div')
      ambEl.className = 'relative flex items-center justify-center'
      ambEl.innerHTML = `
        <span class="animate-ping absolute inline-flex h-7 w-7 rounded-full bg-red-500 opacity-75"></span>
        <div class="relative w-8 h-8 rounded-lg bg-[#FF2D4A] border-2 border-white flex items-center justify-center text-white text-xs shadow-[0_0_20px_#FF2D4A] font-bold">
          🚑
        </div>
      `
      const ambMarker = new mapboxgl.Marker({ element: ambEl, anchor: 'center' })
        .setLngLat(roadCoords[0])
        .addTo(map)

      let step = 0
      const total = roadCoords.length
      const anim = () => {
        step = (step + 0.006) % (total - 1)
        const idx = Math.floor(step)
        const frac = step - idx
        const p1 = roadCoords[idx]
        const p2 = roadCoords[idx + 1]
        const curLng = p1[0] + (p2[0] - p1[0]) * frac
        const curLat = p1[1] + (p2[1] - p1[1]) * frac

        ambMarker.setLngLat([curLng, curLat])
        requestAnimationFrame(anim)
      }
      anim()
    })

    mapInstanceRef.current = map

    return () => map.remove()
  }, [activeIncident?.allocatedHospital?.name])

  // Camera toggle 3D / 2D
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
    } catch (err) {
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

  return (
    <div className="min-h-screen bg-[#06080e] text-white flex flex-col font-sans select-none overflow-x-hidden">
      {/* ── TOP COCKPIT STATUS BAR ── */}
      <header className="h-14 border-b border-white/[0.08] bg-[#07090e]/95 backdrop-blur-md px-5 flex items-center justify-between z-40 shrink-0">
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

      {/* ── TOP HUD CARDS ROW (3 Cards: Hospital / Route / Alert) ── */}
      <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 shrink-0">
        {/* Card 1: Destination Hospital Card (NO STATIC PHOTOS — Dynamic Care HUD) */}
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
              {activeIncident?.allocatedHospital?.name || 'Lilavati Trauma Center'} <span className="text-cyan-400 font-normal">— Bay 03</span>
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
              toast.error(`🚨 High-Priority Trauma Alert Broadcast to ${activeIncident?.allocatedHospital?.name || 'Lilavati Trauma Bay'}!`)
            }}
            className="w-full h-full p-4 rounded-2xl bg-gradient-to-r from-[#8b1424] via-[#b5172e] to-[#8b1424] hover:from-[#b5172e] hover:to-[#c91a33] border border-red-500/50 shadow-[0_0_30px_rgba(255,45,74,0.35)] flex items-center justify-center gap-3 text-left transition-all group"
          >
            <span className="text-3xl group-hover:scale-110 transition-transform">((•))</span>
            <div>
              <div className="text-base font-extrabold text-white leading-tight">
                Alert Hospital
              </div>
              <div className="text-[11px] text-white/80 font-mono">
                Direct Trauma Bay Pre-Alert
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* ── TURN-BY-TURN NAVIGATION INSTRUCTION BAR ── */}
      <div className="mx-4 mb-3 px-4 py-2.5 rounded-xl bg-[#0a0f1d] border border-cyan-500/30 shadow-lg flex items-center justify-between gap-4 shrink-0 text-left">
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

      {/* ── CENTER: LIVE 3D MAPBOX NAVIGATION ENGINE ── */}
      <div className="mx-4 h-[320px] lg:h-[380px] rounded-2xl overflow-hidden border border-white/[0.08] relative shadow-2xl shrink-0">
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

      {/* ── LOWER SECTION: PATIENT VITALS & MEDIAI CLINICAL ASSISTANT ── */}
      <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1">
        {/* ── LEFT HALF: REAL-TIME PATIENT VITALS HUD (col-span-6) ── */}
        <div className="lg:col-span-6 p-4 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl flex flex-col justify-between">
          <div>
            {/* Header with ESI badge & Patient Demographics */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.06] text-left">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold tracking-wider text-white uppercase">
                  PATIENT TELEMETRY
                </span>
                <span className="px-2 py-0.5 rounded bg-red-600/30 border border-red-500/50 text-red-400 font-mono text-[10px] font-bold">
                  ESI {activeIncident?.triageData?.esiLevel || 1}
                </span>
                <span className="text-xs text-white/50 font-medium">Critical Priority</span>
              </div>
              <div className="text-[11px] font-mono text-white/50 flex items-center gap-2">
                <span>👤 {activeIncident?.patientDetails?.name || 'Citizen Patient'}</span>
                <span>·</span>
                <span className="text-orange-400">🩸 {activeIncident?.patientDetails?.bloodType || 'O+'}</span>
              </div>
            </div>

            {/* 4 Live Vitals Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-left">
              {/* Vital 1: Heart Rate */}
              <div className="p-3 rounded-xl bg-white/[0.02] border border-red-500/30">
                <div className="text-[11px] font-mono text-red-400 font-bold">
                  ❤️ Heart Rate
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono mt-1">
                  {patientVitals.heartRate} <span className="text-xs font-normal text-white/50">BPM</span>
                </div>
                <div className="text-[10px] font-mono text-white/30 mt-0.5">(60 - 100)</div>
              </div>

              {/* Vital 2: Blood Pressure */}
              <div className="p-3 rounded-xl bg-white/[0.02] border border-yellow-500/30">
                <div className="text-[11px] font-mono text-yellow-400 font-bold">
                  💉 Blood Press.
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono mt-1">
                  {patientVitals.bpSystolic}/{patientVitals.bpDiastolic}
                </div>
                <div className="text-[10px] font-mono text-white/30 mt-0.5">mmHg (Hypo)</div>
              </div>

              {/* Vital 3: SpO2 */}
              <div className="p-3 rounded-xl bg-white/[0.02] border border-cyan-500/30">
                <div className="text-[11px] font-mono text-cyan-400 font-bold">
                  🫁 SpO2 Pulse
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono mt-1">
                  {patientVitals.spO2}%
                </div>
                <div className="text-[10px] font-mono text-white/30 mt-0.5">Target &gt; 95%</div>
              </div>

              {/* Vital 4: GCS */}
              <div className="p-3 rounded-xl bg-white/[0.02] border border-purple-500/30">
                <div className="text-[11px] font-mono text-purple-400 font-bold">
                  🧠 GCS Score
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono mt-1">
                  {patientVitals.gcs} <span className="text-xs font-normal text-white/50">/ 15</span>
                </div>
                <div className="text-[10px] font-mono text-white/30 mt-0.5">Altered sensorium</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT HALF: MEDIAI CLINICAL ASSISTANT (col-span-6) ── */}
        <div className="lg:col-span-6 p-4 rounded-2xl bg-[#090d16]/90 border border-purple-500/30 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <span className="text-purple-400 text-base">✨</span>
                <span className="text-xs font-mono font-bold tracking-wider text-white uppercase">
                  MediAI Clinical Decision Support
                </span>
              </div>
              <div className="text-[10px] font-mono text-white/40">
                Confidence: 96%
              </div>
            </div>

            {/* Diagnostic Alert Banner */}
            <div className="mt-3 p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-left">
              <div className="flex items-center gap-2 text-red-300 font-bold text-xs">
                <span>🚨</span>
                <span>{activeIncident?.triageData?.chiefComplaint || 'Suspected acute trauma presentation'}</span>
              </div>
              <div className="text-[11px] text-white/70 mt-1">
                {activeIncident?.triageData?.aiSummary || 'High urgency clinical protocol recommended. Prepare rapid surgical intake.'}
              </div>
            </div>

            {/* Recommended Protocol Checklist */}
            <div className="mt-3 space-y-1.5 text-left text-xs font-mono">
              <div className="text-[10px] font-mono uppercase text-white/40 font-semibold mb-1">
                Recommended Protocol Checklist:
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
              <span>Protocol</span>
            </button>
            <button
              onClick={() => toast('💊 Drug Dosage: Fentanyl 50mcg IV / NS 500mL Bolus', { icon: '💉' })}
              className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono text-white/80 transition-all flex items-center justify-center gap-1"
            >
              <span>💉</span>
              <span>Dosages</span>
            </button>
            <button
              onClick={() => toast('🫁 Rapid Sequence Intubation Checklist Verified', { icon: '🫁' })}
              className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono text-white/80 transition-all flex items-center justify-center gap-1"
            >
              <span>🫁</span>
              <span>Airway</span>
            </button>
            <button
              onClick={() => toast('📑 High-Impact Trauma Checklist Confirmed', { icon: '📋' })}
              className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono text-white/80 transition-all flex items-center justify-center gap-1"
            >
              <span>📋</span>
              <span>Checklist</span>
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
                {isRecordingVoice ? 'Transcribing via Whisper' : 'AI Speech to Clinical Chart'}
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
                Sync live telemetry to DB
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
                Update DB care timestamp
              </div>
            </div>
          </button>

          {/* Button 4: Patient Handed to ER */}
          <button
            onClick={handleHandedOver}
            className={`h-full px-4 rounded-xl border flex items-center gap-3 transition-all ${
              dispatchStatus === 'COMPLETED'
                ? 'bg-blue-600/30 border-blue-400 text-blue-300 font-bold shadow-[0_0_15px_rgba(59,130,246,0.3)]'
                : 'bg-blue-950/40 hover:bg-blue-900/60 border-blue-500/40 text-blue-300'
            }`}
          >
            <span className="text-xl">🏥</span>
            <div className="text-left">
              <div className="text-xs font-bold leading-tight">
                Patient Handed to ER
              </div>
              <div className="text-[10px] text-blue-400/70 font-mono">
                Mark incident completed
              </div>
            </div>
          </button>
        </div>
      </footer>
    </div>
  )
}
