import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import mapboxgl from 'mapbox-gl'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts'
import { getSocket } from '../lib/socket'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'
import toast from 'react-hot-toast'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

const CHART_COLORS = ['#FF2D4A', '#00F5FF', '#7C3AED', '#FF8C00', '#00C851']

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-card px-3 py-2 border border-surface-border text-xs">
      <div className="text-white/60 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>{p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</div>
      ))}
    </div>
  )
}

function StatCard({ label, value, sub, color, icon, trend }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="metric-card"
      style={{ '--accent': color }}
    >
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
      <div className="flex items-start justify-between">
        <div>
          <div className="text-white/40 text-xs font-mono uppercase">{label}</div>
          <div className="text-4xl font-display font-bold mt-1" style={{ color }}>{value}</div>
          {sub && <div className="text-white/30 text-xs mt-1">{sub}</div>}
          {trend && (
            <div className={`text-xs mt-1 ${trend > 0 ? 'text-emergency' : 'text-green-400'}`}>
              {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% vs last hour
            </div>
          )}
        </div>
        <div className="text-3xl opacity-60">{icon}</div>
      </div>
    </motion.div>
  )
}

function AmbulanceRow({ ambulance }) {
  const statusColors = {
    AVAILABLE: '#00C851', DISPATCHED: '#FFD700',
    EN_ROUTE_TO_PATIENT: '#FF8C00', AT_PATIENT: '#FF8C00',
    EN_ROUTE_TO_HOSPITAL: '#FF2D4A', OFFLINE: '#555', MAINTENANCE: '#555',
  }
  const color = statusColors[ambulance.status] || '#555'

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-surface-border last:border-0">
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <div className="flex-1 min-w-0">
        <div className="text-white text-sm font-mono">{ambulance.vehicleNumber}</div>
        <div className="text-white/40 text-xs">{ambulance.vehicleType?.replace(/_/g, ' ')}</div>
      </div>
      <div className="text-xs font-mono px-2 py-0.5 rounded" style={{ color, background: `${color}20`, border: `1px solid ${color}40` }}>
        {ambulance.status?.replace(/_/g, ' ')}
      </div>
    </div>
  )
}

