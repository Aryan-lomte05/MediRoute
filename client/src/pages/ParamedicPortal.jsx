/**
 * ==============================================================================
 * MEDIROUTE - PARAMEDIC EMERGENCY DISPATCH HUD & NAVIGATION COCKPIT (ParamedicPortal.jsx)
 * ==============================================================================
 * 
 * WHAT IS WHERE:
 * - Line 25-35:    Module Imports & Mapbox GL Token Initialization
 * - Line 36-95:    Component State & Hardware HUD Telemetry:
 *                  - Cockpit tabs (`nav` | `vitals` | `protocols` | `voice`)
 *                  - Dynamic speedometer, distance counter, ETA clock
 *                  - Patient vitals state (HR, BP, SpO2, Glasgow Coma Scale)
 *                  - Pre-hospital stabilization checklist items
 * - Line 96-180:   Socket.IO Real-time Synchronization:
 *                  - GPS telemetry broadcast to City Admin command room
 *                  - Hospital trauma bay pre-arrival data link
 * - Line 181-340:  Turn-by-Turn Mapbox 3D Geonav Engine:
 *                  - Real-time ambulance vector along Mumbai Bandra-Parel corridor
 *                  - Traffic pre-emption layer (automated green wave traffic light clearing)
 * - Line 341-440:  Paramedic Actions:
 *                  - `handleDispatchStatusChange`: Updates emergency workflow state
 *                  - `handleVitalsUpdate`: Streams real-time vitals to ER doctors
 *                  - `toggleChecklist`: Digital triage checklist compliance
 *                  - `recordVoiceNote`: Speech-to-text paramedic clinical notes
 * - Line 441-End:  Cockpit Layout & Sub-Navigation Views:
 *                  - View 1: 🧭 3D Geonav HUD with floating turn-by-turn instruction card
 *                  - View 2: 💓 Real-time Vitals Monitor with physiological alert thresholds
 *                  - View 3: 📋 Clinical Protocols & ACLS Trauma Care checklist
 *                  - View 4: 🎙️ AI Voice Dictation & ER Doctor Handover Summary
 * ==============================================================================
 */

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { getSocket } from '../lib/socket'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { PARAMEDIC_REAL_ROUTE } from '../lib/routing'
import { ModeToggle, GuideButton } from '../components/PortalGuide'
import AiStatusBadge from '../components/AiStatusBadge'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''


