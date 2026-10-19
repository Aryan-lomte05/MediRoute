import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { ResponsiveContainer, LineChart, Line } from 'recharts'
import { getSocket } from '../lib/socket'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'
import toast from 'react-hot-toast'

const TRAUMA_CHECKLIST_TEMPLATE = [
  { id: 'scene_safety', category: 'Scene Safety', label: 'Scene confirmed safe to approach' },
  { id: 'airway', category: 'Airway', label: 'Airway patent / secured' },
  { id: 'breathing', category: 'Breathing', label: 'Breathing assessed — adequate rate & effort' },
  { id: 'circulation', category: 'Circulation', label: 'Bleeding controlled, pulses checked' },
  { id: 'vitals', category: 'Vitals', label: 'Baseline vitals recorded & monitored' },
  { id: 'iv_meds', category: 'IV / Medication', label: 'IV access established, medications ready' },
  { id: 'equipment', category: 'Trauma Equipment', label: 'C-collar, splints, O2 prepared' },
  { id: 'hospital_notified', category: 'Handoff', label: 'Receiving hospital notified' },
]

function maneuverIcon(type, modifier) {
  if (type === 'arrive') return '🏁'
  if (type === 'depart') return '🚦'
  if (modifier?.includes('left')) return '↰'
  if (modifier?.includes('right')) return '↱'
  if (modifier === 'straight') return '↑'
  if (modifier?.includes('uturn')) return '↩'
  return '➜'
}

function describeManeuver(step) {
  if (!step) return null
  const type = step.maneuver?.type || 'continue'
  const modifier = step.maneuver?.modifier
  const road = step.name || 'the road ahead'
  const verb =
    type === 'arrive' ? 'Arrive at destination'
    : type === 'depart' ? `Head out on ${road}`
    : modifier ? `${modifier[0].toUpperCase()}${modifier.slice(1)} onto ${road}`
    : `Continue on ${road}`
  return {
    text: verb,
    distance: step.distance ? Math.round(step.distance) : null,
    icon: maneuverIcon(type, modifier),
  }
}

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