export default function AdminPortal() {
  const { user, logout } = useAuthStore()
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const ambulanceMarkersRef = useRef({})
  const hospitalMarkersRef = useRef({})
  const incidentMarkersRef = useRef({})
  const orbitAnimationRef = useRef(null)

  const [tab, setTab] = useState('dashboard') // 'dashboard' | 'map' | 'fleet' | 'forecast'
  const [stats, setStats] = useState({ total: 0, active: 0, completed: 0, today: 0 })
  const [ambulances, setAmbulances] = useState([])
  const [hospitals, setHospitals] = useState([])
  const [incidents, setIncidents] = useState([])
  const [surgeForecast, setSurgeForecast] = useState([])
  const [esiDistribution, setEsiDistribution] = useState([])
  const [mapFilter, setMapFilter] = useState('ALL') // 'ALL' | 'AMBULANCES' | 'HOSPITALS' | 'INCIDENTS'
  const [isOrbiting, setIsOrbiting] = useState(false)
  const [activeAngle, setActiveAngle] = useState('iso') // 'iso' | 'flat' | 'horizon' | 'orbit'

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
        setStats(statsRes.data)
        setAmbulances(ambRes.data.ambulances || [])
        setHospitals(hospRes.data.hospitals || [])
        setIncidents(incRes.data.incidents || [])
        setSurgeForecast(forecastRes.data.forecast || [])
        setEsiDistribution(statsRes.data.esiDistribution?.map((e) => ({ name: `ESI ${e._id}`, value: e.count })) || [])
      } catch (err) {
        console.error('Admin fetch error:', err)
      }
    }
    fetchAll()
    const interval = setInterval(fetchAll, 30000)
    return () => clearInterval(interval)
  }, [])

  // Camera angle controls
  const setCameraAngle = (type) => {
    if (!mapInstanceRef.current) return
    const map = mapInstanceRef.current

    // Stop orbit if active
    if (orbitAnimationRef.current) {
      cancelAnimationFrame(orbitAnimationRef.current)
      orbitAnimationRef.current = null
      setIsOrbiting(false)
    }

    setActiveAngle(type)

    if (type === 'iso') {
      map.easeTo({ pitch: 60, bearing: -20, zoom: 12.5, duration: 1200 })
    } else if (type === 'flat') {
      map.easeTo({ pitch: 0, bearing: 0, zoom: 11.5, duration: 1000 })
    } else if (type === 'horizon') {
      map.easeTo({ pitch: 75, bearing: 45, zoom: 13.5, duration: 1400 })
    } else if (type === 'orbit') {
      setIsOrbiting(true)
      const rotateCamera = () => {
        if (!mapInstanceRef.current) return
        const currentBearing = mapInstanceRef.current.getBearing()
        mapInstanceRef.current.setBearing((currentBearing + 0.3) % 360)
        orbitAnimationRef.current = requestAnimationFrame(rotateCamera)
      }
      rotateCamera()
    }
  }

  // Quick map focus
  const focusEntity = (target) => {
    if (!mapInstanceRef.current) return
    const map = mapInstanceRef.current
    if (target === 'mumbai') {
      map.flyTo({ center: [72.8777, 19.076], zoom: 12, pitch: 55, bearing: -15, duration: 1500 })
    } else if (target === 'ambulance' && ambulances.length > 0) {
      const activeAmb = ambulances.find((a) => a.status !== 'OFFLINE') || ambulances[0]
      if (activeAmb?.currentLocation?.coordinates) {
        map.flyTo({ center: activeAmb.currentLocation.coordinates, zoom: 14.5, pitch: 65, duration: 1500 })
      }
    } else if (target === 'incident' && incidents.length > 0) {
      const activeInc = incidents.find((i) => i.status !== 'RESOLVED') || incidents[0]
      if (activeInc?.location?.coordinates) {
        map.flyTo({ center: activeInc.location.coordinates, zoom: 14.5, pitch: 60, duration: 1500 })
      }
    }
  }

  // Initialize Map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [72.8777, 19.076],
      zoom: 12,
      pitch: 55,
      bearing: -20,
    })

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
          'fill-extrusion-color': '#121226',
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': ['get', 'min_height'],
          'fill-extrusion-opacity': 0.8,
        },
      })
    })

    mapInstanceRef.current = map

    return () => {
      if (orbitAnimationRef.current) cancelAnimationFrame(orbitAnimationRef.current)
      map.remove()
      mapInstanceRef.current = null
    }
  }, [])

  // Resize map when tab switches to map
  useEffect(() => {
    if (tab === 'map' && mapInstanceRef.current) {
      setTimeout(() => {
        mapInstanceRef.current.resize()
      }, 100)
    }
  }, [tab])

  // Sync Hospital Markers
  useEffect(() => {
    if (!mapInstanceRef.current || hospitals.length === 0) return
    const map = mapInstanceRef.current

    // Clear old
    Object.values(hospitalMarkersRef.current).forEach((m) => m.remove())
    hospitalMarkersRef.current = {}

    hospitals.forEach((h) => {
      if (!h.location?.coordinates) return
      const el = document.createElement('div')
      el.className = 'group cursor-pointer'
      el.innerHTML = `
        <div style="background: rgba(124, 58, 237, 0.9); border: 2px solid white; box-shadow: 0 0 15px rgba(124, 58, 237, 0.8); width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: bold; color: white; font-size: 13px;">
          🏥
        </div>
      `
      const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
        <div style="color:white; font-family: monospace; padding: 4px;">
          <div style="font-weight: bold; color: #a78bfa; font-size: 13px; margin-bottom: 4px;">${h.name}</div>
          <div>🛏️ ICU Beds: <strong style="color:#00F5FF">${h.resources?.icuBeds?.available || 0}</strong>/${h.resources?.icuBeds?.total || 0}</div>
          <div>⏱️ ER Wait: <strong style="color:#FFD700">${h.queueStatus?.erWaitTimeMinutes || 10} min</strong></div>
          <div style="margin-top:4px; font-size: 10px; color: ${h.queueStatus?.diversionStatus ? '#FF2D4A' : '#00C851'}">
            ● ${h.queueStatus?.diversionStatus ? 'DIVERTING' : 'NORMAL INTAKE'}
          </div>
        </div>
      `)

      const marker = new mapboxgl.Marker(el).setLngLat(h.location.coordinates).setPopup(popup).addTo(map)
      hospitalMarkersRef.current[h._id] = marker
    })
  }, [hospitals])

  // Sync Ambulance Markers
  useEffect(() => {
    if (!mapInstanceRef.current || ambulances.length === 0) return
    const map = mapInstanceRef.current

    ambulances.forEach((a) => {
      if (!a.currentLocation?.coordinates) return
      const coords = a.currentLocation.coordinates

      if (ambulanceMarkersRef.current[a._id]) {
        ambulanceMarkersRef.current[a._id].setLngLat(coords)
      } else {
        const el = document.createElement('div')
        el.className = 'cursor-pointer'
        el.innerHTML = `
          <div style="background: #00F5FF; border: 2px solid #ffffff; box-shadow: 0 0 18px #00F5FF; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 15px;">
            🚑
          </div>
        `
        const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
          <div style="color:white; font-family: monospace; padding: 4px;">
            <div style="font-weight: bold; color: #00F5FF; font-size: 13px;">${a.vehicleNumber}</div>
            <div style="color: #999; font-size: 11px;">${a.vehicleType?.replace(/_/g, ' ')}</div>
            <div style="margin-top: 4px; font-size: 11px;">Status: <strong style="color:#FFD700">${a.status}</strong></div>
          </div>
        `)
        const marker = new mapboxgl.Marker(el).setLngLat(coords).setPopup(popup).addTo(map)
        ambulanceMarkersRef.current[a._id] = marker
      }
    })
  }, [ambulances])

  // Sync Incident Markers
  useEffect(() => {
    if (!mapInstanceRef.current || incidents.length === 0) return
    const map = mapInstanceRef.current

    Object.values(incidentMarkersRef.current).forEach((m) => m.remove())
    incidentMarkersRef.current = {}

    incidents.slice(0, 15).forEach((inc) => {
      if (!inc.location?.coordinates) return
      const esi = inc.triageData?.esiLevel || 2
      const esiColors = ['#FF2D4A', '#FF4500', '#FF8C00', '#FFD700', '#00C851']
      const color = esiColors[esi - 1] || '#FF2D4A'

      const el = document.createElement('div')
      el.className = 'cursor-pointer animate-pulse'
      el.innerHTML = `
        <div style="background: ${color}; border: 2px solid white; box-shadow: 0 0 20px ${color}; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; color: white;">
          !
        </div>
      `
      const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
        <div style="color:white; font-family: monospace; padding: 4px;">
          <div style="font-weight: bold; color: ${color}; font-size: 13px;">${inc.incidentNumber}</div>
          <div style="font-size: 11px; margin-top:2px;">${inc.triageData?.chiefComplaint || 'Emergency SOS'}</div>
          <div style="font-size: 11px; color:#FFD700; margin-top:3px;">ESI Level: ${esi} · Status: ${inc.status}</div>
        </div>
      `)
      const marker = new mapboxgl.Marker(el).setLngLat(inc.location.coordinates).setPopup(popup).addTo(map)
      incidentMarkersRef.current[inc._id] = marker
    })
  }, [incidents])

  // Socket
  useEffect(() => {
    const socket = getSocket()

    socket.on('ambulance_location', ({ ambulanceId, coordinates }) => {
      setAmbulances((prev) => prev.map((a) => (a._id === ambulanceId ? { ...a, currentLocation: { ...a.currentLocation, coordinates } } : a)))
      if (ambulanceMarkersRef.current[ambulanceId]) {
        ambulanceMarkersRef.current[ambulanceId].setLngLat(coordinates)
      }
    })

    socket.on('new_incident', (incident) => {
      setIncidents((prev) => [incident, ...prev])
      setStats((prev) => ({ ...prev, active: prev.active + 1, total: prev.total + 1, today: prev.today + 1 }))
      toast('🆘 New incident incoming!', { icon: '🚨', style: { background: '#FF2D4A', color: 'white' } })
    })

    socket.on('ambulance_status', ({ ambulanceId, status }) => {
      setAmbulances((prev) => prev.map((a) => (a._id === ambulanceId ? { ...a, status } : a)))
    })

    return () => {
      socket.off('ambulance_location')
      socket.off('new_incident')
      socket.off('ambulance_status')
    }
  }, [])

  const seedData = async () => {
    try {
      await Promise.all([
        api.post('/hospitals/seed'),
        api.post('/ambulances/seed'),
      ])
      toast.success('Sample data seeded — refresh to see changes')
    } catch { toast.error('Seed failed') }
  }

  const statusCounts = {
    AVAILABLE: ambulances.filter((a) => a.status === 'AVAILABLE').length,
    ACTIVE: ambulances.filter((a) => !['AVAILABLE', 'OFFLINE', 'MAINTENANCE'].includes(a.status)).length,
    OFFLINE: ambulances.filter((a) => ['OFFLINE', 'MAINTENANCE'].includes(a.status)).length,
  }

  const forecastChartData = surgeForecast.slice(0, 12).map((f) => ({
    hour: `${new Date(f.time).getHours()}:00`,
    load: Math.round(f.predictedLoad),
    confidence: Math.round(f.confidence * 100),
  }))

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col">
      {/* Header */}
      <header className="px-4 py-3 border-b border-surface-border flex items-center justify-between bg-[#0a0a0f]/95 backdrop-blur-xl sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-500/20 border border-orange-500/40 rounded-lg flex items-center justify-center">
            <span className="text-lg">📊</span>
          </div>
          <div>
            <div className="font-display font-bold text-white text-sm">MediRoute Admin</div>
            <div className="flex items-center gap-2">
              <span className="pulse-dot text-emergency w-2 h-2" />
              <span className="text-white/40 text-xs ml-1">{stats.active} active incidents</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={seedData} className="text-xs px-3 py-1.5 border border-surface-border text-white/50 rounded-lg hover:border-white/30 hover:text-white/70 transition-all">Seed Data</button>
          <button onClick={logout} className="btn-ghost text-xs px-3 py-1.5">Out</button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-surface-border">
        {[['dashboard', '📈', 'Dashboard'], ['map', '🗺️', 'City Map'], ['fleet', '🚑', 'Fleet'], ['forecast', '🔮', 'Surge']].map(([key, icon, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 py-3 transition-all duration-200 flex flex-col items-center gap-0.5 ${tab === key ? 'text-orange-400 border-b-2 border-orange-400' : 'text-white/40 hover:text-white/70'}`}>
            <span className="text-lg">{icon}</span>
            <span className="text-xs font-mono">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Dashboard Tab */}
        {tab === 'dashboard' && (
          <div className="p-4 space-y-4">
            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Total Incidents" value={stats.total} sub="All time" color="#FF2D4A" icon="🆘" />
              <StatCard label="Active Now" value={stats.active} sub="In progress" color="#00F5FF" icon="⚡" trend={8} />
              <StatCard label="Today" value={stats.today} sub="Last 24h" color="#7C3AED" icon="📅" />
              <StatCard label="Completed" value={stats.completed} sub="Resolved" color="#00C851" icon="✅" />
            </div>

            {/* Fleet summary */}
            <div className="glass-card p-4">
              <div className="text-white/50 text-xs font-mono uppercase mb-3">Fleet Status</div>
              <div className="flex gap-4">
                {[['Available', statusCounts.AVAILABLE, '#00C851'], ['Active', statusCounts.ACTIVE, '#FF8C00'], ['Offline', statusCounts.OFFLINE, '#555']].map(([label, count, color]) => (
                  <div key={label} className="flex-1 text-center">
                    <div className="text-2xl font-display font-bold" style={{ color }}>{count}</div>
                    <div className="text-white/40 text-xs">{label}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 h-2 bg-surface-elevated rounded-full overflow-hidden flex">
                {ambulances.length > 0 && (
                  <>
                    <div className="h-full bg-green-500 transition-all" style={{ width: `${(statusCounts.AVAILABLE / ambulances.length) * 100}%` }} />
                    <div className="h-full bg-orange-500 transition-all" style={{ width: `${(statusCounts.ACTIVE / ambulances.length) * 100}%` }} />
                    <div className="h-full bg-gray-500 transition-all" style={{ width: `${(statusCounts.OFFLINE / ambulances.length) * 100}%` }} />
                  </>
                )}
              </div>
            </div>

            {/* ESI Distribution */}
            {esiDistribution.length > 0 && (
              <div className="glass-card p-4">
                <div className="text-white/50 text-xs font-mono uppercase mb-3">ESI Distribution</div>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={esiDistribution} cx="50%" cy="50%" outerRadius={60} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={{ stroke: '#ffffff20' }}>
                        {esiDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i]} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Recent incidents */}
            <div className="glass-card p-4">
              <div className="text-white/50 text-xs font-mono uppercase mb-3">Recent Incidents</div>
              {incidents.slice(0, 8).map((inc) => (
                <div key={inc._id} className="flex items-center gap-3 py-2 border-b border-surface-border last:border-0">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ['#FF2D4A', '#FF8C00', '#FFD700', '#00C851', '#007bff'][inc.triageData?.esiLevel - 1] || '#555' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-xs font-mono truncate">{inc.incidentNumber}</div>
                    <div className="text-white/40 text-xs truncate">{inc.triageData?.chiefComplaint || 'N/A'}</div>
                  </div>
                  <div className="text-white/30 text-xs font-mono">{new Date(inc.createdAt).toLocaleTimeString()}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Map Tab - Kept mounted in DOM to prevent reload/blank glitches */}
        <div className={tab === 'map' ? 'h-[calc(100vh-120px)] relative w-full' : 'hidden'}>
          <div ref={mapRef} className="w-full h-full" />

          {/* Top-Right Camera Angle Controls HUD */}
          <div className="absolute top-4 right-4 glass-card p-2.5 flex flex-col gap-2 z-10 border border-cyan-500/30 bg-[#0a0a14]/90 backdrop-blur-md shadow-2xl">
            <div className="text-[10px] font-mono text-cyan-400 font-semibold tracking-wider uppercase flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
              Camera Angles
            </div>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => setCameraAngle('iso')}
                className={`px-3 py-1.5 rounded text-xs font-mono text-left transition-all flex items-center justify-between gap-3 ${
                  activeAngle === 'iso' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <span>📐 3D Isometric</span>
                <span className="text-[10px] text-white/40">55°</span>
              </button>

              <button
                type="button"
                onClick={() => setCameraAngle('horizon')}
                className={`px-3 py-1.5 rounded text-xs font-mono text-left transition-all flex items-center justify-between gap-3 ${
                  activeAngle === 'horizon' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40' : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <span>🌆 3D Horizon</span>
                <span className="text-[10px] text-white/40">75°</span>
              </button>

              <button
                type="button"
                onClick={() => setCameraAngle('flat')}
                className={`px-3 py-1.5 rounded text-xs font-mono text-left transition-all flex items-center justify-between gap-3 ${
                  activeAngle === 'flat' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <span>🧭 Tactical 2D</span>
                <span className="text-[10px] text-white/40">0°</span>
              </button>

              <button
                type="button"
                onClick={() => setCameraAngle('orbit')}
                className={`px-3 py-1.5 rounded text-xs font-mono text-left transition-all flex items-center justify-between gap-3 ${
                  isOrbiting ? 'bg-emergency/20 text-emergency border border-emergency/40 animate-pulse' : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <span>🔄 360° Orbit Mode</span>
                <span className="text-[10px] text-emergency font-bold">{isOrbiting ? 'LIVE' : 'OFF'}</span>
              </button>
            </div>
          </div>

          {/* Top-Left Quick Target Jump Bar */}
          <div className="absolute top-4 left-4 glass-card p-2 flex items-center gap-2 z-10 border border-white/10 bg-[#0a0a14]/90 backdrop-blur-md">
            <span className="text-[10px] font-mono text-white/40 uppercase mr-1">Focus:</span>
            <button
              type="button"
              onClick={() => focusEntity('mumbai')}
              className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-mono text-white/80 transition-all"
            >
              🏙️ City Center
            </button>
            <button
              type="button"
              onClick={() => focusEntity('ambulance')}
              className="px-2.5 py-1 rounded bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/30 text-xs font-mono text-cyan-300 transition-all"
            >
              🚑 Nearest Ambulance
            </button>
            <button
              type="button"
              onClick={() => focusEntity('incident')}
              className="px-2.5 py-1 rounded bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-xs font-mono text-red-300 transition-all"
            >
              🆘 Active Emergency
            </button>
          </div>

          {/* Bottom-Left Real-time HUD & Legend */}
          <div className="absolute bottom-6 left-4 glass-card p-3 text-xs space-y-2 z-10 border border-white/10 bg-[#0a0a14]/90 backdrop-blur-md shadow-2xl min-w-[200px]">
            <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
              <span className="text-[11px] font-mono font-bold text-white uppercase tracking-wider">Telemetry HUD</span>
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            </div>
            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2 text-white/70">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#00F5FF] shadow-[0_0_8px_#00F5FF]" />
                  Active Fleet:
                </span>
                <span className="text-cyan-400 font-bold">{ambulances.length} Units</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2 text-white/70">
                  <span className="w-2.5 h-2.5 rounded bg-[#7C3AED] shadow-[0_0_8px_#7C3AED]" />
                  Hospitals:
                </span>
                <span className="text-purple-400 font-bold">{hospitals.length} Trauma</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2 text-white/70">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FF2D4A] shadow-[0_0_8px_#FF2D4A] animate-ping" />
                  Incidents:
                </span>
                <span className="text-red-400 font-bold">{incidents.length} Logged</span>
              </div>
            </div>
          </div>
        </div>

        {/* Fleet Tab */}
        {tab === 'fleet' && (
          <div className="p-4 space-y-4">
            <div className="glass-card p-4">
              <div className="text-white/50 text-xs font-mono uppercase mb-3">All Units ({ambulances.length})</div>
              {ambulances.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-white/30 text-sm mb-3">No ambulances registered</div>
                  <button onClick={seedData} className="btn-emergency text-sm">Seed Sample Data</button>
                </div>
              ) : (
                ambulances.map((a) => <AmbulanceRow key={a._id} ambulance={a} />)
              )}
            </div>

            {/* Hospitals */}
            <div className="glass-card p-4">
              <div className="text-white/50 text-xs font-mono uppercase mb-3">Hospitals ({hospitals.length})</div>
              {hospitals.map((h) => (
                <div key={h._id} className="flex items-center gap-3 py-2.5 border-b border-surface-border last:border-0">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${h.queueStatus?.diversionStatus ? 'bg-emergency' : 'bg-green-500'}`} />
                  <div className="flex-1">
                    <div className="text-white text-sm">{h.name}</div>
                    <div className="text-white/40 text-xs">ICU: {h.resources?.icuBeds?.available}/{h.resources?.icuBeds?.total} • Wait: {h.queueStatus?.erWaitTimeMinutes}min</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded border ${h.queueStatus?.diversionStatus ? 'border-emergency/40 text-emergency' : 'border-green-500/40 text-green-400'}`}>
                    {h.queueStatus?.diversionStatus ? 'DIVERT' : 'OPEN'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Surge Forecast Tab */}
        {tab === 'forecast' && (
          <div className="p-4 space-y-4">
            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-white font-display font-semibold">Surge Forecast</div>
                  <div className="text-white/40 text-xs">Next 12 hours · AI predicted load</div>
                </div>
                <div className="px-2 py-1 rounded bg-purple-500/20 border border-purple-500/40 text-purple-400 text-xs font-mono">
                  TFT Model
                </div>
              </div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={forecastChartData}>
                    <defs>
                      <linearGradient id="loadGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#FF2D4A" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#FF2D4A" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="hour" tick={{ fill: '#ffffff40', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#ffffff40', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="load" name="Load %" stroke="#FF2D4A" fill="url(#loadGrad)" strokeWidth={2} />
                    <Area type="monotone" dataKey="confidence" name="Confidence %" stroke="#00F5FF" fill="none" strokeWidth={1} strokeDasharray="4 2" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Risk indicators */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Peak Hour', value: forecastChartData.reduce((a, b) => a.load > b.load ? a : b, { hour: '--', load: 0 }).hour, color: '#FF2D4A' },
                { label: 'Peak Load', value: `${Math.max(...forecastChartData.map((f) => f.load), 0)}%`, color: '#FF8C00' },
                { label: 'Avg Confidence', value: `${Math.round(forecastChartData.reduce((s, f) => s + f.confidence, 0) / Math.max(forecastChartData.length, 1))}%`, color: '#00F5FF' },
              ].map(({ label, value, color }) => (
                <div key={label} className="glass-card p-3 text-center">
                  <div className="text-lg font-display font-bold" style={{ color }}>{value}</div>
                  <div className="text-white/40 text-xs">{label}</div>
                </div>
              ))}
            </div>

            {/* High risk hours */}
            <div className="glass-card p-4">
              <div className="text-white/50 text-xs font-mono uppercase mb-3">High Risk Periods</div>
              {surgeForecast.filter((f) => f.riskLevel === 'HIGH').slice(0, 5).map((f, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-surface-border last:border-0">
                  <div className="text-emergency font-mono text-sm">
                    {new Date(f.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="text-white/60 text-xs">{Math.round(f.predictedLoad)}% capacity</div>
                  <span className="text-xs px-2 py-0.5 rounded bg-emergency/20 border border-emergency/40 text-emergency">HIGH</span>
                </div>
              ))}
              {surgeForecast.filter((f) => f.riskLevel === 'HIGH').length === 0 && (
                <div className="text-white/30 text-sm text-center py-4">No high-risk periods in next 12h ✅</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
