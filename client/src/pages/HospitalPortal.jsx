import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import mapboxgl from 'mapbox-gl'
import { getSocket } from '../lib/socket'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'
import toast from 'react-hot-toast'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

const ESI_CONFIG = {
  1: { label: 'CRITICAL', color: '#FF2D4A', bg: 'bg-red-500/20 border-red-500/50 text-red-400' },
  2: { label: 'EMERGENT', color: '#FF8C00', bg: 'bg-orange-500/20 border-orange-500/50 text-orange-400' },
  3: { label: 'URGENT', color: '#FFD700', bg: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' },
  4: { label: 'LESS URGENT', color: '#00C851', bg: 'bg-green-500/20 border-green-500/50 text-green-400' },
  5: { label: 'NON-URGENT', color: '#007bff', bg: 'bg-blue-500/20 border-blue-500/50 text-blue-400' },
}

function PatientCard({ incident, onAccept, onExpand }) {
  const esi = incident.triageData?.esiLevel
  const cfg = ESI_CONFIG[esi] || ESI_CONFIG[3]
  const vitals = incident.triageData?.vitals || {}

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
      className="glass-card p-4 relative overflow-hidden"
    >
      {/* ESI accent strip */}
      <div className="absolute top-0 left-0 bottom-0 w-1 rounded-l-2xl" style={{ background: cfg.color }} />

      <div className="pl-2">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-xs text-white/40 font-mono">{incident.incidentNumber}</div>
            <div className="text-white font-semibold">{incident.patientDetails?.name || 'Unknown Patient'}</div>
            <div className="text-white/60 text-xs mt-0.5">{incident.triageData?.chiefComplaint}</div>
          </div>
          <span className={`px-2 py-1 rounded-lg border text-xs font-mono font-bold ${cfg.bg}`}>
            ESI {esi}
          </span>
        </div>

        {/* Vitals row */}
        {Object.keys(vitals).length > 0 && (
          <div className="flex gap-3 mb-3 flex-wrap">
            {vitals.heartRate && (
              <div className="text-center">
                <div className="text-emergency font-mono font-bold text-sm">{vitals.heartRate}</div>
                <div className="text-white/30 text-xs">HR</div>
              </div>
            )}
            {vitals.spO2 && (
              <div className="text-center">
                <div className="text-cyber font-mono font-bold text-sm">{vitals.spO2}%</div>
                <div className="text-white/30 text-xs">SpO₂</div>
              </div>
            )}
            {vitals.respiratoryRate && (
              <div className="text-center">
                <div className="text-purple-400 font-mono font-bold text-sm">{vitals.respiratoryRate}</div>
                <div className="text-white/30 text-xs">RR</div>
              </div>
            )}
            {vitals.bloodPressureSystolic && (
              <div className="text-center">
                <div className="text-orange-400 font-mono font-bold text-sm">
                  {vitals.bloodPressureSystolic}/{vitals.bloodPressureDiastolic}
                </div>
                <div className="text-white/30 text-xs">BP</div>
              </div>
            )}
          </div>
        )}

        {/* AI summary */}
        {incident.triageData?.aiSummary && (
          <div className="text-xs text-white/50 mb-3 leading-relaxed">
            🤖 {incident.triageData.aiSummary}
          </div>
        )}

        {/* ETA */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-white/40">
            <span>🚑</span>
            <span>
              {incident.route?.etaMinutes
                ? `ETA ${incident.route.etaMinutes} min`
                : 'En route'}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onExpand(incident)}
              className="px-3 py-1.5 rounded-lg border border-surface-border text-white/60 text-xs hover:text-white hover:border-white/30 transition-all"
            >
              Details
            </button>
            {!['ARRIVED_AT_HOSPITAL', 'COMPLETED'].includes(incident.status) && (
              <button
                onClick={() => onAccept(incident)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{ background: `${cfg.color}20`, border: `1px solid ${cfg.color}50`, color: cfg.color }}
              >
                Pre-Accept ✓
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function ResourcePanel({ hospital, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [res, setRes] = useState(hospital?.resources || {})

  const save = async () => {
    try {
      await api.patch(`/hospitals/${hospital._id}/resources`, { resources: res })
      onUpdate(res)
      setEditing(false)
      toast.success('Resources updated')
    } catch { toast.error('Failed to update') }
  }

  const r = res

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-white/50 text-xs font-mono uppercase">Live Resources</div>
        <button onClick={() => editing ? save() : setEditing(true)} className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${editing ? 'border-cyber text-cyber bg-cyber/10' : 'border-surface-border text-white/50 hover:border-white/30'}`}>
          {editing ? 'Save ✓' : 'Edit'}
        </button>
      </div>

      {[
        { label: 'ICU Beds', key: 'icuBeds', icon: '🛏️', color: '#FF2D4A' },
        { label: 'Trauma Beds', key: 'traumaBeds', icon: '🩹', color: '#FF8C00' },
        { label: 'General Beds', key: 'generalBeds', icon: '🛌', color: '#00C851' },
        { label: 'Ventilators', key: 'ventilators', icon: '💨', color: '#00F5FF' },
      ].map(({ label, key, icon, color }) => {
        const available = r[key]?.available ?? 0
        const total = r[key]?.total ?? 0
        const pct = total > 0 ? (available / total) * 100 : 0
        return (
          <div key={key} className="glass-card p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span>{icon}</span>
                <span className="text-white/70 text-xs">{label}</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-xs">
                {editing ? (
                  <>
                    <input type="number" value={r[key]?.available ?? 0} onChange={(e) => setRes((prev) => ({ ...prev, [key]: { ...prev[key], available: parseInt(e.target.value) || 0 } }))} className="w-12 bg-surface-elevated border border-surface-border rounded px-1 text-center text-white" />
                    <span className="text-white/30">/{r[key]?.total ?? 0}</span>
                  </>
                ) : (
                  <span style={{ color }} className="font-bold">{available}/{total}</span>
                )}
              </div>
            </div>
            <div className="h-1.5 bg-surface-elevated rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: pct > 50 ? '#00C851' : pct > 20 ? '#FFD700' : '#FF2D4A' }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function HospitalPortal() {
  const { user, logout } = useAuthStore()
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const [tab, setTab] = useState('feed') // 'feed' | 'map' | 'resources'
  const [incidents, setIncidents] = useState([])
  const [hospital, setHospital] = useState(null)
  const [expandedIncident, setExpandedIncident] = useState(null)
  const [erWaitTime, setErWaitTime] = useState(0)
  const [diversionStatus, setDiversionStatus] = useState(false)
  const ambulanceMarkersRef = useRef({})

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [incRes, hospRes] = await Promise.all([
          api.get('/incidents'),
          user?.hospitalId ? api.get(`/hospitals/${user.hospitalId}`) : null,
        ])
        setIncidents(incRes.data.incidents || [])
        if (hospRes) {
          setHospital(hospRes.data.hospital)
          setErWaitTime(hospRes.data.hospital.queueStatus?.erWaitTimeMinutes || 0)
          setDiversionStatus(hospRes.data.hospital.queueStatus?.diversionStatus || false)
        }
      } catch {}
    }
    fetchData()
  }, [])

  // Map init
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return
    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [72.8777, 19.076],
      zoom: 12,
      pitch: 45,
    })
    map.on('load', () => {
      map.addLayer({ id: '3d-buildings', source: 'composite', 'source-layer': 'building', filter: ['==', 'extrude', 'true'], type: 'fill-extrusion', minzoom: 12, paint: { 'fill-extrusion-color': '#0f0f1a', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.8 } })
    })
    mapInstanceRef.current = map
    return () => { map.remove(); mapInstanceRef.current = null }
  }, [])

  // Socket.io
  useEffect(() => {
    const socket = getSocket()

    socket.on('new_incident', (incident) => {
      if (incident.allocatedHospital?.toString() === user?.hospitalId?.toString()) {
        setIncidents((prev) => [incident, ...prev])
        toast('🆕 New patient incoming!', { icon: '🏥', duration: 5000 })
      }
    })

    socket.on('ambulance_location', ({ ambulanceId, coordinates }) => {
      if (mapInstanceRef.current) {
        if (ambulanceMarkersRef.current[ambulanceId]) {
          ambulanceMarkersRef.current[ambulanceId].setLngLat(coordinates)
        } else {
          const el = document.createElement('div')
          el.style.cssText = 'width:28px;height:28px;background:#00F5FF;border-radius:50%;border:3px solid white;box-shadow:0 0 20px rgba(0,245,255,0.8);display:flex;align-items:center;justify-content:center;font-size:14px'
          el.textContent = '🚑'
          ambulanceMarkersRef.current[ambulanceId] = new mapboxgl.Marker(el)
            .setLngLat(coordinates)
            .addTo(mapInstanceRef.current)
        }
      }
    })

    socket.on('vitals_update', ({ incidentId, vitals }) => {
      setIncidents((prev) => prev.map((i) =>
        i._id === incidentId ? { ...i, triageData: { ...i.triageData, vitals } } : i
      ))
    })

    socket.on('incident_status', ({ incidentId, status }) => {
      setIncidents((prev) => prev.map((i) => i._id === incidentId ? { ...i, status } : i))
    })

    return () => {
      socket.off('new_incident')
      socket.off('ambulance_location')
      socket.off('vitals_update')
      socket.off('incident_status')
    }
  }, [])

  const preAcceptPatient = async (incident) => {
    try {
      await api.patch(`/incidents/${incident._id}/status`, { status: 'ARRIVED_AT_HOSPITAL' })
      setIncidents((prev) => prev.map((i) => i._id === incident._id ? { ...i, status: 'ARRIVED_AT_HOSPITAL' } : i))
      toast.success(`Bed pre-reserved for ${incident.patientDetails?.name || 'patient'}`)
    } catch { toast.error('Failed to pre-accept') }
  }

  const toggleDiversion = async () => {
    if (!hospital) return
    const newStatus = !diversionStatus
    try {
      await api.patch(`/hospitals/${hospital._id}/diversion`, { diversionStatus: newStatus })
      setDiversionStatus(newStatus)
      toast(newStatus ? '⚠️ Diversion ON — Hospital at capacity' : '✅ Diversion OFF — Accepting patients', { duration: 4000 })
    } catch { toast.error('Failed to update diversion') }
  }

  const activeIncidents = incidents.filter((i) => !['COMPLETED', 'CANCELLED'].includes(i.status))

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col">
      {/* Header */}
      <header className="px-4 py-3 border-b border-surface-border flex items-center justify-between bg-[#0a0a0f]/95 backdrop-blur-xl sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-pulse/20 border border-pulse/40 rounded-lg flex items-center justify-center">
            <span className="text-lg">🏥</span>
          </div>
          <div>
            <div className="font-display font-bold text-white text-sm">{hospital?.name || 'Hospital ER'}</div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono px-2 py-0.5 rounded border ${diversionStatus ? 'text-red-400 border-red-500/50 bg-red-500/10' : 'text-green-400 border-green-500/50 bg-green-500/10'}`}>
                {diversionStatus ? '🚫 DIVERSION' : '✅ OPEN'}
              </span>
              <span className="text-white/30 text-xs">ER Wait: {erWaitTime}min</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleDiversion} className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${diversionStatus ? 'border-green-500/40 text-green-400 hover:bg-green-500/10' : 'border-red-500/40 text-red-400 hover:bg-red-500/10'}`}>
            {diversionStatus ? 'Open' : 'Divert'}
          </button>
          <button onClick={logout} className="btn-ghost text-xs px-3 py-1.5">Out</button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-surface-border">
        {[['feed', '📋', `Feed (${activeIncidents.length})`], ['map', '🗺️', 'Live Map'], ['resources', '📊', 'Resources']].map(([key, icon, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 py-3 transition-all duration-200 flex flex-col items-center gap-0.5 ${tab === key ? 'text-pulse border-b-2 border-pulse' : 'text-white/40 hover:text-white/70'}`}>
            <span className="text-lg">{icon}</span>
            <span className="text-xs font-mono">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Feed Tab */}
        {tab === 'feed' && (
          <div className="p-4 space-y-3">
            {activeIncidents.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-6xl mb-4">🏥</div>
                <div className="text-white/60 font-display text-lg">ER Clear</div>
                <div className="text-white/30 text-sm">Monitoring for incoming patients</div>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <span className="pulse-dot text-pulse" />
                  <span className="text-purple-400 text-sm ml-1">Receiving Live Feed</span>
                </div>
              </div>
            ) : (
              <AnimatePresence>
                {activeIncidents.map((incident) => (
                  <PatientCard
                    key={incident._id}
                    incident={incident}
                    onAccept={preAcceptPatient}
                    onExpand={setExpandedIncident}
                  />
                ))}
              </AnimatePresence>
            )}
          </div>
        )}

        {/* Map Tab */}
        {tab === 'map' && (
          <div className="h-[calc(100vh-140px)]">
            <div ref={mapRef} className="h-full" />
          </div>
        )}

        {/* Resources Tab */}
        {tab === 'resources' && (
          <div className="p-4 space-y-4">
            {hospital ? (
              <>
                <ResourcePanel hospital={hospital} onUpdate={(res) => setHospital((h) => ({ ...h, resources: res }))} />
                {/* Duty doctors */}
                <div className="glass-card p-4">
                  <div className="text-white/50 text-xs font-mono uppercase mb-3">Duty Physicians</div>
                  {(hospital.resources?.dutyDoctors || []).length === 0 ? (
                    <div className="text-white/30 text-sm">No duty physicians configured</div>
                  ) : (
                    hospital.resources.dutyDoctors.map((doc, i) => (
                      <div key={i} className="flex items-center justify-between py-2 border-b border-surface-border last:border-0">
                        <div>
                          <div className="text-white text-sm">{doc.name || doc.specialty}</div>
                          <div className="text-white/40 text-xs">{doc.specialty}</div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full border ${doc.onDuty ? 'border-green-500/40 text-green-400 bg-green-500/10' : 'border-surface-border text-white/30'}`}>
                          {doc.onDuty ? '✅ On Duty' : '❌ Off'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-16 text-white/40">
                <div className="text-4xl mb-2">🏥</div>
                <div>No hospital profile linked to your account</div>
                <div className="text-xs mt-1">Contact admin to link hospital</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expanded incident modal */}
      <AnimatePresence>
        {expandedIncident && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="w-full max-w-lg glass-card rounded-t-3xl p-6 pb-8 max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs text-white/40 font-mono">{expandedIncident.incidentNumber}</div>
                  <div className="text-white font-display font-bold text-xl">{expandedIncident.patientDetails?.name}</div>
                </div>
                <button onClick={() => setExpandedIncident(null)} className="text-white/40 hover:text-white text-2xl">×</button>
              </div>

              <div className="space-y-3">
                <div className="glass-card p-3">
                  <div className="text-white/40 text-xs mb-1">Chief Complaint</div>
                  <div className="text-white">{expandedIncident.triageData?.chiefComplaint}</div>
                </div>
                <div className="glass-card p-3">
                  <div className="text-white/40 text-xs mb-1">AI Triage Summary</div>
                  <div className="text-white/80 text-sm">{expandedIncident.triageData?.aiSummary || 'Pending'}</div>
                </div>
                {expandedIncident.triageData?.requiredSpecialties?.length > 0 && (
                  <div className="glass-card p-3">
                    <div className="text-white/40 text-xs mb-2">Required Specialties</div>
                    <div className="flex flex-wrap gap-2">
                      {expandedIncident.triageData.requiredSpecialties.map((s) => (
                        <span key={s} className="px-2 py-1 rounded bg-pulse/20 border border-pulse/40 text-purple-400 text-xs">{s}</span>
                      ))}
                    </div>
                  </div>
                )}
                {expandedIncident.patientDetails?.allergies?.length > 0 && (
                  <div className="glass-card p-3 border border-emergency/30">
                    <div className="text-emergency text-xs mb-1 font-semibold">⚠️ Allergies</div>
                    <div className="text-white/80 text-sm">{expandedIncident.patientDetails.allergies.join(', ')}</div>
                  </div>
                )}
              </div>

              <button onClick={() => { preAcceptPatient(expandedIncident); setExpandedIncident(null) }} className="btn-emergency w-full justify-center mt-4">
                ✅ Pre-Accept & Reserve Bed
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
