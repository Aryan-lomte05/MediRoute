import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import toast from 'react-hot-toast'
import { useAuthStore } from '../store/authStore'
import { CITIZEN_REAL_ROUTE } from '../lib/routing'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

const EMERGENCY_TYPES = [
  { id: 'cardiac', label: 'Cardiac / Chest Pain', icon: '🫀', color: '#FF2D4A', desc: 'Severe pressure or shortness of breath' },
  { id: 'accident', label: 'Severe Road Accident', icon: '🚑', color: '#FF8C00', desc: 'Vehicular collision or trauma' },
  { id: 'unconscious', label: 'Unconscious Patient', icon: '👁️', color: '#00F5FF', desc: 'Unresponsive or fainting' },
  { id: 'fire', label: 'Fire / Burn Injury', icon: '🔥', color: '#FF3B30', desc: 'Thermal or chemical burns' },
  { id: 'trauma', label: 'Other Trauma', icon: '👤', color: '#A855F7', desc: 'Deep wound, fractures or falls' },
  { id: 'more', label: 'More Options', icon: '💬', color: '#10B981', desc: 'Stroke, allergic reaction, pediatric' },
]

const FIRST_AID_TOPICS = [
  {
    id: 'cpr',
    title: 'Adult CPR (Cardiac Arrest)',
    icon: '🫀',
    steps: [
      'Check responsiveness: Tap shoulders firmly and shout "Are you OK?"',
      'Call for help / confirm 112 or MediRoute SOS is dispatched.',
      'Place heel of one hand in center of chest, other hand on top with interlocked fingers.',
      'Push hard and fast: 100-120 compressions/min, at least 2 inches (5 cm) deep.',
      'Allow full chest recoil between compressions. Continue until paramedics arrive.',
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
      'Do NOT administer aspirin or food/water until evaluated by ER stroke team.',
    ],
  },
]

