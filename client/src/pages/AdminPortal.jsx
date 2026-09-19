import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { getSocket } from '../lib/socket'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'
import toast from 'react-hot-toast'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

export default function AdminPortal() {
  const { user, logout } = useAuthStore()

  // State
  const [currentTime, setCurrentTime] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEsiFilter, setSelectedEsiFilter] = useState('ALL')
  const [activeCameraAngle, setActiveCameraAngle] = useState('iso')
  const [isOrbiting, setIsOrbiting] = useState(false)
  const [selectedIncident, setSelectedIncident] = useState(null)
  const [showAnalyticsDrawer, setShowAnalyticsDrawer] = useState(false)
  const [show3DBuildings, setShow3DBuildings] = useState(true)

  // Backend Data State
  const [stats, setStats] = useState({ total: 12, active: 12, completed: 48, today: 18 })
  const [ambulances, setAmbulances] = useState([])
  const [hospitals, setHospitals] = useState([])
  const [incidents, setIncidents] = useState([])
  const [surgeForecast, setSurgeForecast] = useState([])

  // Map Refs
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const orbitAnimationRef = useRef(null)
  const markersRef = useRef([])

  // Live Digital Clock
  useEffect(() => {
    const updateClock = () => {
      const now = new Date()
      const timeStr = now.toLocaleTimeString('en-IN', { hour12: false })
      setCurrentTime(`19 Sep 2026 | ${timeStr} IST`)
    }
    updateClock()
    const timer = setInterval(updateClock, 1000)
    return () => clearInterval(timer)
  }, [])

  // Keyboard shortcut ⌘K or Ctrl+K for search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        document.getElementById('command-search')?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Initial Backend Data Fetch
  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [statsRes, ambRes, hospRes, incRes, forecastRes] = await Promise.all([
          api.get('/incidents/stats/summary'),
          api.get('/ambulances'),
          api.get('/hospitals'),
          api.get('/incidents?limit=50'),
          api.get('/ai/surge-forecast'),
        ])
        setStats(statsRes.data || { total: 12, active: 12, completed: 48, today: 18 })
        if (ambRes.data?.ambulances?.length) setAmbulances(ambRes.data.ambulances)
        if (hospRes.data?.hospitals?.length) setHospitals(hospRes.data.hospitals)
        if (incRes.data?.incidents?.length) setIncidents(incRes.data.incidents)
        if (forecastRes.data?.forecast?.length) setSurgeForecast(forecastRes.data.forecast)
      } catch (err) {
        console.error('Admin fetch error:', err)
      }
    }
    fetchAll()
    const interval = setInterval(fetchAll, 30000)
    return () => clearInterval(interval)
  }, [])

  // Initialize REAL LIVE 3D Mapbox GL Canvas
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [72.855, 19.035],
      zoom: 12.8,
      pitch: 58,
      bearing: -18,
      antialias: true,
    })

    map.on('load', () => {
      // 1. Add Realistic 3D Building Extrusions
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
          'fill-extrusion-opacity': 0.9,
        },
      })

      // 2. Add Live Glowing Green Corridor GeoJSON Line
      map.addSource('green-corridor-route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [72.831, 19.002], // Lower Parel (#INC-7842)
              [72.842, 19.018], // Dadar junction
              [72.852, 19.035], // EMS-104 Ambulance position
              [72.863, 19.048], // Sion Hospital
            ],
          },
        },
      })

      // Glowing Route Outer Blur
      map.addLayer({
        id: 'green-corridor-glow',
        type: 'line',
        source: 'green-corridor-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#10B981',
          'line-width': 8,
          'line-opacity': 0.45,
          'line-blur': 3,
        },
      })

      // Neon Cyan Core Line
      map.addLayer({
        id: 'green-corridor-core',
        type: 'line',
        source: 'green-corridor-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#00F5FF',
          'line-width': 3,
          'line-opacity': 0.95,
        },
      })

      // Secondary Blue Hospital Connection
      map.addSource('hospital-feed-route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [72.852, 19.035],
              [72.868, 19.065],
              [72.875, 19.080],
            ],
          },
        },
      })

      map.addLayer({
        id: 'hospital-feed-line',
        type: 'line',
        source: 'hospital-feed-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#3B82F6',
          'line-width': 2.5,
          'line-opacity': 0.8,
          'line-dasharray': [2, 2],
        },
      })

      // 3. Attach Live Mapbox HTML Markers
      const createMarker = (coords, html) => {
        const el = document.createElement('div')
        el.innerHTML = html
        const m = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat(coords)
          .addTo(map)
        markersRef.current.push(m)
        return m
      }

      // Hospital Markers matching Prompt 2
      createMarker([72.825, 19.131], `
        <div class="px-2.5 py-1 rounded-lg bg-[#090a16]/95 border border-purple-500/70 shadow-[0_0_20px_rgba(124,58,237,0.6)] backdrop-blur-md text-[10px] font-mono flex items-center gap-1.5 cursor-pointer hover:scale-105 transition-transform">
          <span class="w-3.5 h-3.5 rounded bg-purple-600 text-white font-bold flex items-center justify-center text-[8px]">H</span>
          <div>
            <div class="text-purple-300 font-bold leading-tight">Kokilaben Hospital</div>
            <div class="text-white/60 text-[8px]">ICU 4/20</div>
          </div>
        </div>
      `)

      createMarker([72.832, 19.055], `
        <div class="px-2.5 py-1 rounded-lg bg-[#090a16]/95 border border-purple-500/70 shadow-[0_0_20px_rgba(124,58,237,0.6)] backdrop-blur-md text-[10px] font-mono flex items-center gap-1.5 cursor-pointer hover:scale-105 transition-transform">
          <span class="w-3.5 h-3.5 rounded bg-purple-600 text-white font-bold flex items-center justify-center text-[8px]">H</span>
          <div>
            <div class="text-purple-300 font-bold leading-tight">Holy Family Hospital</div>
            <div class="text-white/60 text-[8px]">ICU 2/18</div>
          </div>
        </div>
      `)

      createMarker([72.863, 19.048], `
        <div class="px-2.5 py-1 rounded-lg bg-[#090a16]/95 border border-purple-500/70 shadow-[0_0_20px_rgba(124,58,237,0.6)] backdrop-blur-md text-[10px] font-mono flex items-center gap-1.5 cursor-pointer hover:scale-105 transition-transform">
          <span class="w-3.5 h-3.5 rounded bg-purple-600 text-white font-bold flex items-center justify-center text-[8px]">H</span>
          <div>
            <div class="text-purple-300 font-bold leading-tight">Sion Hospital</div>
            <div class="text-white/60 text-[8px]">ICU 6/24</div>
          </div>
        </div>
      `)

      createMarker([72.842, 19.003], `
        <div class="px-2.5 py-1 rounded-lg bg-[#090a16]/95 border border-purple-500/70 shadow-[0_0_20px_rgba(124,58,237,0.6)] backdrop-blur-md text-[10px] font-mono flex items-center gap-1.5 cursor-pointer hover:scale-105 transition-transform">
          <span class="w-3.5 h-3.5 rounded bg-purple-600 text-white font-bold flex items-center justify-center text-[8px]">H</span>
          <div>
            <div class="text-purple-300 font-bold leading-tight">KEM Hospital</div>
            <div class="text-white/60 text-[8px]">ICU 3/32</div>
          </div>
        </div>
      `)

      // Incident Markers matching Prompt 2
      createMarker([72.831, 19.002], `
        <div class="relative cursor-pointer hover:scale-105 transition-transform">
          <span class="absolute -inset-3 rounded-full bg-red-500/30 animate-ping"></span>
          <div class="relative px-2 py-1 rounded bg-[#12080d]/95 border border-red-500 text-[10px] font-mono shadow-[0_0_25px_rgba(255,45,74,0.7)] flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
            <div>
              <div class="text-red-400 font-bold text-[9px] leading-tight">#INC-7842</div>
              <div class="text-white text-[8px] leading-tight">ESI 1</div>
            </div>
          </div>
        </div>
      `)

      createMarker([72.868, 19.065], `
        <div class="relative cursor-pointer hover:scale-105 transition-transform">
          <span class="absolute -inset-2 rounded-full bg-orange-500/30 animate-ping"></span>
          <div class="relative px-2 py-1 rounded bg-[#120b08]/95 border border-orange-500 text-[10px] font-mono shadow-[0_0_20px_rgba(255,140,0,0.6)] flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></span>
            <div>
              <div class="text-orange-400 font-bold text-[9px] leading-tight">#INC-7841</div>
              <div class="text-white text-[8px] leading-tight">ESI 2</div>
            </div>
          </div>
        </div>
      `)

      // Live Ambulance Markers matching Prompt 2
      createMarker([72.852, 19.035], `
        <div class="px-2 py-1 rounded-lg bg-[#061424]/95 border border-cyan-400 text-[9px] font-mono shadow-[0_0_25px_rgba(0,245,255,0.6)] flex items-center gap-1.5 cursor-pointer hover:scale-105 transition-transform">
          <span class="text-xs">🚑</span>
          <div>
            <div class="text-cyan-300 font-bold leading-tight">EMS-104</div>
            <div class="text-emerald-400 text-[8px] font-semibold leading-tight">82 km/h</div>
          </div>
        </div>
      `)

      createMarker([72.836, 19.012], `
        <div class="px-2 py-1 rounded-lg bg-[#061424]/95 border border-cyan-400 text-[9px] font-mono shadow-[0_0_20px_rgba(0,245,255,0.5)] flex items-center gap-1.5 cursor-pointer hover:scale-105 transition-transform">
          <span class="text-xs">🚑</span>
          <div>
            <div class="text-cyan-300 font-bold leading-tight">EMS-076</div>
            <div class="text-emerald-400 text-[8px] font-semibold leading-tight">76 km/h</div>
          </div>
        </div>
      `)

      createMarker([72.871, 19.038], `
        <div class="px-2 py-1 rounded-lg bg-[#061424]/95 border border-cyan-400 text-[9px] font-mono shadow-[0_0_20px_rgba(0,245,255,0.5)] flex items-center gap-1.5 cursor-pointer hover:scale-105 transition-transform">
          <span class="text-xs">🚑</span>
          <div>
            <div class="text-cyan-300 font-bold leading-tight">EMS-092</div>
            <div class="text-emerald-400 text-[8px] font-semibold leading-tight">61 km/h</div>
          </div>
        </div>
      `)

      createMarker([72.845, 19.025], `
        <div class="px-2.5 py-1 rounded-md bg-emerald-950/90 border border-emerald-500/60 text-[9px] font-mono shadow-[0_0_20px_rgba(16,185,129,0.5)] backdrop-blur-sm cursor-pointer">
          <div class="text-emerald-300 font-bold leading-tight">Green Corridor</div>
          <div class="text-white/70 text-[8px] leading-tight">Signals Synchronized</div>
        </div>
      `)
    })

    mapInstanceRef.current = map

    return () => {
      if (orbitAnimationRef.current) cancelAnimationFrame(orbitAnimationRef.current)
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      map.remove()
      mapInstanceRef.current = null
    }
  }, [])

  // WebSockets for Real-Time Dispatch updates
  useEffect(() => {
    const socket = getSocket()
    socket.on('new_incident', (incident) => {
      setIncidents((prev) => [incident, ...prev])
      setStats((prev) => ({ ...prev, active: prev.active + 1, total: prev.total + 1 }))
      toast('🚨 New incoming SOS incident logged!', { icon: '🆘', style: { background: '#FF2D4A', color: 'white' } })
    })
    return () => {
      socket.off('new_incident')
    }
  }, [])

  // Camera Angle Controls (Manipulating real Mapbox Camera)
  const handleCameraAngle = (type) => {
    setActiveCameraAngle(type)
    if (orbitAnimationRef.current) {
      cancelAnimationFrame(orbitAnimationRef.current)
      orbitAnimationRef.current = null
      setIsOrbiting(false)
    }

    if (!mapInstanceRef.current) return
    const map = mapInstanceRef.current

    if (type === 'orbit') {
      setIsOrbiting(true)
      const rotate = () => {
        if (!mapInstanceRef.current) return
        const cur = mapInstanceRef.current.getBearing()
        mapInstanceRef.current.setBearing((cur + 0.3) % 360)
        orbitAnimationRef.current = requestAnimationFrame(rotate)
      }
      rotate()
      toast.success('360° Continuous Orbit Activated')
      return
    }

    if (type === 'iso') {
      map.easeTo({ pitch: 58, bearing: -18, zoom: 12.8, duration: 1200 })
    } else if (type === 'horizon') {
      map.easeTo({ pitch: 75, bearing: 45, zoom: 13.5, duration: 1400 })
    } else if (type === 'tactical') {
      map.easeTo({ pitch: 0, bearing: 0, zoom: 11.8, duration: 1000 })
    }
  }

  // Quick Focus Targets on the Real Mapbox Camera
  const handleFocus = (target) => {
    if (!mapInstanceRef.current) return
    const map = mapInstanceRef.current

    if (target === 'city') {
      toast('📍 Centered on Mumbai Metropolitan Region', { icon: '🏙️' })
      map.flyTo({ center: [72.855, 19.035], zoom: 12.8, pitch: 58, bearing: -18, duration: 1400 })
    } else if (target === 'ambulance') {
      toast('🚑 Tracking EMS-104 (82 km/h · Green Corridor)', { icon: '⚡' })
      map.flyTo({ center: [72.852, 19.035], zoom: 14.8, pitch: 65, duration: 1400 })
    } else if (target === 'trauma') {
      toast('🆘 Focused on Critical Trauma (#INC-7842 · ESI 1)', { icon: '🚨' })
      map.flyTo({ center: [72.831, 19.002], zoom: 15.2, pitch: 60, duration: 1400 })
    }
  }

  const seedSampleData = async () => {
    try {
      await Promise.all([api.post('/hospitals/seed'), api.post('/ambulances/seed')])
      toast.success('Demonstration fleet & trauma beds seeded successfully')
    } catch {
      toast.error('Data already seeded or server busy')
    }
  }

  // Exact incident feed items matching Prompt 2
  const defaultIncidentFeed = [
    {
      id: 'INC-7842',
      time: '20:21',
      channel: 'call',
      esi: 1,
      title: 'Acute Myocardial Infarction',
      location: 'Lower Parel, Mumbai',
      assigned: 'EMS-104',
      eta: '6 min',
      accentColor: '#FF2D4A',
      coords: [72.831, 19.002],
    },
    {
      id: 'INC-7841',
      time: '20:18',
      channel: 'whatsapp',
      esi: 2,
      title: 'Road Traffic Accident',
      location: 'Bandra Kurla Complex',
      assigned: 'EMS-218',
      eta: '8 min',
      accentColor: '#FF8C00',
      coords: [72.868, 19.065],
    },
    {
      id: 'INC-7840',
      time: '20:16',
      channel: 'call',
      esi: 1,
      title: 'Unconscious Patient',
      location: 'Andheri West',
      assigned: 'EMS-076',
      eta: '5 min',
      accentColor: '#FF2D4A',
      coords: [72.835, 19.12],
    },
    {
      id: 'INC-7839',
      time: '20:13',
      channel: 'app',
      esi: 3,
      title: 'Respiratory Distress',
      location: 'Powai',
      assigned: 'EMS-311',
      eta: '12 min',
      accentColor: '#3B82F6',
      coords: [72.905, 19.117],
    },
    {
      id: 'INC-7838',
      time: '20:11',
      channel: 'call',
      esi: 2,
      title: 'Fall / Head Injury',
      location: 'Ghatkopar',
      assigned: 'EMS-092',
      eta: '9 min',
      accentColor: '#FF8C00',
      coords: [72.908, 19.086],
    },
    {
      id: 'INC-7837',
      time: '20:07',
      channel: 'app',
      esi: 4,
      title: 'Severe Abdominal Pain',
      location: 'Mulund',
      assigned: 'EMS-205',
      eta: '14 min',
      accentColor: '#10B981',
      coords: [72.956, 19.172],
    },
  ]

  const filteredFeed = defaultIncidentFeed.filter((item) => {
    const matchesSearch =
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.assigned.toLowerCase().includes(searchQuery.toLowerCase())

    if (!matchesSearch) return false
    if (selectedEsiFilter === 'ALL') return true
    if (selectedEsiFilter === 'ESI-1') return item.esi === 1
    if (selectedEsiFilter === 'ESI-2') return item.esi === 2
    if (selectedEsiFilter === 'ESI-3') return item.esi === 3
    if (selectedEsiFilter === 'ESI-4+') return item.esi >= 4
    return true
  })

  // TFT Surge Forecast Chart Data
  const forecastChartData = surgeForecast.length
    ? surgeForecast.slice(0, 12).map((f) => ({
        hour: `${new Date(f.time).getHours()}:00`,
        load: Math.round(f.predictedLoad),
        confidence: Math.round(f.confidence * 100),
      }))
    : [
        { hour: '20:00', load: 45, confidence: 92 },
        { hour: '21:00', load: 68, confidence: 88 },
        { hour: '22:00', load: 84, confidence: 95 },
        { hour: '23:00', load: 72, confidence: 89 },
        { hour: '00:00', load: 52, confidence: 91 },
        { hour: '01:00', load: 38, confidence: 94 },
      ]

  return (
    <div className="h-screen w-screen bg-[#07090e] text-white flex flex-col overflow-hidden font-sans select-none">
      {/* ── TOP APP HEADER ── */}
      <header className="h-16 border-b border-white/[0.08] bg-[#07090e]/95 backdrop-blur-md px-5 flex items-center justify-between z-40 shrink-0">
        {/* Left: Brand + Subtitle */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => window.location.href = '/'}>
            <svg className="w-7 h-7 text-[#FF2D4A]" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth={2.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M0 6h6l2.5-6 4 12 2.5-6h9" />
            </svg>
            <div>
              <div className="font-extrabold text-lg tracking-tight text-white flex items-center">
                Medi<span className="text-[#FF2D4A]">Route</span>
              </div>
              <div className="text-[10px] text-white/50 -mt-1 font-medium tracking-wide">
                City Operations Command Center
              </div>
            </div>
          </div>

          {/* Region & Live Digital Clock */}
          <div className="hidden lg:flex items-center gap-2.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.02] text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#10b981]" />
            <span className="text-white/90 font-semibold">Mumbai Metropolitan Region</span>
            <span className="text-white/30">▾</span>
            <span className="text-white/20">|</span>
            <span className="text-white/60">{currentTime || '19 Sep 2026 | 20:24:17 IST'}</span>
          </div>
        </div>

        {/* Center: Search Bar */}
        <div className="flex-1 max-w-md mx-6 hidden md:block">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-white/40 text-xs">
              🔍
            </span>
            <input
              id="command-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search location, incident or unit..."
              className="w-full pl-9 pr-12 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] focus:bg-[#0b0e17] border border-white/10 focus:border-cyan-500/50 text-xs text-white placeholder-white/40 focus:outline-none transition-all font-sans"
            />
            <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none">
              <kbd className="px-1.5 py-0.5 rounded border border-white/20 bg-white/5 text-[10px] font-mono text-white/40">
                ⌘ K
              </kbd>
            </div>
          </div>
        </div>

        {/* Right: Actions, Notifications & Avatar */}
        <div className="flex items-center gap-3">
          <button
            onClick={seedSampleData}
            title="Seed sample data for evaluation"
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-950/20 text-emerald-400 hover:bg-emerald-900/40 text-[11px] font-mono transition-all"
          >
            <span>🌱</span>
            <span>Seed Fleet</span>
          </button>

          <button
            onClick={() => toast('3 Priority Dispatches requiring supervisor attention', { icon: '🔔' })}
            className="relative w-8 h-8 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] flex items-center justify-center text-white/70 transition-all"
          >
            <span className="text-sm">🔔</span>
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#FF2D4A] text-[9px] font-bold font-mono flex items-center justify-center text-white">
              3
            </span>
          </button>

          <div className="flex items-center gap-2.5 pl-2 border-l border-white/10">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-500 text-white font-bold text-xs flex items-center justify-center shadow-[0_0_12px_rgba(0,245,255,0.4)]">
              AD
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-xs font-semibold text-white leading-tight">Admin</div>
              <div className="text-[10px] text-white/40 leading-tight">City Dispatcher</div>
            </div>
            <button
              onClick={logout}
              title="Logout"
              className="ml-1 text-white/30 hover:text-red-400 text-xs transition-colors p-1"
            >
              ⏻
            </button>
          </div>
        </div>
      </header>

      {/* ── MAIN WORKSPACE ── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* ── LEFT PANEL: LIVE INCIDENT FEED ── */}
        <aside className="w-[320px] xl:w-[350px] border-r border-white/[0.08] bg-[#07090e]/95 flex flex-col z-30 shrink-0">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-white tracking-tight">
                Live Incident Feed
              </span>
              <span className="px-1.5 py-0.5 rounded bg-white/10 text-white/70 font-mono text-[11px]">
                {filteredFeed.length}
              </span>
            </div>
            <button
              onClick={() => setSelectedEsiFilter('ALL')}
              className="text-white/40 hover:text-white text-xs transition-colors"
              title="Reset view"
            >
              ⤢
            </button>
          </div>

          {/* Severity Filter Tabs */}
          <div className="p-2 border-b border-white/[0.06] grid grid-cols-5 gap-1 text-[11px] font-mono">
            <button
              onClick={() => setSelectedEsiFilter('ALL')}
              className={`py-1 rounded text-center transition-all ${
                selectedEsiFilter === 'ALL'
                  ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50 font-bold'
                  : 'text-white/50 hover:bg-white/5'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setSelectedEsiFilter('ESI-1')}
              className={`py-1 rounded text-center transition-all flex items-center justify-center gap-1 ${
                selectedEsiFilter === 'ESI-1'
                  ? 'bg-red-600/30 text-red-300 border border-red-500/50 font-bold'
                  : 'text-white/50 hover:bg-white/5'
              }`}
            >
              <span>ESI-1</span>
              <span className="w-3.5 h-3.5 rounded-full bg-red-600/60 text-white text-[9px] flex items-center justify-center">
                2
              </span>
            </button>
            <button
              onClick={() => setSelectedEsiFilter('ESI-2')}
              className={`py-1 rounded text-center transition-all flex items-center justify-center gap-1 ${
                selectedEsiFilter === 'ESI-2'
                  ? 'bg-orange-600/30 text-orange-300 border border-orange-500/50 font-bold'
                  : 'text-white/50 hover:bg-white/5'
              }`}
            >
              <span>ESI-2</span>
              <span className="w-3.5 h-3.5 rounded-full bg-orange-600/60 text-white text-[9px] flex items-center justify-center">
                3
              </span>
            </button>
            <button
              onClick={() => setSelectedEsiFilter('ESI-3')}
              className={`py-1 rounded text-center transition-all flex items-center justify-center gap-1 ${
                selectedEsiFilter === 'ESI-3'
                  ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50 font-bold'
                  : 'text-white/50 hover:bg-white/5'
              }`}
            >
              <span>ESI-3</span>
              <span className="w-3.5 h-3.5 rounded-full bg-blue-600/60 text-white text-[9px] flex items-center justify-center">
                4
              </span>
            </button>
            <button
              onClick={() => setSelectedEsiFilter('ESI-4+')}
              className={`py-1 rounded text-center transition-all flex items-center justify-center gap-1 ${
                selectedEsiFilter === 'ESI-4+'
                  ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50 font-bold'
                  : 'text-white/50 hover:bg-white/5'
              }`}
            >
              <span>ESI-4+</span>
              <span className="w-3.5 h-3.5 rounded-full bg-emerald-600/60 text-white text-[9px] flex items-center justify-center">
                3
              </span>
            </button>
          </div>

          {/* Incident Cards */}
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {filteredFeed.map((item) => {
              const isSelected = selectedIncident?.id === item.id
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    setSelectedIncident(item)
                    if (mapInstanceRef.current && item.coords) {
                      mapInstanceRef.current.flyTo({ center: item.coords, zoom: 14.8, pitch: 60, duration: 1200 })
                    }
                  }}
                  className={`p-3 rounded-lg cursor-pointer transition-all border text-left relative overflow-hidden group ${
                    isSelected
                      ? 'bg-white/[0.08] border-cyan-500/60 shadow-[0_0_15px_rgba(0,245,255,0.15)]'
                      : 'bg-white/[0.02] hover:bg-white/[0.05] border-white/[0.06]'
                  }`}
                >
                  <div
                    className="absolute left-0 inset-y-0 w-1"
                    style={{ backgroundColor: item.accentColor }}
                  />

                  <div className="flex items-start justify-between gap-2 pl-2">
                    <div className="text-[10px] font-mono text-white/40 flex items-center gap-1">
                      <span>{item.time}</span>
                      <span>•</span>
                      {item.channel === 'call' && <span>📞 Call</span>}
                      {item.channel === 'whatsapp' && <span className="text-emerald-400">💬 WhatsApp</span>}
                      {item.channel === 'app' && <span>📱 App</span>}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-white/50">#{item.id}</span>
                      <span
                        className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono text-white"
                        style={{
                          backgroundColor: `${item.accentColor}33`,
                          border: `1px solid ${item.accentColor}88`,
                          color: item.accentColor,
                        }}
                      >
                        ESI {item.esi}
                      </span>
                      <span className="text-white/30 text-xs group-hover:translate-x-0.5 transition-transform">
                        ›
                      </span>
                    </div>
                  </div>

                  <div className="pl-2 mt-1.5">
                    <div className="text-xs font-bold text-white leading-tight">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-white/50 mt-0.5 leading-tight truncate">
                      {item.location}
                    </div>
                  </div>

                  <div className="pl-2 mt-2 flex items-center justify-between text-[10px] font-mono pt-1.5 border-t border-white/[0.04]">
                    <span className="text-white/60 flex items-center gap-1">
                      <span>Assigned:</span>
                      <strong className="text-white font-semibold">{item.assigned}</strong>
                    </span>
                    <span className="text-emerald-400 font-bold bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-500/20">
                      ETA {item.eta}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </aside>

        {/* ── CENTER / RIGHT: 100% LIVE 3D MAPBOX MAP CANVAS (NO STATIC IMAGE) ── */}
        <main className="flex-1 relative overflow-hidden flex flex-col bg-[#05070b]">
          {/* Top-Center Control Pills: Focus Targets */}
          <div className="absolute top-4 left-6 z-20 flex items-center gap-2.5">
            <button
              onClick={() => handleFocus('city')}
              className="px-3 py-1.5 rounded-lg bg-[#090d16]/85 border border-white/10 hover:border-white/25 text-xs font-mono text-white shadow-xl backdrop-blur-md flex items-center gap-2 transition-all hover:bg-[#0e1424]"
            >
              <span className="text-cyan-400">◎</span>
              <span className="font-semibold">City Center</span>
              <span className="text-[10px] text-white/40">Focus view</span>
            </button>

            <button
              onClick={() => handleFocus('ambulance')}
              className="px-3 py-1.5 rounded-lg bg-[#090d16]/85 border border-cyan-500/30 hover:border-cyan-500/60 text-xs font-mono text-cyan-300 shadow-xl backdrop-blur-md flex items-center gap-2 transition-all hover:bg-[#0c1b2c]"
            >
              <span className="text-xs">🚑</span>
              <span className="font-semibold">Nearest Active Ambulance</span>
              <span className="text-[10px] text-cyan-400/60">Track live unit</span>
            </button>

            <button
              onClick={() => handleFocus('trauma')}
              className="px-3 py-1.5 rounded-lg bg-[#090d16]/85 border border-red-500/40 hover:border-red-500/70 text-xs font-mono text-red-300 shadow-xl backdrop-blur-md flex items-center gap-2 transition-all hover:bg-[#200e14]"
            >
              <span className="text-xs">🆘</span>
              <span className="font-semibold">Critical Trauma (ESI-1)</span>
              <span className="text-[10px] text-red-400/60">Jump to highest priority</span>
            </button>
          </div>

          {/* Top-Right: Camera Angle Controller HUD & Compass */}
          <div className="absolute top-4 right-6 z-20 flex items-start gap-3">
            <div className="p-3 rounded-xl bg-[#090d16]/90 border border-white/10 shadow-2xl backdrop-blur-md flex flex-col gap-1.5 min-w-[210px]">
              <div className="text-[10px] font-mono uppercase tracking-wider text-white/40 font-semibold mb-1 flex items-center justify-between">
                <span>Camera Angle</span>
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              </div>

              <button
                onClick={() => handleCameraAngle('iso')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono text-left flex items-center justify-between transition-all ${
                  activeCameraAngle === 'iso'
                    ? 'bg-blue-600/30 text-cyan-300 border border-cyan-500/50 font-bold shadow-[0_0_12px_rgba(0,245,255,0.2)]'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>📐</span>
                  <span>3D Isometric (55°)</span>
                </div>
              </button>

              <button
                onClick={() => handleCameraAngle('horizon')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono text-left flex items-center justify-between transition-all ${
                  activeCameraAngle === 'horizon'
                    ? 'bg-blue-600/30 text-cyan-300 border border-cyan-500/50 font-bold shadow-[0_0_12px_rgba(0,245,255,0.2)]'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>🌆</span>
                  <span>Horizon Perspective (75°)</span>
                </div>
              </button>

              <button
                onClick={() => handleCameraAngle('tactical')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono text-left flex items-center justify-between transition-all ${
                  activeCameraAngle === 'tactical'
                    ? 'bg-blue-600/30 text-cyan-300 border border-cyan-500/50 font-bold shadow-[0_0_12px_rgba(0,245,255,0.2)]'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>🧭</span>
                  <span>Tactical 2D (0°)</span>
                </div>
              </button>

              <button
                onClick={() => handleCameraAngle('orbit')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono text-left flex items-center justify-between transition-all ${
                  isOrbiting
                    ? 'bg-red-600/30 text-red-300 border border-red-500/50 font-bold animate-pulse'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>🔄</span>
                  <span>360° Auto-Orbit</span>
                </div>
                {isOrbiting && <span className="text-[9px] text-red-400 font-bold font-mono">LIVE</span>}
              </button>
            </div>

            {/* Compass Rose */}
            <div className="w-12 h-12 rounded-xl bg-[#090d16]/90 border border-white/10 shadow-2xl backdrop-blur-md flex items-center justify-center text-cyan-400">
              <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <polygon points="12,2 15,10 12,8 9,10" fill="#00F5FF" stroke="none" />
                <polygon points="12,22 9,14 12,16 15,14" fill="#ffffff40" stroke="none" />
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.2} />
              </svg>
            </div>
          </div>

          {/* Right Floating Quick Tools */}
          <div className="absolute top-44 right-6 z-20 flex flex-col gap-2">
            <button
              onClick={() => {
                setShow3DBuildings(!show3DBuildings)
                if (mapInstanceRef.current) {
                  const visibility = !show3DBuildings ? 'visible' : 'none'
                  if (mapInstanceRef.current.getLayer('3d-buildings')) {
                    mapInstanceRef.current.setLayoutProperty('3d-buildings', 'visibility', visibility)
                  }
                }
              }}
              title="Toggle 3D Buildings Extrusion"
              className={`w-9 h-9 rounded-lg border shadow-lg backdrop-blur-md flex items-center justify-center text-sm transition-all ${
                show3DBuildings
                  ? 'bg-cyan-950/80 border-cyan-500/50 text-cyan-300'
                  : 'bg-[#090d16]/85 border-white/10 text-white/50 hover:text-white'
              }`}
            >
              ◫
            </button>

            <button
              onClick={() => setShowAnalyticsDrawer(!showAnalyticsDrawer)}
              title="Toggle Surge Analytics & TFT Forecast"
              className={`w-9 h-9 rounded-lg border shadow-lg backdrop-blur-md flex items-center justify-center text-sm transition-all ${
                showAnalyticsDrawer
                  ? 'bg-purple-950/80 border-purple-500/50 text-purple-300'
                  : 'bg-[#090d16]/85 border-white/10 text-white/50 hover:text-white'
              }`}
            >
              📊
            </button>

            <button
              onClick={() => toast('GIS Layer settings active', { icon: '⚙️' })}
              title="Map & Sensor Layers"
              className="w-9 h-9 rounded-lg bg-[#090d16]/85 border border-white/10 hover:border-white/20 text-white/60 hover:text-white shadow-lg backdrop-blur-md flex items-center justify-center text-sm transition-all"
            >
              ⚙
            </button>

            <div className="h-px bg-white/10 my-1" />

            <button
              onClick={() => {
                if (mapInstanceRef.current) mapInstanceRef.current.zoomIn()
              }}
              title="Zoom in"
              className="w-9 h-9 rounded-lg bg-[#090d16]/85 border border-white/10 hover:border-white/20 text-white/70 hover:text-white shadow-lg backdrop-blur-md flex items-center justify-center text-base font-bold transition-all"
            >
              +
            </button>
            <button
              onClick={() => {
                if (mapInstanceRef.current) mapInstanceRef.current.zoomOut()
              }}
              title="Zoom out"
              className="w-9 h-9 rounded-lg bg-[#090d16]/85 border border-white/10 hover:border-white/20 text-white/70 hover:text-white shadow-lg backdrop-blur-md flex items-center justify-center text-base font-bold transition-all"
            >
              −
            </button>
          </div>

          {/* ── THE LIVE MAPBOX CONTAINER (100% REAL LIVE MAP) ── */}
          <div className="flex-1 w-full h-full relative">
            <div ref={mapRef} className="w-full h-full" />

            {/* Bottom-Left Overlay: Weather Widget */}
            <div className="absolute bottom-4 left-6 z-20 pointer-events-auto">
              <div className="px-3.5 py-2 rounded-xl bg-[#090d16]/90 border border-white/10 shadow-xl backdrop-blur-md flex items-center gap-3 text-xs font-mono">
                <span className="text-2xl">☁️</span>
                <div>
                  <div className="text-white font-bold text-sm leading-tight">28°C</div>
                  <div className="text-white/50 text-[10px] leading-tight">Haze · Mumbai</div>
                </div>
              </div>
            </div>

            {/* Bottom-Right Overlay: Coordinates & Scale */}
            <div className="absolute bottom-4 right-6 z-20 pointer-events-none text-right">
              <div className="text-sm font-bold text-white tracking-tight">Mumbai</div>
              <div className="text-[11px] font-mono text-white/50">Live Traffic</div>
              <div className="mt-1 flex items-center justify-end gap-3 text-[10px] font-mono text-white/40">
                <span>2 km ━</span>
                <span>19.0760° N  72.8777° E</span>
              </div>
            </div>
          </div>

          {/* ── ANALYTICS DRAWER OVERLAY ── */}
          <AnimatePresence>
            {showAnalyticsDrawer && (
              <motion.div
                initial={{ opacity: 0, y: 100 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 100 }}
                className="absolute bottom-2 inset-x-6 z-30 p-4 rounded-2xl bg-[#080b14]/95 border border-purple-500/40 shadow-[0_0_50px_rgba(0,0,0,0.9)] backdrop-blur-2xl"
              >
                <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🔮</span>
                    <span className="font-bold text-sm text-white">
                      AI Surge Forecast (12-Hour TFT Temporal Fusion Transformer)
                    </span>
                    <span className="px-2 py-0.5 rounded bg-purple-900/50 text-purple-300 font-mono text-[10px] border border-purple-500/30">
                      Confidence 94%
                    </span>
                  </div>
                  <button
                    onClick={() => setShowAnalyticsDrawer(false)}
                    className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs flex items-center justify-center transition-colors"
                  >
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                  <div className="md:col-span-3 h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={forecastChartData}>
                        <defs>
                          <linearGradient id="surgeGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="hour" tick={{ fill: '#ffffff60', fontSize: 10 }} stroke="#ffffff20" />
                        <YAxis tick={{ fill: '#ffffff60', fontSize: 10 }} stroke="#ffffff20" unit="%" />
                        <Tooltip
                          contentStyle={{ background: '#090d18', border: '1px solid #ffffff20', borderRadius: '8px', fontSize: '11px' }}
                        />
                        <Area type="monotone" dataKey="load" name="Predicted Load %" stroke="#8B5CF6" strokeWidth={2} fill="url(#surgeGrad)" />
                        <Area type="monotone" dataKey="confidence" name="Confidence %" stroke="#00F5FF" strokeWidth={1} strokeDasharray="3 3" fill="none" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="space-y-2 font-mono text-xs">
                    <div className="p-2 rounded-lg bg-white/[0.03] border border-white/10">
                      <div className="text-white/40 text-[10px]">Peak Surge Window</div>
                      <div className="text-red-400 font-bold text-sm">22:00 – 23:30 IST</div>
                    </div>
                    <div className="p-2 rounded-lg bg-white/[0.03] border border-white/10">
                      <div className="text-white/40 text-[10px]">High-Volume Corridors</div>
                      <div className="text-cyan-300 font-bold text-sm">Western Express Highway</div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* ── BOTTOM DOCK: TELEMETRY BAR ── */}
      <footer className="h-24 border-t border-white/[0.08] bg-[#07090e]/95 backdrop-blur-md px-6 py-2.5 z-40 shrink-0">
        <div className="h-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-center">
          {/* Card 1: Fleet Status */}
          <div className="h-full px-4 py-2 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-cyan-950/40 border border-cyan-500/30 flex items-center justify-center text-cyan-400 text-xl shrink-0">
              🚑
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                Fleet Status
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-white tracking-tight">18</span>
                <span className="text-[10px] font-mono text-white/50">Total Active</span>
              </div>
              <div className="flex items-center gap-2.5 text-[10px] font-mono mt-0.5">
                <span className="text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <strong>7</strong> Available
                </span>
                <span className="text-cyan-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  <strong>11</strong> In-Route
                </span>
                <span className="text-white/30">● 0 Diverted</span>
              </div>
            </div>
          </div>

          {/* Card 2: Hospital Bed Utilization */}
          <div className="h-full px-4 py-2 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-purple-950/40 border border-purple-500/30 flex items-center justify-center text-purple-400 text-xl shrink-0">
              🏥
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                Hospital Bed Utilization
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-extrabold text-white tracking-tight">78%</span>
                <span className="text-[10px] font-mono text-white/50">243 / 312 ER Beds</span>
              </div>
              <div className="mt-1 h-2 w-full bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 via-purple-500 to-[#FF2D4A] rounded-full"
                  style={{ width: '78%' }}
                />
              </div>
            </div>
          </div>

          {/* Card 3: Average Dispatch Delay */}
          <div className="h-full px-4 py-2 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-blue-950/40 border border-blue-500/30 flex items-center justify-center text-blue-400 text-xl shrink-0">
              ⏱
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                Average Dispatch Delay
              </div>
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold text-white tracking-tight">48s</span>
                  <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-0.5">
                    <span>↓ 32%</span>
                    <span className="text-white/40">vs. last week</span>
                  </span>
                </div>
                <svg className="w-14 h-5 text-cyan-400" viewBox="0 0 60 20" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M0 16 L12 14 L24 17 L36 9 L48 12 L60 4" />
                </svg>
              </div>
            </div>
          </div>

          {/* Card 4: Active Incidents */}
          <div className="h-full px-4 py-2 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-red-950/40 border border-red-500/30 flex items-center justify-center text-red-400 text-xl shrink-0">
              ⚠️
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                Active Incidents
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-white tracking-tight">12</span>
                <span className="text-[10px] font-mono text-white/50">Citywide SOS</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono mt-0.5">
                <span className="text-red-400 font-semibold">● 2 ESI-1</span>
                <span className="text-orange-400 font-semibold">● 3 ESI-2</span>
                <span className="text-blue-400 font-semibold">● 4 ESI-3</span>
                <span className="text-emerald-400 font-semibold">● 3 ESI-4+</span>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
