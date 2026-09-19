import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useAuthStore } from '../store/authStore'
import toast from 'react-hot-toast'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

const ROLE_CONFIG = {
  admin: {
    label: 'Admin',
    sub: 'City / System',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    color: '#FF2D4A',
    path: '/admin',
    camera: { center: [72.855, 19.035], zoom: 12.5, pitch: 52, bearing: 20 },
  },
  paramedic: {
    label: 'Paramedic',
    sub: 'Field Operations',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="15" height="13" />
        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
        <line x1="8.5" y1="7" x2="8.5" y2="11" />
        <line x1="6.5" y1="9" x2="10.5" y2="9" />
      </svg>
    ),
    color: '#00F5FF',
    path: '/paramedic',
    camera: { center: [72.822, 19.038], zoom: 14.2, pitch: 58, bearing: 35 },
  },
  hospital_staff: {
    label: 'Hospital ER',
    sub: 'Trauma Care',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21h18" />
        <path d="M5 21V7l8-4v18" />
        <path d="M19 21V11l-6-4" />
        <line x1="9" y1="9" x2="9" y2="9.01" />
        <line x1="9" y1="13" x2="9" y2="13.01" />
        <line x1="9" y1="17" x2="9" y2="17.01" />
      </svg>
    ),
    color: '#A855F7',
    path: '/hospital',
    camera: { center: [72.8428, 19.0025], zoom: 14.8, pitch: 55, bearing: -15 },
  },
  patient: {
    label: 'Citizen SOS',
    sub: 'Public Access',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    color: '#FF8C00',
    path: '/patient',
    camera: { center: [72.836, 19.019], zoom: 14.5, pitch: 48, bearing: 10 },
  },
}

const DEMO_CREDENTIALS = {
  admin: { email: 'admin@mediroute.com', password: 'admin123' },
  paramedic: { email: 'paramedic@mediroute.com', password: 'paramedic123' },
  hospital_staff: { email: 'hospital@mediroute.com', password: 'hospital123' },
  patient: { email: 'patient@mediroute.com', password: 'patient123' },
}

const CAPABILITIES = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF2D4A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
    title: 'AI-Powered Dispatch',
    desc: 'Predict. Respond. Save Lives.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF334B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
      </svg>
    ),
    title: 'Real-time Coordination',
    desc: 'Citizens · Paramedics · Hospitals · City',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF4D4D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    title: 'Data-Driven Decisions',
    desc: 'Forecast. Optimize. Allocate.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF2D4A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    title: 'Scalable & Secure',
    desc: 'Built for Smart Cities',
  },
]

