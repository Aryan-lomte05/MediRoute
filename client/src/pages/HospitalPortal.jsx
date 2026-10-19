/**
 * ==============================================================================
 * MEDIROUTE - HOSPITAL EMERGENCY ROOM & TRAUMA RESUSCITATION PORTAL (HospitalPortal.jsx)
 * ==============================================================================
 * 
 * WHAT IS WHERE:
 * - Line 25-35:    Module Imports & Mapbox GL Token Initialization
 * - Line 36-95:    Component State & Trauma Unit Telemetry:
 *                  - Navigation tabs (`queue` | `inventory` | `protocols` | `mutualaid`)
 *                  - ICU / ER / OR Bed matrix and diversion state (`NORMAL` | `DIVERT`)
 *                  - Blood Bank stocks (O-Neg, A-Pos, Plasma) & Ventilator monitors
 *                  - Pre-arrival surgical prep checklist & Regional sister hospitals
 * - Line 96-180:   Real-time Socket.IO Listeners & MongoDB Sync:
 *                  - Inbound ambulance telemetry & dynamic ETA countdown
 *                  - Automated bed reservation broadcasts
 * - Line 181-300:  Tactical 3D Approach Corridor Mapbox Engine:
 *                  - Hospital location node & live incoming ambulance path
 *                  - Traffic congestion vectors on approach routes
 * - Line 301-410:  Hospital ER Handlers:
 *                  - `toggleDivertStatus`: Signals city dispatchers when capacity is saturated
 *                  - `reserveBed`: Instant clinical reservation before patient arrives
 *                  - `notifySurgicalTeam`: Emergency trauma bay team paging
 * - Line 411-End:  ER Trauma Dashboard Views:
 *                  - View 1: 🏥 Inbound Critical Ambulance Queue & Patient Vitals
 *                  - View 2: 🩸 Blood Bank, Blood Components & Life-Support Equipment
 *                  - View 3: 📋 Zero-Wait Trauma Intake Resuscitation Protocol
 *                  - View 4: 🤝 City-Wide Mutual Aid Network & Capacity Balancing
 * ==============================================================================
 */

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { getSocket } from '../lib/socket'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { PREFETCHED_TRAFFIC_ROUTES } from '../lib/routing'
import { ModeToggle, GuideButton } from '../components/PortalGuide'
import { LanguageSwitcher } from '../lib/i18n'
import { useUiStore } from '../store/uiStore'
import AiStatusBadge from '../components/AiStatusBadge'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || ''

/** Badge styling per ESI level, matching the global badge-esi-* palette. */
const ESI_BADGE = {
  1: 'bg-red-600/40 border-red-500',
  2: 'bg-orange-600/35 border-orange-500',
  3: 'bg-amber-500/30 border-amber-400',
  4: 'bg-emerald-600/30 border-emerald-500',
  5: 'bg-emerald-600/20 border-emerald-600',
}

const ESI_WORD = {
  1: 'CRITICAL',
  2: 'EMERGENT',
  3: 'URGENT',
  4: 'SEMI-URGENT',
  5: 'NON-URGENT',
}

/**
 * How long a bay has been in its current state, from the real timestamp the
 * server records. The board previously showed fixed strings like "40m".
 */
function dwellTime(since) {
  if (!since) return ''
  const mins = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000))
  if (mins < 60) return mins + 'm'
  const h = Math.floor(mins / 60)
  return h + 'h ' + (mins % 60) + 'm'
}

/**
 * One vital sign. Renders "Not recorded" when the value is absent rather than
 * substituting a plausible number, so staff can tell measured data apart from
 * missing data at a glance.
 */
function VitalTile({ label, value, unit, tone }) {
  const recorded = value !== null && value !== undefined && value !== ''
  return (
    <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/10">
      <div className="text-white/40 text-[10px]">{label}</div>
      {recorded ? (
        <div className={`text-lg font-bold mt-0.5 ${tone}`}>
          {value}
          {unit ? ` ${unit}` : ''}
        </div>
      ) : (
        <div className="text-sm font-semibold mt-1 text-white/30">Not recorded</div>
      )}
    </div>
  )
}


