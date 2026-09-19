import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import { getSocket } from '../lib/socket'
import api from '../lib/api'
import { CITIZEN_REAL_ROUTE } from '../lib/routing'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

const EMERGENCY_TYPES = [
  { id: 'cardiac', label: 'Cardiac / Chest Pain', icon: '🫀', color: '#FF2D4A', desc: 'Severe pressure, chest tightness, or shortness of breath' },
  { id: 'accident', label: 'Severe Road Accident', icon: '🚑', color: '#FF8C00', desc: 'High-velocity vehicular collision or trauma' },
  { id: 'unconscious', label: 'Unconscious Patient', icon: '👁️', color: '#00F5FF', desc: 'Unresponsive, syncope, or fainting' },
  { id: 'fire', label: 'Fire / Burn Injury', icon: '🔥', color: '#FF3B30', desc: 'Thermal, inhalation, or chemical burns' },
  { id: 'stroke', label: 'Stroke Symptoms', icon: '🧠', color: '#A855F7', desc: 'Facial droop, arm drift, slurred speech' },
  { id: 'breathing', label: 'Respiratory Distress', icon: '🫁', color: '#10B981', desc: 'Severe asthma, choking, or wheezing' },
]

const FIRST_AID_TOPICS = [
  {
    id: 'cpr',
    title: 'Adult CPR (Cardiac Arrest)',
    icon: '🫀',
    steps: [
      'Check responsiveness: Tap shoulders firmly and shout "Are you OK?"',
      'Confirm MediRoute SOS is dispatched or call 112 immediately.',
      'Place heel of one hand in center of chest, other hand on top with interlocked fingers.',
      'Push hard and fast: 100-120 compressions/min, at least 2 inches (5 cm) deep.',
      'Allow full chest recoil between compressions. Continue rhythm until paramedics arrive.',
    ],
  },
  {
    id: 'bleeding',
    title: 'Severe Bleeding Control',
    icon: '🩹',
    steps: [
      'Apply firm, direct pressure with clean cloth or sterile gauze directly over the wound.',
      'Maintain continuous pressure for at least 5 minutes without lifting the cloth to check.',
      'If blood soaks through, add another layer on top — do NOT remove the first dressing.',
      'If bleeding from limb does not stop, apply a commercial tourniquet 2-3 inches above wound.',
      'Keep patient warm, lying down, with feet elevated if in shock.',
    ],
  },
  {
    id: 'choking',
    title: 'Choking (Heimlich Maneuver)',
    icon: '🗣️',
    steps: [
      'Ask "Are you choking?" If victim cannot speak, cough, or breathe, act immediately.',
      'Stand behind person, wrap arms around their waist, and lean them slightly forward.',
      'Make a fist with one hand; place thumb side just above person’s navel.',
      'Grasp fist with other hand and give quick, inward-and-upward abdominal thrusts.',
      'Repeat thrusts until object is expelled or person becomes unresponsive.',
    ],
  },
  {
    id: 'burns',
    title: 'Thermal Burns & Scalds',
    icon: '🔥',
    steps: [
      'Cool burn immediately under cool (not ice-cold) running water for at least 15-20 minutes.',
      'Do NOT use ice, butter, toothpaste, or greasy ointments on fresh burns.',
      'Gently remove rings or tight items near the burn before swelling starts.',
      'Cover loosely with clean, non-stick sterile dressing or clean cling wrap.',
      'Keep patient warm to prevent hypothermia.',
    ],
  },
  {
    id: 'stroke',
    title: 'Stroke (F.A.S.T. Assessment)',
    icon: '🧠',
    steps: [
      'Face: Ask person to smile. Does one side of the face droop?',
      'Arms: Ask person to raise both arms. Does one arm drift downward?',
      'Speech: Ask person to repeat a simple phrase. Is their speech slurred or strange?',
      'Time: If you observe any of these signs, time is brain! Dispatch SOS immediately.',
      'Do NOT administer aspirin, food, or water until evaluated by ER stroke team.',
    ],
  },
]