// ── REAL LIVE 3D MAPBOX MAP COMPONENT (DEFINED OUTSIDE TO PREVENT RE-RENDER UNMOUNTS) ──
function TrackingMap() {
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
        id: 'live-route-glow',
        type: 'line',
        source: 'ambulance-live-route',
        paint: {
          'line-color': '#10b981',
          'line-width': 8,
          'line-opacity': 0.4,
          'line-blur': 4,
        },
      })

      map.addLayer({
        id: 'live-route-core',
        type: 'line',
        source: 'ambulance-live-route',
        paint: {
          'line-color': '#34d399',
          'line-width': 3.5,
          'line-opacity': 0.95,
        },
      })

      // Patient location marker
      const patientEl = document.createElement('div')
      patientEl.className = 'relative flex flex-col items-center cursor-pointer'
      patientEl.innerHTML = `
        <div class="px-2 py-0.5 rounded-full bg-red-600/90 border border-white text-white font-bold text-[9px] shadow-lg mb-1 whitespace-nowrap">
          📍 You
        </div>
        <span class="animate-ping absolute top-5 inline-flex h-6 w-6 rounded-full bg-red-500 opacity-70"></span>
        <div class="w-4 h-4 rounded-full bg-red-600 border-2 border-white shadow-[0_0_15px_#FF2D4A]"></div>
      `
      new mapboxgl.Marker({ element: patientEl, anchor: 'bottom' })
        .setLngLat(roadCoords[roadCoords.length - 1])
        .addTo(map)

      // Animated live moving ambulance marker along actual road
      const ambEl = document.createElement('div')
      ambEl.className = 'relative flex items-center justify-center'
      ambEl.innerHTML = `
        <span class="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-cyan-400 opacity-60"></span>
        <div class="relative px-2 py-1 rounded-lg bg-[#0d1526] border-2 border-cyan-400 flex items-center gap-1.5 shadow-[0_0_20px_#00F5FF]">
          <span class="text-sm">🚑</span>
          <span class="text-[10px] font-mono font-extrabold text-cyan-300 tracking-tight">EMS-104</span>
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
  }, [])

  return (
    <div className="relative rounded-2xl overflow-hidden border border-white/[0.12] bg-[#060911] shadow-xl h-64 w-full">
      <div ref={mapRef} className="w-full h-full" />
      <div className="absolute top-2.5 left-2.5 z-10 px-2 py-0.5 rounded bg-black/80 border border-emerald-500/40 text-[9px] font-mono text-emerald-400 flex items-center gap-1.5 shadow">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span>Real-Time GPS · Updating every 2s</span>
      </div>
      <div className="absolute bottom-2.5 right-2.5 z-10 text-[9px] font-mono text-cyan-300 bg-black/80 px-2 py-0.5 rounded border border-cyan-500/30">
        Traffic: Live
      </div>
    </div>
  )
}

export default function PatientPortal() {
  const { user } = useAuthStore()

  // Primary state: false = SOS Intake Screen, true = Live Ambulance Tracking
  const [isDispatched, setIsDispatched] = useState(false)
  const [selectedEmergency, setSelectedEmergency] = useState('cardiac')
  const [activeTab, setActiveTab] = useState('sos') // 'sos' | 'track' | 'firstaid' | 'profile'
  const [currentAidStep, setCurrentAidStep] = useState(1)
  const [selectedTopic, setSelectedTopic] = useState('cpr')

  // Modals
  const [callModalOpen, setCallModalOpen] = useState(false)
  const [chatModalOpen, setChatModalOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState([
    { sender: 'rahul', text: 'Unit EMS-104 en route. Sirens active on Western Express. We will be there in under 4 minutes.' },
  ])
  const [inputMessage, setInputMessage] = useState('')

  // Live countdown timer (starts at 4m 22s = 262s)
  const [secondsRemaining, setSecondsRemaining] = useState(262)

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

  // Handle SOS Click
  const handleSosDispatch = () => {
    setIsDispatched(true)
    setActiveTab('track')
    setSecondsRemaining(262)
    toast.success('🚨 EMERGENCY DISPATCHED: Unit EMS-104 en route to Bandra Station!', { duration: 5000 })
  }

  // Handle End Emergency
  const handleEndEmergency = () => {
    if (window.confirm('Are you sure you want to end this emergency tracking session?')) {
      setIsDispatched(false)
      setActiveTab('sos')
      setSecondsRemaining(262)
      toast('Emergency tracking ended. Paramedic log archived.', { icon: 'ℹ️' })
    }
  }

  // Chat message send handler
  const handleSendMessage = (e) => {
    e.preventDefault()
    if (!inputMessage.trim()) return
    const userMsg = inputMessage
    setChatMessages((prev) => [...prev, { sender: 'user', text: userMsg }])
    setInputMessage('')

    setTimeout(() => {
      setChatMessages((prev) => [
        ...prev,
        { sender: 'rahul', text: 'Copy that. Western Express traffic is held clear by Mumbai Police. We are approaching.' },
      ])
    }, 1200)
  }

  return (
    <div className="min-h-screen bg-[#07090e] text-white flex justify-center font-sans antialiased select-none">
      {/* ── REAL PWA MOBILE-FIRST CONTAINER (Centered on desktop, full-width on mobile) ── */}
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

        {/* ─── BODY CONTENT BY ACTIVE TAB ─── */}
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {/* TAB 1: SOS INTAKE SCREEN */}
          {activeTab === 'sos' && (
            <motion.div
              key="sos-tab"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="px-5 py-5 space-y-5"
            >
              {/* Hero Header */}
              <div className="text-center space-y-1">
                <h1 className="text-2xl font-extrabold text-white tracking-tight">
                  In an Emergency?
                </h1>
                <p className="text-xs text-white/60">
                  You are not alone. Tap below to get immediate help.
                </p>
              </div>

              {/* ── HUGE PULSING SOS BUTTON ── */}
              <div className="relative py-2 flex items-center justify-center">
                {/* Subtle City Stat Tickers on Left & Right */}
                <div className="absolute left-0 text-left text-[9px] font-mono text-white/40 leading-tight">
                  <div>Faster</div>
                  <div>Response:</div>
                  <div className="text-red-400 font-bold">Safer Cities</div>
                </div>

                <div className="absolute right-0 text-right text-[9px] font-mono text-white/40 leading-tight">
                  <div>Mumbai</div>
                  <div>Stays</div>
                  <div className="text-emerald-400 font-bold">Stronger</div>
                </div>

                {/* SOS Main Button */}
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  onClick={handleSosDispatch}
                  className="relative w-44 h-44 rounded-full flex flex-col items-center justify-center text-white cursor-pointer select-none focus:outline-none"
                  style={{
                    background: 'radial-gradient(circle at 35% 30%, #ff4b65 0%, #d81630 65%, #8a0c1c 100%)',
                    boxShadow: '0 0 60px rgba(255,45,74,0.5), inset 0 2px 10px rgba(255,255,255,0.4)',
                  }}
                >
                  {/* Pulsing Outer Rings */}
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
                      Western Railway Line, Near Bandra Station
                    </div>
                    <div className="text-[10px] text-white/50">
                      Mumbai, Maharashtra · <span className="text-emerald-400 font-mono font-bold">Accuracy ±4m</span>
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
                      Unit EMS-104
                    </div>
                    <div className="text-[10px] text-white/50 leading-tight mt-0.5">
                      Bandra EMS Station · Advanced Life Support
                    </div>
                  </div>
                </div>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse mr-1" />
              </div>

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
                  <div className="text-base font-extrabold text-white font-mono mt-1">2.1 km</div>
                </div>
                <div>
                  <div className="text-[9px] font-mono text-white/40 uppercase font-semibold">Arrival</div>
                  <div className="text-base font-extrabold text-emerald-400 font-mono mt-1">Live</div>
                </div>
              </div>

              {/* ── REAL LIVE 3D MAPBOX MAP CANVAS (NO FAKE IMAGES) ── */}
              <TrackingMap />

              {/* Paramedic Team Card with Call & Chat */}
              <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] shadow text-left">
                <div className="text-xs font-bold text-white mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span>👥</span>
                    <span>Paramedic Team</span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400">● On Vehicle</span>
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
                        Lead Paramedic · Unit EMS-104
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 font-mono text-[8px]">
                        <span className="px-1.5 py-0.2 rounded bg-blue-600/30 border border-blue-400/40 text-cyan-300 font-bold">
                          🚑 EMS-104
                        </span>
                        <span className="px-1.5 py-0.2 rounded bg-blue-600/30 border border-blue-400/40 text-cyan-300 font-bold">
                          ⚕️ ALS Unit
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Interactive Call & Chat buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setCallModalOpen(true)}
                      className="w-9 h-9 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center text-sm shadow transition-transform active:scale-95"
                      title="Call Paramedic"
                    >
                      📞
                    </button>
                    <button
                      onClick={() => setChatModalOpen(true)}
                      className="w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center text-sm shadow transition-transform active:scale-95"
                      title="Chat with Paramedic"
                    >
                      💬
                    </button>
                  </div>
                </div>
              </div>

              {/* AI First-Aid Guidance Stepper */}
              <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] text-left">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-cyan-400">🩺</span>
                    <span className="text-xs font-bold text-white">AI First-Aid Guidance</span>
                  </div>
                  <span className="text-[9px] font-mono text-white/40">Step {currentAidStep} of 3</span>
                </div>

                <div className="p-3 rounded-xl bg-black/40 border border-white/5 flex items-start gap-3">
                  <span className="text-xl">🛏️</span>
                  <div className="text-xs text-white/80 leading-relaxed">
                    {currentAidStep === 1 && (
                      <span>Keep patient lying flat on their back. Do not offer food or fluids. Elevate feet if conscious.</span>
                    )}
                    {currentAidStep === 2 && (
                      <span>Loosen tight clothing around neck and chest. Ensure airway remains completely clear.</span>
                    )}
                    {currentAidStep === 3 && (
                      <span>Stay calm. EMS-104 is approaching on Western Express and will arrive in moments.</span>
                    )}
                  </div>
                </div>

                <div className="flex justify-between items-center mt-2.5 pt-1">
                  <button
                    onClick={() => setCurrentAidStep((s) => (s > 1 ? s - 1 : 3))}
                    className="text-[10px] font-mono text-white/50 hover:text-white"
                  >
                    ← Previous
                  </button>
                  <button
                    onClick={() => setCurrentAidStep((s) => (s < 3 ? s + 1 : 1))}
                    className="text-[10px] font-mono text-cyan-400 font-bold hover:text-cyan-300"
                  >
                    Next Step →
                  </button>
                </div>
              </div>

              {/* Emergency Notifications Dispatched Confirmation */}
              <div className="p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between text-left">
                <div className="flex items-center gap-2.5">
                  <span className="text-base">📲</span>
                  <div>
                    <div className="text-xs font-bold text-emerald-400">
                      Emergency Notifications Dispatched
                    </div>
                    <div className="text-[10px] text-white/60">
                      SMS & Email sent to emergency contact: <strong>Sarah (Spouse)</strong>
                    </div>
                  </div>
                </div>
                <span className="w-5 h-5 rounded-full bg-emerald-500 text-black font-bold text-xs flex items-center justify-center shrink-0">
                  ✓
                </span>
              </div>
            </motion.div>
          )}

          {/* TAB 3: FIRST AID OFFLINE DIRECTORY */}
          {activeTab === 'firstaid' && (
            <motion.div
              key="firstaid-tab"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="px-5 py-4 space-y-4 text-left"
            >
              <div>
                <h2 className="text-lg font-extrabold text-white">First Aid Protocols</h2>
                <p className="text-xs text-white/50">Emergency life-saving instructions available offline</p>
              </div>

              {/* Topic Selector Tabs */}
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {FIRST_AID_TOPICS.map((top) => (
                  <button
                    key={top.id}
                    onClick={() => setSelectedTopic(top.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                      selectedTopic === top.id
                        ? 'bg-red-600 text-white border-red-500 shadow-md'
                        : 'bg-white/[0.04] text-white/70 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <span className="mr-1">{top.icon}</span>
                    {top.title.split(' ')[0]}
                  </button>
                ))}
              </div>

              {/* Topic Details Card */}
              {(() => {
                const topic = FIRST_AID_TOPICS.find((t) => t.id === selectedTopic) || FIRST_AID_TOPICS[0]
                return (
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] space-y-3">
                    <div className="flex items-center gap-2 pb-2 border-b border-white/10">
                      <span className="text-2xl">{topic.icon}</span>
                      <div className="text-sm font-bold text-white">{topic.title}</div>
                    </div>

                    <div className="space-y-2.5">
                      {topic.steps.map((step, idx) => (
                        <div key={idx} className="flex items-start gap-3 text-xs leading-relaxed">
                          <span className="w-5 h-5 rounded-full bg-red-600/20 text-red-400 border border-red-500/40 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                            {idx + 1}
                          </span>
                          <span className="text-white/80">{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* Quick Dial 112 Emergency Banner */}
              <div className="p-3.5 rounded-2xl bg-red-950/40 border border-red-500/40 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-red-400">Need Immediate Paramedic Assistance?</div>
                  <div className="text-[10px] text-white/60">Tap to instantly launch the SOS dispatch sequence</div>
                </div>
                <button
                  onClick={handleSosDispatch}
                  className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shrink-0"
                >
                  Launch SOS
                </button>
              </div>
            </motion.div>
          )}

          {/* TAB 4: CITIZEN PROFILE & EMERGENCY CONTACTS */}
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
                <p className="text-xs text-white/50">Accessible by first responders during dispatch</p>
              </div>

              {/* Medical Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-[#121624] to-[#0c101c] border border-white/[0.12] space-y-3 shadow-xl">
                <div className="flex items-center justify-between pb-2 border-b border-white/10">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-full bg-red-600/20 border border-red-500/40 flex items-center justify-center text-lg text-red-400">
                      👤
                    </div>
                    <div>
                      <div className="text-sm font-extrabold text-white">{user?.name || 'Citizen User'}</div>
                      <div className="text-[10px] text-white/50 font-mono">{user?.email || 'citizen@mediroute.com'}</div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[9px] font-mono font-bold">
                    VERIFIED ID
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/5">
                    <div className="text-[9px] text-white/40 uppercase font-mono">Blood Group</div>
                    <div className="font-extrabold text-red-400 text-sm mt-0.5">O Positive (O+)</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/5">
                    <div className="text-[9px] text-white/40 uppercase font-mono">Organ Donor</div>
                    <div className="font-extrabold text-emerald-400 text-sm mt-0.5">Yes (Registered)</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/5">
                    <div className="text-[9px] text-white/40 uppercase font-mono">Allergies</div>
                    <div className="font-semibold text-white text-xs mt-0.5">Penicillin, Peanuts</div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-black/40 border border-white/5">
                    <div className="text-[9px] text-white/40 uppercase font-mono">Medical Conditions</div>
                    <div className="font-semibold text-white text-xs mt-0.5">Asthma (Mild)</div>
                  </div>
                </div>

                {/* Emergency Contact */}
                <div className="p-3 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between">
                  <div>
                    <div className="text-[9px] text-white/40 uppercase font-mono">Primary Emergency Contact</div>
                    <div className="font-bold text-white text-xs mt-0.5">Sarah (Spouse) · +91 98200 12345</div>
                    <div className="text-[9px] text-emerald-400 font-mono mt-0.5">● Auto-SMS alerts enabled</div>
                  </div>
                  <button
                    onClick={() => toast.success('Emergency contact notification test sent!')}
                    className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-[10px] font-mono text-white shrink-0"
                  >
                    Test Alert
                  </button>
                </div>
              </div>

              {/* App Status & Version */}
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] text-center space-y-1">
                <div className="text-xs font-mono text-white/50">MediRoute PWA Client · v2.4.0</div>
                <div className="text-[10px] text-white/30">Offline ServiceWorker Active · Mumbai Node</div>
              </div>
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
            onClick={() => {
              setActiveTab('track')
              if (!isDispatched) {
                toast('Showing live tracker simulation', { icon: '📡' })
              }
            }}
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
              <div className="text-xs text-white/50 font-mono">Lead Paramedic · Unit EMS-104</div>
              <div className="text-emerald-400 font-mono text-xs mt-2 animate-pulse">
                Connected · 00:14
              </div>

              <div className="mt-5 p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-white/80 italic">
                "Hello, this is Rahul from EMS-104. We are 3 minutes out on Western Express. Keep the patient still."
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
                    <div className="text-[10px] text-emerald-400 font-mono">● Online · EMS-104 En Route</div>
                  </div>
                </div>
                <button
                  onClick={() => setChatModalOpen(false)}
                  className="text-white/40 hover:text-white text-lg font-bold"
                >
                  ✕
                </button>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 text-left">
                {chatMessages.map((m, idx) => (
                  <div
                    key={idx}
                    className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] p-3 rounded-2xl text-xs leading-relaxed ${
                        m.sender === 'user'
                          ? 'bg-red-600 text-white rounded-br-none'
                          : 'bg-white/10 text-white/90 border border-white/10 rounded-bl-none'
                      }`}
                    >
                      {m.text}
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
                  placeholder="Type message to paramedic team..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-xl text-xs font-bold text-white transition-colors"
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
