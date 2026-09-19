import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { getSocket } from '../lib/socket'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { PREFETCHED_TRAFFIC_ROUTES } from '../lib/routing'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

export default function HospitalPortal() {
  const { user, logout } = useAuthStore()

  // Live Clock
  const [currentTime, setCurrentTime] = useState('20:28:17')
  const [currentDate, setCurrentDate] = useState('Thu, 19 Sep 2026')

  // Real Hospital Data State
  const [hospitalData, setHospitalData] = useState(null)
  const [icuAvailable, setIcuAvailable] = useState(5)
  const [erAvailable, setErAvailable] = useState(12)
  const [intakeStatus, setIntakeStatus] = useState('NORMAL') // 'NORMAL' | 'DIVERT'
  const [bedFilter, setBedFilter] = useState('all') // 'all' | 'occupied' | 'available' | 'cleaning'
  const [inboundIncident, setInboundIncident] = useState(null)

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

  // 20 ER Bays Grid
  const [bays, setBays] = useState([
    { id: 1, name: 'Bay 01', status: 'incoming', unit: 'MH-AMB-002', eta: '4 min', complaint: 'Penetrating Trauma', esi: 1, doctor: 'Trauma Team' },
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

  // Fetch real hospital and incident data from MongoDB
  useEffect(() => {
    const fetchHospitalData = async () => {
      try {
        const [hospRes, incRes] = await Promise.all([
          api.get('/hospitals/primary'),
          api.get('/incidents?limit=20'),
        ])

        if (hospRes.data?.hospital) {
          const h = hospRes.data.hospital
          setHospitalData(h)
          setIcuAvailable(h.resources?.icuBeds?.available ?? 5)
          setErAvailable(h.resources?.traumaBeds?.available ?? 8)
          setIntakeStatus(h.queueStatus?.diversionStatus ? 'DIVERT' : 'NORMAL')
        }

        if (incRes.data?.incidents?.length) {
          const incoming = incRes.data.incidents.find((i) =>
            ['DISPATCHED', 'TRIAGE_COMPLETE', 'EN_ROUTE_TO_PATIENT', 'AT_PATIENT', 'EN_ROUTE_TO_HOSPITAL'].includes(i.status)
          )
          if (incoming) {
            setInboundIncident(incoming)
            setBays((prev) =>
              prev.map((b) =>
                b.id === 1
                  ? {
                      ...b,
                      unit: incoming.assignedAmbulance?.vehicleNumber || 'MH-AMB-002',
                      complaint: incoming.triageData?.chiefComplaint || 'Acute Trauma',
                      esi: incoming.triageData?.esiLevel || 1,
                    }
                  : b
              )
            )
          }
        }
      } catch (err) {
        console.warn('Hospital fetch warning:', err.message)
      }
    }

    fetchHospitalData()
    const interval = setInterval(fetchHospitalData, 20000)
    return () => clearInterval(interval)
  }, [])

  // Socket.IO event listeners
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    socket.on('incoming_patient', (data) => {
      if (data.incident) {
        setInboundIncident(data.incident)
        toast.error(`🚨 INBOUND PATIENT ALERT: ${data.incident.triageData?.chiefComplaint || 'Critical Patient'} en route!`, { duration: 8000 })
      }
    })

    socket.on('vitals_update', (data) => {
      if (data.vitals) {
        setInboundIncident((prev) => prev ? {
          ...prev,
          triageData: { ...prev.triageData, vitals: data.vitals },
        } : prev)
      }
    })

    socket.on('hospital_resources_update', (data) => {
      if (data.hospitalId === hospitalData?._id) {
        if (data.resources?.icuBeds) setIcuAvailable(data.resources.icuBeds.available)
        if (data.resources?.traumaBeds) setErAvailable(data.resources.traumaBeds.available)
      }
    })

    return () => {
      socket.off('incoming_patient')
      socket.off('vitals_update')
      socket.off('hospital_resources_update')
    }
  }, [hospitalData?._id])

  // Toggle Diversion
  const toggleDiversion = async () => {
    const nextStatus = intakeStatus === 'NORMAL' ? 'DIVERT' : 'NORMAL'
    setIntakeStatus(nextStatus)
    if (hospitalData?._id) {
      await api.patch(`/hospitals/${hospitalData._id}/diversion`, {
        diversionStatus: nextStatus === 'DIVERT',
      }).catch(() => {})
    }
    toast(nextStatus === 'DIVERT' ? '⚠️ Emergency Intake DIVERTED' : '✅ Emergency Intake ACTIVE', {
      icon: nextStatus === 'DIVERT' ? '🚫' : '✅',
    })
  }

  // Reserve ICU Bed
  const handleReserveIcu = async () => {
    if (icuAvailable > 0) {
      const nextCount = icuAvailable - 1
      setIcuAvailable(nextCount)
      setChecklist((prev) => prev.map((c) => (c.id === 6 ? { ...c, done: true, time: currentTime } : c)))
      if (hospitalData?._id) {
        await api.patch(`/hospitals/${hospitalData._id}/resources`, {
          resources: {
            ...hospitalData.resources,
            icuBeds: { ...hospitalData.resources?.icuBeds, available: nextCount },
          },
        }).catch(() => {})
      }
      toast.success('ICU Bed Reserved in Surgical Trauma Ward!')
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

  // Toggle Checklist item
  const toggleChecklist = (id) => {
    setChecklist((prev) =>
      prev.map((c) => (c.id === id ? { ...c, done: !c.done, time: !c.done ? currentTime : 'Pending' } : c))
    )
  }

  // Initialize Mapbox 3D Radar Map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const ems102RoadCoords = PREFETCHED_TRAFFIC_ROUTES.find((r) => r.id === 'ems102')?.coordinates || []
    const ems104RoadCoords = PREFETCHED_TRAFFIC_ROUTES.find((r) => r.id === 'ems104')?.coordinates || []

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
      // 3D Buildings
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

      // Real Traffic Layer
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
              'line-width': 2.4,
              'line-opacity': 0.65,
            },
          })
        }
      } catch (e) {
        console.warn('Traffic error:', e)
      }

      // Inbound route
      map.addSource('route-ems102', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: ems102RoadCoords,
          },
        },
      })

      map.addLayer({
        id: 'route-ems102-glow',
        type: 'line',
        source: 'route-ems102',
        paint: {
          'line-color': '#FF2D4A',
          'line-width': 8,
          'line-opacity': 0.45,
          'line-blur': 3,
        },
      })

      map.addLayer({
        id: 'route-ems102-core',
        type: 'line',
        source: 'route-ems102',
        paint: {
          'line-color': '#FF2D4A',
          'line-width': 3,
          'line-opacity': 0.95,
        },
      })

      // Hospital Center Marker
      const kemEl = document.createElement('div')
      kemEl.className = 'px-2.5 py-1.5 rounded-lg bg-[#7C3AED] border-2 border-[#A855F7] text-white font-mono font-bold text-xs shadow-[0_0_20px_rgba(168,85,247,0.8)]'
      kemEl.innerHTML = `🏥 ${hospitalData?.name || 'City General Trauma Center'}`
      new mapboxgl.Marker({ element: kemEl, anchor: 'bottom' })
        .setLngLat([72.8428, 19.0025])
        .addTo(map)
    })

    mapInstanceRef.current = map

    return () => {
      map.remove()
      mapInstanceRef.current = null
    }
  }, [hospitalData?.name])

  // Filtered ER Bays
  const filteredBays = bays.filter((b) => {
    if (bedFilter === 'all') return true
    if (bedFilter === 'occupied') return b.status === 'occupied' || b.status === 'incoming'
    if (bedFilter === 'available') return b.status === 'available'
    if (bedFilter === 'cleaning') return b.status === 'cleaning'
    return true
  })

  return (
    <div className="min-h-screen bg-[#06080e] text-white flex flex-col font-sans select-none overflow-x-hidden">
      {/* ── TOP APP HEADER ── */}
      <header className="h-16 border-b border-white/[0.08] bg-[#07090e]/95 backdrop-blur-md px-5 flex items-center justify-between z-40 shrink-0">
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
                Hospital ED Command Center
              </div>
            </div>
          </div>

          {/* Hospital Identity Badge HUD (NO FAKE IMAGES) */}
          <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.02]">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-600/30 to-blue-600/30 border border-purple-500/40 flex items-center justify-center text-purple-300 font-bold text-base">
              🏥
            </div>
            <div>
              <div className="text-sm font-extrabold text-white leading-tight">
                {hospitalData?.name || 'City General Trauma Center'}
              </div>
              <div className="text-[10px] text-white/50 leading-tight">
                Level 1 Comprehensive Trauma Facility · Mumbai
              </div>
              <div className="text-[8px] font-mono tracking-[0.16em] text-cyan-400 font-bold uppercase mt-0.5">
                CARE · RESILIENCE · PRIORITY INTAKE
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live Clock & Logout */}
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

          <button
            onClick={logout}
            title="Logout"
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center text-sm transition-all ml-2"
          >
            ⏻
          </button>
        </div>
      </header>

      {/* ── TOP STATS STRIP (5 KPI Cards) ── */}
      <div className="px-5 py-3 border-b border-white/[0.06] bg-[#070a12] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 shrink-0">
        {/* Stat 1: ICU Beds */}
        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-950/40 border border-red-500/30 flex items-center justify-center text-red-400 text-lg shrink-0">
            🏥
          </div>
          <div>
            <div className="text-[10px] font-mono text-white/40 uppercase font-semibold">ICU Beds</div>
            <div className="text-xl font-extrabold text-white tracking-tight font-mono">
              {icuAvailable} <span className="text-xs font-normal text-white/40">/ 20</span>
            </div>
            <div className="text-[10px] font-mono text-emerald-400">Available</div>
          </div>
        </div>

        {/* Stat 2: Trauma Beds */}
        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-950/40 border border-red-500/30 flex items-center justify-center text-red-400 text-lg shrink-0">
            🛏️
          </div>
          <div>
            <div className="text-[10px] font-mono text-white/40 uppercase font-semibold">Trauma Beds</div>
            <div className="text-xl font-extrabold text-white tracking-tight font-mono">
              {erAvailable} <span className="text-xs font-normal text-white/40">/ 10</span>
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
              2 <span className="text-xs font-normal text-white/40">/ 6</span>
            </div>
            <div className="text-[10px] font-mono text-emerald-400">Ready</div>
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
              3 <span className="text-xs font-normal text-white/40">/ 4</span>
            </div>
            <div className="text-[10px] font-mono text-blue-300">Active</div>
          </div>
        </div>

        {/* Stat 5: Intake Status Toggle */}
        <div className="col-span-2 sm:col-span-1 p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-mono text-white/40 uppercase font-semibold">Intake Status</div>
            <div className={`text-sm font-extrabold font-mono mt-0.5 ${intakeStatus === 'NORMAL' ? 'text-emerald-400' : 'text-red-400'}`}>
              {intakeStatus === 'NORMAL' ? 'NORMAL' : 'DIVERT'}
            </div>
            <div className="text-[9px] text-white/40">Synced with City EMS</div>
          </div>

          <button
            onClick={toggleDiversion}
            className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold transition-all shadow ${
              intakeStatus === 'NORMAL'
                ? 'bg-red-600/30 hover:bg-red-600/50 border border-red-500 text-red-300'
                : 'bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500 text-emerald-300'
            }`}
          >
            {intakeStatus === 'NORMAL' ? 'Toggle Divert' : 'Restore Normal'}
          </button>
        </div>
      </div>

      {/* ── MAIN WORKSPACE BODY ── */}
      <div className="flex-1 p-5 space-y-4 overflow-y-auto">
        {/* Top Split: Live Radar Map (5 cols) + ER Bays Grid (7 cols) */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {/* Radar Map */}
          <div className="xl:col-span-5 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl overflow-hidden flex flex-col h-[380px] relative">
            <div className="p-3 border-b border-white/[0.06] flex items-center justify-between z-10 bg-[#090d16]/90">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="font-bold text-xs text-white">Inbound Trauma Radar</span>
              </div>
              <span className="text-[10px] font-mono text-cyan-400">Live Traffic</span>
            </div>
            <div ref={mapRef} className="w-full h-full" />
          </div>

          {/* 20-Bay ER Grid */}
          <div className="xl:col-span-7 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl p-4 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-white">ER Bed Management Grid</span>
                <span className="text-xs font-mono text-white/50">(20 Bays)</span>
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
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 mt-3 flex-1 overflow-y-auto">
              {filteredBays.map((bay) => (
                <div
                  key={bay.id}
                  onClick={() => toast(`Bay ${bay.name}: ${bay.complaint || 'Available'}`, { icon: '🛏️' })}
                  className={`p-2 rounded-xl text-left cursor-pointer transition-all border relative overflow-hidden ${
                    bay.status === 'incoming'
                      ? 'bg-red-950/40 border-red-500 shadow-[0_0_15px_rgba(255,45,74,0.4)] animate-pulse'
                      : bay.status === 'occupied'
                      ? 'bg-white/[0.02] border-white/[0.07] hover:bg-white/[0.05]'
                      : bay.status === 'available'
                      ? 'bg-emerald-950/20 border-emerald-500/30 hover:bg-emerald-950/40'
                      : 'bg-yellow-950/20 border-yellow-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-white">{bay.name}</span>
                    {bay.esi && (
                      <span className="text-[8px] font-mono px-1 rounded bg-red-600/60 text-white font-bold">
                        ESI {bay.esi}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-white/80 font-medium truncate mt-1">
                    {bay.complaint}
                  </div>
                  <div className="text-[9px] text-white/40 font-mono">
                    {bay.status === 'incoming' ? `ETA ${bay.eta}` : bay.status}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Split: Inbound Patient Card + Pre-Arrival Checklist */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Inbound Patient Details */}
          <div className="lg:col-span-5 p-4 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl text-left flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                <div className="text-xs font-bold text-white">Inbound Patient Details</div>
                <span className="px-2 py-0.5 rounded bg-red-600 text-white font-mono text-[9px] font-bold">
                  ESI {inboundIncident?.triageData?.esiLevel || 1}
                </span>
              </div>

              <div className="flex items-center gap-3 mt-3">
                <div className="w-10 h-10 rounded-full bg-red-600/20 border border-red-500/40 flex items-center justify-center text-lg shrink-0">
                  👤
                </div>
                <div>
                  <div className="text-xs text-white/50 font-mono">
                    {inboundIncident?.patientDetails?.name || 'Citizen Patient'} · 🩸 {inboundIncident?.patientDetails?.bloodType || 'O+'}
                  </div>
                  <div className="text-sm font-extrabold text-white">
                    {inboundIncident?.triageData?.chiefComplaint || 'Penetrating Chest Trauma'}
                  </div>
                </div>
              </div>

              <div className="mt-3 p-2.5 rounded-lg bg-black/40 border border-white/[0.06] font-mono text-xs text-white/80 space-y-1">
                <div>AI Summary: {inboundIncident?.triageData?.aiSummary || 'Immediate emergency surgical intervention prepared.'}</div>
                <div className="text-[10px] text-emerald-400">Unit: {inboundIncident?.assignedAmbulance?.vehicleNumber || 'MH-AMB-002'} en route</div>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/10">
              <button
                onClick={handlePageTrauma}
                className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow transition-all"
              >
                Page Trauma Team
              </button>
              <button
                onClick={handleNotifyRadiology}
                className="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-all"
              >
                Clear CT Suite
              </button>
            </div>
          </div>

          {/* Pre-Arrival Preparation Checklist */}
          <div className="lg:col-span-7 p-4 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl text-left flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                <div className="text-xs font-bold text-white">Pre-Arrival Trauma Checklist</div>
                <span className="text-[10px] font-mono text-emerald-400">Synced with Paramedic Lead</span>
              </div>

              <div className="space-y-2 mt-3">
                {checklist.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => toggleChecklist(c.id)}
                    className="flex items-center justify-between p-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 cursor-pointer transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold ${
                        c.done ? 'bg-emerald-500 text-black' : 'border border-white/30 text-white/40'
                      }`}>
                        {c.done ? '✓' : ''}
                      </span>
                      <span className={`text-xs ${c.done ? 'text-white/90' : 'text-white/60'}`}>
                        {c.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-white/40">{c.time}</span>
                      {c.canReserve && !c.done && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleReserveIcu()
                          }}
                          className="px-2 py-0.5 rounded bg-purple-600/30 border border-purple-400 text-purple-200 text-[10px] font-bold"
                        >
                          Reserve ICU Bed
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
