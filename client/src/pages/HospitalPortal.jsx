import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { getSocket } from '../lib/socket'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { PREFETCHED_TRAFFIC_ROUTES, fetchTrafficRoute } from '../lib/routing'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

export default function HospitalPortal() {
  const { user, logout } = useAuthStore()

  // Live Clock
  const [currentTime, setCurrentTime] = useState('20:28:17')
  const [currentDate, setCurrentDate] = useState('Thu, 19 Sep 2026')

  // Top Hospital Stats
  const [icuAvailable, setIcuAvailable] = useState(3)
  const [erAvailable, setErAvailable] = useState(8)
  const [intakeStatus, setIntakeStatus] = useState('NORMAL') // 'NORMAL' | 'DIVERT'
  const [selectedNav, setSelectedNav] = useState('overview')
  const [bedFilter, setBedFilter] = useState('all') // 'all' | 'occupied' | 'available' | 'cleaning'

  // Map & Telemetry States
  const [isMapFullscreen, setIsMapFullscreen] = useState(false)
  const [trafficVisible, setTrafficVisible] = useState(true)
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)

  // Pre-Arrival Preparation Checklist
  const [checklist, setChecklist] = useState([
    { id: 1, label: 'Blood Bank Notified (O-Neg)', time: '20:24', done: true },
    { id: 2, label: 'CT Scanner Cleared', time: '20:25', done: true },
    { id: 3, label: 'Trauma Surgery Attending Present', time: 'Pending', done: false, canNotify: true },
    { id: 4, label: 'OR Ready (If Required)', time: 'Pending', done: false, canNotify: true },
    { id: 5, label: 'Crossmatch Samples Prepared', time: '20:26', done: true },
    { id: 6, label: 'ICU Bed Reserved', time: 'Pending', done: false, canReserve: true },
  ])

  // 20 ER Bays Grid (Exact match to Prompt 4 mockup)
  const [bays, setBays] = useState([
    { id: 1, name: 'Bay 01', status: 'incoming', unit: 'EMS-102', eta: '4 min', complaint: 'Penetrating Trauma', esi: 1, doctor: 'Trauma Team' },
    { id: 2, name: 'Bay 02', status: 'occupied', complaint: 'Head Injury', doctor: 'Dr. Shah', time: '40m', esi: 2 },
    { id: 3, name: 'Bay 03', status: 'available', complaint: '—', doctor: '—', time: '—' },
    { id: 4, name: 'Bay 04', status: 'occupied', complaint: 'Resp. Distress', doctor: 'Dr. Kapoor', time: '42m', esi: 3 },
    { id: 5, name: 'Bay 05', status: 'cleaning', complaint: 'ETA 15m', doctor: 'Staff', time: '15m' },
    { id: 6, name: 'Bay 06', status: 'occupied', complaint: 'Abdominal Pain', doctor: 'Dr. Iyer', time: '1h 5m', esi: 2 },
    { id: 7, name: 'Bay 07', status: 'available', complaint: '—', doctor: '—', time: '—' },
    { id: 8, name: 'Bay 08', status: 'occupied', complaint: 'Polytrauma', doctor: 'Dr. Mehta', time: '28m', esi: 1 },
    { id: 9, name: 'Bay 09', status: 'available', complaint: '—', doctor: '—', time: '—' },
    { id: 10, name: 'Bay 10', status: 'occupied', complaint: 'Fracture', doctor: 'Dr. Khan', time: '2h 10m', esi: 3 },
    { id: 11, name: 'Bay 11', status: 'available', complaint: '—', doctor: '—', time: '—' },
    { id: 12, name: 'Bay 12', status: 'occupied', complaint: 'Asthma', doctor: 'Dr. Patel', time: '1h 48m', esi: 4 },
    { id: 13, name: 'Bay 13', status: 'cleaning', complaint: 'ETA 10m', doctor: 'Staff', time: '10m' },
    { id: 14, name: 'Bay 14', status: 'available', complaint: '—', doctor: '—', time: '—' },
    { id: 15, name: 'Bay 15', status: 'occupied', complaint: 'Stroke (R/O)', doctor: 'Dr. Desai', time: '55m', esi: 2 },
    { id: 16, name: 'Bay 16', status: 'available', complaint: '—', doctor: '—', time: '—' },
    { id: 17, name: 'Bay 17', status: 'occupied', complaint: 'Chest Pain', doctor: 'Dr. Nair', time: '1h 20m', esi: 3 },
    { id: 18, name: 'Bay 18', status: 'available', complaint: '—', doctor: '—', time: '—' },
    { id: 19, name: 'Bay 19', status: 'occupied', complaint: 'Minor Injury', doctor: 'Dr. Limaye', time: '3h 15m', esi: 5 },
    { id: 20, name: 'Bay 20', status: 'available', complaint: '—', doctor: '—', time: '—' },
  ])

  // Digital Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setCurrentTime(now.toLocaleTimeString('en-IN', { hour12: false }))
      setCurrentDate('Thu, 19 Sep 2026')
    }
    updateTime()
    const timer = setInterval(updateTime, 1000)
    return () => clearInterval(timer)
  }, [])

  // Handle ESC key to exit map fullscreen
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isMapFullscreen) {
        setIsMapFullscreen(false)
        setTimeout(() => mapInstanceRef.current?.resize(), 120)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isMapFullscreen])

  // Helper: Toggle Fullscreen with auto-resize
  const toggleFullscreen = () => {
    setIsMapFullscreen((prev) => {
      const next = !prev
      setTimeout(() => mapInstanceRef.current?.resize(), 120)
      return next
    })
  }

  // Helper: Toggle Live Traffic Layer
  const toggleTraffic = () => {
    if (!mapInstanceRef.current) return
    const map = mapInstanceRef.current
    const next = !trafficVisible
    setTrafficVisible(next)
    if (map.getLayer('traffic-roads')) {
      map.setLayoutProperty('traffic-roads', 'visibility', next ? 'visible' : 'none')
    }
    toast(next ? 'Live Road Traffic: Visible' : 'Live Road Traffic: Hidden', { icon: '🚦' })
  }

  // Camera Helpers
  const focusHospital = () => {
    mapInstanceRef.current?.flyTo({
      center: [72.8428, 19.0035],
      zoom: 15,
      pitch: 58,
      bearing: -20,
      duration: 1800,
    })
  }

  const focusEms102 = () => {
    mapInstanceRef.current?.flyTo({
      center: [72.8486, 19.0221],
      zoom: 15.2,
      pitch: 60,
      bearing: 15,
      duration: 1800,
    })
  }

  const resetTacticalView = () => {
    mapInstanceRef.current?.flyTo({
      center: [72.845, 19.022],
      zoom: 12.6,
      pitch: 48,
      bearing: -12,
      duration: 1500,
    })
  }

  // Initialize Mapbox 3D Radar Map with REAL ROAD TRAFFIC ROUTES around KEM Hospital (Parel, Mumbai)
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    // Real road geometries from Mapbox driving-traffic
    const ems102RoadCoords = PREFETCHED_TRAFFIC_ROUTES.find((r) => r.id === 'ems102')?.coordinates || []
    const ems104RoadCoords = PREFETCHED_TRAFFIC_ROUTES.find((r) => r.id === 'ems104')?.coordinates || []
    const ems087RoadCoords = PREFETCHED_TRAFFIC_ROUTES.find((r) => r.id === 'ems087')?.coordinates || []

    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [72.845, 19.022],
      zoom: 12.6,
      pitch: 48,
      bearing: -12,
      antialias: true,
      attributionControl: false,
    })

    map.addControl(new mapboxgl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right')

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
          'fill-extrusion-opacity': 0.88,
        },
      })

      // 2. Real-Time Road Traffic Layer (Mapbox Traffic Vector Tiles)
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
              'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 14, 2.5, 17, 5],
              'line-opacity': 0.65,
            },
          })
        }
      } catch (e) {
        console.warn('Traffic layer init warning:', e)
      }

      // 3. Inbound Ambulance 1: EMS-102 (Dadar to KEM - Real Road Dr. Ambedkar Marg)
      map.addSource('route-ems102', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: ems102RoadCoords,
          },
        },
      })

      // Glow backing
      map.addLayer({
        id: 'route-ems102-glow',
        type: 'line',
        source: 'route-ems102',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#FF2D4A',
          'line-width': 8,
          'line-opacity': 0.45,
          'line-blur': 3,
        },
      })

      // Sharp Core
      map.addLayer({
        id: 'route-ems102-core',
        type: 'line',
        source: 'route-ems102',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#FF2D4A',
          'line-width': 3.5,
          'line-opacity': 0.95,
        },
      })

      // 4. Inbound Ambulance 2: EMS-104 (Bandra to KEM - Real Road via Lady Jamshedji)
      map.addSource('route-ems104', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: ems104RoadCoords,
          },
        },
      })

      map.addLayer({
        id: 'route-ems104-line',
        type: 'line',
        source: 'route-ems104',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#00F5FF',
          'line-width': 2.8,
          'line-opacity': 0.85,
          'line-dasharray': [3, 2],
        },
      })

      // 5. Inbound Ambulance 3: EMS-087 (Sion to KEM - Real Road via Dadar TT Flyover)
      map.addSource('route-ems087', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: ems087RoadCoords,
          },
        },
      })

      map.addLayer({
        id: 'route-ems087-line',
        type: 'line',
        source: 'route-ems087',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#3B82F6',
          'line-width': 2.5,
          'line-opacity': 0.8,
          'line-dasharray': [2, 2],
        },
      })

      // ── Markers on Exact Road Coordinates ──
      // KEM Hospital Trauma Center Pin
      const kemEl = document.createElement('div')
      kemEl.innerHTML = `
        <div class="relative cursor-pointer flex flex-col items-center group">
          <span class="absolute -inset-2.5 rounded-full bg-red-500/30 animate-ping"></span>
          <div class="w-8 h-8 rounded-full bg-red-600/95 border-2 border-white shadow-[0_0_25px_rgba(255,45,74,0.9)] text-white font-mono font-black text-xs flex items-center justify-center">
            H
          </div>
          <div class="mt-1 px-2 py-0.5 rounded bg-black/85 border border-white/20 text-[10px] font-mono text-white font-bold whitespace-nowrap shadow-lg">
            KEM Hospital
          </div>
        </div>
      `
      new mapboxgl.Marker({ element: kemEl, anchor: 'center' })
        .setLngLat([72.8428, 19.0035])
        .addTo(map)

      // EMS-102 (Current Road Location on Dr. Ambedkar Marg)
      const ems102Pos = ems102RoadCoords[0] || [72.8486, 19.0221]
      const ems102El = document.createElement('div')
      ems102El.innerHTML = `
        <div class="relative cursor-pointer hover:scale-105 transition-transform flex flex-col items-center">
          <span class="absolute -inset-3 rounded-full bg-red-500/50 animate-ping"></span>
          <div class="w-7 h-7 rounded-full bg-red-600 border-2 border-white text-white flex items-center justify-center text-xs shadow-[0_0_20px_#ff2d4a]">
            🚑
          </div>
          <div class="mt-1 px-1.5 py-0.5 rounded bg-red-950/90 border border-red-500 text-[9px] font-mono font-bold text-white whitespace-nowrap shadow">
            EMS-102
          </div>
        </div>
      `
      new mapboxgl.Marker({ element: ems102El, anchor: 'center' })
        .setLngLat(ems102Pos)
        .addTo(map)

      // EMS-104 (Bandra Road Position)
      const ems104Pos = ems104RoadCoords[0] || [72.8400, 19.0550]
      const ems104El = document.createElement('div')
      ems104El.innerHTML = `
        <div class="px-2 py-1 rounded-lg bg-[#061424]/90 border border-cyan-400 text-[9px] font-mono shadow-[0_0_15px_rgba(0,245,255,0.5)] flex items-center gap-1.5 cursor-pointer">
          <span class="text-xs">🚑</span>
          <div>
            <div class="text-cyan-300 font-bold leading-tight">EMS-104</div>
            <div class="text-white/60 text-[8px]">8 min</div>
          </div>
        </div>
      `
      new mapboxgl.Marker({ element: ems104El, anchor: 'center' })
        .setLngLat(ems104Pos)
        .addTo(map)

      // EMS-087 (Sion Road Position)
      const ems087Pos = ems087RoadCoords[0] || [72.8600, 19.0300]
      const ems087El = document.createElement('div')
      ems087El.innerHTML = `
        <div class="px-2 py-1 rounded-lg bg-[#061424]/90 border border-blue-400 text-[9px] font-mono shadow-[0_0_15px_rgba(59,130,246,0.5)] flex items-center gap-1.5 cursor-pointer">
          <span class="text-xs">🚑</span>
          <div>
            <div class="text-blue-300 font-bold leading-tight">EMS-087</div>
            <div class="text-white/60 text-[8px]">12 min</div>
          </div>
        </div>
      `
      new mapboxgl.Marker({ element: ems087El, anchor: 'center' })
        .setLngLat(ems087Pos)
        .addTo(map)
    })

    mapInstanceRef.current = map

    return () => {
      map.remove()
      mapInstanceRef.current = null
    }
  }, [])

  // Filtered ER Bays
  const filteredBays = bays.filter((b) => {
    if (bedFilter === 'all') return true
    if (bedFilter === 'occupied') return b.status === 'occupied' || b.status === 'incoming'
    if (bedFilter === 'available') return b.status === 'available'
    if (bedFilter === 'cleaning') return b.status === 'cleaning'
    return true
  })

  // Action: Toggle Checklist Item
  const toggleChecklist = (id) => {
    setChecklist((prev) =>
      prev.map((c) => (c.id === id ? { ...c, done: !c.done, time: !c.done ? currentTime : 'Pending' } : c))
    )
  }

  // Action: Reserve ICU Bed
  const handleReserveIcu = () => {
    if (icuAvailable > 0) {
      setIcuAvailable((prev) => prev - 1)
      setChecklist((prev) => prev.map((c) => (c.id === 6 ? { ...c, done: true, time: currentTime } : c)))
      toast.success('ICU Bed Reserved for Unit EMS-102 in Surgical Trauma Ward!')
    } else {
      toast.error('No ICU beds currently available')
    }
  }

  // Action: Page Trauma Team
  const handlePageTrauma = () => {
    toast.success('📢 Code Red Trauma Team Paged (Surgical, Anesthesia, Nursing dispatched to Bay 01)')
    setChecklist((prev) => prev.map((c) => (c.id === 3 ? { ...c, done: true, time: currentTime } : c)))
  }

  // Action: Notify Radiology
  const handleNotifyRadiology = () => {
    toast.success('📡 Radiology & CT Scan Suite cleared for immediate priority intake')
    setChecklist((prev) => prev.map((c) => (c.id === 2 ? { ...c, done: true, time: currentTime } : c)))
  }

  return (
    <div className="min-h-screen bg-[#06080e] text-white flex flex-col font-sans select-none overflow-x-hidden">
      {/* ── TOP APP HEADER ── */}
      <header className="h-16 border-b border-white/[0.08] bg-[#07090e]/95 backdrop-blur-md px-5 flex items-center justify-between z-40 shrink-0">
        {/* Left: Brand + Hospital Identity Card */}
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
                Hospital ED Command
              </div>
            </div>
          </div>

          {/* KEM Hospital Badge with Image */}
          <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.02]">
            <img
              src="/hospital-kem.jpg"
              alt="KEM Hospital Thumbnail"
              className="w-9 h-9 rounded-lg object-cover border border-white/10"
            />
            <div>
              <div className="text-sm font-extrabold text-white leading-tight">
                KEM Hospital
              </div>
              <div className="text-[10px] text-white/50 leading-tight">
                Level 1 Trauma Center · Parel, Mumbai
              </div>
              <div className="text-[8px] font-mono tracking-[0.2em] text-cyan-400/80 font-bold uppercase mt-0.5">
                CARE · TRAUMA · RESEARCH · RESILIENCE
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live Clock & Slogan */}
        <div className="flex items-center gap-5">
          <div className="text-right font-mono hidden md:block">
            <div className="text-xs text-white/50">{currentDate}</div>
            <div className="text-base font-extrabold text-white tracking-tight flex items-center justify-end gap-2">
              <span>{currentTime}</span>
              <span className="flex items-center gap-1 text-emerald-400 text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_#10b981]" />
                Live
              </span>
            </div>
          </div>

          <div className="hidden xl:block text-right border-l border-white/10 pl-4">
            <div className="text-xs text-white/80 font-semibold">Every Patient.</div>
            <div className="text-xs text-red-400 font-bold">A Fighting Chance.</div>
          </div>

          <button
            onClick={logout}
            title="Logout"
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center text-sm transition-all ml-2"
          >
            ⏻
          </button>
        </div>
      </header>

      {/* ── TOP STATS STRIP (5 KPI Cards matching Prompt 4) ── */}
      <div className="px-5 py-3 border-b border-white/[0.06] bg-[#070a12] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 shrink-0">
        {/* Stat 1: ICU Beds */}
        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-950/40 border border-red-500/30 flex items-center justify-center text-red-400 text-lg shrink-0">
            🏥
          </div>
          <div>
            <div className="text-[10px] font-mono text-white/40 uppercase font-semibold">ICU Beds</div>
            <div className="text-xl font-extrabold text-white tracking-tight font-mono">
              {icuAvailable} <span className="text-xs font-normal text-white/40">/ 18</span>
            </div>
            <div className="text-[10px] font-mono text-emerald-400">Available</div>
          </div>
        </div>

        {/* Stat 2: ER Beds */}
        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-950/40 border border-red-500/30 flex items-center justify-center text-red-400 text-lg shrink-0">
            🛏️
          </div>
          <div>
            <div className="text-[10px] font-mono text-white/40 uppercase font-semibold">ER Beds</div>
            <div className="text-xl font-extrabold text-white tracking-tight font-mono">
              {erAvailable} <span className="text-xs font-normal text-white/40">/ 30</span>
            </div>
            <div className="text-[10px] font-mono text-emerald-400">Available</div>
          </div>
        </div>

        {/* Stat 3: OR Suites */}
        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-lg shrink-0">
            ⚕️
          </div>
          <div>
            <div className="text-[10px] font-mono text-white/40 uppercase font-semibold">OR Suites</div>
            <div className="text-xl font-extrabold text-white tracking-tight font-mono">
              1 <span className="text-xs font-normal text-white/40">/ 6</span>
            </div>
            <div className="text-[10px] font-mono text-emerald-400">Free</div>
          </div>
        </div>

        {/* Stat 4: Trauma Teams */}
        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-950/40 border border-blue-500/30 flex items-center justify-center text-blue-400 text-lg shrink-0">
            👥
          </div>
          <div>
            <div className="text-[10px] font-mono text-white/40 uppercase font-semibold">Trauma Teams</div>
            <div className="text-xl font-extrabold text-white tracking-tight font-mono">
              2 <span className="text-xs font-normal text-white/40">/ 4</span>
            </div>
            <div className="text-[10px] font-mono text-blue-300">On-Duty</div>
          </div>
        </div>

        {/* Stat 5: Intake Status Toggle */}
        <div className="col-span-2 sm:col-span-1 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-mono text-white/40 uppercase font-semibold">Intake Status</div>
            <div className={`text-sm font-extrabold font-mono mt-0.5 ${intakeStatus === 'NORMAL' ? 'text-emerald-400' : 'text-red-400'}`}>
              {intakeStatus === 'NORMAL' ? 'NORMAL' : 'DIVERT'}
            </div>
            <div className="text-[9px] text-white/50 leading-tight">
              {intakeStatus === 'NORMAL' ? 'Accepting Critical Dispatches' : 'ER At Full Capacity'}
            </div>
          </div>

          <button
            onClick={() => {
              const next = intakeStatus === 'NORMAL' ? 'DIVERT' : 'NORMAL'
              setIntakeStatus(next)
              toast(next === 'NORMAL' ? 'Intake restored to NORMAL' : 'Hospital set to DIVERT', { icon: '🏥' })
            }}
            className={`w-11 h-6 rounded-full p-1 transition-colors flex items-center ${
              intakeStatus === 'NORMAL' ? 'bg-emerald-500 justify-end' : 'bg-red-600 justify-start'
            }`}
          >
            <div className="w-4 h-4 rounded-full bg-white shadow-md" />
          </button>
        </div>
      </div>

      {/* ── INBOUND CRITICAL AMBULANCE ALERT BANNER ── */}
      <div className="mx-5 mt-3 p-3 rounded-2xl bg-gradient-to-r from-[#5a0c16] via-[#7e1220] to-[#5a0c16] border border-red-500/60 shadow-[0_0_25px_rgba(255,45,74,0.35)] flex flex-col md:flex-row items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-red-600/40 border border-red-400 flex items-center justify-center text-xl shrink-0 animate-pulse">
            🚑
          </div>
          <div className="text-left">
            <div className="text-sm sm:text-base font-extrabold text-white tracking-tight flex items-center gap-2">
              <span>INBOUND CRITICAL AMBULANCE — UNIT EMS-102 — ETA 4 MIN</span>
              <span className="text-red-300 font-bold">&gt;&gt;</span>
            </div>
            <div className="text-xs text-white/80 font-mono mt-0.5">
              42yo Male | <strong className="text-red-300">ESI Level 1</strong> | Penetrating Chest Trauma | GCS 11 | <strong className="text-red-200">Hypotensive (BP 78/50)</strong>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-end">
          <div className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/20 text-xs font-mono text-white text-center">
            <div className="text-cyan-300 font-bold">Bay 01</div>
            <div className="text-[9px] text-white/50">Pre-Assigned</div>
          </div>

          <button
            onClick={() => toast('Displaying full trauma chart for EMS-102', { icon: '📋' })}
            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg transition-all flex items-center gap-1.5 whitespace-nowrap"
          >
            <span>View Patient Details</span>
            <span>→</span>
          </button>
        </div>
      </div>

      {/* ── WORKSPACE: LEFT NAV + CENTER MAP + RIGHT ER BAYS ── */}
      <div className="flex-1 flex overflow-hidden p-5 gap-4">
        {/* ── LEFT SIDEBAR NAVIGATION ── */}
        <aside className="w-48 hidden lg:flex flex-col justify-between border-r border-white/[0.06] pr-4 shrink-0">
          <div className="space-y-1">
            {[
              { id: 'overview', label: 'Overview', icon: '🏠', active: true },
              { id: 'inbound', label: 'Inbound Units', icon: '🚑', badge: '3' },
              { id: 'patients', label: 'ER Patients', icon: '👥', badge: '12' },
              { id: 'beds', label: 'Bed Management', icon: '🛏️' },
              { id: 'surgical', label: 'Surgical Prep', icon: '⚕️' },
              { id: 'diagnostics', label: 'Diagnostics', icon: '🔬' },
              { id: 'pharmacy', label: 'Pharmacy', icon: '💊' },
              { id: 'staff', label: 'Staff Roster', icon: '👨‍⚕️' },
              { id: 'analytics', label: 'Hospital Analytics', icon: '📊' },
              { id: 'settings', label: 'Settings', icon: '⚙' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedNav(item.id)}
                className={`w-full px-3 py-2 rounded-xl text-left text-xs font-mono transition-all flex items-center justify-between ${
                  selectedNav === item.id
                    ? 'bg-blue-600/20 text-cyan-300 border border-cyan-500/40 font-bold'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className="px-1.5 py-0.2 rounded-full bg-red-600/80 text-white text-[9px] font-bold">
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="pt-4 border-t border-white/[0.06] text-left">
            <div className="text-xs font-bold text-white">KEM Hospital</div>
            <div className="text-[10px] text-white/40 italic">"For a Healthier Mumbai"</div>
          </div>
        </aside>

        {/* ── CENTER: INBOUND RADAR MAP & ER BED MATRIX ── */}
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            {/* ── INBOUND RADAR 3D MAPBOX MAP (Supports Full Screen Mode) ── */}
            <div
              className={
                isMapFullscreen
                  ? 'fixed inset-0 z-50 bg-[#06080e]/98 backdrop-blur-2xl p-4 flex flex-col'
                  : 'xl:col-span-5 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl overflow-hidden flex flex-col h-[380px] relative'
              }
            >
              {/* Map Header / Fullscreen Controls */}
              <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between bg-[#07090e]/90 z-10 shrink-0">
                <div className="flex items-center gap-2 text-xs font-mono font-bold text-white">
                  <span>Inbound Ambulances</span>
                  <span className="px-1.5 py-0.5 rounded bg-white/10 text-white/70 text-[10px]">3</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-1" />
                  <span className="text-emerald-400 text-[10px]">Live</span>
                  <span className="hidden sm:inline text-[9px] text-white/40 font-normal ml-1">
                    · Road Snapped (Traffic Aware)
                  </span>
                </div>

                {isMapFullscreen ? (
                  <div className="flex items-center gap-2">
                    {/* Traffic Toggle */}
                    <button
                      onClick={toggleTraffic}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all border ${
                        trafficVisible
                          ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/40'
                          : 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10'
                      }`}
                    >
                      🚦 Traffic: {trafficVisible ? 'ON' : 'OFF'}
                    </button>

                    {/* Quick Views */}
                    <button
                      onClick={focusHospital}
                      className="px-2.5 py-1 rounded-lg bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-red-300 text-[10px] font-mono transition-all hidden md:block"
                    >
                      🏥 KEM Hospital
                    </button>
                    <button
                      onClick={focusEms102}
                      className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-cyan-500/40 text-cyan-300 text-[10px] font-mono transition-all hidden md:block"
                    >
                      🚑 Unit EMS-102
                    </button>
                    <button
                      onClick={resetTacticalView}
                      className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-[10px] font-mono transition-all hidden sm:block"
                    >
                      🗺️ Tactical View
                    </button>

                    {/* Exit Fullscreen Button */}
                    <button
                      onClick={toggleFullscreen}
                      className="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-mono font-bold transition-all shadow-lg flex items-center gap-1 ml-2"
                    >
                      <span>Exit Full Screen</span>
                      <span className="text-[10px] opacity-70">(Esc) ✕</span>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={toggleFullscreen}
                    className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 font-bold bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-500/30"
                  >
                    <span>View Full City Map</span>
                    <span>⤢</span>
                  </button>
                )}
              </div>

              {/* Real Live Mapbox GL Canvas */}
              <div className="flex-1 w-full h-full relative min-h-[330px] bg-[#060911]">
                <div ref={mapRef} className="w-full h-full bg-[#060911]" style={{ minHeight: '330px' }} />

                {/* Overlay EMS-102 Inbound Card directly on map (Matches Prompt 4 Mockup) */}
                <div className="absolute top-[46%] left-[60%] -translate-y-1/2 -translate-x-1/2 z-20 pointer-events-auto bg-[#090d16]/95 border border-red-500/80 rounded-xl p-2.5 shadow-[0_0_25px_rgba(255,45,74,0.4)] backdrop-blur-md min-w-[170px] text-left">
                  <div className="flex items-center justify-between gap-2 pb-1 border-b border-white/10">
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-red-600/80 text-white flex items-center justify-center text-[10px]">🚑</span>
                      <span className="font-mono font-bold text-xs text-white">EMS-102</span>
                    </div>
                    <button onClick={() => toast('Ambulance details minimized', { icon: 'ℹ️' })} className="text-white/40 hover:text-white text-[11px]">✕</button>
                  </div>
                  <div className="mt-1.5">
                    <div className="text-emerald-400 font-mono text-[10px] font-bold">4 min (1.8 km)</div>
                    <div className="text-white text-[10px] font-medium truncate mt-0.5">Penetrating Chest Trauma</div>
                    <div className="mt-1 flex items-center gap-1">
                      <span className="px-1.5 py-0.2 rounded bg-red-600 text-white font-mono text-[8px] font-bold">ESI 1</span>
                    </div>
                  </div>
                </div>

                <div className="absolute bottom-2.5 right-3 z-10 text-[9px] font-mono text-emerald-400 bg-black/60 px-2 py-0.5 rounded border border-emerald-500/30">
                  Traffic: Live
                </div>
              </div>
            </div>

            {/* ── ER BED STATUS 20-BAY GRID (xl:col-span-7) ── */}
            <div className="xl:col-span-7 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl p-4 flex flex-col">
              {/* Header & Filter Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-white">ER Bed Status</span>
                  <span className="text-xs font-mono text-white/50">(20)</span>
                </div>

                <div className="flex items-center gap-1.5 text-[10px] font-mono">
                  {['all', 'occupied', 'available', 'cleaning'].map((f) => (
                    <button
                      key={f}
                      onClick={() => setBedFilter(f)}
                      className={`px-2.5 py-1 rounded-lg capitalize transition-all ${
                        bedFilter === f
                          ? 'bg-blue-600/30 text-cyan-300 border border-cyan-500/50 font-bold'
                          : 'text-white/50 hover:bg-white/5'
                      }`}
                    >
                      {f === 'all' && 'All (20)'}
                      {f === 'occupied' && 'Occupied (12)'}
                      {f === 'available' && 'Available (8)'}
                      {f === 'cleaning' && 'Cleaning (2)'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 20 Bed Cards Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 mt-3">
                {filteredBays.map((bay) => {
                  const isIncoming = bay.status === 'incoming'
                  const isOccupied = bay.status === 'occupied'
                  const isAvailable = bay.status === 'available'
                  const isCleaning = bay.status === 'cleaning'

                  return (
                    <div
                      key={bay.id}
                      onClick={() => {
                        toast(`Selected ${bay.name}: ${bay.complaint || 'Ready'}`, { icon: '🛏️' })
                      }}
                      className={`p-2 rounded-xl text-left cursor-pointer transition-all border relative overflow-hidden ${
                        isIncoming
                          ? 'bg-red-950/40 border-red-500 shadow-[0_0_15px_rgba(255,45,74,0.4)] animate-pulse'
                          : isOccupied
                          ? 'bg-white/[0.02] border-white/[0.07] hover:bg-white/[0.05]'
                          : isAvailable
                          ? 'bg-emerald-950/20 border-emerald-500/30 hover:bg-emerald-950/40'
                          : 'bg-yellow-950/20 border-yellow-500/30 hover:bg-yellow-950/40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold text-white">{bay.name}</span>
                        {bay.esi && (
                          <span className={`text-[8px] font-mono px-1 rounded font-bold ${
                            bay.esi === 1 ? 'bg-red-600/60 text-white' : 'bg-orange-600/60 text-white'
                          }`}>
                            ESI {bay.esi}
                          </span>
                        )}
                      </div>

                      <div className="mt-1">
                        {isIncoming && (
                          <div>
                            <div className="text-[9px] font-mono text-red-400 font-bold flex items-center gap-1">
                              <span>🔴 Incoming</span>
                            </div>
                            <div className="text-[10px] font-mono text-white font-bold">{bay.unit}</div>
                            <div className="text-[9px] text-red-300 font-mono">ETA {bay.eta}</div>
                          </div>
                        )}

                        {isOccupied && (
                          <div>
                            <div className="text-[9px] font-mono text-orange-400 font-semibold flex items-center gap-1">
                              <span>● Occupied</span>
                            </div>
                            <div className="text-[10px] font-medium text-white truncate">{bay.complaint}</div>
                            <div className="text-[9px] text-white/40 font-mono truncate">{bay.doctor} · {bay.time}</div>
                          </div>
                        )}

                        {isAvailable && (
                          <div>
                            <div className="text-[9px] font-mono text-emerald-400 font-bold">● Available</div>
                            <div className="text-[10px] text-white/30 font-mono mt-1">—</div>
                          </div>
                        )}

                        {isCleaning && (
                          <div>
                            <div className="text-[9px] font-mono text-yellow-400 font-bold">● Cleaning</div>
                            <div className="text-[9px] text-yellow-200/60 font-mono mt-1">{bay.complaint}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ── BOTTOM ROW (3 CARDS: PATIENT DETAILS / CHECKLIST / ACTIONS) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Card 1: Inbound Patient Details — EMS-102 (lg:col-span-4) */}
            <div className="lg:col-span-4 p-4 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl text-left flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                  <div className="text-xs font-bold text-white">Inbound Patient Details — EMS-102</div>
                  <div className="flex items-center gap-1">
                    <span className="px-1.5 py-0.5 rounded bg-red-600 text-white font-mono text-[9px] font-bold">ESI 1</span>
                    <span className="text-[10px] font-mono text-red-400 font-bold">ETA 4 min</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-3">
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-lg shrink-0">
                    👤
                  </div>
                  <div>
                    <div className="text-xs text-white/50 font-mono">42 years | Male</div>
                    <div className="text-sm font-extrabold text-white">Penetrating Chest Trauma</div>
                  </div>
                </div>

                <div className="mt-2.5 p-2 rounded-lg bg-black/40 border border-white/[0.06] font-mono text-[11px] text-white/80">
                  <span>GCS <strong className="text-white">11</strong></span> · 
                  <span> BP <strong className="text-red-400">78/50</strong></span> · 
                  <span> HR <strong className="text-red-400">132</strong></span> · 
                  <span> SpO₂ <strong className="text-red-400">88%</strong></span>
                </div>

                <div className="text-[10px] text-white/50 mt-2">
                  Mechanism: Stab wound, suspected hemothorax
                </div>
              </div>

              <div className="flex items-center gap-2 pt-3 border-t border-white/[0.06] mt-3">
                <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 font-mono text-[9px] font-bold">
                  ✓ Pre-Alert Sent
                </span>
                <span className="px-2 py-0.5 rounded bg-red-950/60 border border-red-500/40 text-red-300 font-mono text-[9px] font-bold">
                  ● Trauma Team Notified
                </span>
              </div>
            </div>

            {/* Card 2: Pre-Arrival Preparation Checklist (lg:col-span-5) */}
            <div className="lg:col-span-5 p-4 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl text-left">
              <div className="text-xs font-bold text-white pb-2 border-b border-white/[0.06] mb-2">
                Pre-Arrival Preparation Checklist
              </div>

              <div className="space-y-1.5 font-mono text-[11px]">
                {checklist.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => toggleChecklist(item.id)}
                    className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] ${
                        item.done ? 'bg-emerald-500 text-black font-bold' : 'border border-white/30 text-white/40'
                      }`}>
                        {item.done ? '✓' : ''}
                      </span>
                      <span className={item.done ? 'text-white font-medium' : 'text-white/60'}>
                        {item.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] ${item.done ? 'text-emerald-400' : 'text-white/40'}`}>
                        {item.time}
                      </span>
                      {item.canNotify && !item.done && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleChecklist(item.id)
                            toast.success(`Notified: ${item.label}`)
                          }}
                          className="px-2 py-0.5 rounded bg-blue-600/30 border border-blue-400/50 text-blue-300 text-[9px] hover:bg-blue-600/50 transition-all"
                        >
                          Notify
                        </button>
                      )}
                      {item.canReserve && !item.done && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleReserveIcu()
                          }}
                          className="px-2 py-0.5 rounded bg-blue-600/30 border border-blue-400/50 text-blue-300 text-[9px] hover:bg-blue-600/50 transition-all"
                        >
                          Reserve
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Card 3: Quick Hospital ED Actions (lg:col-span-3) */}
            <div className="lg:col-span-3 p-4 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl flex flex-col justify-between gap-2">
              <div className="text-xs font-bold text-white pb-2 border-b border-white/[0.06] text-left">
                Actions
              </div>

              <button
                onClick={handleReserveIcu}
                className="w-full py-2.5 px-3 rounded-xl bg-blue-600/30 hover:bg-blue-600/50 border border-cyan-400/50 text-cyan-300 font-mono text-xs font-bold shadow-lg transition-all flex items-center justify-center gap-2"
              >
                <span>🛏️</span>
                <span>Reserve ICU Bed for EMS-102</span>
              </button>

              <button
                onClick={handlePageTrauma}
                className="w-full py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-mono text-xs transition-all flex items-center justify-center gap-2"
              >
                <span>👥</span>
                <span>Page Trauma Team</span>
              </button>

              <button
                onClick={handleNotifyRadiology}
                className="w-full py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-mono text-xs transition-all flex items-center justify-center gap-2"
              >
                <span>📡</span>
                <span>Notify Radiology</span>
              </button>

              <button
                onClick={() => toast('Complete electronic medical record retrieved', { icon: '📄' })}
                className="w-full py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white font-mono text-xs transition-all flex items-center justify-center gap-2"
              >
                <span>📄</span>
                <span>View Full Patient Profile</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
