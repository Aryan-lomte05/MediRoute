/**
 * ==============================================================================
 * MEDIROUTE - PUBLIC EMERGENCY REPORTING (SosPortal.jsx)  ROUTE: /sos
 * ==============================================================================
 *
 * WHAT IS WHERE:
 * - Line 60-120:   Question catalogues for both reporting branches
 * - Line 122-190:  Plain-language status vocabulary + helpers
 * - Line 192-260:  Geolocation acquisition with manual fallback
 * - Line 262-340:  Voice reporting via MediaRecorder -> Whisper
 * - Line 342-430:  Submit + live tracking poll
 * - Line 432-520:  Shared presentational pieces (BigChoice, StepDots, Banner)
 * - Line 522-640:  Step: choose branch
 * - Line 642-820:  Step: describe (branch-specific)
 * - Line 822-930:  Step: confirm location and send
 * - Line 932-1120: Step: active report, dispatch state and first aid
 *
 * DESIGN INTENT (from review feedback that the app overwhelmed civilians):
 * - No account, ever. A login wall in front of an emergency is unacceptable.
 * - One question per screen, large touch targets, plain words over clinical
 *   shorthand. No map is rendered until there is actually a vehicle to track,
 *   because a 3D map is slow and distracting on a phone mid-emergency.
 * - The real phone number stays on screen at every step. This app is an
 *   addition to calling 108, never a replacement for it.
 * - Two branches, both anonymous: reporting for yourself, or for someone else.
 *   A bystander is only asked what an untrained person can actually observe.
 * ==============================================================================
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import api, { getTrackedIncident, cancelTrackedIncident, postVoiceReport } from '../lib/api'
import { useT, LanguageSwitcher } from '../lib/i18n'

// Where an in-progress report is kept so a phone that locks, reloads or loses
// signal mid-emergency can resume tracking instead of losing the report.
const STORAGE_KEY = 'mediroute-active-sos'

const EMERGENCY_NUMBER = '108'

// ──────────────────────────────────────────────────────────────────────────────
// QUESTION CATALOGUES
// ──────────────────────────────────────────────────────────────────────────────

/**
 * What the patient themselves might be experiencing.
 *
 * `label` and `hint` are translation keys resolved at render time; `text` is
 * the English phrasing sent to triage, which always reasons in English
 * regardless of the language the caller is reading.
 */
const SELF_COMPLAINTS = [
  { id: 'chest', key: 'c.chest', label: 'Chest pain', hint: 'Pain, pressure or tightness in the chest', text: 'severe chest pain' },
  { id: 'breathing', key: 'c.breathing', label: "Can't breathe properly", hint: 'Short of breath, wheezing, choking', text: 'difficulty breathing' },
  { id: 'bleeding', key: 'c.bleeding', label: 'Bleeding badly', hint: 'A wound that will not stop bleeding', text: 'severe bleeding' },
  { id: 'accident', key: 'c.accident', label: 'I had an accident', hint: 'Road accident, fall or injury', text: 'accident with injury' },
  { id: 'stroke', key: 'c.stroke', label: 'Face or arm went weak', hint: 'Drooping face, slurred speech, numb arm', text: 'stroke symptoms, facial droop and slurred speech' },
  { id: 'pain', key: 'c.pain', label: 'Severe pain', hint: 'Sudden, very bad pain anywhere', text: 'sudden severe pain' },
  { id: 'allergy', key: 'c.allergy', label: 'Allergic reaction', hint: 'Swelling, rash, trouble swallowing', text: 'allergic reaction with swelling' },
  { id: 'other', key: 'c.other', label: 'Something else', hint: "I'll describe it myself", text: '' },
]

/** What a bystander can see from outside. */
const BYSTANDER_SITUATIONS = [
  { id: 'road', key: 'b.road', label: 'Road accident', hint: 'Vehicle crash, someone hit', text: 'road accident with casualty' },
  { id: 'collapse', key: 'b.collapse', label: 'Someone collapsed', hint: 'Fell down, not getting up', text: 'person collapsed suddenly' },
  { id: 'fall', key: 'b.fall', label: 'Bad fall', hint: 'Fell from a height or stairs', text: 'fall from height with injury' },
  { id: 'fire', key: 'b.fire', label: 'Fire or burns', hint: 'Someone is burnt', text: 'burn injury from fire' },
  { id: 'drown', key: 'b.drown', label: 'Drowning', hint: 'Pulled from water', text: 'drowning, pulled from water' },
  { id: 'assault', key: 'b.assault', label: 'Someone is hurt by violence', hint: 'Assault or stabbing', text: 'penetrating trauma from assault' },
  { id: 'unknown', key: 'b.unknown', label: "I don't know what happened", hint: 'I just found them like this', text: 'person found unresponsive, cause unknown' },
  { id: 'other', label: 'Something else', hint: "I'll describe it myself", text: '' },
]