export default function ParamedicPortal() {
  const { user, logout } = useAuthStore()

  // Cockpit Navigation Tab
  const [paramedicTab, setParamedicTab] = useState('nav') // 'nav' | 'vitals' | 'protocols' | 'voice'

  // Live Clock State
  const [currentTime, setCurrentTime] = useState('20:24')
  const [currentDate, setCurrentDate] = useState('')

  // Map & Navigation State
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const [mapMode, setMapMode] = useState('3D') // '3D' | '2D'
  const [distanceKm, setDistanceKm] = useState('—')

  // Live route data (real OSRM geometry/steps via existing /api/ai/route) + ETA countdown
  const [routeData, setRouteData] = useState(null) // { etaMinutes, distanceKm, steps }
  const [etaSecondsLeft, setEtaSecondsLeft] = useState(null) // null = no ETA known yet
  const [currentStepIdx, setCurrentStepIdx] = useState(0)

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
  const [vitalsSource, setVitalsSource] = useState('demo')

  // Demo/sample baseline only; no monitor integration is connected.
  const [vitalsHistory, setVitalsHistory] = useState(() => [
    { t: 0, heartRate: 118, spO2: 92, bpSystolic: 85 },
  ])

  const [activeChecklist, setActiveChecklist] = useState([
    { id: 1, text: "Administer 500 mL IV crystalloid bolus (Ringer's Lactate)", done: false },
    { id: 2, text: 'Apply high-flow oxygen via non-rebreather mask (15 L/min)', done: false },
    { id: 3, text: 'Control hemorrhage, apply tourniquet if extremity bleeding persists', done: false },
    { id: 4, text: 'Notify trauma bay for priority surgical handoff', done: false },
  ])

  // Pre-Arrival Trauma Checklist — a workflow checklist, not medical advice.
  // Persisted per-incident (or per-session if no active incident yet).
  const [traumaChecklist, setTraumaChecklist] = useState(() =>
    TRAUMA_CHECKLIST_TEMPLATE.map((item) => ({ ...item, done: false }))
  )

  // Dispatch & Workflow Status
  const [dispatchStatus, setDispatchStatus] = useState('PENDING')
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [voiceNotes, setVoiceNotes] = useState([])

  // Digital Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setCurrentTime(now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }))
      setCurrentDate(now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }))
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
            setVitalsSource('incident')
          } else {
            setVitalsSource('demo')
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

  // Route estimate from the last reported vehicle location to the current
  // incident destination. No browser GPS feed is connected, so this is not live navigation.
  useEffect(() => {
    const hospitalDestination = activeIncident?.allocatedHospital?.location?.coordinates
    const sceneDestination = activeIncident?.location?.coordinates
    const destination = dispatchStatus === 'EN_ROUTE_TO_HOSPITAL' ? hospitalDestination : sceneDestination
    const origin = activeAmbulance?.currentLocation?.coordinates
    const validPoint = (point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && !(point[0] === 0 && point[1] === 0)
    if (!validPoint(origin) || !validPoint(destination)) {
      setRouteData(null)
      setEtaSecondsLeft(null)
      setDistanceKm('—')
      return
    }

    let cancelled = false
    api
      .post('/ai/route', { origin, destination })
      .then((res) => {
        if (cancelled || !res.data) return
        setRouteData(res.data)
        setDistanceKm(String(res.data.distanceKm))
        setCurrentStepIdx(0)
      })
      .catch((err) => {
        console.warn('Route estimate unavailable:', err.message)
        if (!cancelled) {
          setRouteData(null)
          setEtaSecondsLeft(null)
          setDistanceKm('—')
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeAmbulance?.currentLocation?.updatedAt, activeIncident?._id, activeIncident?.status, dispatchStatus])

  // ETA countdown — seeded from real route data (or the incident's own
  // route.etaMinutes if the backend already computed one), ticks down every
  // second, never goes negative, and shows an "Arrived" state on completion.
  useEffect(() => {
    const sourceMinutes = routeData?.etaMinutes ?? activeIncident?.route?.etaMinutes
    if (sourceMinutes == null) return
    setEtaSecondsLeft(Math.round(sourceMinutes * 60))
  }, [routeData?.etaMinutes, activeIncident?.route?.etaMinutes])

  useEffect(() => {
    if (etaSecondsLeft === null) return
    if (['AT_PATIENT', 'ARRIVED_AT_HOSPITAL', 'COMPLETED', 'CANCELLED'].includes(dispatchStatus)) return
    const timer = setInterval(() => {
      setEtaSecondsLeft((s) => (s === null ? null : Math.max(0, s - 1)))
    }, 1000)
    return () => clearInterval(timer)
  }, [etaSecondsLeft === null, dispatchStatus])

  const etaDisplay = useMemo(() => {
    if (dispatchStatus === 'AT_PATIENT') return 'At scene'
    if (['ARRIVED_AT_HOSPITAL', 'COMPLETED'].includes(dispatchStatus)) return 'Arrived'
    if (etaSecondsLeft === null) return '—:—'
    if (etaSecondsLeft === 0) return 'Arriving'
    const m = Math.floor(etaSecondsLeft / 60)
    const s = etaSecondsLeft % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }, [etaSecondsLeft, dispatchStatus])

  // Persist the Pre-Arrival Trauma Checklist per-incident (falls back to a
  // shared session key when there's no active incident yet).
  const checklistStorageKey = `mediroute-trauma-checklist-${activeIncident?._id || 'session'}`
  useEffect(() => {
    try {
      const saved = localStorage.getItem(checklistStorageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        setTraumaChecklist(TRAUMA_CHECKLIST_TEMPLATE.map((item) => ({ ...item, done: !!parsed[item.id] })))
      } else {
        setTraumaChecklist(TRAUMA_CHECKLIST_TEMPLATE.map((item) => ({ ...item, done: false })))
      }
    } catch {
      toast.error('Checklist could not be loaded from this device.')
    }
  }, [checklistStorageKey])

  const toggleTraumaChecklistItem = (id) => {
    setTraumaChecklist((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
      try {
        const toSave = Object.fromEntries(next.map((item) => [item.id, item.done]))
        localStorage.setItem(checklistStorageKey, JSON.stringify(toSave))
      } catch {
        toast.error('Checklist changed for this session but could not be saved on this device.')
      }
      return next
    })
  }

  // Live Mapbox Initialization
  useEffect(() => {
    if (paramedicTab !== 'nav' || !mapRef.current || mapInstanceRef.current) return

    const vehiclePosition = activeAmbulance?.currentLocation?.coordinates
    const hasVehiclePosition = Array.isArray(vehiclePosition) && vehiclePosition.length === 2 &&
      vehiclePosition.every(Number.isFinite) && vehiclePosition[0] >= -180 && vehiclePosition[0] <= 180 &&
      vehiclePosition[1] >= -90 && vehiclePosition[1] <= 90 && !(vehiclePosition[0] === 0 && vehiclePosition[1] === 0)
    if (!hasVehiclePosition) return

    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: vehiclePosition,
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

      const routeCoordinates = routeData?.geometry?.coordinates
      if (Array.isArray(routeCoordinates) && routeCoordinates.length > 1) {
        map.addSource('paramedic-route', {
          type: 'geojson',
          data: { type: 'Feature', geometry: routeData.geometry, properties: {} },
        })
        map.addLayer({
          id: 'paramedic-route-line',
          type: 'line',
          source: 'paramedic-route',
          paint: { 'line-color': '#00F5FF', 'line-width': 4, 'line-opacity': 0.9 },
        })
      }

      // Mark the vehicle's last reported position, never a demo coordinate.
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
        .setLngLat(vehiclePosition)
        .addTo(map)

    })

    mapInstanceRef.current = map

    return () => {
      map.remove()
      mapInstanceRef.current = null
    }
  }, [paramedicTab, activeAmbulance?.currentLocation?.coordinates?.[0], activeAmbulance?.currentLocation?.coordinates?.[1], routeData?.geometry])

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
    const position = activeAmbulance?.currentLocation?.coordinates
    if (!Array.isArray(position) || position.length !== 2 || !position.every(Number.isFinite) || position.every((value) => value === 0)) {
      toast.error('No vehicle GPS position is available to recenter the map.')
      return
    }
    mapInstanceRef.current.flyTo({ center: position, zoom: 14, pitch: 58, duration: 1000 })
    toast('Map centered on the last reported vehicle location.', { icon: '📍' })
  }

  // Action: Transmit Vitals
  const transmitVitals = async () => {
    if (!activeIncident?._id) {
      toast.error('No active incident is linked. Vitals were not shared.')
      return
    }
    if (vitalsSource === 'demo') {
      toast.error('These are demo values. Load incident vitals or adjust them as manual measurements before sharing.')
      return
    }
    try {
      await api.patch(`/incidents/${activeIncident._id}/status`, { vitals: patientVitals })
      const socket = getSocket()
      if (!socket?.connected) {
        toast.success('Vitals saved to the incident. Live delivery to connected listeners is unconfirmed.')
        return
      }
      socket.timeout(3000).emit('vitals_update', { incidentId: activeIncident._id, vitals: patientVitals }, (err, result) => {
        if (err || !result?.success) toast.error(`Vitals saved, but live delivery was not confirmed: ${result?.message || 'connection timed out'}`)
        else toast.success('Vitals saved and delivered to connected incident listeners.')
      })
    } catch (err) {
      toast.error(`Vitals were not saved or shared: ${err.response?.data?.message || err.message}`)
    }
  }

  // Voice notes are added locally only after the server confirms transcription
  // and persistence; failures never create a placeholder transcript.
  const logVoiceNote = (text) => setVoiceNotes((prev) => [`[${currentTime}] ${text}`, ...prev])

  const handleVoiceLog = () => {
    if (isRecordingVoice) return
    setIsRecordingVoice(true)

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setIsRecordingVoice(false)
      toast.error('Microphone recording is unavailable in this browser. No note was created.')
      return
    }

    toast('Recording a short note for Groq Whisper…', { icon: '🎙️' })

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => window.MediaRecorder.isTypeSupported?.(type)) || ''
        if (!mimeType) {
          stream.getTracks().forEach((t) => t.stop())
          setIsRecordingVoice(false)
          toast.error('This browser does not support an accepted recording format. No note was created.')
          return
        }
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        const chunks = []

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data)
        }

        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop())
          try {
            const blob = new Blob(chunks, { type: mimeType })
            if (!blob.size || blob.size > 7 * 1024 * 1024) throw new Error('Recording is empty or larger than 7 MB.')
            const base64 = await new Promise((resolve, reject) => {
              const reader = new FileReader()
              reader.onloadend = () => resolve(String(reader.result).split(',')[1])
              reader.onerror = reject
              reader.readAsDataURL(blob)
            })

            if (!activeIncident?._id) throw new Error('No active incident is linked; the transcript was not saved.')
            const res = await api.post('/ai/whisper-transcribe', {
              audioBase64: base64,
              mimeType: blob.type,
              durationSeconds: 5,
              incidentId: activeIncident?._id,
            })

            const transcript = res.data?.text?.trim()
            if (!transcript) throw new Error('No speech was detected; no transcript was saved.')
            logVoiceNote(transcript)
            toast.success('Groq Whisper transcript saved to the incident notes.')
          } catch (err) {
            console.warn('Whisper transcription unavailable:', err.message)
            toast.error(`Transcript was not saved: ${err.response?.data?.message || err.message}`)
          } finally {
            setIsRecordingVoice(false)
          }
        }

        recorder.start()
        setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop()
        }, 5000)
      })
      .catch((err) => {
        console.warn('Microphone access denied/unavailable:', err.message)
        setIsRecordingVoice(false)
        toast.error(`Microphone access failed: ${err.message}. No note was created.`)
      })
  }

  // Action: Arrived at Patient
  const handleArrived = async () => {
    if (!activeIncident?._id) return toast.error('No active incident. Arrival status was not saved.')
    try {
      await api.patch(`/incidents/${activeIncident._id}/status`, { status: 'AT_PATIENT' })
      setDispatchStatus('AT_PATIENT')
      toast.success('Arrival status saved to the incident.')
    } catch (err) {
      toast.error(`Arrival status was not saved: ${err.response?.data?.message || err.message}`)
    }
  }

  const handleEnRouteToHospital = async () => {
    if (!activeIncident?._id) return toast.error('No active incident. Route status was not saved.')
    try {
      await api.patch(`/incidents/${activeIncident._id}/status`, { status: 'EN_ROUTE_TO_HOSPITAL' })
      setDispatchStatus('EN_ROUTE_TO_HOSPITAL')
    } catch (err) {
      toast.error(`Could not save route status: ${err.response?.data?.message || err.message}`)
    }
  }

  // Action: Handed over to ER
  const handleHandedOver = async () => {
    if (!activeIncident?._id) return toast.error('No active incident. Handoff status was not saved.')
    try {
      await api.patch(`/incidents/${activeIncident._id}/status`, { status: 'COMPLETED' })
      setDispatchStatus('COMPLETED')
      toast.success(`Handoff status saved for ${activeIncident?.allocatedHospital?.name || 'the assigned hospital'}.`)
    } catch (err) {
      toast.error(`Handoff status was not saved: ${err.response?.data?.message || err.message}`)
    }
  }

  // Vitals Increment / Decrement
  const adjustVital = (key, delta) => {
    setVitalsSource('manual')
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
                <span className="text-white/30 text-[9px]">· Demo session</span>
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
              <div>{activeAmbulance?.vehicleNumber || 'Unit unassigned'}</div>
              <div className="text-[8px] text-cyan-400/60 leading-none hidden sm:block">
                {activeAmbulance?.vehicleType?.replace(/_/g, ' ') || 'No unit assignment'}
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
          <span>Traffic signal integration unavailable</span>
        </div>
      </nav>

      {/* ── TOP HUD CARDS ROW (3 Cards: Hospital / Route / Alert) ── */}
      <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 shrink-0">
        {/* Card 1: Destination Hospital Card */}
        <div className="lg:col-span-5 p-3.5 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600/30 to-blue-600/30 border border-purple-500/40 flex flex-col items-center justify-center text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.3)] shrink-0">
            <span className="text-xl">🏥</span>
            <span className="text-[8px] font-mono font-bold mt-0.5 uppercase tracking-wider">ESI {activeIncident?.triageData?.esiLevel ?? '—'}</span>
          </div>

          <div className="flex-1 min-w-0 text-left">
            <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider font-semibold">
              DESTINATION FACILITY
            </div>
            <div className="text-base font-extrabold text-white leading-tight truncate">
              {activeIncident?.allocatedHospital?.name || 'No hospital allocated'}
            </div>
            <div className="text-xs text-white/50 leading-tight mt-0.5">
              {activeIncident?.allocatedHospital?.location?.address || activeIncident?.location?.address || 'Location unavailable'}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[9px] font-mono font-semibold">
              <span className="px-2 py-0.5 rounded bg-red-950/60 border border-red-500/40 text-red-300">
                {activeIncident?.allocatedHospital ? 'Hospital allocated' : 'Awaiting allocation'}
              </span>
              <span className="px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/40 text-cyan-300">
                {etaDisplay} estimated ETA
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                {activeIncident?.assignedAmbulance ? 'Unit assigned' : 'Dispatch unconfirmed'}
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
                {etaDisplay}
                {etaSecondsLeft !== null && !['AT_PATIENT', 'ARRIVED_AT_HOSPITAL', 'COMPLETED'].includes(dispatchStatus) && (
                  <span className="text-sm font-sans font-medium text-emerald-300/70"> countdown</span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono text-white/60 mt-0.5">
              <span>Estimated distance <strong className="text-white">{distanceKm} km</strong></span>
              <span>·</span>
              <span>Vehicle speed: <strong className="text-cyan-300">{activeAmbulance?.currentLocation?.speed ?? '—'} km/h</strong></span>
            </div>

            <div className="flex items-center gap-2 mt-2">
              <div className="px-2.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] font-bold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#10b981]" />
                <span>Green corridor: demo only</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400/80 flex items-center gap-1">
                <span>•</span> No live signal feed
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
              if (!activeIncident?._id) return toast.error('No active incident. Trauma alert was not sent.')
              const socket = getSocket()
              if (!socket?.connected) return toast.error('Live connection is unavailable. Trauma alert was not sent.')
              socket.timeout(3000).emit('trauma_alert', { incidentId: activeIncident._id, vitals: patientVitals }, (err, result) => {
                if (err || !result?.success) toast.error(`Trauma alert was not confirmed: ${result?.message || 'connection timed out'}`)
                else toast.success('Trauma alert delivered to connected incident listeners.')
              })
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
          {/* Route maneuvers are an estimate from the last reported vehicle location. */}
          {(() => {
            const steps = routeData?.steps
            const current = steps?.length ? describeManeuver(steps[currentStepIdx]) : null
            const next = steps?.length ? describeManeuver(steps[currentStepIdx + 1]) : null
            return (
              <div className="px-4 py-2.5 rounded-xl bg-[#0a0f1d] border border-cyan-500/30 shadow-lg flex items-center justify-between gap-4 shrink-0 text-left">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300 text-xl font-bold shrink-0">
                    {current ? current.icon : '↰'}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-extrabold text-white leading-tight truncate">
                      {current
                        ? `${current.text}${current.distance ? ` · in ${current.distance} m` : ''}`
                        : 'No route estimate available for the current vehicle location'}
                    </div>
            <div className="text-[11px] text-emerald-400 font-mono leading-tight truncate">
                      {next ? `Next preview step: ${next.text}` : 'Route preview only; steps do not advance with vehicle GPS'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <button
                    onClick={() => recenter()}
                    className="px-3 py-1 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-mono text-white/80 transition-all flex items-center gap-1.5"
                  >
                    <span>Recenter</span>
                    <span>⤢</span>
                  </button>
                </div>
              </div>
            )
          })()}

          {/* Map initializes only when a real vehicle position is available. */}
          <div className="h-[320px] lg:h-[380px] rounded-2xl overflow-hidden border border-white/[0.08] relative shadow-2xl shrink-0">
            <div ref={mapRef} className="w-full h-full" />
            {(!Array.isArray(activeAmbulance?.currentLocation?.coordinates) || activeAmbulance.currentLocation.coordinates.length !== 2 ||
              !activeAmbulance.currentLocation.coordinates.every(Number.isFinite) ||
              activeAmbulance.currentLocation.coordinates[0] < -180 || activeAmbulance.currentLocation.coordinates[0] > 180 ||
              activeAmbulance.currentLocation.coordinates[1] < -90 || activeAmbulance.currentLocation.coordinates[1] > 90 ||
              (activeAmbulance.currentLocation.coordinates[0] === 0 && activeAmbulance.currentLocation.coordinates[1] === 0)) && (
              <div className="absolute inset-0 z-10 bg-[#090d16] flex items-center justify-center px-6 text-center text-sm font-mono text-white/60">
                No vehicle GPS position is available. The map will appear after the vehicle reports its location.
              </div>
            )}

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
              <span className="font-bold text-white text-xs">Field navigation</span> · Last reported vehicle position
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
            {dispatchStatus === 'AT_PATIENT' ? (
              <button onClick={handleEnRouteToHospital} className="py-3 rounded-xl bg-yellow-600/30 hover:bg-yellow-600/50 border border-yellow-500/50 text-yellow-300 font-mono text-xs font-bold transition-all shadow-lg">
                🚑 En route to hospital
              </button>
            ) : dispatchStatus === 'EN_ROUTE_TO_HOSPITAL' || dispatchStatus === 'ARRIVED_AT_HOSPITAL' ? (
              <button onClick={handleHandedOver} className="py-3 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/50 text-emerald-300 font-mono text-xs font-bold transition-all shadow-lg">
                🤝 Handed Over to ER
              </button>
            ) : (
              <button onClick={handleArrived} className="py-3 rounded-xl bg-yellow-600/30 hover:bg-yellow-600/50 border border-yellow-500/50 text-yellow-300 font-mono text-xs font-bold transition-all shadow-lg">
                📍 Arrived at Patient
              </button>
            )}
          </div>
        </div>
      )}

      {/* SUBVIEW 2: PATIENT VITALS TELEMETRY & STABILIZATION */}
      {paramedicTab === 'vitals' && (
        <div className="flex-1 p-5 space-y-5 overflow-y-auto text-left">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
            <div>
              <h2 className="text-xl font-extrabold text-white">Patient Vitals & On-Scene Notes</h2>
              <p className="text-xs text-white/50 font-mono mt-0.5">
                {vitalsSource === 'incident' ? 'Showing values saved on this incident; no patient monitor is connected.' : 'Demo values only. Enter measurements manually before sharing; no patient monitor is connected.'}
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
              <div className="h-10 -mx-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={vitalsHistory}>
                    <Line type="monotone" dataKey="heartRate" stroke="#f87171" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
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
              <div className="h-10 -mx-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={vitalsHistory}>
                    <Line type="monotone" dataKey="bpSystolic" stroke="#facc15" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
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
              <div className="h-10 -mx-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={vitalsHistory}>
                    <Line type="monotone" dataKey="spO2" stroke="#22d3ee" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
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
        <div className="flex-1 p-5 space-y-8 overflow-y-auto text-left">
          <div>
            <div className="pb-3 border-b border-white/[0.08]">
              <h2 className="text-xl font-extrabold text-white">AI-Suggested Clinical Actions</h2>
              <p className="text-xs text-white/50 font-mono mt-0.5">
                {activeIncident?.triageData?.recommendedActions?.length
                  ? 'Generated by MediRoute AI triage for the current incident.'
                  : 'Protocol adherence checklist for trauma handoff and pharmacotherapy.'}
              </p>
            </div>

            <div className="space-y-3 mt-4">
              {(activeIncident?.triageData?.recommendedActions?.length
                ? activeIncident.triageData.recommendedActions.map((text, idx) => ({ id: `ai-${idx}`, text, done: false }))
                : activeChecklist
              ).map((item) => (
                <div
                  key={item.id}
                  onClick={() =>
                    setActiveChecklist((prev) =>
                      prev.some((c) => c.id === item.id)
                        ? prev.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c))
                        : prev
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

          <div>
            <div className="pb-3 border-b border-white/[0.08]">
              <h2 className="text-xl font-extrabold text-white">Pre-Arrival Trauma Checklist</h2>
              <p className="text-xs text-white/50 font-mono mt-0.5">
                Checklist is saved only in this browser — it is not shared with the hospital. This is a workflow aid, not medical guidance.
              </p>
            </div>

            <div className="space-y-2 mt-4">
              {traumaChecklist.map((item) => (
                <div
                  key={item.id}
                  onClick={() => toggleTraumaChecklistItem(item.id)}
                  className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-all min-h-[52px] ${
                    item.done
                      ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                      : 'bg-white/[0.02] border-white/10 text-white/80 hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-center gap-3 font-mono text-sm min-w-0">
                    <span className="text-lg shrink-0">{item.done ? '☑' : '☐'}</span>
                    <span className="min-w-0">
                      <span className="block text-[10px] uppercase tracking-wider text-white/40">{item.category}</span>
                      <span className="block truncate">{item.label}</span>
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-white/40 shrink-0">{item.done ? 'DONE' : 'PENDING'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SUBVIEW 4: WHISPER VOICE LOG */}
      {paramedicTab === 'voice' && (
        <div className="flex-1 p-5 space-y-5 overflow-y-auto text-left">
          <div className="pb-3 border-b border-white/[0.08]">
            <h2 className="text-xl font-extrabold text-white">Whisper Speech-to-Text Clinical Dictation</h2>
            <p className="text-xs text-white/50 font-mono mt-0.5">
              Records up to 5 seconds and saves a successful Groq Whisper transcript to the active incident. Failures create no placeholder note.
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
              {isRecordingVoice ? 'Recording for Groq Whisper…' : 'Tap to record a short voice note'}
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