// Real road coordinates along Mumbai Bandra-Worli Sea Link -> KEM Hospital Parel
const SEA_LINK_CORRIDOR = [
  [72.8182, 19.0435],
  [72.8175, 19.0378],
  [72.8188, 19.0305],
  [72.8225, 19.0232],
  [72.8285, 19.0162],
  [72.8335, 19.0118],
  [72.8385, 19.0068],
  [72.8428, 19.0025],
]

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, register, loading } = useAuthStore()
  const [selectedRole, setSelectedRole] = useState('admin')
  const [mode, setMode] = useState('login')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [telemetrySpeed, setTelemetrySpeed] = useState(74)
  const [telemetryCoord, setTelemetryCoord] = useState('19.0312° N, 72.8194° E')

  const mapContainerRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const animFrameRef = useRef(null)

  const [form, setForm] = useState({
    name: '',
    email: 'admin@mediroute.com',
    password: 'admin123',
    phone: '',
  })

  // Initialize REAL LIVE Mapbox GL background map
  useEffect(() => {
    if (!mapContainerRef.current) return

    const initialCamera = ROLE_CONFIG[selectedRole]?.camera || {
      center: [72.855, 19.035],
      zoom: 12.5,
      pitch: 52,
      bearing: 20,
    }

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: initialCamera.center,
      zoom: initialCamera.zoom,
      pitch: initialCamera.pitch,
      bearing: initialCamera.bearing,
      interactive: true,
      attributionControl: false,
    })

    mapInstanceRef.current = map

    map.on('load', () => {
      // Add real-time traffic layer
      if (!map.getSource('mapbox-traffic')) {
        map.addSource('mapbox-traffic', {
          type: 'vector',
          url: 'mapbox://mapbox.mapbox-traffic-v1',
        })
        map.addLayer(
          {
            id: 'traffic-lines',
            type: 'line',
            source: 'mapbox-traffic',
            'source-layer': 'traffic',
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'congestion'], 'low'],
                '#10b981',
                ['==', ['get', 'congestion'], 'moderate'],
                '#f59e0b',
                ['==', ['get', 'congestion'], 'heavy'],
                '#ef4444',
                '#3b82f6',
              ],
              'line-width': 2.2,
              'line-opacity': 0.45,
            },
          },
          'road-label'
        )
      }

      // Add green corridor route GeoJSON
      map.addSource('green-corridor', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: SEA_LINK_CORRIDOR,
          },
        },
      })

      map.addLayer({
        id: 'corridor-glow',
        type: 'line',
        source: 'green-corridor',
        paint: {
          'line-color': '#00F5FF',
          'line-width': 8,
          'line-opacity': 0.35,
          'line-blur': 4,
        },
      })

      map.addLayer({
        id: 'corridor-core',
        type: 'line',
        source: 'green-corridor',
        paint: {
          'line-color': '#00F5FF',
          'line-width': 3,
          'line-opacity': 0.9,
        },
      })

      // Hospital marker
      const hospEl = document.createElement('div')
      hospEl.className = 'flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#7C3AED]/90 border border-[#A855F7] text-white text-[10px] font-mono font-bold shadow-[0_0_15px_rgba(168,85,247,0.7)]'
      hospEl.innerHTML = '🏥 KEM Hospital ER'
      new mapboxgl.Marker({ element: hospEl, anchor: 'bottom' })
        .setLngLat([72.8428, 19.0025])
        .addTo(map)

      // Live animated ambulance marker along the corridor
      const ambEl = document.createElement('div')
      ambEl.className = 'relative flex items-center justify-center cursor-pointer'
      ambEl.innerHTML = `
        <span class="animate-ping absolute inline-flex h-8 w-8 rounded-full bg-red-500 opacity-60"></span>
        <div class="relative w-8 h-8 rounded-lg bg-[#FF2D4A] border-2 border-white flex items-center justify-center text-white text-xs shadow-[0_0_20px_#FF2D4A]">
          🚑
        </div>
      `
      const ambMarker = new mapboxgl.Marker({ element: ambEl, anchor: 'center' })
        .setLngLat(SEA_LINK_CORRIDOR[0])
        .addTo(map)

      // Animate ambulance moving smoothly along Sea Link road
      let step = 0
      const totalPoints = SEA_LINK_CORRIDOR.length
      const animateAmbulance = () => {
        step = (step + 0.005) % (totalPoints - 1)
        const idx = Math.floor(step)
        const frac = step - idx
        const p1 = SEA_LINK_CORRIDOR[idx]
        const p2 = SEA_LINK_CORRIDOR[idx + 1]
        const currentLng = p1[0] + (p2[0] - p1[0]) * frac
        const currentLat = p1[1] + (p2[1] - p1[1]) * frac

        ambMarker.setLngLat([currentLng, currentLat])
        setTelemetryCoord(`${currentLat.toFixed(4)}° N, ${currentLng.toFixed(4)}° E`)

        animFrameRef.current = requestAnimationFrame(animateAmbulance)
      }
      animFrameRef.current = requestAnimationFrame(animateAmbulance)
    })

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      map.remove()
    }
  }, [])

  // Live telemetry speed jitter effect
  useEffect(() => {
    const timer = setInterval(() => {
      setTelemetrySpeed(70 + Math.floor(Math.random() * 9))
    }, 2000)
    return () => clearInterval(timer)
  }, [])

  // Switch roles: update form & smoothly fly map camera to role operational zone
  const handleRoleSelect = (role) => {
    setSelectedRole(role)
    const creds = DEMO_CREDENTIALS[role]
    setForm((f) => ({ ...f, email: creds.email, password: creds.password }))

    if (mapInstanceRef.current && ROLE_CONFIG[role]?.camera) {
      mapInstanceRef.current.flyTo({
        ...ROLE_CONFIG[role].camera,
        duration: 1800,
        essential: true,
      })
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (mode === 'login') {
        const data = await login(form.email, form.password, selectedRole)
        toast.success(`Welcome back, ${data.user.name || selectedRole}!`)
        navigate(ROLE_CONFIG[data.user.role]?.path || '/admin')
      } else {
        const data = await register({ ...form, role: selectedRole })
        toast.success('Account created successfully!')
        navigate(ROLE_CONFIG[data.user.role]?.path || '/admin')
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Authentication failed')
    }
  }

  const handleQuickOAuth = (provider) => {
    toast.success(`Connected via ${provider}. Signing in as ${ROLE_CONFIG[selectedRole].label}...`)
    handleSubmit({ preventDefault: () => {} })
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#07080c',
        position: 'relative',
        color: '#fff',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        display: 'flex',
        flexDirection: 'column',
        overflowX: 'hidden',
      }}
    >
      {/* ─── REAL LIVE MAPBOX GL 3D MAP CANVAS (BACKGROUND) ─── */}
      <div
        ref={mapContainerRef}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          width: '100%',
          height: '100%',
        }}
      />

      {/* Dark Vignette & Atmospheric Overlay: keeps text ultra-readable while preserving live map visibility */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          background:
            'radial-gradient(ellipse 90% 75% at 50% 50%, rgba(7, 8, 12, 0.78) 0%, rgba(7, 8, 12, 0.94) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* ─── TOP GLOBAL BAR ─── */}
      <header
        style={{
          position: 'relative',
          zIndex: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '24px 44px 10px 44px',
        }}
      >
        {/* Brand logo */}
        <div
          onClick={() => navigate('/')}
          style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', userSelect: 'none' }}
        >
          {/* Glowing red ECG pulse icon */}
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 38,
              height: 38,
              borderRadius: 10,
              background: 'rgba(255, 45, 74, 0.14)',
              border: '1px solid rgba(255, 45, 74, 0.35)',
              boxShadow: '0 0 22px rgba(255, 45, 74, 0.4)',
            }}
          >
            <svg width="26" height="20" viewBox="0 0 38 28" fill="none">
              <path
                d="M2 14h6l4-9 6 18 5-13 4 7 3-3h8"
                stroke="#FF2D4A"
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <div>
            <div style={{ fontWeight: 800, fontSize: 21, letterSpacing: '-0.02em', lineHeight: 1 }}>
              Medi<span style={{ color: '#FF2D4A' }}>Route</span>
            </div>
            <div
              style={{
                fontSize: 9,
                color: 'rgba(255,255,255,0.45)',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                fontFamily: 'monospace',
                marginTop: 3,
              }}
            >
              NEXT-GEN INTELLIGENT EMERGENCY RESPONSE
            </div>
          </div>
        </div>

        {/* Top Right Live Telemetry & Tag */}
        <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              borderRadius: 10,
              background: 'rgba(16, 18, 26, 0.8)',
              border: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(10px)',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#10B981',
                boxShadow: '0 0 10px #10B981',
              }}
            />
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#10B981', fontWeight: 700 }}>
              LIVE MAP ENGINE
            </span>
          </div>

          <div>
            <span
              style={{
                color: 'rgba(255,255,255,0.38)',
                fontSize: 10,
                fontFamily: 'monospace',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                display: 'block',
              }}
            >
              A SAFER TOMORROW,
            </span>
            <span
              style={{
                color: 'rgba(255,255,255,0.52)',
                fontSize: 10,
                fontFamily: 'monospace',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            >
              A HEALTHIER INDIA 🇮🇳
            </span>
          </div>
        </div>
      </header>

      {/* ─── MAIN 3-COLUMN CONTENT ─── */}
      <main
        style={{
          position: 'relative',
          zIndex: 10,
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px 44px 32px 44px',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 1480,
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 1fr) minmax(380px, 480px) minmax(280px, 340px)',
            gap: 40,
            alignItems: 'center',
          }}
          className="login-grid-responsive"
        >
          {/* ─── LEFT COLUMN: HERO & LIVE TACTICAL TELEMETRY HUD (ZERO FAKE IMAGES) ─── */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingRight: 10 }}
            className="hidden lg:flex"
          >
            <div>
              <p
                style={{
                  color: '#FF2D4A',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  marginBottom: 10,
                }}
              >
                FASTER RESPONSE. STRONGER COMMUNITIES.
              </p>

              <h1
                style={{
                  fontSize: '40px',
                  fontWeight: 800,
                  lineHeight: 1.15,
                  color: '#ffffff',
                  letterSpacing: '-0.03em',
                  margin: '0 0 14px 0',
                }}
              >
                Intelligent{' '}
                <span
                  style={{
                    background: 'linear-gradient(135deg, #FF2D4A 0%, #FF6584 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  Emergency Care
                </span>
                <br />
                for Everyone
              </h1>

              <p
                style={{
                  color: 'rgba(255,255,255,0.55)',
                  fontSize: 13,
                  lineHeight: 1.65,
                  maxWidth: 380,
                  margin: 0,
                }}
              >
                AI-powered coordination between citizens, paramedics, hospitals and city administration for a safer,
                healthier tomorrow.
              </p>
            </div>

            {/* 3 Metric Pills */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[
                {
                  icon: '👥',
                  title: 'Faster',
                  sub: 'Response Times',
                },
                {
                  icon: '🛡️',
                  title: 'Smarter',
                  sub: 'Resource Allocation',
                },
                {
                  icon: '❤️',
                  title: 'Stronger',
                  sub: 'Communities',
                },
              ].map((badge) => (
                <div
                  key={badge.sub}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 14px',
                    borderRadius: 14,
                    background: 'rgba(16, 19, 28, 0.75)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(10px)',
                  }}
                >
                  <span style={{ fontSize: 16 }}>{badge.icon}</span>
                  <div>
                    <div style={{ color: '#fff', fontSize: 11.5, fontWeight: 700 }}>{badge.title}</div>
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>{badge.sub}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* ── LIVE TACTICAL TELEMETRY HUD (REAL LIVE ITEM — NO FAKE IMAGES) ── */}
            <div
              style={{
                borderRadius: 18,
                background: 'rgba(12, 15, 23, 0.82)',
                border: '1px solid rgba(255, 45, 74, 0.25)',
                boxShadow: '0 20px 45px rgba(0,0,0,0.6), 0 0 35px rgba(255,45,74,0.1)',
                padding: '18px 20px',
                maxWidth: 420,
                backdropFilter: 'blur(16px)',
              }}
            >
              {/* HUD Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      background: '#FF2D4A',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                    }}
                  >
                    🚑
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#fff' }}>Unit EMS-104</div>
                    <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace' }}>
                      ALS · Sea Link Corridor
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '3px 8px',
                    borderRadius: 6,
                    background: 'rgba(16,185,129,0.15)',
                    border: '1px solid rgba(16,185,129,0.3)',
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#10B981',
                      boxShadow: '0 0 8px #10B981',
                    }}
                  />
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#10B981', fontWeight: 700 }}>
                    CODE 3 LIVE
                  </span>
                </div>
              </div>

              {/* Real-time telemetry grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  marginBottom: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>SPEED</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#00F5FF', fontFamily: 'monospace' }}>
                    {telemetrySpeed} <span style={{ fontSize: 9, fontWeight: 500 }}>km/h</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>ETA TO KEM</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#10B981', fontFamily: 'monospace' }}>
                    4.2 <span style={{ fontSize: 9, fontWeight: 500 }}>min</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>CORRIDOR</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#FF2D4A', fontFamily: 'monospace' }}>
                    99% <span style={{ fontSize: 9, fontWeight: 500 }}>CLEAR</span>
                  </div>
                </div>
              </div>

              {/* Coordinates & destination banner */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.5)' }}>
                  📍 {telemetryCoord}
                </span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#00F5FF', fontWeight: 600 }}>
                  TRAFFIC LIVE ↗
                </span>
              </div>
            </div>

            {/* Bottom Quote */}
            <div style={{ paddingLeft: 4 }}>
              <p
                style={{
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: 12,
                  fontStyle: 'italic',
                  margin: '0 0 3px 0',
                }}
              >
                “Technology in service of human lives.”
              </p>
              <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontFamily: 'monospace' }}>
                — MediRoute
              </span>
            </div>
          </motion.div>

          {/* ─── CENTER COLUMN: LOGIN CARD ─── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            style={{ width: '100%', margin: '0 auto' }}
          >
            <div
              style={{
                background: 'rgba(12, 14, 20, 0.88)',
                backdropFilter: 'blur(28px)',
                WebkitBackdropFilter: 'blur(28px)',
                borderRadius: 24,
                border: '1px solid rgba(255, 255, 255, 0.10)',
                padding: '32px 34px',
                boxShadow:
                  '0 30px 80px rgba(0, 0, 0, 0.75), 0 0 50px rgba(255, 45, 74, 0.08), inset 0 1px 0 rgba(255,255,255,0.1)',
                position: 'relative',
              }}
            >
              {/* Header */}
              <div style={{ textAlign: 'center', marginBottom: 22 }}>
                <h2
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: '#ffffff',
                    letterSpacing: '-0.02em',
                    margin: 0,
                  }}
                >
                  Welcome to Medi<span style={{ color: '#FF2D4A' }}>Route</span>
                </h2>
                <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: 12.5, marginTop: 5, marginBottom: 0 }}>
                  Access your role-based portal
                </p>
              </div>

              {/* 4 Role Selector Tabs (Interacts with live map!) */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 8,
                  marginBottom: 22,
                }}
              >
                {Object.entries(ROLE_CONFIG).map(([role, rc]) => {
                  const isSelected = selectedRole === role
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => handleRoleSelect(role)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5,
                        padding: '12px 6px 10px 6px',
                        borderRadius: 14,
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(255, 45, 74, 0.10)' : 'rgba(255, 255, 255, 0.025)',
                        border: isSelected ? '1.5px solid #FF2D4A' : '1px solid rgba(255, 255, 255, 0.07)',
                        boxShadow: isSelected ? '0 0 16px rgba(255, 45, 74, 0.3)' : 'none',
                        transition: 'all 0.22s ease',
                      }}
                    >
                      <div
                        style={{
                          color: isSelected ? '#FF2D4A' : 'rgba(255,255,255,0.5)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {rc.icon}
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: isSelected ? '#fff' : 'rgba(255,255,255,0.7)',
                          textAlign: 'center',
                          lineHeight: 1.15,
                        }}
                      >
                        {rc.label}
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          color: isSelected ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.28)',
                          textAlign: 'center',
                          lineHeight: 1.15,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {rc.sub}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                <AnimatePresence>
                  {mode === 'register' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 13 }}
                    >
                      <div>
                        <label
                          style={{
                            display: 'block',
                            fontSize: 10,
                            color: 'rgba(255,255,255,0.42)',
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            marginBottom: 6,
                            fontFamily: 'monospace',
                          }}
                        >
                          Full Name
                        </label>
                        <input
                          style={{
                            width: '100%',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.09)',
                            borderRadius: 12,
                            padding: '11px 14px',
                            color: '#fff',
                            fontSize: 13.5,
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                          placeholder="Dr. Jane Doe"
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          required
                        />
                      </div>

                      <div>
                        <label
                          style={{
                            display: 'block',
                            fontSize: 10,
                            color: 'rgba(255,255,255,0.42)',
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            marginBottom: 6,
                            fontFamily: 'monospace',
                          }}
                        >
                          Phone Number
                        </label>
                        <input
                          style={{
                            width: '100%',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.09)',
                            borderRadius: 12,
                            padding: '11px 14px',
                            color: '#fff',
                            fontSize: 13.5,
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                          placeholder="+91 98765 43210"
                          value={form.phone}
                          onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Email Field */}
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 10,
                      color: 'rgba(255,255,255,0.45)',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      marginBottom: 6,
                      fontFamily: 'monospace',
                    }}
                  >
                    Email Address
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span
                      style={{
                        position: 'absolute',
                        left: 14,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'rgba(255,255,255,0.3)',
                        fontSize: 14,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                    </span>
                    <input
                      type="email"
                      style={{
                        width: '100%',
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.09)',
                        borderRadius: 12,
                        padding: '11px 14px 11px 40px',
                        color: '#fff',
                        fontSize: 13.5,
                        outline: 'none',
                        boxSizing: 'border-box',
                        transition: 'border-color 0.2s',
                      }}
                      onFocus={(e) => (e.target.style.borderColor = 'rgba(255,45,74,0.6)')}
                      onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.09)')}
                      placeholder="admin@mediroute.com"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label
                      style={{
                        fontSize: 10,
                        color: 'rgba(255,255,255,0.45)',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        fontFamily: 'monospace',
                      }}
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => toast('Demo mode: passwords are auto-filled for each role tab above!')}
                      style={{
                        fontSize: 11,
                        color: '#FF2D4A',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      Forgot Password?
                    </button>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <span
                      style={{
                        position: 'absolute',
                        left: 14,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'rgba(255,255,255,0.3)',
                        fontSize: 14,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      style={{
                        width: '100%',
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.09)',
                        borderRadius: 12,
                        padding: '11px 42px 11px 40px',
                        color: '#fff',
                        fontSize: 13.5,
                        outline: 'none',
                        boxSizing: 'border-box',
                        transition: 'border-color 0.2s',
                      }}
                      onFocus={(e) => (e.target.style.borderColor = 'rgba(255,45,74,0.6)')}
                      onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.09)')}
                      placeholder="••••••••"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute',
                        right: 14,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'rgba(255,255,255,0.35)',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      {showPassword ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Remember Me & SSO link */}
                {mode === 'login' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <label
                      onClick={() => setRememberMe(!rememberMe)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
                    >
                      <div
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 4,
                          border: `1.5px solid ${rememberMe ? '#FF2D4A' : 'rgba(255,255,255,0.2)'}`,
                          background: rememberMe ? '#FF2D4A' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s',
                        }}
                      >
                        {rememberMe && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <span style={{ color: 'rgba(255,255,255,0.5)' }}>Remember me</span>
                    </label>

                    <button
                      type="button"
                      onClick={() => handleQuickOAuth('SSO')}
                      style={{
                        color: 'rgba(255,255,255,0.38)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                        fontSize: 11.5,
                      }}
                    >
                      Use SSO (SSO/Google) ↗
                    </button>
                  </div>
                )}

                {/* Main Submit CTA */}
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '13px 20px',
                    borderRadius: 12,
                    fontWeight: 700,
                    color: '#ffffff',
                    fontSize: 14,
                    letterSpacing: '-0.01em',
                    background: loading
                      ? 'rgba(255,45,74,0.5)'
                      : 'linear-gradient(90deg, #FF2D4A 0%, #D91A38 100%)',
                    boxShadow: loading ? 'none' : '0 6px 24px rgba(255,45,74,0.42)',
                    border: 'none',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    marginTop: 4,
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!loading) e.currentTarget.style.boxShadow = '0 8px 30px rgba(255,45,74,0.6)'
                  }}
                  onMouseLeave={(e) => {
                    if (!loading) e.currentTarget.style.boxShadow = '0 6px 24px rgba(255,45,74,0.42)'
                  }}
                >
                  {loading ? (
                    <>
                      <motion.span
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        style={{
                          display: 'block',
                          width: 16,
                          height: 16,
                          border: '2px solid rgba(255,255,255,0.3)',
                          borderTopColor: '#ffffff',
                          borderRadius: '50%',
                        }}
                      />
                      Authorizing...
                    </>
                  ) : mode === 'login' ? (
                    'Sign In →'
                  ) : (
                    'Create Account →'
                  )}
                </button>

                {/* Social Login Divider */}
                {mode === 'login' && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0 2px 0' }}>
                      <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', fontFamily: 'monospace' }}>
                        or continue with
                      </span>
                      <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <button
                        type="button"
                        onClick={() => handleQuickOAuth('Google')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: '1px solid rgba(255,255,255,0.08)',
                          background: 'rgba(255,255,255,0.03)',
                          color: 'rgba(255,255,255,0.7)',
                          fontSize: 11.5,
                          fontWeight: 500,
                          cursor: 'pointer',
                          transition: 'background 0.2s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24">
                          <path
                            fill="#4285F4"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                          />
                          <path
                            fill="#EA4335"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                          />
                        </svg>
                        Sign in with Google
                      </button>

                      <button
                        type="button"
                        onClick={() => handleQuickOAuth('Microsoft')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: '1px solid rgba(255,255,255,0.08)',
                          background: 'rgba(255,255,255,0.03)',
                          color: 'rgba(255,255,255,0.7)',
                          fontSize: 11.5,
                          fontWeight: 500,
                          cursor: 'pointer',
                          transition: 'background 0.2s',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <rect x="2" y="2" width="9" height="9" fill="#F25022" />
                          <rect x="13" y="2" width="9" height="9" fill="#7FBA00" />
                          <rect x="2" y="13" width="9" height="9" fill="#00A4EF" />
                          <rect x="13" y="13" width="9" height="9" fill="#FFB900" />
                        </svg>
                        Sign in with Microsoft
                      </button>
                    </div>
                  </>
                )}
              </form>

              {/* Mode switch */}
              <div style={{ textAlign: 'center', marginTop: 18 }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)' }}>
                  {mode === 'login' ? 'New to MediRoute? ' : 'Already have an account? '}
                </span>
                <button
                  type="button"
                  onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#FF2D4A',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {mode === 'login' ? 'Request Access' : 'Sign In'}
                </button>
              </div>
            </div>

            {/* Back to landing */}
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button
                onClick={() => navigate('/')}
                style={{
                  color: 'rgba(255,255,255,0.3)',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                ← Back to Landing Page
              </button>
            </div>
          </motion.div>

          {/* ─── RIGHT COLUMN: CAPABILITIES & QUOTE & CITY ─── */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            className="hidden xl:flex"
          >
            {/* Unified Capabilities Glass Card */}
            <div
              style={{
                background: 'rgba(12, 14, 20, 0.72)',
                backdropFilter: 'blur(20px)',
                borderRadius: 20,
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: '20px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              {CAPABILITIES.map((cap) => (
                <div key={cap.title} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 10,
                      background: 'rgba(255, 45, 74, 0.10)',
                      border: '1px solid rgba(255, 45, 74, 0.22)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {cap.icon}
                  </div>
                  <div>
                    <div style={{ color: '#ffffff', fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>
                      {cap.title}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2 }}>{cap.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Live Operations Status Card (Interactive Real Item) */}
            <div
              style={{
                background: 'rgba(12, 14, 20, 0.65)',
                backdropFilter: 'blur(16px)',
                borderRadius: 18,
                border: '1px solid rgba(255, 255, 255, 0.07)',
                padding: '18px 20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  City System Pulse
                </span>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#10B981' }}>● 100% OPERATIONAL</span>
              </div>
              <p
                style={{
                  color: 'rgba(255,255,255,0.75)',
                  fontSize: 12,
                  fontStyle: 'italic',
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                “Every second counts.
                <br />
                Together we can make cities safer.”
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <div style={{ width: 16, height: 2, background: '#FF2D4A', borderRadius: 1 }} />
                <span style={{ color: 'rgba(255,255,255,0.38)', fontSize: 10.5, fontFamily: 'monospace' }}>
                  MediRoute Autonomous Fleet
                </span>
              </div>
            </div>

            {/* City Location Badge */}
            <div
              style={{
                background: 'rgba(12, 14, 20, 0.65)',
                backdropFilter: 'blur(16px)',
                borderRadius: 18,
                border: '1px solid rgba(255, 255, 255, 0.07)',
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: 'rgba(255, 45, 74, 0.12)',
                  border: '1px solid rgba(255, 45, 74, 0.28)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                }}
              >
                📍
              </div>
              <div>
                <div style={{ color: '#ffffff', fontWeight: 700, fontSize: 13.5 }}>Mumbai Metropolitan</div>
                <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: 11, marginTop: 1 }}>
                  Smarter Cities · Healthier People
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </main>

      {/* Responsive stylesheet helper */}
      <style>{`
        @media (max-width: 1280px) {
          .login-grid-responsive {
            grid-template-columns: 1fr 480px !important;
          }
        }
        @media (max-width: 1024px) {
          .login-grid-responsive {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  )
}