/** Three-state answers. "Not sure" is a first-class answer, not a failure. */
const TRISTATE = [
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
  { value: null, label: 'Not sure' },
]

const HAZARDS = [
  { id: 'TRAFFIC', key: 'h.traffic', label: 'Traffic' },
  { id: 'FIRE', key: 'h.fire', label: 'Fire or smoke' },
  { id: 'WATER', key: 'h.water', label: 'Water' },
  { id: 'ELECTRICAL', key: 'h.electrical', label: 'Live wires' },
  { id: 'CROWD', key: 'h.crowd', label: 'Crowd or violence' },
]

// ──────────────────────────────────────────────────────────────────────────────
// PLAIN-LANGUAGE VOCABULARY
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Server status codes rendered as something a frightened person can read.
 * The raw enum (EN_ROUTE_TO_PATIENT) is never shown on this page.
 */
const STATUS_WORDS = {
  PENDING: { key: 'status.received', done: 1 },
  TRIAGE_COMPLETE: { key: 'status.assessed', done: 2 },
  DISPATCHING: { key: 'status.assigned', done: 2 },
  DISPATCHED: { key: 'status.onTheWay', done: 3 },
  EN_ROUTE_TO_PATIENT: { key: 'status.onTheWay', done: 3 },
  AT_PATIENT: { key: 'status.arrived', done: 4 },
  EN_ROUTE_TO_HOSPITAL: { key: 'status.toHospital', done: 5 },
  ARRIVED_AT_HOSPITAL: { key: 'status.atHospital', done: 6 },
  COMPLETED: { key: 'status.atHospital', done: 6 },
  CANCELLED: { key: 'status.received', done: 0 },
}

/**
 * ESI 1-5 described in words, with no number shown to the citizen. The number
 * is a clinical scale that means nothing to the public and reads as a score.
 */
const URGENCY_WORDS = {
  1: { key: 'urgency.1', tone: 'text-red-400' },
  2: { key: 'urgency.2', tone: 'text-orange-400' },
  3: { key: 'urgency.3', tone: 'text-amber-300' },
  4: { key: 'urgency.4', tone: 'text-emerald-400' },
  5: { key: 'urgency.5', tone: 'text-emerald-400' },
}

const TRACK_STEPS = [
  'status.received',
  'status.assessed',
  'status.assigned',
  'status.onTheWay',
  'status.arrived',
  'status.atHospital',
]

// ──────────────────────────────────────────────────────────────────────────────
// PAGE
// ──────────────────────────────────────────────────────────────────────────────