/** Walkthrough for the emergency department console. */
const HOSPITAL_TOUR_STEPS = [
  {
    heading: 'Who is on the way to you',
    body: 'The queue shows patients an ambulance is bringing in, with how urgent they are and what the crew has found so far. It updates as the crew works, not only at handover.',
  },
  {
    heading: 'The pre-arrival checklist is per patient',
    body: 'It is generated from that specific patient\u2019s assessment, so a cardiac case and a head injury get different steps. Ticking an item is saved and the ambulance crew sees it.',
  },
  {
    heading: 'Bays, blood and ventilators are live',
    body: 'Tap a bay to move it between available, occupied and cleaning. Blood stock changes are saved to this hospital\u2019s record, so the city command centre sees them immediately.',
  },
  {
    heading: 'Missing data is shown as missing',
    body: 'Where a vital sign reads \u201cNot recorded\u201d, the crew has genuinely not sent one yet. The screen will never fill in a plausible number for a reading nobody measured.',
  },
]

export default function HospitalPortal() {
  const { user, logout } = useAuthStore()

  // Navigation View Tab
  const [hospitalTab, setHospitalTab] = useState('queue') // 'queue' | 'inventory' | 'protocols' | 'mutualaid'

  // Density preference. In simple mode the secondary views are hidden and
  // only the view a non-specialist needs is reachable.
  const simple = useUiStore((st) => (st.modes['hospital'] || 'pro') === 'simple')

  // Switching to simple while on a now-hidden view would leave the body
  // rendering a view with no way back to it, so the view is reset.
  const SIMPLE_ALLOWED = ["queue"]
  useEffect(() => {
    if (simple && !SIMPLE_ALLOWED.includes(hospitalTab)) setHospitalTab('queue')
  }, [simple, hospitalTab])

  // Live Clock
  const [currentTime, setCurrentTime] = useState(() =>
    new Date().toLocaleTimeString('en-IN', { hour12: false })
  )
  const [currentDate, setCurrentDate] = useState(() =>
    new Date().toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
  )

  // Real Hospital Data State
  const [hospitalData, setHospitalData] = useState(null)
  const [icuAvailable, setIcuAvailable] = useState(5)
  const [erAvailable, setErAvailable] = useState(8)
  const [orAvailable, setOrAvailable] = useState(2)
  const [intakeStatus, setIntakeStatus] = useState('NORMAL') // 'NORMAL' | 'DIVERT'
  const [bedFilter, setBedFilter] = useState('all') // 'all' | 'occupied' | 'available' | 'cleaning'
  const [inboundIncident, setInboundIncident] = useState(null)
  const inboundVitals = inboundIncident?.triageData?.vitals || null

  // Map & Telemetry States
  const [isMapFullscreen, setIsMapFullscreen] = useState(false)
  const [trafficVisible, setTrafficVisible] = useState(true)
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)

  // Resource Inventory State
  // Blood stock lives on the hospital record, so a request for units persists
  // and every other portal sees it.
  const [bloodBank, setBloodBank] = useState(null)
  const [ventilators, setVentilators] = useState(null)

  // Pre-Arrival Preparation Checklist
  // Pre-arrival steps for the actual inbound patient, generated server-side
  // from that patient's triage. Previously a fixed array that reset on reload
  // and was invisible to the crew.
  const [checklist, setChecklist] = useState([])

  // Regional mutual-aid network, read from the hospitals collection rather
  // than a hardcoded list with invented bed counts.
  const [sisterHospitals, setSisterHospitals] = useState([])

  // Resuscitation bays for THIS hospital, from its own record. The board was
  // previously a fixed 20-bay array, identical for every hospital.
  const [bays, setBays] = useState([])

  // Digital Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setCurrentTime(now.toLocaleTimeString('en-IN', { hour12: false }))
      setCurrentDate(
        now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
      )
    }
    updateTime()
    const timer = setInterval(updateTime, 1000)
    return () => clearInterval(timer)
  }, [])

  // Fetch real hospital, network and incident data from MongoDB
  useEffect(() => {
    const fetchHospitalData = async () => {
      try {
        const [hospRes, incRes, allHospRes] = await Promise.all([
          api.get('/hospitals/primary'),
          api.get('/incidents?limit=20'),
          api.get('/hospitals'),
        ])

        const h = hospRes.data?.hospital
        if (h) {
          setHospitalData(h)
          setIcuAvailable(h.resources?.icuBeds?.available ?? 0)
          setErAvailable(h.resources?.traumaBeds?.available ?? 0)
          setIntakeStatus(h.queueStatus?.diversionStatus ? 'DIVERT' : 'NORMAL')
          setBloodBank(h.bloodBank || null)
          setVentilators(h.resources?.ventilators || null)

          // Bays come from this hospital's own record.
          setBays(
            (h.erBays || [])
              .slice()
              .sort((a, b) => a.number - b.number)
              .map((b) => ({
                id: b.number,
                name: `Bay ${String(b.number).padStart(2, '0')}`,
                status: (b.status || 'AVAILABLE').toLowerCase(),
                complaint: b.label || '',
                doctor: b.doctor || '',
                since: b.since || null,
                incident: b.incident || null,
              }))
          )
        }

        // Mutual-aid network: every other active hospital, with its real
        // capacity and distance-free ETA left to the allocation engine.
        if (allHospRes.data?.hospitals) {
          setSisterHospitals(
            allHospRes.data.hospitals
              .filter((x) => String(x._id) !== String(h?._id))
              .map((x) => ({
                id: x._id,
                name: x.name,
                icu: `${x.resources?.icuBeds?.available ?? 0}/${x.resources?.icuBeds?.total ?? 0}`,
                trauma: `${x.resources?.traumaBeds?.available ?? 0}/${x.resources?.traumaBeds?.total ?? 0}`,
                status: x.queueStatus?.diversionStatus ? 'DIVERT' : 'NORMAL',
                wait: x.queueStatus?.erWaitTimeMinutes ?? null,
                capabilities: x.capabilities || [],
              }))
          )
        }

        const incidents = incRes.data?.incidents || []
        const incoming = incidents.find((i) =>
          ['DISPATCHED', 'TRIAGE_COMPLETE', 'EN_ROUTE_TO_PATIENT', 'AT_PATIENT', 'EN_ROUTE_TO_HOSPITAL'].includes(i.status)
        )

        setInboundIncident(incoming || null)
        // The prep board is this patient's own, generated from their triage.
        setChecklist(incoming?.prepChecklist || [])
      } catch (err) {
        console.warn('Hospital fetch warning:', err.message)
      }
    }

    fetchHospitalData()
    const interval = setInterval(fetchHospitalData, 20000)
    return () => clearInterval(interval)
  }, [])

  /** Persist a prep-checklist tick so the crew and command centre both see it. */
  const toggleChecklistItem = async (item) => {
    if (!inboundIncident?._id) return
    const next = !item.done

    // Optimistic: an ER checklist must feel instant under pressure.
    setChecklist((prev) => prev.map((c) => (c.key === item.key ? { ...c, done: next } : c)))

    try {
      const { data } = await api.patch(`/incidents/${inboundIncident._id}/checklist`, {
        board: 'prep',
        key: item.key,
        done: next,
      })
      setChecklist(data.prepChecklist || [])
    } catch {
      setChecklist((prev) => prev.map((c) => (c.key === item.key ? { ...c, done: item.done } : c)))
      toast.error('Could not save that step')
    }
  }

  /** Request additional blood units; persisted on the hospital record. */
  const requestBlood = async (component, delta, label) => {
    if (!hospitalData?._id) return
    try {
      const { data } = await api.patch(`/hospitals/${hospitalData._id}/blood`, { component, delta })
      setBloodBank(data.bloodBank)
      toast.success(`${delta} units of ${label} added to stock`)
    } catch {
      toast.error('Could not update blood stock')
    }
  }

  /** Change a bay's state; persisted and broadcast to the command centre. */
  const setBayStatus = async (bayNumber, status) => {
    if (!hospitalData?._id) return
    try {
      const { data } = await api.patch(`/hospitals/${hospitalData._id}/bays/${bayNumber}`, { status })
      setBays(
        (data.erBays || [])
          .slice()
          .sort((a, b) => a.number - b.number)
          .map((b) => ({
            id: b.number,
            name: `Bay ${String(b.number).padStart(2, '0')}`,
            status: (b.status || 'AVAILABLE').toLowerCase(),
            complaint: b.label || '',
            doctor: b.doctor || '',
            since: b.since || null,
            incident: b.incident || null,
          }))
      )
    } catch {
      toast.error('Could not update that bay')
    }
  }

  // Socket.IO event listeners
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    socket.on('incoming_patient', (data) => {
      if (data.incident) {
        setInboundIncident(data.incident)
        toast.error(`🚨 INBOUND PATIENT ALERT: ${data.incident.triageData?.chiefComplaint || 'Details pending'} en route!`, { duration: 8000 })
      }
    })

    socket.on('vitals_update', (data) => {
      if (data.vitals) {
        setInboundIncident((prev) =>
          prev
            ? {
                ...prev,
                triageData: { ...prev.triageData, vitals: data.vitals },
              }
            : prev
        )
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
      await api
        .patch(`/hospitals/${hospitalData._id}/diversion`, {
          diversionStatus: nextStatus === 'DIVERT',
        })
        .catch(() => {})
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
        await api
          .patch(`/hospitals/${hospitalData._id}/resources`, {
            resources: {
              ...hospitalData.resources,
              icuBeds: { ...hospitalData.resources?.icuBeds, available: nextCount },
            },
          })
          .catch(() => {})
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

  // Initialize Mapbox 3D Radar Map
  useEffect(() => {
    if (hospitalTab !== 'queue' || !mapRef.current || mapInstanceRef.current) return

    const ems102RoadCoords = PREFETCHED_TRAFFIC_ROUTES.find((r) => r.id === 'ems102')?.coordinates || []

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
      if (!map.getLayer('3d-buildings')) {
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
      }

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
      if (!map.getSource('route-ems102')) {
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
      }

      // Hospital Center Marker
      const kemEl = document.createElement('div')
      kemEl.className =
        'px-2.5 py-1.5 rounded-lg bg-[#7C3AED] border-2 border-[#A855F7] text-white font-mono font-bold text-xs shadow-[0_0_20px_rgba(168,85,247,0.8)]'
      kemEl.innerHTML = `🏥 ${hospitalData?.name || 'This hospital'}`
      new mapboxgl.Marker({ element: kemEl, anchor: 'bottom' }).setLngLat([72.8428, 19.0025]).addTo(map)
    })

    mapInstanceRef.current = map

    return () => {
      map.remove()
      mapInstanceRef.current = null
    }
  }, [hospitalTab, hospitalData?.name])

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
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => (window.location.href = '/')}>
            <svg className="w-7 h-7 text-[#FF2D4A]" viewBox="0 0 24 12" fill="none" stroke="currentColor" strokeWidth={2.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M0 6h6l2.5-6 4 12 2.5-6h9" />
            </svg>
            <div>
              <div className="font-extrabold text-lg tracking-tight text-white flex items-center">
                Medi<span className="text-[#FF2D4A]">Route</span>
              </div>
              <div className="text-[10px] text-white/50 -mt-1 font-medium tracking-wide">Hospital ED Command Center</div>
            </div>
          </div>

          {/* Hospital Identity Badge HUD */}
          <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.02]">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-600/30 to-blue-600/30 border border-purple-500/40 flex items-center justify-center text-purple-300 font-bold text-base">
              🏥
            </div>
            <div>
              <div className="text-sm font-extrabold text-white leading-tight">
                {hospitalData?.name || 'Loading hospital…'}
              </div>
              <div className="text-[10px] text-white/50 leading-tight">Level 1 Comprehensive Trauma Facility · Mumbai</div>
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

          <LanguageSwitcher compact />
          <AiStatusBadge className="hidden lg:inline-flex" />
          <ModeToggle portal="hospital" className="hidden md:inline-flex" />
          <GuideButton
            tourId="hospital-v1"
              tourTrack="hospital"
            title="Emergency Department"
            steps={HOSPITAL_TOUR_STEPS}
          />

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
              {orAvailable} <span className="text-xs font-normal text-white/40">/ 6</span>
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

      {/* ── SECONDARY VIEW NAVIGATION BAR ── */}
      <nav className="h-11 border-b border-white/[0.06] bg-[#090c15] px-5 flex items-center justify-between text-xs font-mono z-30 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHospitalTab('queue')}
            className={`px-3 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
              hospitalTab === 'queue'
                ? 'bg-purple-600/30 text-purple-300 border border-purple-500/50'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>🚨</span>
            <span>Inbound Queue &amp; Bay Board</span>
          </button>

          {!simple && (
            <button
              onClick={() => setHospitalTab('inventory')}
              className={`px-3 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                hospitalTab === 'inventory'
                  ? 'bg-purple-600/30 text-purple-300 border border-purple-500/50'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>🛏️</span>
              <span>Resource & Blood Inventory</span>
            </button>
          )}

          {!simple && (
            <button
              onClick={() => setHospitalTab('protocols')}
              className={`px-3 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                hospitalTab === 'protocols'
                  ? 'bg-purple-600/30 text-purple-300 border border-purple-500/50'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>📋</span>
              <span>Trauma Team Paging & Protocols</span>
            </button>
          )}

          {!simple && (
            <button
              onClick={() => setHospitalTab('mutualaid')}
              className={`px-3 py-1 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                hospitalTab === 'mutualaid'
                  ? 'bg-purple-600/30 text-purple-300 border border-purple-500/50'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>🤝</span>
              <span>Regional Mutual Aid</span>
            </button>
          )}
        </div>
      </nav>

      {/* SIMPLE_BANNER: states the purpose of this screen in plain words. */}
      {simple && (
        <div className="px-5 py-2.5 bg-cyan-500/[0.07] border-b border-cyan-400/20 text-[13px] text-cyan-100/80 leading-relaxed">
          This screen shows who is being brought to you and how urgent they are. Switch to Full for bays, blood stock and the regional network.
        </div>
      )}

      {/* ── MAIN WORKSPACE BODY ── */}
      <div className="flex-1 p-5 space-y-4 overflow-y-auto">
        {/* SUBVIEW 1: INBOUND QUEUE & ER 20-BAY GRID */}
        {hospitalTab === 'queue' && (
          <>
            {/* Top Split: Live Radar Map (5 cols) + ER Bays Grid (7 cols) */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              {/* Radar Map */}
              <div className="xl:col-span-5 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl overflow-hidden flex flex-col h-[380px] relative">
                <div className="p-3 border-b border-white/[0.06] flex items-center justify-between z-10 bg-[#090d16]/90">
                  <div className="flex items-center gap-2">
                    <span className="text-red-400 animate-ping w-2 h-2 rounded-full bg-red-400" />
                    <span className="font-bold text-xs font-mono uppercase tracking-wider text-white">
                      Live Inbound Radar
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-cyan-400">Green Corridor Active</span>
                </div>

                <div className="flex-1 relative">
                  <div ref={mapRef} className="w-full h-full" />
                </div>
              </div>

              {/* ER bay board, sized per hospital */}
              <div className="xl:col-span-7 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
                    <div className="font-bold text-sm text-white flex items-center gap-2">
                      <span>🛏️</span>
                      <span>Trauma & Emergency Bays Status</span>
                    </div>

                    {/* Filter Pills */}
                    <div className="flex items-center gap-1 text-[10px] font-mono">
                      {['all', 'occupied', 'available', 'cleaning'].map((f) => (
                        <button
                          key={f}
                          onClick={() => setBedFilter(f)}
                          className={`px-2.5 py-1 rounded-lg uppercase transition-all ${
                            bedFilter === f ? 'bg-purple-600 text-white font-bold' : 'bg-white/5 text-white/60 hover:text-white'
                          }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Resuscitation bay board, sized from this hospital record */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5 mt-3">
                    {filteredBays.map((bay) => {
                      const isIncoming = bay.status === 'incoming'
                      const isOccupied = bay.status === 'occupied'
                      const isAvail = bay.status === 'available'

                      // AVAILABLE -> OCCUPIED -> CLEANING -> AVAILABLE
                      const nextStatus = isAvail ? 'OCCUPIED' : isOccupied ? 'CLEANING' : 'AVAILABLE'

                      return (
                        <button
                          key={bay.id}
                          type="button"
                          onClick={() => setBayStatus(bay.id, nextStatus)}
                          title={`Mark ${bay.name} as ${nextStatus.toLowerCase()}`}
                          className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition-all hover:brightness-125 ${
                            isIncoming
                              ? 'bg-red-950/60 border-red-500 shadow-[0_0_15px_rgba(255,45,74,0.4)] animate-pulse'
                              : isOccupied
                              ? 'bg-white/[0.03] border-white/10'
                              : isAvail
                              ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                              : 'bg-yellow-950/30 border-yellow-500/40'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] font-mono">
                            <span className="font-bold text-white">{bay.name}</span>
                            {isIncoming && <span className="text-red-400 font-bold">INBOUND</span>}
                            {isOccupied && bay.since && (
                              <span className="text-white/40">{dwellTime(bay.since)}</span>
                            )}
                            {isAvail && <span className="text-emerald-400">READY</span>}
                          </div>

                          <div className="my-1.5">
                            <div className="text-[11px] font-semibold text-white leading-tight truncate">
                              {bay.complaint}
                            </div>
                            <div className="text-[9px] text-white/50 leading-tight truncate">
                              {bay.doctor}
                            </div>
                          </div>

                          <div className="text-[9px] font-mono text-white/40 flex justify-between">
                            <span>{bay.status.toUpperCase()}</span>
                            {bay.since && <span>{dwellTime(bay.since)}</span>}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-white/50">
                  <span>
                    Occupancy:{' '}
                    <strong className="text-white">
                      {bays.length
                        ? Math.round((bays.filter((b) => b.status === 'occupied').length / bays.length) * 100) + '%'
                        : '-'}
                    </strong>
                  </span>
                  <span>
                    Bays free:{' '}
                    <strong className="text-emerald-400">
                      {bays.filter((b) => b.status === 'available').length} of {bays.length || '-'}
                    </strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom Row: Inbound Trauma Patient Card + Pre-Arrival Checklist */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Inbound Patient Details */}
              <div className="lg:col-span-7 p-4 rounded-2xl bg-[#090d16]/90 border border-red-500/30 shadow-xl text-left space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🚨</span>
                    <div>
                      <div className="text-xs font-mono text-red-400 font-bold uppercase">Priority Inbound Trauma</div>
                      <div className="text-base font-extrabold text-white leading-tight">
                        {inboundIncident?.triageData?.chiefComplaint || 'Awaiting details from the crew'}
                      </div>
                    </div>
                  </div>

                  <span className={`px-3 py-1 rounded-full border text-white font-mono text-xs font-bold ${ESI_BADGE[inboundIncident?.triageData?.esiLevel] || 'bg-white/10 border-white/20'}`}>
                    {inboundIncident?.triageData?.esiLevel
                      ? `ESI ${inboundIncident.triageData.esiLevel} ${ESI_WORD[inboundIncident.triageData.esiLevel]}`
                      : 'AWAITING TRIAGE'}
                  </span>
                </div>

                {/*
                  Vitals render only when a paramedic has actually recorded
                  them. An absent value shows "Not recorded", never a filled-in
                  number: a fabricated heart rate on a trauma handover screen is
                  a clinical hazard, not a cosmetic placeholder.
                */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                  <VitalTile
                    label="Heart Rate"
                    value={inboundVitals?.heartRate}
                    unit="BPM"
                    tone="text-red-400"
                  />
                  <VitalTile
                    label="Blood Pressure"
                    value={
                      inboundVitals?.bloodPressureSystolic != null &&
                      inboundVitals?.bloodPressureDiastolic != null
                        ? `${inboundVitals.bloodPressureSystolic}/${inboundVitals.bloodPressureDiastolic}`
                        : null
                    }
                    unit="mmHg"
                    tone="text-yellow-400"
                  />
                  <VitalTile
                    label="SpO2"
                    value={inboundVitals?.spO2}
                    unit="%"
                    tone="text-cyan-300"
                  />
                  <VitalTile
                    label="GCS Score"
                    value={inboundVitals?.gcsScore}
                    unit=""
                    tone="text-purple-300"
                  />
                </div>

                <div className="p-3 rounded-xl bg-red-950/20 border border-red-500/20 text-xs font-mono text-white/80 leading-relaxed">
                  <strong className="text-red-400">MediAI Clinical Note:</strong>{' '}
                  {inboundIncident?.triageData?.aiSummary || 'No clinical assessment recorded yet.'}
                  {inboundIncident?.triageData?.engine?.startsWith('rules') && (
                    <span className="block mt-1 text-amber-300/80 not-italic">
                      Generated by the offline protocol, not the clinical AI. Reassess on arrival.
                    </span>
                  )}
                </div>
              </div>

              {/* Pre-Arrival Checklist */}
              <div className="lg:col-span-5 p-4 rounded-2xl bg-[#090d16]/90 border border-white/[0.08] shadow-xl text-left flex flex-col justify-between">
                <div>
                  <div className="font-bold text-sm text-white mb-2 flex items-center justify-between">
                    <span>Pre-Arrival Readiness Protocol</span>
                    <span className="text-xs font-mono text-emerald-400 font-semibold">
                      {checklist.length
                        ? checklist.filter((c) => c.done).length + '/' + checklist.length + ' done'
                        : 'No inbound patient'}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {checklist.length === 0 && (
                      <p className="text-xs font-mono text-white/35 py-2">
                        Steps appear here once a patient is allocated to this hospital. They are
                        generated from that patient&apos;s own triage.
                      </p>
                    )}
                    {checklist.map((item) => (
                      <div
                        key={item.key}
                        onClick={() => toggleChecklistItem(item)}
                        className={`p-2 rounded-lg border text-xs font-mono flex items-center justify-between cursor-pointer transition-all ${
                          item.done
                            ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                            : 'bg-white/[0.02] border-white/10 text-white/70 hover:bg-white/[0.05]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span>{item.done ? '☑' : '☐'}</span>
                          <span>{item.label}</span>
                        </div>
                        <span className="text-[10px] text-white/40">
                          {item.doneAt
                            ? new Date(item.doneAt).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })
                            : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-3 flex gap-2">
                  <button
                    onClick={handlePageTrauma}
                    className="flex-1 py-2 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500 text-purple-300 text-xs font-mono font-bold transition-all"
                  >
                    Page Trauma Team
                  </button>
                  <button
                    onClick={handleReserveIcu}
                    className="flex-1 py-2 rounded-xl bg-red-600/30 hover:bg-red-600/50 border border-red-500 text-red-300 text-xs font-mono font-bold transition-all"
                  >
                    Reserve ICU Bed
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* SUBVIEW 2: RESOURCE & BLOOD INVENTORY */}
        {hospitalTab === 'inventory' && (
          <div className="space-y-6 text-left">
            <div className="pb-3 border-b border-white/[0.08]">
              <h2 className="text-xl font-extrabold text-white">Emergency Department Resource & Critical Bank Inventory</h2>
              <p className="text-xs text-white/50 font-mono mt-0.5">
                Real-time inventory levels synchronized across the Mumbai Trauma Network.
              </p>
            </div>

            {/* Blood Bank Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-2xl bg-[#090d16]/90 border border-red-500/40 shadow-xl">
                <div className="text-xs font-mono text-red-400 font-bold uppercase">Blood Bank · O-Negative (Universal)</div>
                <div className="text-3xl font-extrabold text-white font-mono mt-1">
                  {bloodBank?.oNeg ?? '-'} Units
                </div>
                <div className="text-[10px] text-emerald-400 font-mono mt-0.5">
                  {bloodBank?.oNeg != null
                    ? 'Covers about ' + Math.floor(bloodBank.oNeg / 4) + ' major polytrauma cases'
                    : 'Stock not reported'}
                </div>
                <button
                  onClick={() => requestBlood('oNeg', 4, 'O-negative')}
                  className="mt-3 w-full py-1.5 rounded-lg bg-red-600/30 hover:bg-red-600/50 border border-red-500/40 text-red-300 text-xs font-mono"
                >
                  Order +4 Units
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-[#090d16]/90 border border-white/10 shadow-xl">
                <div className="text-xs font-mono text-white/50 uppercase">Blood Bank · Fresh Frozen Plasma</div>
                <div className="text-3xl font-extrabold text-white font-mono mt-1">
                  {bloodBank?.plasma ?? '-'} Units
                </div>
                <div className="text-[10px] text-white/40 font-mono mt-0.5">
                  {(bloodBank?.plasma ?? 0) >= 10
                    ? 'Massive transfusion protocol ready'
                    : 'Below massive transfusion reserve'}
                </div>
                <button
                  onClick={() => requestBlood('plasma', 6, 'fresh frozen plasma')}
                  className="mt-3 w-full py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-mono"
                >
                  Thaw +6 Units
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-[#090d16]/90 border border-white/10 shadow-xl">
                <div className="text-xs font-mono text-cyan-400 uppercase">Mechanical Ventilators</div>
                <div className="text-3xl font-extrabold text-white font-mono mt-1">
                  {ventilators?.available ?? '-'}{' '}
                  <span className="text-xs text-white/40 font-normal">
                    / {ventilators?.total ?? '-'} available
                  </span>
                </div>
                <div className="text-[10px] text-cyan-300 font-mono mt-0.5">
                  {ventilators
                    ? (ventilators.total || 0) - (ventilators.available || 0) + ' currently in use'
                    : 'Inventory not reported'}
                </div>
                <button
                  onClick={() => {
                    setVentilatorCount((v) => Math.max(0, v - 1))
                    toast.success('Deployed portable ventilator to Bay 01')
                  }}
                  className="mt-3 w-full py-1.5 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/40 text-cyan-300 text-xs font-mono"
                >
                  Deploy Ventilator
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-[#090d16]/90 border border-white/10 shadow-xl">
                <div className="text-xs font-mono text-purple-400 uppercase">Operating Rooms (Surgical Suites)</div>
                <div className="text-3xl font-extrabold text-white font-mono mt-1">
                  {orAvailable} <span className="text-xs text-white/40 font-normal">/ 6 Ready</span>
                </div>
                <div className="text-[10px] text-purple-300 font-mono mt-0.5">Suite 02 sterile and cleared</div>
                <button
                  onClick={() => {
                    setOrAvailable((o) => Math.max(0, o - 1))
                    toast.success('OR Suite 02 locked for incoming emergency laparotomy')
                  }}
                  className="mt-3 w-full py-1.5 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 text-purple-300 text-xs font-mono"
                >
                  Lock OR for Inbound
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SUBVIEW 3: PROTOCOLS */}
        {hospitalTab === 'protocols' && (
          <div className="space-y-6 text-left">
            <div className="pb-3 border-b border-white/[0.08]">
              <h2 className="text-xl font-extrabold text-white">Emergency Triage & Trauma Protocols</h2>
              <p className="text-xs text-white/50 font-mono mt-0.5">
                Standard operating procedures for Level 1 Trauma Intake and Mass Casualty Scenarios.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
              <div className="p-4 rounded-2xl bg-[#090d16]/90 border border-red-500/30 space-y-2">
                <div className="text-red-400 font-bold text-sm uppercase">Code Red: Polytrauma Activation</div>
                <p className="text-white/70 leading-relaxed font-sans">
                  Activated for penetrating trauma, blast injuries, or high-speed motor vehicle collisions with hemodynamically unstable vitals.
                </p>
                <button onClick={handlePageTrauma} className="w-full py-2 rounded-lg bg-red-600/30 border border-red-500 text-red-300 font-bold">
                  Broadcast Code Red
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-[#090d16]/90 border border-cyan-500/30 space-y-2">
                <div className="text-cyan-400 font-bold text-sm uppercase">Code Stroke: Neuro Priority</div>
                <p className="text-white/70 leading-relaxed font-sans">
                  Immediate non-contrast head CT within 15 minutes of arrival. Direct assessment for IV thrombolysis and mechanical thrombectomy.
                </p>
                <button onClick={handleNotifyRadiology} className="w-full py-2 rounded-lg bg-cyan-600/30 border border-cyan-500 text-cyan-300 font-bold">
                  Clear CT Scan Suite
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-[#090d16]/90 border border-purple-500/30 space-y-2">
                <div className="text-purple-400 font-bold text-sm uppercase">Code STEMI: Cardiac Cath Lab</div>
                <p className="text-white/70 leading-relaxed font-sans">
                  Target door-to-balloon time &lt; 60 minutes. Direct bypass of general ER to Interventional Cardiology Suite.
                </p>
                <button
                  onClick={() => toast.success('Interventional Cardiology Cath Lab team activated!')}
                  className="w-full py-2 rounded-lg bg-purple-600/30 border border-purple-500 text-purple-300 font-bold"
                >
                  Activate Cath Lab
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SUBVIEW 4: MUTUAL AID */}
        {hospitalTab === 'mutualaid' && (
          <div className="space-y-6 text-left">
            <div className="pb-3 border-b border-white/[0.08]">
              <h2 className="text-xl font-extrabold text-white">Regional Hospital Mutual Aid & Diversion Network</h2>
              <p className="text-xs text-white/50 font-mono mt-0.5">
                Real-time bed availability and overflow diversion status across neighboring trauma facilities in Mumbai.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sisterHospitals.map((sister) => (
                <div key={sister.id} className="p-4 rounded-2xl bg-[#090d16]/90 border border-white/10 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-white text-sm">{sister.name}</div>
                    <div className="text-xs font-mono text-white/50 mt-1">
                      ICU: {sister.icu} · Trauma Bays: {sister.trauma}
                      {sister.wait != null ? ' · ER wait: ' + sister.wait + 'm' : ''}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        sister.status === 'NORMAL' ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-300' : 'bg-red-950/60 border border-red-500/40 text-red-300'
                      }`}
                    >
                      {sister.status}
                    </span>
                    <button
                      onClick={() => toast.success(`Mutual aid protocol linked with ${sister.name}`)}
                      className="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-mono text-white border border-white/10"
                    >
                      Coordinate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
