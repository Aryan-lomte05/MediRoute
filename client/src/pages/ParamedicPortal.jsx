import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import mapboxgl from 'mapbox-gl'
import { getSocket } from '../lib/socket'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'
import toast from 'react-hot-toast'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

const ESI_COLORS = { 1: '#FF2D4A', 2: '#FF8C00', 3: '#FFD700', 4: '#00C851', 5: '#007bff' }
const ESI_LABELS = { 1: 'CRITICAL', 2: 'EMERGENT', 3: 'URGENT', 4: 'LESS URGENT', 5: 'NON-URGENT' }

function VitalsForm({ vitals, onChange }) {
  const fields = [
    { key: 'heartRate', label: 'HR', unit: 'bpm', normal: '60-100', icon: '❤️' },
    { key: 'spO2', label: 'SpO₂', unit: '%', normal: '95-100', icon: '🫁' },
    { key: 'respiratoryRate', label: 'RR', unit: '/min', normal: '12-20', icon: '💨' },
    { key: 'bloodPressureSystolic', label: 'BP Sys', unit: 'mmHg', normal: '90-140', icon: '🩺' },
    { key: 'bloodPressureDiastolic', label: 'BP Dia', unit: 'mmHg', normal: '60-90', icon: '🩺' },
    { key: 'gcsScore', label: 'GCS', unit: '/15', normal: '13-15', icon: '🧠' },
    { key: 'temperature', label: 'Temp', unit: '°C', normal: '36.1-37.2', icon: '🌡️' },
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      {fields.map(({ key, label, unit, normal, icon }) => (
        <div key={key} className="glass-card p-3">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-sm">{icon}</span>
            <span className="text-white/50 text-xs">{label}</span>
            <span className="text-white/30 text-xs ml-auto">{unit}</span>
          </div>
          <input
            type="number"
            className="w-full bg-transparent text-white text-xl font-mono font-bold outline-none border-b border-surface-border focus:border-cyber"
            placeholder="---"
            value={vitals[key] || ''}
            onChange={(e) => onChange(key, e.target.value ? parseFloat(e.target.value) : '')}
          />
          <div className="text-white/20 text-xs mt-0.5">Normal: {normal}</div>
        </div>
      ))}
    </div>
  )
}