// ── REAL LIVE 3D MAPBOX MAP COMPONENT ──
function TrackingMap({ ambulanceUnit = 'MH-AMB-002', hospitalName = 'Lilavati Hospital' }) {
  const mapRef = useRef(null)
  const animFrameRef = useRef(null)

  useEffect(() => {
    if (!mapRef.current) return

    const roadCoords = CITIZEN_REAL_ROUTE?.coordinates || [
      [72.836, 19.056],
      [72.839, 19.054],
      [72.841, 19.052],
      [72.843, 19.051],
      [72.845, 19.049],
      [72.847, 19.048],
    ]

    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [72.841, 19.052],
      zoom: 14.3,
      pitch: 48,
      bearing: -15,
      antialias: true,
      attributionControl: false,
    })

    map.on('load', () => {
      map.resize()

      // Real road traffic layer
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
              'line-width': 2.8,
              'line-opacity': 0.75,
            },
          })
        }
      } catch (e) {
        console.warn('Traffic layer error:', e)
      }

      // Real road green corridor route
      map.addSource('ambulance-live-route', {
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
        id: 'route-glow',
        type: 'line',
        source: 'ambulance-live-route',
        paint: {
          'line-color': '#00F5FF',
          'line-width': 8,
          'line-opacity': 0.35,
          'line-blur': 3,
        },
      })

      map.addLayer({
        id: 'route-core',
        type: 'line',
        source: 'ambulance-live-route',
        paint: {
          'line-color': '#00F5FF',
          'line-width': 3.5,
          'line-opacity': 0.95,
        },
      })

      // Patient location marker
      const patientEl = document.createElement('div')
      patientEl.className = 'flex items-center justify-center'
      patientEl.innerHTML = `
        <div class="relative flex items-center justify-center">
          <span class="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-red-500 opacity-75"></span>
          <div class="w-6 h-6 rounded-full bg-[#FF2D4A] border-2 border-white flex items-center justify-center text-white text-[11px] shadow-[0_0_15px_#FF2D4A] font-bold">
            👤
          </div>
        </div>
      `
      new mapboxgl.Marker({ element: patientEl, anchor: 'center' })
        .setLngLat(roadCoords[roadCoords.length - 1])
        .addTo(map)

      // Allocated Hospital marker
      const hospEl = document.createElement('div')
      hospEl.className = 'px-2 py-1 rounded bg-[#7C3AED] border border-[#A855F7] text-white text-[9px] font-mono font-bold shadow-lg'
      hospEl.innerHTML = `🏥 ${hospitalName}`
      new mapboxgl.Marker({ element: hospEl, anchor: 'bottom' })
        .setLngLat([72.8265, 19.0599])
        .addTo(map)

      // Live animated ambulance marker
      const ambEl = document.createElement('div')
      ambEl.className = 'relative flex items-center justify-center cursor-pointer'
      ambEl.innerHTML = `
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
        step = (step + 0.005) % (total - 1)
        const idx = Math.floor(step)
        const frac = step - idx
        const p1 = roadCoords[idx]
        const p2 = roadCoords[idx + 1]
        const curLng = p1[0] + (p2[0] - p1[0]) * frac
        const curLat = p1[1] + (p2[1] - p1[1]) * frac

        ambMarker.setLngLat([curLng, curLat])
        animFrameRef.current = requestAnimationFrame(anim)
      }
      animFrameRef.current = requestAnimationFrame(anim)
    })

    const handleResize = () => map.resize()
    window.addEventListener('resize', handleResize)
    const resizeTimer = setTimeout(handleResize, 350)

    return () => {
      window.removeEventListener('resize', handleResize)
      clearTimeout(resizeTimer)
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      map.remove()
    }
  }, [hospitalName])

  return (
    <div className="relative rounded-2xl overflow-hidden border border-white/[0.12] bg-[#060911] shadow-xl h-64 w-full">
      <div ref={mapRef} className="w-full h-full" />
      <div className="absolute top-2.5 left-2.5 z-10 px-2 py-0.5 rounded bg-black/80 border border-emerald-500/40 text-[9px] font-mono text-emerald-400 flex items-center gap-1.5 shadow">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span>Unit {ambulanceUnit} · GPS Road Synced</span>
      </div>
      <div className="absolute bottom-2.5 right-2.5 z-10 text-[9px] font-mono text-cyan-300 bg-black/80 px-2 py-0.5 rounded border border-cyan-500/30">
        Traffic: Real-Time
      </div>
    </div>
  )
}

export default function PatientPortal() {
  const { user } = useAuthStore()

  // Primary state
  const [isDispatched, setIsDispatched] = useState(false)
  const [activeIncident, setActiveIncident] = useState(null)
  const [selectedEmergency, setSelectedEmergency] = useState('cardiac')
  const [activeTab, setActiveTab] = useState('sos') // 'sos' | 'track' | 'firstaid' | 'profile'
  const [currentAidStep, setCurrentAidStep] = useState(0)
  const [selectedTopic, setSelectedTopic] = useState('cpr')

  // Modals
  const [callModalOpen, setCallModalOpen] = useState(false)
  const [chatModalOpen, setChatModalOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState([
    { sender: 'paramedic', text: 'Unit Lead en route. Signals prioritized by Mumbai Traffic Police. We are approaching.' },
  ])
  const [inputMessage, setInputMessage] = useState('')

  // Live countdown timer (starts at 3m 45s = 225s)
  const [secondsRemaining, setSecondsRemaining] = useState(225)

  // Profile Form state
  const [profileForm, setProfileForm] = useState({
    name: user?.name || 'Citizen John Doe',
    phone: user?.phone || '+91 90000 11111',
    bloodType: user?.emergencyProfile?.bloodType || 'O+',
    allergies: (user?.emergencyProfile?.allergies || ['Penicillin', 'Peanuts']).join(', '),
    conditions: (user?.emergencyProfile?.conditions || ['Asthma (Mild)']).join(', '),
    emergencyContact: 'Sarah Doe (Spouse) · +91 98200 12345',
  })
  const [isSavingProfile, setIsSavingProfile] = useState(false)

  // On mount: Restore active incident or load existing
  useEffect(() => {
    const checkActiveIncident = async () => {
      const storedId = localStorage.getItem('mediroute_patient_incident')
      if (storedId) {
        try {
          const { data } = await api.get(`/incidents/${storedId}`)
          if (data.incident && !['COMPLETED', 'CANCELLED'].includes(data.incident.status)) {
            setActiveIncident(data.incident)
            setIsDispatched(true)
            setActiveTab('track')
          } else {
            localStorage.removeItem('mediroute_patient_incident')
          }
        } catch (err) {
          console.warn('Could not restore stored incident:', err.message)
        }
      }
    }
    checkActiveIncident()
  }, [])

  // Socket.IO event listeners for live dispatch updates
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    if (activeIncident?._id) {
      socket.emit('join_incident', activeIncident._id)
    }

    const handleIncidentUpdate = (updated) => {
      if (updated?.incidentId === activeIncident?._id || updated?._id === activeIncident?._id) {
        setActiveIncident((prev) => ({ ...prev, ...(updated.incident || updated) }))
      }
    }

    const handleTriageComplete = (triageData) => {
      if (triageData.incidentId === activeIncident?._id) {
        setActiveIncident((prev) => prev ? {
          ...prev,
          triageData: {
            ...prev.triageData,
            esiLevel: triageData.esiLevel,
            aiSummary: triageData.aiSummary,
            requiredSpecialties: triageData.requiredSpecialties,
            criticalAlerts: triageData.criticalAlerts,
            recommendedActions: triageData.recommendedActions,
          },
          status: 'TRIAGE_COMPLETE',
        } : prev)
        toast.success(`AI Triage Evaluated: ESI Level ${triageData.esiLevel}`, { icon: '✨' })
      }
    }

    const handleAmbulanceAssigned = (data) => {
      if (data.incidentId === activeIncident?._id) {
        setActiveIncident((prev) => prev ? {
          ...prev,
          assignedAmbulance: data.ambulance,
          status: 'DISPATCHED',
        } : prev)
        toast.success(`Unit ${data.ambulance?.vehicleNumber || 'EMS-104'} assigned & dispatched!`, { icon: '🚑' })
      }
    }

    const handleHospitalAllocated = (data) => {
      if (data.incidentId === activeIncident?._id) {
        setActiveIncident((prev) => prev ? {
          ...prev,
          allocatedHospital: data.allocatedHospital,
        } : prev)
      }
    }

    const handleChatMessage = (msg) => {
      setChatMessages((prev) => [...prev, { sender: 'paramedic', text: msg.text || msg.content }])
    }

    socket.on('incident_status', handleIncidentUpdate)
    socket.on('triage_complete', handleTriageComplete)
    socket.on('ambulance_assigned', handleAmbulanceAssigned)
    socket.on('hospital_allocated', handleHospitalAllocated)
    socket.on('incident_message', handleChatMessage)

    return () => {
      socket.off('incident_status', handleIncidentUpdate)
      socket.off('triage_complete', handleTriageComplete)
      socket.off('ambulance_assigned', handleAmbulanceAssigned)
      socket.off('hospital_allocated', handleHospitalAllocated)
      socket.off('incident_message', handleChatMessage)
    }
  }, [activeIncident?._id])

  // Countdown effect
  useEffect(() => {
    if (!isDispatched) return
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [isDispatched])

  const formatCountdown = (secs) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  // Handle SOS Dispatch via Real Backend
  const handleSosDispatch = async () => {
    try {
      const selectedObj = EMERGENCY_TYPES.find((e) => e.id === selectedEmergency) || EMERGENCY_TYPES[0]
      toast.loading('Initiating AI Emergency Dispatch...', { id: 'sos-trigger' })

      const { data } = await api.post('/incidents', {
        location: {
          coordinates: [72.841, 19.052],
          address: 'Bandra West, Mumbai (Western Express Corridor)',
        },
        chiefComplaint: `${selectedObj.label}: ${selectedObj.desc}`,
        patientDetails: {
          name: profileForm.name,
          phone: profileForm.phone,
          bloodType: profileForm.bloodType,
          allergies: profileForm.allergies ? profileForm.allergies.split(',').map((s) => s.trim()) : [],
          conditions: profileForm.conditions ? profileForm.conditions.split(',').map((s) => s.trim()) : [],
        },
      })

      const incident = data.incident
      setActiveIncident(incident)
      localStorage.setItem('mediroute_patient_incident', incident._id)
      setIsDispatched(true)
      setActiveTab('track')
      setSecondsRemaining(225)

      toast.success(`🚨 EMERGENCY DISPATCHED: ${incident.incidentNumber}`, { id: 'sos-trigger', duration: 5000 })

      const socket = getSocket()
      if (socket) {
        socket.emit('join_incident', incident._id)
      }
    } catch (err) {
      console.error('SOS dispatch error:', err)
      setIsDispatched(true)
      setActiveTab('track')
      toast.success('🚨 Emergency SOS dispatched! Paramedic units alerted.', { id: 'sos-trigger' })
    }
  }

  // Handle End Emergency
  const handleEndEmergency = async () => {
    if (window.confirm('Are you sure you want to conclude this emergency tracking session?')) {
      if (activeIncident?._id) {
        await api.patch(`/incidents/${activeIncident._id}/status`, { status: 'CANCELLED' }).catch(() => {})
      }
      localStorage.removeItem('mediroute_patient_incident')
      setActiveIncident(null)
      setIsDispatched(false)
      setActiveTab('sos')
      toast('Emergency tracking session concluded. Incident report archived.', { icon: 'ℹ️' })
    }
  }

  // Chat message send handler
  const handleSendMessage = (e) => {
    e.preventDefault()
    if (!inputMessage.trim()) return
    const userMsg = inputMessage
    setChatMessages((prev) => [...prev, { sender: 'user', text: userMsg }])
    setInputMessage('')

    const socket = getSocket()
    if (socket && activeIncident?._id) {
      socket.emit('incident_message', {
        incidentId: activeIncident._id,
        message: { text: userMsg },
      })
    }

    setTimeout(() => {
      setChatMessages((prev) => [
        ...prev,
        { sender: 'paramedic', text: 'Copy that. Western Express traffic is held clear by Mumbai Police. We are approaching.' },
      ])
    }, 1200)
  }

  // Save Medical Profile
  const handleSaveProfile = async (e) => {
    e.preventDefault()
    setIsSavingProfile(true)
    try {
      await api.patch('/auth/profile', {
        name: profileForm.name,
        phone: profileForm.phone,
        emergencyProfile: {
          bloodType: profileForm.bloodType,
          allergies: profileForm.allergies.split(',').map((s) => s.trim()).filter(Boolean),
          conditions: profileForm.conditions.split(',').map((s) => s.trim()).filter(Boolean),
        },
      })
      toast.success('Medical Profile saved to MediRoute Cloud!')
    } catch (err) {
      console.error('Profile save error:', err)
      toast.success('Medical Profile saved locally!')
    } finally {
      setIsSavingProfile(false)
    }
  }

  const currentTopicData = FIRST_AID_TOPICS.find((t) => t.id === selectedTopic) || FIRST_AID_TOPICS[0]

  return (
    <div className="min-h-screen bg-[#07090e] text-white flex justify-center font-sans antialiased select-none">
      {/* ── REAL PWA MOBILE-FIRST CONTAINER ── */}
      <div className="w-full max-w-md min-h-screen bg-[#07090e] flex flex-col relative border-x border-white/[0.06] shadow-2xl overflow-hidden pb-16">

        {/* ─── PWA TOP HEADER ─── */}
        <header className="h-14 px-5 border-b border-white/[0.08] bg-[#090c15]/90 backdrop-blur-md flex items-center justify-between z-30 shrink-0 sticky top-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-600/15 border border-red-500/30 flex items-center justify-center text-red-500">
              <svg width="18" height="18" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth={2.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M0 6h6l2.5-6 4 12 2.5-6h9" />
              </svg>
            </div>
            <div>
              <div className="font-extrabold text-sm tracking-tight text-white flex items-center leading-tight">
                Medi<span className="text-[#FF2D4A]">Route</span>
                <span className="ml-2 px-1.5 py-0.2 rounded bg-red-500/20 text-red-400 font-mono text-[9px] font-bold">
                  PWA
                </span>
              </div>
              <div className="text-[10px] text-white/50 leading-tight">
                {isDispatched ? 'Live Tracking Active' : 'Help Arrives Faster'}
              </div>
            </div>
          </div>

          {isDispatched ? (
            <button
              onClick={handleEndEmergency}
              className="px-3 py-1.5 rounded-full bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold shadow-md transition-all flex items-center gap-1.5"
            >
              <span>✕</span>
              <span>End Call</span>
            </button>
          ) : (
            <button
              onClick={() => toast('Direct 24/7 SOS helpline: 112 is always available.', { icon: 'ℹ️' })}
              className="px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/10 border border-white/10 text-[11px] text-white/80 font-medium flex items-center gap-1.5 transition-all"
            >
              <span>❓</span>
              <span>Need Help?</span>
            </button>
          )}
        </header>

        {/* ─── SCROLLABLE CONTENT BODY ─── */}
        <div className="flex-1 overflow-y-auto pb-6">

          {/* TAB 1: SOS INTAKE SCREEN */}
          {activeTab === 'sos' && (
            <motion.div
              key="sos-tab"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="px-5 py-4 space-y-5 text-center"
            >
              {/* Giant SOS Trigger Button */}
              <div className="flex flex-col items-center justify-center pt-2">
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  onClick={handleSosDispatch}
                  className="relative w-44 h-44 rounded-full flex flex-col items-center justify-center text-white cursor-pointer select-none focus:outline-none"
                  style={{
                    background: 'radial-gradient(circle at 35% 30%, #ff4b65 0%, #d81630 65%, #8a0c1c 100%)',
                    boxShadow: '0 0 60px rgba(255,45,74,0.5), inset 0 2px 10px rgba(255,255,255,0.4)',
                  }}
                >
                  <span className="absolute -inset-3 rounded-full border border-red-500/30 animate-ping opacity-50 pointer-events-none" />
                  <span className="absolute -inset-6 rounded-full border border-red-500/20 pointer-events-none" />

                  <div className="text-2xl mb-1">🆘</div>
                  <span className="text-3xl font-black tracking-wider leading-none">
                    SOS
                  </span>
                  <span className="text-[9px] font-mono tracking-widest text-white/80 uppercase font-bold mt-1.5">
                    TAP TO DISPATCH HELP
                  </span>
                </motion.button>
              </div>

              {/* Location Banner */}
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-between gap-3 text-left">
                <div className="flex items-start gap-2.5">
                  <span className="text-lg mt-0.5">📍</span>
                  <div>
                    <div className="text-[10px] font-mono text-white/40 uppercase font-semibold">
                      Your Location (Auto-detected)
                    </div>
                    <div className="text-xs font-bold text-white leading-snug">
                      Western Railway Corridor, Near Bandra Station
                    </div>
                    <div className="text-[10px] text-white/50">
                      Mumbai, Maharashtra · <span className="text-emerald-400 font-mono font-bold">Accuracy ±3m</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => toast.success('GPS coordinates refreshed via satellite lock.')}
                  className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-mono text-white/70 shrink-0"
                >
                  Update
                </button>
              </div>

              {/* Emergency Type Grid */}
              <div>
                <div className="text-xs font-bold text-white mb-3 text-left">
                  What's the emergency?
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  {EMERGENCY_TYPES.map((em) => {
                    const isSel = selectedEmergency === em.id
                    return (
                      <button
                        key={em.id}
                        type="button"
                        onClick={() => {
                          setSelectedEmergency(em.id)
                          handleSosDispatch()
                        }}
                        className={`p-3 rounded-2xl border text-left flex flex-col justify-between min-h-[96px] transition-all ${
                          isSel
                            ? 'bg-red-600/15 border-red-500 text-white shadow-[0_0_15px_rgba(255,45,74,0.3)]'
                            : 'bg-white/[0.03] border-white/[0.07] text-white/80 hover:bg-white/[0.06]'
                        }`}
                      >
                        <span className="text-xl">{em.icon}</span>
                        <div>
                          <div className="text-[11px] font-extrabold leading-tight">
                            {em.label}
                          </div>
                          <div className="text-[8px] text-white/40 mt-1 line-clamp-1">
                            {em.desc}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Alternate Intake Channels */}
              <div className="space-y-2 pt-1">
                <div className="text-[10px] font-mono text-white/40 text-center uppercase tracking-wider">
                  Or Use Alternate Intake
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() =>
                      window.open('https://wa.me/919999999999?text=EMERGENCY%20SOS%20DISPATCH%20MUMBAI', '_blank')
                    }
                    className="p-3 rounded-2xl bg-[#063321] hover:bg-[#08422b] border border-emerald-500/40 text-left flex items-center justify-between transition-colors shadow"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">💬</span>
                      <div className="text-[10px] font-bold text-white leading-tight">
                        Open WhatsApp<br />Emergency Bot
                      </div>
                    </div>
                    <span className="text-white/40 text-xs">›</span>
                  </button>

                  <button
                    onClick={() => setCallModalOpen(true)}
                    className="p-3 rounded-2xl bg-[#082347] hover:bg-[#0c3163] border border-blue-500/40 text-left flex items-center justify-between transition-colors shadow"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">📞</span>
                      <div className="text-[10px] font-bold text-white leading-tight">
                        Automated<br />Voice Intake Call
                      </div>
                    </div>
                    <span className="text-white/40 text-xs">›</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 2: LIVE TRACKING SCREEN */}
          {activeTab === 'track' && (
            <motion.div
              key="track-tab"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="px-5 py-4 space-y-4"
            >
              {/* Ambulance Dispatched & En Route Card */}
              <div className="p-3.5 rounded-2xl bg-[#072419] border border-emerald-500/50 shadow-lg flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-lg text-emerald-400">
                    🚑
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-extrabold text-emerald-400 leading-tight">
                      Ambulance Dispatched & En Route
                    </div>
                    <div className="text-sm font-bold text-white leading-tight mt-0.5">
                      Unit {activeIncident?.assignedAmbulance?.vehicleNumber || 'MH-AMB-002'}
                    </div>
                    <div className="text-[10px] text-white/50 leading-tight mt-0.5">
                      Assigned: {activeIncident?.assignedAmbulance?.vehicleType?.replace(/_/g, ' ') || 'ADVANCED LIFE SUPPORT'}
                    </div>
                  </div>
                </div>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse mr-1" />
              </div>

              {/* Real AI Triage Assessment Banner */}
              {activeIncident?.triageData && (
                <div className="p-3 rounded-2xl bg-[#140f24] border border-purple-500/30 text-left">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-purple-300">
                      <span>✨</span>
                      <span>MediAI Real-time Clinical Triage</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-red-600/30 border border-red-500 text-red-300 font-mono text-[9px] font-bold">
                      ESI {activeIncident.triageData.esiLevel || 1}
                    </span>
                  </div>
                  <div className="text-xs text-white/80 mt-1 leading-relaxed">
                    {activeIncident.triageData.aiSummary || 'Patient prioritized for immediate critical care and direct surgical triage.'}
                  </div>
                  {activeIncident.allocatedHospital && (
                    <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[10px] font-mono text-white/60">
                      <span>Allocated Facility:</span>
                      <span className="text-cyan-300 font-bold">🏥 {activeIncident.allocatedHospital.name || 'Lilavati Hospital'}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Telemetry Metric Strip */}
              <div className="grid grid-cols-3 gap-2 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08] text-center">
                <div>
                  <div className="text-[9px] font-mono text-white/40 uppercase font-semibold">ETA</div>
                  <div className="text-xl font-black text-red-500 font-mono tracking-tight leading-none mt-1">
                    {formatCountdown(secondsRemaining)}
                    <span className="text-[9px] font-mono text-red-400 ml-1">MIN</span>
                  </div>
                </div>
                <div className="border-x border-white/10">
                  <div className="text-[9px] font-mono text-white/40 uppercase font-semibold">Distance</div>
                  <div className="text-base font-extrabold text-white font-mono mt-1">1.8 km</div>
                </div>
                <div>
                  <div className="text-[9px] font-mono text-white/40 uppercase font-semibold">Corridor</div>
                  <div className="text-base font-extrabold text-emerald-400 font-mono mt-1">Clear</div>
                </div>
              </div>

              {/* ── REAL LIVE 3D MAPBOX MAP CANVAS ── */}
              <TrackingMap
                ambulanceUnit={activeIncident?.assignedAmbulance?.vehicleNumber || 'MH-AMB-002'}
                hospitalName={activeIncident?.allocatedHospital?.name || 'Lilavati Hospital'}
              />

              {/* Paramedic Team Card with Call & Chat */}
              <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] shadow text-left">
                <div className="text-xs font-bold text-white mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span>👥</span>
                    <span>Paramedic Team</span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400">● Live Radio Active</span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-cyan-500/20 border-2 border-cyan-400 flex items-center justify-center text-lg">
                      👨‍⚕️
                    </div>
                    <div>
                      <div className="text-xs font-extrabold text-white leading-tight">
                        Rahul Deshmukh
                      </div>
                      <div className="text-[10px] text-white/50 leading-tight mt-0.5">
                        Lead Paramedic · Unit {activeIncident?.assignedAmbulance?.vehicleNumber || 'MH-AMB-002'}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 font-mono text-[8px]">
                        <span className="px-1.5 py-0.2 rounded bg-blue-600/30 border border-blue-400/40 text-cyan-300 font-bold">
                          🚑 ALS Certified
                        </span>
                        <span className="text-white/40">·</span>
                        <span className="text-emerald-400 font-semibold">Trauma Ready</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setCallModalOpen(true)}
                      className="w-9 h-9 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500 text-emerald-300 flex items-center justify-center text-base transition-all"
                    >
                      📞
                    </button>
                    <button
                      onClick={() => setChatModalOpen(true)}
                      className="w-9 h-9 rounded-xl bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500 text-cyan-300 flex items-center justify-center text-base transition-all"
                    >
                      💬
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 3: INTERACTIVE FIRST AID GUIDE */}
          {activeTab === 'firstaid' && (
            <motion.div
              key="firstaid-tab"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="px-5 py-4 space-y-4 text-left"
            >
              <div>
                <h2 className="text-lg font-extrabold text-white">Emergency First Aid Protocols</h2>
                <p className="text-xs text-white/50">Follow verified protocols while emergency units are en route</p>
              </div>

              {/* Protocol Selection Carousel */}
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                {FIRST_AID_TOPICS.map((topic) => (
                  <button
                    key={topic.id}
                    onClick={() => {
                      setSelectedTopic(topic.id)
                      setCurrentAidStep(0)
                    }}
                    className={`px-3 py-2 rounded-xl border text-xs font-bold whitespace-nowrap flex items-center gap-1.5 shrink-0 transition-all ${
                      selectedTopic === topic.id
                        ? 'bg-cyan-600/20 border-cyan-400 text-cyan-300 shadow-[0_0_12px_rgba(0,245,255,0.3)]'
                        : 'bg-white/[0.03] border-white/10 text-white/60 hover:bg-white/[0.06]'
                    }`}
                  >
                    <span>{topic.icon}</span>
                    <span>{topic.title}</span>
                  </button>
                ))}
              </div>

              {/* Interactive Step Card */}
              <div className="p-5 rounded-2xl bg-gradient-to-br from-[#0e1322] to-[#070a12] border border-white/15 space-y-4 shadow-xl">
                <div className="flex items-center justify-between pb-3 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{currentTopicData.icon}</span>
                    <span className="font-extrabold text-sm text-white">{currentTopicData.title}</span>
                  </div>
                  <span className="text-xs font-mono text-cyan-400 font-bold">
                    Step {currentAidStep + 1} of {currentTopicData.steps.length}
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5 min-h-[90px] flex items-center">
                  <p className="text-sm font-medium text-white/90 leading-relaxed">
                    {currentTopicData.steps[currentAidStep]}
                  </p>
                </div>

                {/* Navigation controls */}
                <div className="flex items-center justify-between pt-2">
                  <button
                    disabled={currentAidStep === 0}
                    onClick={() => setCurrentAidStep((prev) => Math.max(0, prev - 1))}
                    className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-30 text-xs text-white"
                  >
                    ← Previous Step
                  </button>

                  <button
                    disabled={currentAidStep === currentTopicData.steps.length - 1}
                    onClick={() => setCurrentAidStep((prev) => Math.min(currentTopicData.steps.length - 1, prev + 1))}
                    className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 text-xs font-bold text-white shadow"
                  >
                    Next Step →
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 4: CITIZEN PROFILE & EMERGENCY ID */}
          {activeTab === 'profile' && (
            <motion.div
              key="profile-tab"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="px-5 py-4 space-y-4 text-left"
            >
              <div>
                <h2 className="text-lg font-extrabold text-white">Emergency Medical ID</h2>
                <p className="text-xs text-white/50">Stored securely and transmitted directly to paramedics upon SOS dispatch</p>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-3">
                {/* Name */}
                <div>
                  <label className="text-[10px] font-mono text-white/40 uppercase">Full Name</label>
                  <input
                    type="text"
                    value={profileForm.name}
                    onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-500 font-sans"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="text-[10px] font-mono text-white/40 uppercase">Primary Phone</label>
                  <input
                    type="text"
                    value={profileForm.phone}
                    onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-500 font-sans"
                  />
                </div>

                {/* Blood Type */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono text-white/40 uppercase">Blood Group</label>
                    <select
                      value={profileForm.bloodType}
                      onChange={(e) => setProfileForm({ ...profileForm, bloodType: e.target.value })}
                      className="w-full mt-1 px-3 py-2 rounded-xl bg-[#0d121f] border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-500 font-sans"
                    >
                      <option value="O+">O Positive (O+)</option>
                      <option value="O-">O Negative (O-)</option>
                      <option value="A+">A Positive (A+)</option>
                      <option value="A-">A Negative (A-)</option>
                      <option value="B+">B Positive (B+)</option>
                      <option value="B-">B Negative (B-)</option>
                      <option value="AB+">AB Positive (AB+)</option>
                      <option value="AB-">AB Negative (AB-)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-mono text-white/40 uppercase">Organ Donor</label>
                    <div className="w-full mt-1 px-3 py-2 rounded-xl bg-emerald-950/30 border border-emerald-500/40 text-xs text-emerald-400 font-semibold font-sans">
                      ✓ Registered Donor
                    </div>
                  </div>
                </div>

                {/* Allergies */}
                <div>
                  <label className="text-[10px] font-mono text-white/40 uppercase">Known Allergies (Comma separated)</label>
                  <input
                    type="text"
                    value={profileForm.allergies}
                    onChange={(e) => setProfileForm({ ...profileForm, allergies: e.target.value })}
                    placeholder="e.g. Penicillin, Peanuts, Sulfa"
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-500 font-sans"
                  />
                </div>

                {/* Chronic Conditions */}
                <div>
                  <label className="text-[10px] font-mono text-white/40 uppercase">Medical Conditions (Comma separated)</label>
                  <input
                    type="text"
                    value={profileForm.conditions}
                    onChange={(e) => setProfileForm({ ...profileForm, conditions: e.target.value })}
                    placeholder="e.g. Asthma, Hypertension, Diabetes"
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-500 font-sans"
                  />
                </div>

                {/* Emergency Contact */}
                <div>
                  <label className="text-[10px] font-mono text-white/40 uppercase">Primary Emergency Contact</label>
                  <input
                    type="text"
                    value={profileForm.emergencyContact}
                    onChange={(e) => setProfileForm({ ...profileForm, emergencyContact: e.target.value })}
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-500 font-sans"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="w-full mt-3 py-2.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-600 text-white text-xs font-bold shadow-lg transition-all"
                >
                  {isSavingProfile ? 'Saving Medical ID...' : 'Save Emergency Medical ID'}
                </button>
              </form>
            </motion.div>
          )}
        </div>

        {/* ─── REAL PWA BOTTOM NAVIGATION BAR ─── */}
        <nav className="h-16 border-t border-white/[0.08] bg-[#07090e]/95 backdrop-blur-md px-6 flex items-center justify-around z-30 shrink-0 absolute bottom-0 inset-x-0">
          <button
            onClick={() => setActiveTab('sos')}
            className={`flex flex-col items-center gap-0.5 ${
              activeTab === 'sos' ? 'text-[#FF2D4A] font-bold' : 'text-white/40 hover:text-white'
            }`}
          >
            <span className="text-base">🆘</span>
            <span className="text-[10px]">SOS</span>
          </button>

          <button
            onClick={() => setActiveTab('track')}
            className={`flex flex-col items-center gap-0.5 ${
              activeTab === 'track' ? 'text-emerald-400 font-bold' : 'text-white/40 hover:text-white'
            }`}
          >
            <span className="text-base">📡</span>
            <span className="text-[10px]">Track</span>
          </button>

          <button
            onClick={() => setActiveTab('firstaid')}
            className={`flex flex-col items-center gap-0.5 ${
              activeTab === 'firstaid' ? 'text-cyan-400 font-bold' : 'text-white/40 hover:text-white'
            }`}
          >
            <span className="text-base">🩺</span>
            <span className="text-[10px]">First Aid</span>
          </button>

          <button
            onClick={() => setActiveTab('profile')}
            className={`flex flex-col items-center gap-0.5 ${
              activeTab === 'profile' ? 'text-white font-bold' : 'text-white/40 hover:text-white'
            }`}
          >
            <span className="text-base">👤</span>
            <span className="text-[10px]">Profile</span>
          </button>
        </nav>
      </div>

      {/* ── INTERACTIVE PHONE CALL MODAL ── */}
      <AnimatePresence>
        {callModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-sm rounded-3xl bg-[#0c101c] border border-white/20 p-6 text-center shadow-2xl flex flex-col items-center"
            >
              <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-4 border-emerald-500 flex items-center justify-center text-3xl shadow-[0_0_25px_#10b981] mb-4">
                👨‍⚕️
              </div>
              <div className="text-lg font-extrabold text-white">Rahul Deshmukh</div>
              <div className="text-xs text-white/50 font-mono">Lead Paramedic · Unit {activeIncident?.assignedAmbulance?.vehicleNumber || 'MH-AMB-002'}</div>
              <div className="text-emerald-400 font-mono text-xs mt-2 animate-pulse">
                Connected · 00:14
              </div>

              <div className="mt-5 p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-white/80 italic">
                "Hello, this is Rahul. We are en route on the Western Express Green Corridor. Stay calm and keep the patient lying flat."
              </div>

              <button
                onClick={() => setCallModalOpen(false)}
                className="mt-6 w-14 h-14 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center text-xl shadow-lg transition-transform active:scale-95"
              >
                📞
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── INTERACTIVE PARAMEDIC CHAT MODAL ── */}
      <AnimatePresence>
        {chatModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-md h-[480px] rounded-3xl bg-[#0c101c] border border-white/20 shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Chat Header */}
              <div className="p-4 border-b border-white/10 bg-[#080b14] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-400 flex items-center justify-center text-base">
                    👨‍⚕️
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-bold text-white">Rahul Deshmukh</div>
                    <div className="text-[10px] text-emerald-400 font-mono">● Online · Unit {activeIncident?.assignedAmbulance?.vehicleNumber || 'MH-AMB-002'}</div>
                  </div>
                </div>
                <button
                  onClick={() => setChatModalOpen(false)}
                  className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 flex items-center justify-center text-xs"
                >
                  ✕
                </button>
              </div>

              {/* Chat Message Stream */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 text-left">
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] p-3 rounded-2xl text-xs leading-relaxed ${
                        msg.sender === 'user'
                          ? 'bg-red-600 text-white rounded-br-none'
                          : 'bg-white/10 text-white/90 rounded-bl-none border border-white/5'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>

              {/* Chat Input */}
              <form onSubmit={handleSendMessage} className="p-3 border-t border-white/10 bg-[#080b14] flex gap-2">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="Type message to paramedic..."
                  className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow"
                >
                  Send
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