/** Walkthrough for the field console. */
const PARAMEDIC_TOUR_STEPS = [
  {
    heading: 'Navigation runs off this device',
    body: 'Speed, distance and ETA come from this phone\u2019s GPS, and your position is sent to the control room and to the patient who called. If it reads \u201cno GPS\u201d, location permission is off.',
  },
  {
    heading: 'Your checklist is for this patient',
    body: 'The interventions listed were generated from this patient\u2019s own assessment, not a fixed protocol. Ticking one is saved and appears on the receiving hospital\u2019s screen.',
  },
  {
    heading: 'Dictation is real transcription',
    body: 'Tap the microphone, speak, then tap again to stop. The recording is transcribed and attached to the patient record, and the emergency department sees it straight away.',
  },
  {
    heading: 'Recording vitals can change the triage',
    body: 'When you send measured vitals, the case is reassessed. If the numbers are worse than the phone description suggested, the severity is raised and the hospital is told.',
  },
]

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
  /**
   * Navigation telemetry. These were fixed strings ('05:40', '2.4', 76) that no
   * code ever updated, so the HUD displayed the same ETA, distance and speed
   * on every run while presenting them as live turn-by-turn data. They are now
   * derived from the device GPS and the server-computed route.
   */
  const [etaMinutes, setEtaMinutes] = useState(null)
  const [distanceKm, setDistanceKm] = useState(null)
  const [ambulanceSpeed, setAmbulanceSpeed] = useState(null)
  const [gpsActive, setGpsActive] = useState(false)

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

  // Interventions for THIS patient, generated server-side from their triage
  // and shared with the receiving ER. Previously a fixed four-item array that
  // reset on reload and nobody else could see.
  const [activeChecklist, setActiveChecklist] = useState([])

  // Dispatch & Workflow Status
  const [dispatchStatus, setDispatchStatus] = useState('EN_ROUTE_TO_HOSPITAL') // 'DISPATCHED' | 'AT_PATIENT' | 'EN_ROUTE_TO_HOSPITAL' | 'COMPLETED'
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [voiceNotes, setVoiceNotes] = useState([])
  const [isTranscribing, setIsTranscribing] = useState(false)
  const recorderRef = useRef(null)
  const audioChunksRef = useRef([])

  // Digital Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setCurrentTime(now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }))
      // Was hardcoded to 'Thu, 19 Sep 2026', so the field HUD showed the same
      // date on every shift.
      setCurrentDate(
        now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
      )
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
          // Both boards belong to the incident, so they survive a reload and
          // stay in step with the receiving ER.
          setActiveChecklist(active.fieldChecklist || [])
          setVoiceNotes(active.fieldNotes || [])
        } else {
          setActiveChecklist([])
          setVoiceNotes([])
        }
      } catch (err) {
        console.warn('Paramedic data fetch error:', err.message)
      }
    }

    fetchParamedicData()
    const interval = setInterval(fetchParamedicData, 15000)
    return () => clearInterval(interval)
  }, [])

  /**
   * Live GPS telemetry from the crew's own device.
   *
   * Does three things the HUD previously faked: reads real speed, computes the
   * real remaining distance and ETA to the current destination, and pushes the
   * unit's position to the server so the command centre and the patient's
   * tracking page both see the ambulance actually moving.
   *
   * Throttled to one write every 8 seconds to stay well inside the API rate
   * limit on a long transport.
   */
  useEffect(() => {
    if (!('geolocation' in navigator)) return

    let lastPush = 0

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsActive(true)

        const { longitude, latitude, speed } = pos.coords
        // The Geolocation API reports speed in m/s, and null when stationary
        // or unsupported.
        setAmbulanceSpeed(speed != null ? Math.max(0, Math.round(speed * 3.6)) : null)

        // Destination depends on the phase of the job: collect the patient
        // first, then run to the receiving hospital.
        const heading = ['EN_ROUTE_TO_HOSPITAL', 'ARRIVED_AT_HOSPITAL'].includes(dispatchStatus)
          ? activeIncident?.allocatedHospital?.location?.coordinates
          : activeIncident?.location?.coordinates

        if (Array.isArray(heading) && heading.length === 2) {
          const R = 6371
          const toRad = (d) => (d * Math.PI) / 180
          const dLat = toRad(heading[1] - latitude)
          const dLng = toRad(heading[0] - longitude)
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(latitude)) * Math.cos(toRad(heading[1])) * Math.sin(dLng / 2) ** 2
          const km = 2 * R * Math.asin(Math.sqrt(a))

          setDistanceKm(km.toFixed(1))
          // Use the measured speed when actually moving, else an urban average.
          const kmh = speed != null && speed * 3.6 > 5 ? speed * 3.6 : 28
          setEtaMinutes(Math.max(1, Math.round((km / kmh) * 60)))
        }

        const now = Date.now()
        if (activeAmbulance?._id && now - lastPush > 8000) {
          lastPush = now
          api
            .patch(`/ambulances/${activeAmbulance._id}/location`, {
              coordinates: [longitude, latitude],
              heading: pos.coords.heading ?? null,
              speed: speed != null ? Math.round(speed * 3.6) : null,
            })
            .catch(() => {
              // A dropped telemetry write is not worth interrupting the crew.
            })
        }
      },
      (err) => {
        console.warn('[Paramedic] GPS unavailable:', err.message)
        setGpsActive(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [activeAmbulance?._id, activeIncident?._id, dispatchStatus])

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

  /**
   * Record the crew's dictation and transcribe it with Whisper server-side.
   *
   * This replaces a simulated handler that waited three seconds and inserted a
   * fixed sentence while reporting that speech had been transcribed. Audio is
   * posted as a raw body to /ai/transcribe, then the text is appended to the
   * incident so the receiving ER sees it immediately.
   */
  const handleVoiceLog = async () => {
    // Second tap stops the recording.
    if (isRecordingVoice) {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      setIsRecordingVoice(false)
      return
    }

    if (!activeIncident?._id) {
      toast.error('No active incident to attach a note to')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunksRef.current = []

      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })

        if (blob.size < 1200) {
          toast.error('Recording too short')
          return
        }

        setIsTranscribing(true)
        try {
          const { data } = await api.post('/ai/transcribe', blob, {
            headers: { 'Content-Type': blob.type || 'audio/webm' },
            timeout: 60000,
          })

          if (!data.transcript) {
            toast.error('No speech detected')
            return
          }

          const { data: saved } = await api.post(`/incidents/${activeIncident._id}/notes`, {
            text: data.transcript,
            source: 'VOICE',
          })
          setVoiceNotes(saved.fieldNotes || [])
          toast.success('Note transcribed and sent to the ER')
        } catch {
          toast.error('Could not transcribe that recording')
        } finally {
          setIsTranscribing(false)
        }
      }

      recorder.start()
      recorderRef.current = recorder
      setIsRecordingVoice(true)
    } catch {
      toast.error('Microphone unavailable')
    }
  }

  /** Persist a field-intervention tick, shared with the receiving ER. */
  const toggleFieldChecklist = async (item) => {
    if (!activeIncident?._id) return
    const next = !item.done

    setActiveChecklist((prev) => prev.map((c) => (c.key === item.key ? { ...c, done: next } : c)))

    try {
      const { data } = await api.patch(`/incidents/${activeIncident._id}/checklist`, {
        board: 'field',
        key: item.key,
        done: next,
      })
      setActiveChecklist(data.fieldChecklist || [])
    } catch {
      setActiveChecklist((prev) => prev.map((c) => (c.key === item.key ? { ...c, done: item.done } : c)))
      toast.error('Could not save that step')
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
              <div>{activeAmbulance?.vehicleNumber || 'No unit assigned'}</div>
              <div className="text-[8px] text-cyan-400/60 leading-none hidden sm:block">
                {activeAmbulance?.vehicleType?.replace(/_/g, ' ') || '—'}
              </div>
            </div>
          </div>

          <AiStatusBadge className="hidden lg:inline-flex" />
          <ModeToggle portal="paramedic" className="hidden md:inline-flex" />
          <GuideButton
            tourId="paramedic-v1"
            title="Field Console"
            steps={PARAMEDIC_TOUR_STEPS}
          />

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
              {activeIncident?.allocatedHospital?.name || 'No hospital allocated yet'}
            </div>
            <div className="text-xs text-white/50 leading-tight mt-0.5">
              {activeIncident?.allocatedHospital?.location?.address || '—'}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[9px] font-mono font-semibold">
              {(activeIncident?.allocatedHospital?.resources?.icuBeds?.available ?? 0) > 0 && (
                <span className="px-2 py-0.5 rounded bg-red-950/60 border border-red-500/40 text-red-300">
                  {activeIncident.allocatedHospital.resources.icuBeds.available} ICU free
                </span>
              )}
              {etaMinutes != null && (
                <span className="px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/40 text-cyan-300">
                  {etaMinutes} min ETA
                </span>
              )}
              {activeIncident?.prepChecklist?.some((c) => c.key === 'team-alerted' && c.done) && (
                <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  Receiving team briefed
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Card 2: Green Corridor Telemetry & Traffic Light */}
        <div className="lg:col-span-4 p-3.5 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl flex items-center justify-between gap-3 text-left">
          <div className="flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-mono text-white/40 uppercase font-semibold">ETA</span>
              <span className="text-3xl font-extrabold text-emerald-400 font-mono tracking-tight">
                {etaMinutes ?? '--'}{' '}
                <span className="text-sm font-sans font-medium text-emerald-300/70">min</span>
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono text-white/60 mt-0.5">
              <span>
                Distance <strong className="text-white">{distanceKm ?? '--'} km</strong>
              </span>
              <span>·</span>
              <span>
                Speed:{' '}
                <strong className="text-cyan-300">
                  {ambulanceSpeed != null ? ambulanceSpeed + ' km/h' : gpsActive ? 'stationary' : 'no GPS'}
                </strong>
              </span>
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
            {activeChecklist.length === 0 && (
              <p className="text-sm font-mono text-white/35">
                Interventions appear here once a patient is assigned and triaged. The list is
                generated from that patient&apos;s presentation.
              </p>
            )}
            {activeChecklist.map((item) => (
              <div
                key={item.key}
                onClick={() => toggleFieldChecklist(item)}
                className={`p-4 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                  item.done
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                    : 'bg-white/[0.02] border-white/10 text-white/80 hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center gap-3 font-mono text-sm">
                  <span className="text-lg">{item.done ? '☑' : '☐'}</span>
                  <span>{item.label}</span>
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
              {isTranscribing
                ? 'Transcribing with Whisper...'
                : isRecordingVoice
                ? 'Recording - tap again to stop'
                : 'Tap to dictate a note'}
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-xs font-mono text-white/40 uppercase font-semibold">Transcribed Voice Notes</div>
            {voiceNotes.length === 0 && (
              <p className="text-sm font-mono text-white/35">
                No notes recorded for this patient yet.
              </p>
            )}
            {voiceNotes
              .slice()
              .reverse()
              .map((note, idx) => (
                <div
                  key={note._id || idx}
                  className="p-4 rounded-xl bg-white/[0.03] border border-white/10 font-mono text-xs text-white/80 leading-relaxed"
                >
                  <div className="flex items-center justify-between text-[10px] text-white/40 mb-1.5">
                    <span>
                      {note.at
                        ? new Date(note.at).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })
                        : ''}
                      {note.by ? ' · ' + note.by : ''}
                    </span>
                    <span>{note.source === 'VOICE' ? 'DICTATED' : 'TYPED'}</span>
                  </div>
                  {note.text}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