export default function ParamedicPortal() {
  const { user, logout } = useAuthStore()
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const gpsIntervalRef = useRef(null)
  const routeLayerRef = useRef(false)
  const [activeDispatch, setActiveDispatch] = useState(null)
  const [tab, setTab] = useState('dispatch') // 'dispatch' | 'vitals' | 'nav'
  const [vitals, setVitals] = useState({})
  const [ambulanceId, setAmbulanceId] = useState(null)
  const [myLocation, setMyLocation] = useState(null)
  const [navEta, setNavEta] = useState(null)
  const [incidents, setIncidents] = useState([])
  const [savingVitals, setSavingVitals] = useState(false)

  useEffect(() => {
    // Get user's ambulance
    const fetchAmbulance = async () => {
      try {
        const { data } = await api.get('/ambulances?status=DISPATCHED')
        if (data.ambulances[0]) setAmbulanceId(data.ambulances[0]._id)
      } catch {}
    }
    fetchAmbulance()

    const fetchIncidents = async () => {
      try {
        const { data } = await api.get('/incidents?status=DISPATCHING')
        setIncidents(data.incidents)
      } catch {}
    }
    fetchIncidents()
  }, [])

  // Map init
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return
    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [72.8777, 19.076],
      zoom: 13,
      pitch: 60,
    })
    map.on('load', () => {
      map.addLayer({ id: '3d-buildings', source: 'composite', 'source-layer': 'building', filter: ['==', 'extrude', 'true'], type: 'fill-extrusion', minzoom: 12, paint: { 'fill-extrusion-color': '#0f0f1a', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.9 } })
    })
    mapInstanceRef.current = map
    return () => { map.remove(); mapInstanceRef.current = null }
  }, [])

  // GPS streaming
  useEffect(() => {
    const socket = getSocket()

    const startGPS = () => {
      navigator.geolocation.watchPosition((pos) => {
        const coords = [pos.coords.longitude, pos.coords.latitude]
        setMyLocation(coords)
        if (ambulanceId && mapInstanceRef.current) {
          socket.emit('gps_update', { ambulanceId, coordinates: coords, heading: pos.coords.heading, speed: pos.coords.speed })
          mapInstanceRef.current.easeTo({ center: coords })
        }
      }, null, { enableHighAccuracy: true, maximumAge: 2000, timeout: 5000 })
    }

    startGPS()

    // Dispatch alert
    socket.on('dispatch_alert', ({ incidentId, incident }) => {
      setActiveDispatch(incident)
      toast('🚨 NEW DISPATCH ALERT', { icon: '🚑', duration: 6000, style: { background: '#FF2D4A', color: 'white' } })
      setTab('nav')
      // Draw route on map
      if (incident.route?.geometry && mapInstanceRef.current) {
        drawRoute(incident.route.geometry, incident.location.coordinates)
      }
    })

    return () => {
      socket.off('dispatch_alert')
    }
  }, [ambulanceId])

  const drawRoute = (geometry, destination) => {
    const map = mapInstanceRef.current
    if (!map) return
    if (routeLayerRef.current) {
      map.removeLayer('route-glow')
      map.removeLayer('route-line')
      map.removeSource('route')
    }
    map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry } })
    map.addLayer({ id: 'route-glow', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FF2D4A', 'line-width': 12, 'line-opacity': 0.3 } })
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FF2D4A', 'line-width': 4 } })
    routeLayerRef.current = true
    // Destination marker
    const el = document.createElement('div')
    el.style.cssText = 'width:24px;height:24px;background:#FF2D4A;border-radius:50%;border:3px solid white;box-shadow:0 0 20px rgba(255,45,74,0.8)'
    new mapboxgl.Marker(el).setLngLat(destination).addTo(map)
    map.fitBounds([
      [Math.min(myLocation?.[0] || 72.8, destination[0]) - 0.01, Math.min(myLocation?.[1] || 19.07, destination[1]) - 0.01],
      [Math.max(myLocation?.[0] || 72.8, destination[0]) + 0.01, Math.max(myLocation?.[1] || 19.07, destination[1]) + 0.01],
    ], { padding: 60 })
  }

  const updateStatus = async (status) => {
    if (!activeDispatch) return
    try {
      await api.patch(`/incidents/${activeDispatch._id}/status`, { status })
      setActiveDispatch((prev) => ({ ...prev, status }))
      toast.success(`Status → ${status.replace(/_/g, ' ')}`)
    } catch {
      toast.error('Failed to update status')
    }
  }

  const saveVitals = async () => {
    if (!activeDispatch) return
    setSavingVitals(true)
    try {
      await api.patch(`/incidents/${activeDispatch._id}/status`, {
        status: activeDispatch.status,
        vitals: Object.fromEntries(Object.entries(vitals).filter(([, v]) => v !== '')),
      })
      const socket = getSocket()
      socket.emit('vitals_update', { incidentId: activeDispatch._id, vitals })
      toast.success('Vitals saved & transmitted to hospital')
    } catch {
      toast.error('Failed to save vitals')
    } finally {
      setSavingVitals(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col">
      {/* Header */}
      <header className="px-4 py-3 border-b border-surface-border flex items-center justify-between bg-[#0a0a0f]/95 backdrop-blur-xl sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-cyber/20 border border-cyber/40 rounded-lg flex items-center justify-center">
            <span className="text-lg">🚑</span>
          </div>
          <div>
            <div className="font-display font-bold text-white text-sm">Paramedic PWA</div>
            <div className="flex items-center gap-1">
              <span className="pulse-dot text-cyber w-2 h-2" />
              <span className="text-white/40 text-xs ml-1">GPS Active</span>
            </div>
          </div>
        </div>
        <button onClick={logout} className="btn-ghost text-xs px-3 py-1.5">Sign Out</button>
      </header>

      {/* Dispatch banner */}
      <AnimatePresence>
        {activeDispatch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-emergency/40 bg-emergency/10 overflow-hidden"
          >
            <div className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-emergency text-xs font-mono font-bold uppercase">Active Dispatch</div>
                <div className="text-white text-sm font-semibold">{activeDispatch.incidentNumber}</div>
                <div className="text-white/60 text-xs">{activeDispatch.triageData?.chiefComplaint || 'Emergency'}</div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="px-2 py-1 rounded-lg border text-xs font-mono font-bold"
                  style={{ color: ESI_COLORS[activeDispatch.triageData?.esiLevel], borderColor: `${ESI_COLORS[activeDispatch.triageData?.esiLevel]}60`, background: `${ESI_COLORS[activeDispatch.triageData?.esiLevel]}15` }}
                >
                  ESI {activeDispatch.triageData?.esiLevel || '?'}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs */}
      <div className="flex border-b border-surface-border">
        {[['dispatch', '📋', 'Dispatch'], ['nav', '🗺️', 'Navigate'], ['vitals', '❤️', 'Vitals']].map(([key, icon, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-3 transition-all duration-200 flex flex-col items-center gap-0.5 ${
              tab === key ? 'text-cyber border-b-2 border-cyber' : 'text-white/40 hover:text-white/70'
            }`}
          >
            <span className="text-lg">{icon}</span>
            <span className="text-xs font-mono">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Dispatch Tab */}
        {tab === 'dispatch' && (
          <div className="p-4 space-y-4">
            {!activeDispatch ? (
              <div className="text-center py-16">
                <div className="text-6xl mb-4">📡</div>
                <div className="text-white/60 text-lg font-display">Awaiting Dispatch</div>
                <div className="text-white/30 text-sm mt-1">Standing by for emergency calls</div>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <span className="pulse-dot text-cyber" />
                  <span className="text-cyber text-sm ml-1">System Online</span>
                </div>
              </div>
            ) : (
              <>
                <div className="glass-card p-5">
                  <div className="text-xs text-white/40 font-mono mb-3 uppercase">Incident Details</div>
                  <div className="space-y-2">
                    {[
                      ['Incident #', activeDispatch.incidentNumber],
                      ['Patient', activeDispatch.patientDetails?.name || 'Unknown'],
                      ['Complaint', activeDispatch.triageData?.chiefComplaint || 'N/A'],
                      ['ESI Level', `${activeDispatch.triageData?.esiLevel} — ${ESI_LABELS[activeDispatch.triageData?.esiLevel]}`],
                      ['AI Summary', activeDispatch.triageData?.aiSummary || 'Manual assessment needed'],
                      ['Status', activeDispatch.status?.replace(/_/g, ' ')],
                    ].map(([label, value]) => (
                      <div key={label} className="flex gap-3">
                        <span className="text-white/40 text-xs w-24 flex-shrink-0">{label}</span>
                        <span className="text-white text-xs flex-1">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Status actions */}
                <div className="glass-card p-4">
                  <div className="text-xs text-white/40 font-mono mb-3 uppercase">Update Status</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { status: 'EN_ROUTE_TO_PATIENT', label: 'En Route', color: '#00F5FF' },
                      { status: 'AT_PATIENT', label: 'At Patient', color: '#FFD700' },
                      { status: 'EN_ROUTE_TO_HOSPITAL', label: 'To Hospital', color: '#FF8C00' },
                      { status: 'ARRIVED_AT_HOSPITAL', label: 'Arrived', color: '#00C851' },
                    ].map(({ status, label, color }) => (
                      <button
                        key={status}
                        onClick={() => updateStatus(status)}
                        disabled={activeDispatch.status === status}
                        className="p-3 rounded-xl border text-xs font-semibold transition-all duration-200 disabled:opacity-40"
                        style={{
                          borderColor: `${color}40`,
                          color: activeDispatch.status === status ? color : `${color}99`,
                          background: activeDispatch.status === status ? `${color}20` : 'transparent',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Navigate Tab */}
        {tab === 'nav' && (
          <div className="flex flex-col h-[calc(100vh-180px)]">
            <div ref={mapRef} className="flex-1" />
            {navEta && (
              <div className="p-4 glass-card border-t border-surface-border">
                <div className="flex items-center justify-between">
                  <div className="text-white/50 text-sm">Estimated Arrival</div>
                  <div className="text-cyber font-mono font-bold text-2xl">{navEta} min</div>
                </div>
              </div>
            )}
            {!activeDispatch && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="glass-card p-4 text-center">
                  <div className="text-white/40 text-sm">No active dispatch — map ready</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Vitals Tab */}
        {tab === 'vitals' && (
          <div className="p-4 space-y-4">
            {!activeDispatch ? (
              <div className="text-center py-16 text-white/40">
                <div className="text-4xl mb-2">❤️</div>
                <div>No active incident</div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-white font-display font-semibold">Patient Vitals</div>
                  <div className="text-white/40 text-xs font-mono">Live to Hospital ER →</div>
                </div>
                <VitalsForm vitals={vitals} onChange={(key, val) => setVitals((v) => ({ ...v, [key]: val }))} />
                <button
                  onClick={saveVitals}
                  disabled={savingVitals}
                  className="btn-emergency w-full justify-center"
                >
                  {savingVitals ? '⏳ Transmitting...' : '📡 Transmit Vitals to ER'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