export default function SosPortal() {
  const { t } = useT()

  // 'choose' -> 'describe' -> 'confirm' -> 'active'
  const [step, setStep] = useState('choose')
  const [branch, setBranch] = useState(null) // 'SELF' | 'BYSTANDER'

  const [situation, setSituation] = useState(null)
  const [freeText, setFreeText] = useState('')
  const [isConscious, setIsConscious] = useState(null)
  const [isBreathing, setIsBreathing] = useState(null)
  const [victimCount, setVictimCount] = useState(1)
  const [hazards, setHazards] = useState([])
  const [callerPhone, setCallerPhone] = useState('')

  const [coords, setCoords] = useState(null)
  const [address, setAddress] = useState('')
  const [geoState, setGeoState] = useState('idle') // idle | locating | ok | denied | unsupported
  const [manualAddress, setManualAddress] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [incident, setIncident] = useState(null)
  const [trackingToken, setTrackingToken] = useState(null)
  // Whether the backend has answered at least once this session.
  const [apiWarm, setApiWarm] = useState(false)
  // Set when a send fails, so the caller is offered a retry rather than a
  // dead end with only a toast that disappears.
  const [sendError, setSendError] = useState(null)

  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])

  const catalogue = branch === 'BYSTANDER' ? BYSTANDER_SITUATIONS : SELF_COMPLAINTS

  /**
   * Wake the API as soon as the page opens.
   *
   * The backend runs on a free tier that sleeps after inactivity, and a cold
   * start can take 40-50s - longer than the request timeout. The first report
   * of the day was therefore failing at the submit step, which is the worst
   * possible moment. The caller spends 20-40s choosing a branch and answering
   * questions, so a cheap ping on mount means the service is warm by the time
   * they press send. Fire-and-forget: nothing depends on the result.
   */
  useEffect(() => {
    const started = Date.now()
    api
      .get('/ai/health', { timeout: 90000 })
      .then(() => setApiWarm(true))
      .catch(() => setApiWarm(true)) // Even a failure means the dyno is now up.
      .finally(() => {
        if (Date.now() - started > 4000) console.info('[SOS] API was cold; it is warm now')
      })
  }, [])

  // ── Resume an in-flight report after a reload or a locked screen ──────────
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (saved?.incidentId && saved?.trackingToken) {
        setTrackingToken(saved.trackingToken)
        getTrackedIncident(saved.incidentId, saved.trackingToken)
          .then(({ data }) => {
            // Only resume something still in progress.
            if (!['COMPLETED', 'CANCELLED'].includes(data.incident.status)) {
              setIncident(data.incident)
              setStep('active')
            } else {
              localStorage.removeItem(STORAGE_KEY)
            }
          })
          .catch(() => localStorage.removeItem(STORAGE_KEY))
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  // ── Location ──────────────────────────────────────────────────────────────

  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGeoState('unsupported')
      return
    }

    setGeoState('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { longitude, latitude } = pos.coords
        setCoords([longitude, latitude])
        setGeoState('ok')
        reverseGeocode(longitude, latitude).then(setAddress)
      },
      (err) => {
        console.warn('[SOS] Geolocation failed:', err.message)
        // Denial is not a dead end: the report can still go with a typed
        // address, which is better than no report at all.
        setGeoState('denied')
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    )
  }, [])

  // Ask for location as soon as a branch is picked, so the permission prompt
  // is resolved before the person reaches the send screen.
  useEffect(() => {
    if (branch && geoState === 'idle') requestLocation()
  }, [branch, geoState, requestLocation])

  /** Turn coordinates into a street name using the Mapbox token already present. */
  async function reverseGeocode(lng, lat) {
    const token = import.meta.env.VITE_MAPBOX_TOKEN
    if (!token) return ''
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&types=address,place,locality,neighborhood&limit=1`
      )
      const json = await res.json()
      return json?.features?.[0]?.place_name || ''
    } catch {
      return ''
    }
  }

  // ── Voice reporting ───────────────────────────────────────────────────────

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []

      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size < 1200) {
          toast.error('That recording was too short. Hold the button while you speak.')
          return
        }

        setTranscribing(true)
        try {
          const { data } = await postVoiceReport(blob, branch)
          if (data.transcript) {
            // Append rather than replace, so a second recording adds detail.
            setFreeText((prev) => (prev ? `${prev} ${data.transcript}` : data.transcript))
            toast.success('Added what you said')
          }
        } catch {
          toast.error('Could not understand the recording. You can type instead.')
        } finally {
          setTranscribing(false)
        }
      }

      recorder.start()
      recorderRef.current = recorder
      setRecording(true)
    } catch {
      toast.error('Microphone unavailable. Please type what happened.')
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    setRecording(false)
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  /** Build the complaint text that the triage model will reason over. */
  function buildComplaint() {
    const picked = catalogue.find((c) => c.id === situation)
    return [picked?.text, freeText.trim()].filter(Boolean).join('. ')
  }

  /**
   * Turn a typed address or landmark into real coordinates.
   *
   * Biased towards Mumbai so a bare landmark like "Bandra station" resolves to
   * the right city rather than a same-named place elsewhere.
   *
   * @returns {Promise<{coordinates: [number, number], address: string}|null>}
   */
  async function geocodeAddress(text) {
    const token = import.meta.env.VITE_MAPBOX_TOKEN
    if (!token || !text.trim()) return null

    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(text.trim())}.json` +
          `?access_token=${token}&proximity=72.8777,19.0760&country=IN&limit=1`
      )
      const json = await res.json()
      const hit = json?.features?.[0]
      if (!hit?.center) return null
      return { coordinates: [hit.center[0], hit.center[1]], address: hit.place_name }
    } catch {
      return null
    }
  }

  async function submitReport() {
    let effectiveCoords = coords
    let effectiveAddress = address
    // 'GPS' when the device gave us a fix, 'GEOCODED' when we resolved typed
    // text. Dispatch needs to know which, because a geocoded landmark can be a
    // few hundred metres out.
    let locationSource = coords ? 'GPS' : null

    if (!effectiveCoords) {
      if (!manualAddress.trim()) {
        toast.error('We need a location to send help.')
        return
      }

      /**
       * Resolve the typed address to coordinates before sending.
       *
       * This previously submitted hardcoded Mumbai city-centre coordinates with
       * the typed address carried only as text. Dispatch runs a $nearSphere
       * query on those coordinates, so it would have assigned the ambulance
       * nearest Parel rather than the actual emergency, and the ETA shown to
       * the caller would have been measured from the wrong point.
       */
      setSubmitting(true)
      const resolved = await geocodeAddress(manualAddress)
      setSubmitting(false)

      if (!resolved) {
        toast.error(
          `We could not find "${manualAddress.trim()}". Add a landmark or area, or call ${EMERGENCY_NUMBER}.`,
          { duration: 7000 }
        )
        return
      }

      effectiveCoords = resolved.coordinates
      effectiveAddress = resolved.address
      locationSource = 'GEOCODED'
    }

    setSubmitting(true)
    try {
      const payload = {
        reporterType: branch,
        chiefComplaint: buildComplaint() || 'Emergency assistance requested',
        reporterContact: callerPhone.trim() ? { phone: callerPhone.trim() } : undefined,
        location: {
          coordinates: effectiveCoords,
          address: effectiveAddress || manualAddress.trim(),
          source: locationSource,
          // What the caller actually typed, kept verbatim alongside the
          // geocoder's interpretation so the crew can tell them apart.
          reportedAs: coords ? null : manualAddress.trim() || null,
        },
        sceneInfo: {
          victimCount,
          isConscious,
          isBreathing,
          hazards,
          description: freeText.trim(),
        },
      }

      /**
       * A generous timeout on purpose. The default 30s is shorter than a cold
       * start on the hosting free tier, so an emergency report could time out
       * and be reported to the caller as a failure while the request was still
       * in flight. Waiting is always better than telling someone help was not
       * requested when it may have been.
       */
      const { data } = await api.post('/incidents', payload, { timeout: 120000 })

      setSendError(null)
      setIncident(data.incident)
      setTrackingToken(data.trackingToken)
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ incidentId: data.incident._id, trackingToken: data.trackingToken })
      )
      setStep('active')
      toast.success('Help has been requested')
    } catch (err) {
      // Distinguish a refusal from never reaching the server. A timeout or a
      // network drop may still have created the report, so the wording must not
      // state that nothing was sent.
      const reachedServer = Boolean(err.response)
      const serverMessage = err.response?.data?.message

      const message = reachedServer
        ? serverMessage || 'The service refused the report.'
        : 'We could not reach the service. Your report may not have been sent.'

      setSendError(message)
      toast.error(`${message} If this is urgent, call ${EMERGENCY_NUMBER} now.`, { duration: 9000 })
    } finally {
      setSubmitting(false)
    }
  }

  // ── Live tracking ─────────────────────────────────────────────────────────
  // Polled rather than socket-driven: an anonymous reporter holds no JWT, and
  // the socket layer authenticates on one. Polling also survives the flaky
  // mobile connections this page has to work on.
  useEffect(() => {
    if (step !== 'active' || !incident?._id || !trackingToken) return

    let cancelled = false
    const tick = async () => {
      try {
        const { data } = await getTrackedIncident(incident._id, trackingToken)
        if (!cancelled) setIncident(data.incident)
      } catch {
        // A failed poll is not worth alarming the user over; the next one may
        // succeed. The report is already filed server-side.
      }
    }

    const id = setInterval(tick, 5000)
    tick()
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [step, incident?._id, trackingToken])

  async function cancelReport() {
    if (!incident?._id) return
    try {
      await cancelTrackedIncident(incident._id, trackingToken)
      localStorage.removeItem(STORAGE_KEY)
      toast.success('Report cancelled')
      resetAll()
    } catch {
      toast.error('Could not cancel. If help is no longer needed, please call ' + EMERGENCY_NUMBER + '.')
    }
  }

  function resetAll() {
    setStep('choose')
    setBranch(null)
    setSituation(null)
    setFreeText('')
    setIsConscious(null)
    setIsBreathing(null)
    setVictimCount(1)
    setHazards([])
    setCallerPhone('')
    setIncident(null)
    setTrackingToken(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const stepIndex = { choose: 0, describe: 1, confirm: 2, active: 3 }[step]

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex flex-col">
      <CallBanner />

      <header className="px-5 pt-4 pb-2 flex items-center justify-between gap-3">
        <Link to="/" className="text-sm text-white/50 hover:text-white transition-colors shrink-0">
          ← MediRoute
        </Link>
        <div className="flex items-center gap-3">
          {step !== 'active' && <StepDots total={3} current={stepIndex} />}
          {/* Offered on every step: someone may realise mid-report that they
              would rather read this in their own language. */}
          <LanguageSwitcher compact />
        </div>
      </header>

      <main className="flex-1 px-5 pb-10 max-w-xl w-full mx-auto">
        <AnimatePresence mode="wait">
          {step === 'choose' && (
            <Screen key="choose">
              <ChooseBranch
                onPick={(b) => {
                  setBranch(b)
                  setStep('describe')
                }}
              />
            </Screen>
          )}

          {step === 'describe' && (
            <Screen key="describe">
              <DescribeStep
                branch={branch}
                catalogue={catalogue}
                situation={situation}
                setSituation={setSituation}
                freeText={freeText}
                setFreeText={setFreeText}
                isConscious={isConscious}
                setIsConscious={setIsConscious}
                isBreathing={isBreathing}
                setIsBreathing={setIsBreathing}
                victimCount={victimCount}
                setVictimCount={setVictimCount}
                hazards={hazards}
                setHazards={setHazards}
                recording={recording}
                transcribing={transcribing}
                startRecording={startRecording}
                stopRecording={stopRecording}
                onBack={() => {
                  setStep('choose')
                  setBranch(null)
                }}
                onNext={() => setStep('confirm')}
              />
            </Screen>
          )}

          {step === 'confirm' && (
            <Screen key="confirm">
              <ConfirmStep
                branch={branch}
                geoState={geoState}
                address={address}
                coords={coords}
                manualAddress={manualAddress}
                setManualAddress={setManualAddress}
                retryLocation={requestLocation}
                callerPhone={callerPhone}
                setCallerPhone={setCallerPhone}
                submitting={submitting}
                apiWarm={apiWarm}
                sendError={sendError}
                onBack={() => setStep('describe')}
                onSend={submitReport}
              />
            </Screen>
          )}

          {step === 'active' && incident && (
            <Screen key="active">
              <ActiveReport incident={incident} onCancel={cancelReport} onNew={resetAll} />
            </Screen>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// SHARED PIECES
// ──────────────────────────────────────────────────────────────────────────────

function Screen({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
    >
      {children}
    </motion.div>
  )
}

/**
 * The real emergency number, permanently visible. This app assists dispatch;
 * it must never look like the only way to get help.
 */
function CallBanner() {
  const { t } = useT()
  return (
    <a
      href={`tel:${EMERGENCY_NUMBER}`}
      className="block bg-red-600/90 hover:bg-red-600 transition-colors text-center py-2.5 px-4 text-sm font-semibold"
    >
      {t('banner.call')}
    </a>
  )
}

function StepDots({ total, current }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === current ? 'w-6 bg-red-500' : i < current ? 'w-1.5 bg-red-500/60' : 'w-1.5 bg-white/15'
          }`}
        />
      ))}
    </div>
  )
}

/** A large, thumb-friendly option. Minimum target well above 44px. */
function BigChoice({ label, hint, selected, onClick, tone = 'neutral' }) {
  const toneRing =
    tone === 'danger'
      ? 'border-red-500/40 hover:border-red-500 hover:bg-red-500/10'
      : 'border-white/10 hover:border-cyan-400/50 hover:bg-cyan-400/5'

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`w-full text-left rounded-2xl border px-5 py-4 min-h-[68px] transition-all duration-200 ${
        selected ? 'border-cyan-400 bg-cyan-400/10' : toneRing
      }`}
    >
      <span className="block text-base font-semibold leading-snug">{label}</span>
      {hint && <span className="block text-sm text-white/45 mt-0.5 leading-snug">{hint}</span>}
    </button>
  )
}

function TriStateRow({ question, value, onChange }) {
  const { t } = useT()
  const labels = { true: t('common.yes'), false: t('common.no'), null: t('common.notSure') }
  return (
    <fieldset>
      <legend className="text-base font-semibold mb-2.5">{question}</legend>
      <div className="grid grid-cols-3 gap-2">
        {TRISTATE.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={value === opt.value}
            className={`rounded-xl border py-3.5 text-sm font-semibold transition-all ${
              value === opt.value
                ? 'border-cyan-400 bg-cyan-400/15 text-white'
                : 'border-white/10 text-white/70 hover:border-white/30'
            }`}
          >
            {labels[String(opt.value)]}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function PrimaryButton({ children, disabled, onClick, loading }) {
  const { t } = useT()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full rounded-2xl bg-red-600 hover:bg-red-500 disabled:bg-white/10 disabled:text-white/40 text-white font-bold text-lg py-4 transition-colors"
    >
      {loading ? t('common.sending') : children}
    </button>
  )
}

function BackLink({ onClick }) {
  const { t } = useT()
  return (
    <button type="button" onClick={onClick} className="text-sm text-white/45 hover:text-white transition-colors py-2">
      ← {t('common.back')}
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// STEP 1 - WHO IS THIS FOR
// ──────────────────────────────────────────────────────────────────────────────

function ChooseBranch({ onPick }) {
  const { t } = useT()
  return (
    <div className="pt-6">
      <h1 className="text-3xl font-bold leading-tight">{t('sos.title')}</h1>
      <p className="text-white/55 mt-2 text-base leading-relaxed">{t('sos.subtitle')}</p>

      <div className="mt-8 space-y-3">
        <button
          type="button"
          onClick={() => onPick('SELF')}
          className="w-full rounded-2xl bg-red-600 hover:bg-red-500 px-6 py-7 text-left transition-colors"
        >
          <span className="block text-2xl font-bold">{t('sos.self')}</span>
          <span className="block text-white/80 mt-1">{t('sos.selfHint')}</span>
        </button>

        <button
          type="button"
          onClick={() => onPick('BYSTANDER')}
          className="w-full rounded-2xl border-2 border-white/15 hover:border-cyan-400/60 hover:bg-cyan-400/5 px-6 py-7 text-left transition-all"
        >
          <span className="block text-2xl font-bold">{t('sos.bystander')}</span>
          <span className="block text-white/55 mt-1">{t('sos.bystanderHint')}</span>
        </button>
      </div>

      <p className="text-xs text-white/35 mt-8 leading-relaxed">{t('sos.privacy')}</p>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// STEP 2 - WHAT IS HAPPENING
// ──────────────────────────────────────────────────────────────────────────────

function DescribeStep({
  branch,
  catalogue,
  situation,
  setSituation,
  freeText,
  setFreeText,
  isConscious,
  setIsConscious,
  isBreathing,
  setIsBreathing,
  victimCount,
  setVictimCount,
  hazards,
  setHazards,
  recording,
  transcribing,
  startRecording,
  stopRecording,
  onBack,
  onNext,
}) {
  const { t } = useT()
  const isBystander = branch === 'BYSTANDER'
  const canContinue = Boolean(situation) || freeText.trim().length > 3

  function toggleHazard(id) {
    setHazards((prev) => (prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id]))
  }

  return (
    <div className="pt-4">
      <BackLink onClick={onBack} />

      <h2 className="text-2xl font-bold mt-2 leading-tight">
        {isBystander ? t('sos.whatHappened') : t('sos.whatWrong')}
      </h2>
      <p className="text-white/50 mt-1.5 text-sm">{t('sos.pickClosest')}</p>

      <div className="mt-5 space-y-2">
        {catalogue.map((item) => (
          <BigChoice
            key={item.id}
            /* t falls back to English when a key has no translation yet. */
            label={item.key ? t(item.key) : item.label}
            hint={item.hint}
            selected={situation === item.id}
            onClick={() => setSituation(item.id)}
          />
        ))}
      </div>

      {/* The bystander questions: only things visible from outside. We never
          ask an untrained caller for a blood group or a GCS score. */}
      {isBystander && (
        <div className="mt-8 space-y-6">
          <TriStateRow question={t('sos.awake')} value={isConscious} onChange={setIsConscious} />
          <TriStateRow question={t('sos.breathing')} value={isBreathing} onChange={setIsBreathing} />

          <fieldset>
            <legend className="text-base font-semibold mb-2.5">{t('sos.howMany')}</legend>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setVictimCount(n)}
                  aria-pressed={victimCount === n}
                  className={`rounded-xl border py-3.5 text-sm font-semibold transition-all ${
                    victimCount === n
                      ? 'border-cyan-400 bg-cyan-400/15'
                      : 'border-white/10 text-white/70 hover:border-white/30'
                  }`}
                >
                  {n === 4 ? '4+' : n}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-base font-semibold mb-1">{t('sos.danger')}</legend>
            <p className="text-sm text-white/45 mb-2.5">{t('sos.dangerHint')}</p>
            <div className="flex flex-wrap gap-2">
              {HAZARDS.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => toggleHazard(h.id)}
                  aria-pressed={hazards.includes(h.id)}
                  className={`rounded-full border px-4 py-2.5 text-sm font-medium transition-all ${
                    hazards.includes(h.id)
                      ? 'border-amber-400 bg-amber-400/15 text-amber-200'
                      : 'border-white/10 text-white/60 hover:border-white/30'
                  }`}
                >
                  {h.key ? t(h.key) : h.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {/* Free text and voice. Voice goes through Whisper server-side, so it
          works on mobile browsers that lack the Web Speech API. */}
      <div className="mt-8">
        <label htmlFor="sos-detail" className="block text-base font-semibold mb-1">
          {t('sos.anythingElse')}{' '}
          <span className="text-white/40 font-normal">({t('common.optional')})</span>
        </label>
        <p className="text-sm text-white/45 mb-2.5">{t('sos.typeOrSpeak')}</p>

        <textarea
          id="sos-detail"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          rows={3}
          placeholder="He is bleeding from the head and not responding…"
          className="w-full rounded-xl bg-white/5 border border-white/10 focus:border-cyan-400/60 focus:outline-none px-4 py-3 text-base resize-none placeholder:text-white/25"
        />

        <button
          type="button"
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onMouseLeave={stopRecording}
          onTouchStart={(e) => {
            e.preventDefault()
            startRecording()
          }}
          onTouchEnd={(e) => {
            e.preventDefault()
            stopRecording()
          }}
          disabled={transcribing}
          className={`mt-2.5 w-full rounded-xl border py-3.5 text-sm font-semibold transition-all ${
            recording
              ? 'border-red-500 bg-red-500/20 text-red-200'
              : 'border-white/15 text-white/70 hover:border-white/35'
          }`}
        >
          {transcribing
            ? t('sos.writingDown')
            : recording
            ? t('sos.listening')
            : t('sos.holdToSpeak')}
        </button>
      </div>

      <div className="mt-8">
        <PrimaryButton disabled={!canContinue} onClick={onNext}>
          {t('common.continue')}
        </PrimaryButton>
        {!canContinue && (
          <p className="text-sm text-white/40 mt-2 text-center">{t('sos.chooseOrDescribe')}</p>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// STEP 3 - WHERE, THEN SEND
// ──────────────────────────────────────────────────────────────────────────────

function ConfirmStep({
  branch,
  geoState,
  apiWarm,
  sendError,
  address,
  coords,
  manualAddress,
  setManualAddress,
  retryLocation,
  callerPhone,
  setCallerPhone,
  submitting,
  onBack,
  onSend,
}) {
  const { t } = useT()
  const hasLocation = geoState === 'ok' && coords
  const canSend = hasLocation || manualAddress.trim().length > 4

  return (
    <div className="pt-4">
      <BackLink onClick={onBack} />

      <h2 className="text-2xl font-bold mt-2 leading-tight">{t('sos.whereSend')}</h2>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        {geoState === 'locating' && (
          <p className="text-base text-white/70">{t('sos.findingLocation')}</p>
        )}

        {hasLocation && (
          <>
            <p className="text-xs uppercase tracking-wider text-emerald-400 font-semibold">
              {t('sos.locationFound')}
            </p>
            <p className="text-base mt-1.5 leading-snug">{address || 'Coordinates captured'}</p>
            <p className="text-xs text-white/35 mt-1.5 font-mono">
              {coords[1].toFixed(5)}, {coords[0].toFixed(5)}
            </p>
          </>
        )}

        {(geoState === 'denied' || geoState === 'unsupported') && (
          <>
            <p className="text-sm text-amber-300 font-semibold">
              {t('sos.locationBlocked')}
            </p>
            <p className="text-sm text-white/55 mt-1.5 leading-relaxed">{t('sos.typeAddress')}</p>
            <input
              value={manualAddress}
              onChange={(e) => setManualAddress(e.target.value)}
              placeholder="Opposite Bandra station, near the bus stop"
              className="mt-3 w-full rounded-xl bg-white/5 border border-white/10 focus:border-cyan-400/60 focus:outline-none px-4 py-3 text-base placeholder:text-white/25"
            />
            <button
              type="button"
              onClick={retryLocation}
              className="mt-2.5 text-sm text-cyan-300 hover:text-cyan-200 transition-colors"
            >
              Try using my location again
            </button>
          </>
        )}
      </div>

      <div className="mt-5">
        <label htmlFor="sos-phone" className="block text-base font-semibold mb-1">
          {t('sos.yourPhone')}{' '}
          <span className="text-white/40 font-normal">({t('common.optional')})</span>
        </label>
        <p className="text-sm text-white/45 mb-2.5">
          {branch === 'BYSTANDER' ? t('sos.phoneHintBystander') : t('sos.phoneHintSelf')}
        </p>
        <input
          id="sos-phone"
          type="tel"
          inputMode="tel"
          value={callerPhone}
          onChange={(e) => setCallerPhone(e.target.value)}
          placeholder="+91 98765 43210"
          className="w-full rounded-xl bg-white/5 border border-white/10 focus:border-cyan-400/60 focus:outline-none px-4 py-3 text-base placeholder:text-white/25"
        />
      </div>

      <div className="mt-8">
        <PrimaryButton disabled={!canSend} loading={submitting} onClick={onSend}>
          {sendError ? t('sos.tryAgain') : t('sos.sendNow')}
        </PrimaryButton>

        {!canSend && (
          <p className="text-sm text-white/40 mt-2 text-center">{t('sos.needLocation')}</p>
        )}

        {/*
          A failed send stays on screen with a retry. A toast disappears, and
          someone in an emergency should never be left unsure whether their
          report went through.
        */}
        {sendError && (
          <div className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/[0.08] p-4">
            <p className="text-sm font-semibold text-red-200">{sendError}</p>
            <p className="text-sm text-white/65 mt-1.5 leading-relaxed">
              Press the button above to try again. If help is needed now, do not wait - call{' '}
              {EMERGENCY_NUMBER}.
            </p>
            <a
              href={`tel:${EMERGENCY_NUMBER}`}
              className="mt-3 block w-full rounded-xl bg-red-600 hover:bg-red-500 text-center font-bold py-3 transition-colors"
            >
              Call {EMERGENCY_NUMBER}
            </a>
          </div>
        )}

        {/*
          The backend sleeps on its free tier and can take most of a minute to
          wake. Saying so beats a spinner that looks stuck.
        */}
        {submitting && !apiWarm && (
          <p className="text-sm text-white/50 mt-3 text-center leading-relaxed">
            {t('sos.waking')}
          </p>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// STEP 4 - ACTIVE REPORT
// ──────────────────────────────────────────────────────────────────────────────

function ActiveReport({ incident, onCancel, onNew }) {
  const { t } = useT()
  const status = STATUS_WORDS[incident.status] || STATUS_WORDS.PENDING
  const urgency = URGENCY_WORDS[incident.triageData?.esiLevel]
  const ambulance = incident.assignedAmbulance
  const hospital = incident.allocatedHospital
  const eta = incident.route?.etaMinutes
  const finished = ['COMPLETED', 'CANCELLED'].includes(incident.status)

  // Pre-hospital steps come from the triage engine. Only shown when a real
  // model produced them, never when the deterministic fallback did, since the
  // fallback text is written for responders rather than the public.
  const fromModel = incident.triageData?.engine && !incident.triageData.engine.startsWith('rules')
  const actions = fromModel ? incident.triageData?.recommendedActions || [] : []

  return (
    <div className="pt-4">
      <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.07] p-5">
        <div className="flex items-start gap-3">
          {!finished && <span className="pulse-dot mt-2 shrink-0" />}
          <div>
            <h2 className="text-2xl font-bold leading-tight">{t(status.key)}</h2>
          </div>
        </div>

        <p className="text-xs text-white/40 mt-4 font-mono">
          {t('sos.reference')} {incident.incidentNumber}
        </p>
      </div>

      {/* Progress through the real dispatch workflow, in plain words. */}
      <ol className="mt-6 space-y-0">
        {TRACK_STEPS.map((label, i) => {
          const reached = status.done > i
          const current = status.done === i + 1
          return (
            <li key={label} className="flex gap-3.5 items-start">
              <div className="flex flex-col items-center">
                <span
                  className={`h-7 w-7 rounded-full grid place-items-center text-xs font-bold shrink-0 transition-colors ${
                    reached ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white/40'
                  } ${current ? 'ring-2 ring-emerald-400/50' : ''}`}
                >
                  {reached ? '✓' : i + 1}
                </span>
                {i < TRACK_STEPS.length - 1 && (
                  <span className={`w-0.5 h-7 ${reached ? 'bg-emerald-500/50' : 'bg-white/10'}`} />
                )}
              </div>
              <span className={`pt-1 text-base ${reached ? 'text-white' : 'text-white/40'}`}>
                {t(label)}
              </span>
            </li>
          )
        })}
      </ol>

      {urgency && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs uppercase tracking-wider text-white/40 font-semibold">
            {t('sos.howUrgent')}
          </p>
          <p className={`text-xl font-bold mt-1.5 ${urgency.tone}`}>{t(urgency.key)}</p>
          {!fromModel && (
            <p className="text-xs text-amber-300/80 mt-2.5 leading-relaxed">
              Assessed by our offline protocol because the clinical AI was unreachable. A
              paramedic will reassess on arrival.
            </p>
          )}
        </div>
      )}

      {(ambulance || hospital) && (
        <div className="mt-4 grid gap-3">
          {ambulance && (
            <div className="rounded-2xl border border-cyan-400/25 bg-cyan-400/[0.06] p-5">
              <p className="text-xs uppercase tracking-wider text-cyan-300 font-semibold">
                {t('sos.yourAmbulance')}
              </p>
              <p className="text-lg font-bold mt-1.5">{ambulance.vehicleNumber}</p>
              {eta != null && (
                <p className="text-base text-white/70 mt-0.5">{t('sos.minutesAway', { n: eta })}</p>
              )}
            </div>
          )}

          {hospital && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-wider text-white/40 font-semibold">
                {t('sos.hospitalExpecting')}
              </p>
              <p className="text-lg font-bold mt-1.5">{hospital.name}</p>
              {hospital.location?.address && (
                <p className="text-sm text-white/50 mt-0.5">{hospital.location.address}</p>
              )}
            </div>
          )}
        </div>
      )}

      {actions.length > 0 && !finished && (
        <div className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5">
          <p className="text-xs uppercase tracking-wider text-emerald-300 font-semibold">
            {t('sos.whileYouWait')}
          </p>
          <ul className="mt-2.5 space-y-2">
            {actions.map((a, i) => (
              <li key={i} className="text-base text-white/80 flex gap-2.5 leading-relaxed">
                <span className="text-emerald-400 shrink-0">•</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-white/40 mt-3 leading-relaxed">
            Only do what feels safe. Do not move the person unless they are in danger.
          </p>
        </div>
      )}

      <div className="mt-8 space-y-2.5">
        <a
          href={`tel:${EMERGENCY_NUMBER}`}
          className="block w-full rounded-2xl bg-red-600 hover:bg-red-500 text-center font-bold text-lg py-4 transition-colors"
        >
          {t('banner.callNumber')}
        </a>

        {finished ? (
          <button
            type="button"
            onClick={onNew}
            className="w-full rounded-2xl border border-white/15 hover:border-white/35 py-3.5 font-semibold transition-colors"
          >
            {t('sos.reportAnother')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-2xl border border-white/15 hover:border-red-500/50 hover:text-red-300 py-3.5 font-semibold transition-colors"
          >
            {t('sos.cancel')}
          </button>
        )}
      </div>

      <p className="text-xs text-white/35 mt-6 leading-relaxed">{t('sos.keepOpen')}</p>
    </div>
  )
}
