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

const STATUS_LABELS = {
  PENDING: 'Pending Dispatch',
  TRIAGE_COMPLETE: 'Triage Complete',
  DISPATCHING: 'Finding Ambulance',
  EN_ROUTE_TO_PATIENT: 'Ambulance En Route',
  AT_PATIENT: 'Paramedic On Scene',
  EN_ROUTE_TO_HOSPITAL: 'En Route to Hospital',
  ARRIVED_AT_HOSPITAL: 'At Hospital',
  COMPLETED: 'Completed',
}

function VoiceTriageModal({ onClose, onTriageResult }) {
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [processing, setProcessing] = useState(false)
  const recognitionRef = useRef(null)

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast.error('Speech recognition not supported in this browser. Use Chrome/Edge.')
      return
    }
    const rec = new SpeechRecognition()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = (event) => {
      const t = Array.from(event.results).map((r) => r[0].transcript).join(' ')
      setTranscript(t)
    }
    rec.onerror = (e) => { toast.error('Mic error: ' + e.error); setListening(false) }
    rec.onend = () => setListening(false)
    recognitionRef.current = rec
    rec.start()
    setListening(true)
  }

  const stopAndAnalyze = async () => {
    if (recognitionRef.current) recognitionRef.current.stop()
    setListening(false)
    if (!transcript.trim()) return toast.error('No speech detected')
    setProcessing(true)
    try {
      const { data } = await api.post('/ai/triage', { voiceTranscript: transcript, chiefComplaint: transcript })
      onTriageResult(data, transcript)
      onClose()
    } catch {
      toast.error('Triage analysis failed')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        className="glass-card p-8 max-w-md w-full mx-4"
      >
        <h3 className="font-display text-2xl font-bold text-white mb-2">AI Voice Triage</h3>
        <p className="text-white/50 text-sm mb-6">Describe your emergency. AI will classify severity.</p>

        <div className="relative mb-6">
          <div
            className={`w-24 h-24 mx-auto rounded-full border-4 flex items-center justify-center cursor-pointer transition-all duration-300 ${
              listening ? 'border-emergency glow-red animate-pulse' : 'border-surface-border hover:border-emergency/50'
            }`}
            onClick={listening ? stopAndAnalyze : startListening}
          >
            <span className="text-4xl">{listening ? '🎙️' : '🔇'}</span>
          </div>
          {listening && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-24 h-24 rounded-full border-4 border-emergency animate-ping opacity-30" />
            </div>
          )}
        </div>

        <div className="text-center mb-4 text-sm text-white/60">
          {listening ? 'Listening... tap to stop' : 'Tap mic to start speaking'}
        </div>

        {transcript && (
          <div className="bg-surface-elevated rounded-xl p-4 mb-4 border border-surface-border">
            <p className="text-xs text-white/40 uppercase mb-1 font-mono">Transcript</p>
            <p className="text-white/80 text-sm">{transcript}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-ghost flex-1 justify-center">Cancel</button>
          {transcript && !listening && (
            <button
              onClick={stopAndAnalyze}
              disabled={processing}
              className="btn-emergency flex-1 justify-center"
            >
              {processing ? 'Analyzing...' : 'Analyze →'}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

export default function PatientPortal() {
  const { user, logout } = useAuthStore()
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const ambulanceMarkerRef = useRef(null)
  const [activeIncident, setActiveIncident] = useState(null)
  const [showVoiceTriage, setShowVoiceTriage] = useState(false)
  const [location, setLocation] = useState(null)
  const [loading, setLoading] = useState(false)
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [triageResult, setTriageResult] = useState(null)
  const [tab, setTab] = useState('sos') // 'sos' | 'track' | 'profile'
  const [incidents, setIncidents] = useState([])

  // Get user location
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocation({ lat: 19.0760, lng: 72.8777 }) // Mumbai fallback
    )
  }, [])

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || !location || mapInstanceRef.current) return
    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [location.lng, location.lat],
      zoom: 13,
      pitch: 45,
      bearing: 0,
    })
    map.on('load', () => {
      map.addLayer({ id: '3d-buildings', source: 'composite', 'source-layer': 'building', filter: ['==', 'extrude', 'true'], type: 'fill-extrusion', minzoom: 13, paint: { 'fill-extrusion-color': '#0f0f1a', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': ['get', 'min_height'], 'fill-extrusion-opacity': 0.8 } })
      // Patient marker
      const el = document.createElement('div')
      el.style.cssText = 'width:20px;height:20px;background:#FF2D4A;border-radius:50%;border:3px solid white;box-shadow:0 0 15px rgba(255,45,74,0.8)'
      new mapboxgl.Marker(el).setLngLat([location.lng, location.lat]).setPopup(new mapboxgl.Popup().setText('Your Location')).addTo(map)
    })
    mapInstanceRef.current = map
    return () => { map.remove(); mapInstanceRef.current = null }
  }, [location])

  // Socket for live tracking
  useEffect(() => {
    if (!activeIncident) return
    const socket = getSocket()
    socket.emit('join_incident', activeIncident._id)

    socket.on('ambulance_location', ({ coordinates }) => {
      if (mapInstanceRef.current) {
        if (ambulanceMarkerRef.current) ambulanceMarkerRef.current.remove()
        const el = document.createElement('div')
        el.style.cssText = 'width:28px;height:28px;background:#00F5FF;border-radius:50%;border:3px solid white;box-shadow:0 0 20px rgba(0,245,255,0.8);display:flex;align-items:center;justify-content:center;font-size:14px'
        el.innerHTML = '🚑'
        ambulanceMarkerRef.current = new mapboxgl.Marker(el).setLngLat(coordinates).addTo(mapInstanceRef.current)
        mapInstanceRef.current.flyTo({ center: coordinates, zoom: 14 })
      }
    })

    socket.on('incident_status', ({ status }) => {
      setActiveIncident((prev) => prev ? { ...prev, status } : prev)
      toast.success(`Status: ${STATUS_LABELS[status] || status}`)
    })

    return () => {
      socket.off('ambulance_location')
      socket.off('incident_status')
      socket.emit('leave_incident', activeIncident._id)
    }
  }, [activeIncident?._id])

  const fetchIncidents = async () => {
    try {
      const { data } = await api.get('/incidents')
      setIncidents(data.incidents)
      const active = data.incidents.find((i) => !['COMPLETED', 'CANCELLED'].includes(i.status))
      if (active) setActiveIncident(active)
    } catch {}
  }

  useEffect(() => { fetchIncidents() }, [])

  const triggerSOS = async () => {
    if (!location) return toast.error('Location not available')
    setLoading(true)
    try {
      const { data } = await api.post('/incidents', {
        location: { coordinates: [location.lng, location.lat], address: 'Current Location' },
        chiefComplaint: chiefComplaint || 'Emergency SOS',
        vitals: null,
      })
      setActiveIncident(data.incident)
      setTab('track')
      toast.success('🚨 SOS sent! Finding nearest ambulance...')
      setIncidents((prev) => [data.incident, ...prev])
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send SOS')
    } finally {
      setLoading(false)
    }
  }

  const handleTriageResult = (result, transcript) => {
    setTriageResult(result)
    setChiefComplaint(transcript)
    toast.success(`ESI Level ${result.esiLevel} — ${ESI_CONFIG[result.esiLevel]?.label}`)
  }

  const esiCfg = triageResult ? ESI_CONFIG[triageResult.esiLevel] : null

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col">
      {/* Header */}
      <header className="px-4 py-3 border-b border-surface-border flex items-center justify-between sticky top-0 z-40 bg-[#0a0a0f]/95 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emergency rounded-lg flex items-center justify-center glow-red">
            <span className="text-white text-sm font-bold">M</span>
          </div>
          <div>
            <div className="font-display font-bold text-white text-sm">MediRoute</div>
            <div className="text-white/40 text-xs">Patient Portal</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right hidden sm:block">
            <div className="text-white text-sm font-medium">{user?.name}</div>
            <div className="text-white/40 text-xs">Patient</div>
          </div>
          <button onClick={logout} className="btn-ghost text-xs px-3 py-1.5">Sign Out</button>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-surface-border">
        {[['sos', '🆘', 'Emergency'], ['track', '📍', 'Track'], ['profile', '👤', 'Profile']].map(([key, icon, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-3 text-sm flex flex-col items-center gap-0.5 transition-all duration-200 ${
              tab === key ? 'text-emergency border-b-2 border-emergency' : 'text-white/40 hover:text-white/70'
            }`}
          >
            <span className="text-lg">{icon}</span>
            <span className="text-xs font-mono">{label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* SOS Tab */}
        {tab === 'sos' && (
          <div className="p-4 max-w-lg mx-auto">
            {/* Big SOS button */}
            <div className="text-center py-10">
              <motion.button
                onClick={triggerSOS}
                disabled={loading || !!activeIncident}
                whileTap={{ scale: 0.95 }}
                className="relative w-44 h-44 mx-auto rounded-full border-4 border-emergency flex flex-col items-center justify-center text-white transition-all duration-300 disabled:opacity-50"
                style={{ background: 'radial-gradient(circle, rgba(255,45,74,0.3) 0%, rgba(255,45,74,0.05) 70%)', boxShadow: '0 0 60px rgba(255,45,74,0.5), 0 0 120px rgba(255,45,74,0.2)' }}
              >
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute inset-0 rounded-full border-4 border-emergency opacity-30"
                />
                <motion.div
                  animate={{ scale: [1, 1.25, 1], opacity: [0.3, 0, 0.3] }}
                  transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
                  className="absolute inset-0 rounded-full border-2 border-emergency"
                />
                <span className="text-5xl mb-1">🆘</span>
                <span className="font-display font-bold text-2xl text-glow-red">SOS</span>
                {loading && <span className="text-xs text-white/60 mt-1">Sending...</span>}
              </motion.button>

              {activeIncident && (
                <div className="mt-4 text-white/50 text-sm">
                  Active incident — <button onClick={() => setTab('track')} className="text-cyber underline">Track →</button>
                </div>
              )}
            </div>

            {/* AI Voice Triage */}
            <div className="glass-card p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-white font-semibold text-sm">AI Voice Triage</div>
                  <div className="text-white/40 text-xs">Describe emergency by voice for instant ESI scoring</div>
                </div>
                <button onClick={() => setShowVoiceTriage(true)} className="btn-emergency text-sm px-4 py-2">
                  🎙️ Start
                </button>
              </div>

              {triageResult && esiCfg && (
                <div className={`p-3 rounded-xl border ${esiCfg.bg} mt-2`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs uppercase">ESI Level {triageResult.esiLevel}</span>
                    <span className="text-xs font-mono">{Math.round((triageResult.aiConfidence || 0) * 100)}% confidence</span>
                  </div>
                  <div className="font-semibold text-sm">{esiCfg.label}</div>
                  <div className="text-xs mt-1 opacity-80">{triageResult.aiSummary}</div>
                </div>
              )}
            </div>

            {/* Manual complaint input */}
            <div className="glass-card p-4">
              <label className="text-white/50 text-xs font-mono uppercase mb-2 block">Chief Complaint</label>
              <textarea
                className="input-dark resize-none h-20 text-sm"
                placeholder="Describe what's happening..."
                value={chiefComplaint}
                onChange={(e) => setChiefComplaint(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Track Tab */}
        {tab === 'track' && (
          <div className="flex flex-col h-[calc(100vh-140px)]">
            <div ref={mapRef} className="flex-1 min-h-64" />

            {activeIncident ? (
              <div className="p-4 border-t border-surface-border space-y-3 max-h-72 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-white/40 font-mono">{activeIncident.incidentNumber}</div>
                    <div className="text-white font-semibold">{STATUS_LABELS[activeIncident.status] || activeIncident.status}</div>
                  </div>
                  {activeIncident.triageData?.esiLevel && (
                    <span className={`px-3 py-1 rounded-full border text-xs font-mono ${ESI_CONFIG[activeIncident.triageData.esiLevel]?.bg}`}>
                      ESI {activeIncident.triageData.esiLevel}
                    </span>
                  )}
                </div>

                {activeIncident.assignedAmbulance && (
                  <div className="flex items-center gap-3 p-3 bg-cyber/10 border border-cyber/30 rounded-xl">
                    <span className="text-2xl">🚑</span>
                    <div>
                      <div className="text-cyber text-sm font-semibold">Ambulance Assigned</div>
                      <div className="text-white/60 text-xs">{activeIncident.assignedAmbulance.vehicleNumber || 'En Route'}</div>
                    </div>
                    <div className="ml-auto">
                      <span className="pulse-dot text-cyber" />
                    </div>
                  </div>
                )}

                {activeIncident.allocatedHospital && (
                  <div className="flex items-center gap-3 p-3 glass-card">
                    <span className="text-2xl">🏥</span>
                    <div>
                      <div className="text-white text-sm font-semibold">{activeIncident.allocatedHospital.name || 'Hospital Allocated'}</div>
                      <div className="text-white/40 text-xs">Destination confirmed</div>
                    </div>
                  </div>
                )}

                {/* Status timeline */}
                <div className="space-y-1">
                  {Object.entries(STATUS_LABELS).map(([key, label]) => {
                    const statuses = Object.keys(STATUS_LABELS)
                    const currentIdx = statuses.indexOf(activeIncident.status)
                    const thisIdx = statuses.indexOf(key)
                    const done = thisIdx <= currentIdx
                    return (
                      <div key={key} className={`flex items-center gap-2 text-xs py-0.5 ${done ? 'text-white/70' : 'text-white/20'}`}>
                        <span>{done ? '✅' : '⬜'}</span>
                        <span>{label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-white/40">
                <div className="text-4xl mb-2">📍</div>
                <div>No active incident</div>
                <button onClick={() => setTab('sos')} className="text-emergency text-sm mt-2 underline">Send SOS →</button>
              </div>
            )}
          </div>
        )}

        {/* Profile Tab */}
        {tab === 'profile' && (
          <div className="p-4 max-w-lg mx-auto space-y-4">
            <div className="glass-card p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-14 h-14 bg-emergency/20 border border-emergency/40 rounded-full flex items-center justify-center text-2xl">👤</div>
                <div>
                  <div className="text-white font-bold text-lg">{user?.name}</div>
                  <div className="text-white/40 text-sm">{user?.email}</div>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  ['Blood Type', user?.emergencyProfile?.bloodType || 'Not set'],
                  ['Allergies', (user?.emergencyProfile?.allergies || []).join(', ') || 'None'],
                  ['Conditions', (user?.emergencyProfile?.conditions || []).join(', ') || 'None'],
                  ['Emergency Contact', user?.emergencyProfile?.emergencyContact?.name || 'Not set'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between py-2 border-b border-surface-border">
                    <span className="text-white/50 text-sm">{label}</span>
                    <span className="text-white text-sm font-medium">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Past incidents */}
            <div className="glass-card p-4">
              <div className="text-white/50 text-xs font-mono uppercase mb-3">Recent Incidents</div>
              {incidents.length === 0 ? (
                <div className="text-white/30 text-sm text-center py-4">No incidents yet</div>
              ) : (
                incidents.slice(0, 5).map((inc) => (
                  <div key={inc._id} className="flex items-center justify-between py-2 border-b border-surface-border last:border-0">
                    <div>
                      <div className="text-white text-xs font-mono">{inc.incidentNumber}</div>
                      <div className="text-white/40 text-xs">{new Date(inc.createdAt).toLocaleDateString()}</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded border text-xs ${inc.status === 'COMPLETED' ? 'border-green-500/40 text-green-400 bg-green-500/10' : 'border-emergency/40 text-emergency bg-emergency/10'}`}>
                      {inc.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showVoiceTriage && (
          <VoiceTriageModal onClose={() => setShowVoiceTriage(false)} onTriageResult={handleTriageResult} />
        )}
      </AnimatePresence>
    </div>
  )
}
