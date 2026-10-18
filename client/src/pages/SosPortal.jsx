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

// Where an in-progress report is kept so a phone that locks, reloads or loses
// signal mid-emergency can resume tracking instead of losing the report.
const STORAGE_KEY = 'mediroute-active-sos'

const EMERGENCY_NUMBER = '108'

// ──────────────────────────────────────────────────────────────────────────────
// QUESTION CATALOGUES
// ──────────────────────────────────────────────────────────────────────────────

/** What the patient themselves might be experiencing. */
const SELF_COMPLAINTS = [
  { id: 'chest', label: 'Chest pain', hint: 'Pain, pressure or tightness in the chest', text: 'severe chest pain' },
  { id: 'breathing', label: "Can't breathe properly", hint: 'Short of breath, wheezing, choking', text: 'difficulty breathing' },
  { id: 'bleeding', label: 'Bleeding badly', hint: 'A wound that will not stop bleeding', text: 'severe bleeding' },
  { id: 'accident', label: 'I had an accident', hint: 'Road accident, fall or injury', text: 'accident with injury' },
  { id: 'stroke', label: 'Face or arm went weak', hint: 'Drooping face, slurred speech, numb arm', text: 'stroke symptoms, facial droop and slurred speech' },
  { id: 'pain', label: 'Severe pain', hint: 'Sudden, very bad pain anywhere', text: 'sudden severe pain' },
  { id: 'allergy', label: 'Allergic reaction', hint: 'Swelling, rash, trouble swallowing', text: 'allergic reaction with swelling' },
  { id: 'other', label: 'Something else', hint: "I'll describe it myself", text: '' },
]

/** What a bystander can see from outside. */
const BYSTANDER_SITUATIONS = [
  { id: 'road', label: 'Road accident', hint: 'Vehicle crash, someone hit', text: 'road accident with casualty' },
  { id: 'collapse', label: 'Someone collapsed', hint: 'Fell down, not getting up', text: 'person collapsed suddenly' },
  { id: 'fall', label: 'Bad fall', hint: 'Fell from a height or stairs', text: 'fall from height with injury' },
  { id: 'fire', label: 'Fire or burns', hint: 'Someone is burnt', text: 'burn injury from fire' },
  { id: 'drown', label: 'Drowning', hint: 'Pulled from water', text: 'drowning, pulled from water' },
  { id: 'assault', label: 'Someone is hurt by violence', hint: 'Assault or stabbing', text: 'penetrating trauma from assault' },
  { id: 'unknown', label: "I don't know what happened", hint: 'I just found them like this', text: 'person found unresponsive, cause unknown' },
  { id: 'other', label: 'Something else', hint: "I'll describe it myself", text: '' },
]

/** Three-state answers. "Not sure" is a first-class answer, not a failure. */
const TRISTATE = [
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
  { value: null, label: 'Not sure' },
]

const HAZARDS = [
  { id: 'TRAFFIC', label: 'Traffic', hint: 'On or near a busy road' },
  { id: 'FIRE', label: 'Fire or smoke' },
  { id: 'WATER', label: 'Water' },
  { id: 'ELECTRICAL', label: 'Live wires' },
  { id: 'CROWD', label: 'Crowd or violence' },
]

// ──────────────────────────────────────────────────────────────────────────────
// PLAIN-LANGUAGE VOCABULARY
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Server status codes rendered as something a frightened person can read.
 * The raw enum (EN_ROUTE_TO_PATIENT) is never shown on this page.
 */
const STATUS_WORDS = {
  PENDING: { title: 'Report received', detail: 'We are working out how urgent this is.', done: 1 },
  TRIAGE_COMPLETE: { title: 'Urgency assessed', detail: 'Finding the closest ambulance now.', done: 2 },
  DISPATCHING: { title: 'Finding an ambulance', detail: 'Assigning the nearest available crew.', done: 2 },
  DISPATCHED: { title: 'Ambulance on the way', detail: 'A crew has been assigned and is heading to you.', done: 3 },
  EN_ROUTE_TO_PATIENT: { title: 'Ambulance on the way', detail: 'The crew is travelling to the location.', done: 3 },
  AT_PATIENT: { title: 'Crew has arrived', detail: 'Paramedics are with the patient.', done: 4 },
  EN_ROUTE_TO_HOSPITAL: { title: 'On the way to hospital', detail: 'The patient is being taken to hospital.', done: 5 },
  ARRIVED_AT_HOSPITAL: { title: 'Arrived at hospital', detail: 'The hospital team has taken over.', done: 6 },
  COMPLETED: { title: 'Handover complete', detail: 'The patient is in hospital care.', done: 6 },
  CANCELLED: { title: 'Report cancelled', detail: 'This report was cancelled.', done: 0 },
}

/**
 * ESI 1-5 described in words, with no number shown to the citizen. The number
 * is a clinical scale that means nothing to the public and reads as a score.
 */
const URGENCY_WORDS = {
  1: { label: 'Most urgent', tone: 'text-red-400', note: 'Treated as immediately life-threatening.' },
  2: { label: 'Very urgent', tone: 'text-orange-400', note: 'A crew is being sent straight away.' },
  3: { label: 'Urgent', tone: 'text-amber-300', note: 'Help is being arranged now.' },
  4: { label: 'Less urgent', tone: 'text-emerald-400', note: 'You will be seen, but others may go first.' },
  5: { label: 'Non-urgent', tone: 'text-emerald-400', note: 'Consider a clinic if this is not an emergency.' },
}

const TRACK_STEPS = [
  'Report received',
  'Urgency assessed',
  'Ambulance assigned',
  'On the way to you',
  'With the patient',
  'At hospital',
]

// ──────────────────────────────────────────────────────────────────────────────
// PAGE
// ──────────────────────────────────────────────────────────────────────────────

export default function SosPortal() {
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

  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])

  const catalogue = branch === 'BYSTANDER' ? BYSTANDER_SITUATIONS : SELF_COMPLAINTS

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

  async function submitReport() {
    const effectiveCoords = coords
    if (!effectiveCoords && !manualAddress.trim()) {
      toast.error('We need a location to send help.')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        reporterType: branch,
        chiefComplaint: buildComplaint() || 'Emergency assistance requested',
        reporterContact: callerPhone.trim() ? { phone: callerPhone.trim() } : undefined,
        location: {
          // Mumbai city centre stands in only when the browser gave us nothing
          // and the person typed an address instead; dispatch reads the text.
          coordinates: effectiveCoords || [72.8777, 19.076],
          address: address || manualAddress.trim() || 'Address given by caller',
        },
        sceneInfo: {
          victimCount,
          isConscious,
          isBreathing,
          hazards,
          description: freeText.trim(),
        },
      }

      const { data } = await api.post('/incidents', payload)

      setIncident(data.incident)
      setTrackingToken(data.trackingToken)
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ incidentId: data.incident._id, trackingToken: data.trackingToken })
      )
      setStep('active')
      toast.success('Help has been requested')
    } catch (err) {
      const msg = err.response?.data?.message || 'Could not send the report.'
      toast.error(`${msg} Please call ${EMERGENCY_NUMBER}.`)
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

      <header className="px-5 pt-4 pb-2 flex items-center justify-between">
        <Link to="/" className="text-sm text-white/50 hover:text-white transition-colors">
          ← MediRoute
        </Link>
        {step !== 'active' && <StepDots total={3} current={stepIndex} />}
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
  return (
    <a
      href={`tel:${EMERGENCY_NUMBER}`}
      className="block bg-red-600/90 hover:bg-red-600 transition-colors text-center py-2.5 px-4 text-sm font-semibold"
    >
      Life-threatening and need to speak to someone? Tap to call {EMERGENCY_NUMBER}
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
            {opt.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function PrimaryButton({ children, disabled, onClick, loading }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full rounded-2xl bg-red-600 hover:bg-red-500 disabled:bg-white/10 disabled:text-white/40 text-white font-bold text-lg py-4 transition-colors"
    >
      {loading ? 'Sending…' : children}
    </button>
  )
}

function BackLink({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="text-sm text-white/45 hover:text-white transition-colors py-2">
      ← Back
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// STEP 1 - WHO IS THIS FOR
// ──────────────────────────────────────────────────────────────────────────────

function ChooseBranch({ onPick }) {
  return (
    <div className="pt-6">
      <h1 className="text-3xl font-bold leading-tight">Get emergency help</h1>
      <p className="text-white/55 mt-2 text-base leading-relaxed">
        No account needed. Two questions, then we send an ambulance.
      </p>

      <div className="mt-8 space-y-3">
        <button
          type="button"
          onClick={() => onPick('SELF')}
          className="w-full rounded-2xl bg-red-600 hover:bg-red-500 px-6 py-7 text-left transition-colors"
        >
          <span className="block text-2xl font-bold">I need help</span>
          <span className="block text-white/80 mt-1">Something is wrong with me</span>
        </button>

        <button
          type="button"
          onClick={() => onPick('BYSTANDER')}
          className="w-full rounded-2xl border-2 border-white/15 hover:border-cyan-400/60 hover:bg-cyan-400/5 px-6 py-7 text-left transition-all"
        >
          <span className="block text-2xl font-bold">Someone else needs help</span>
          <span className="block text-white/55 mt-1">I can see a person who is hurt</span>
        </button>
      </div>

      <p className="text-xs text-white/35 mt-8 leading-relaxed">
        Your location is used only to send help to the right place. You will get a tracking
        link on this device and can cancel at any time.
      </p>
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
  const isBystander = branch === 'BYSTANDER'
  const canContinue = Boolean(situation) || freeText.trim().length > 3

  function toggleHazard(id) {
    setHazards((prev) => (prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id]))
  }

  return (
    <div className="pt-4">
      <BackLink onClick={onBack} />

      <h2 className="text-2xl font-bold mt-2 leading-tight">
        {isBystander ? 'What has happened?' : "What's wrong?"}
      </h2>
      <p className="text-white/50 mt-1.5 text-sm">
        Pick the closest one. If nothing fits, choose “Something else”.
      </p>

      <div className="mt-5 space-y-2">
        {catalogue.map((item) => (
          <BigChoice
            key={item.id}
            label={item.label}
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
          <TriStateRow question="Is the person awake?" value={isConscious} onChange={setIsConscious} />
          <TriStateRow question="Are they breathing?" value={isBreathing} onChange={setIsBreathing} />

          <fieldset>
            <legend className="text-base font-semibold mb-2.5">How many people are hurt?</legend>
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
            <legend className="text-base font-semibold mb-1">Is there any danger there?</legend>
            <p className="text-sm text-white/45 mb-2.5">
              This keeps the crew safe. Skip if there is none.
            </p>
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
                  {h.label}
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
          Anything else? <span className="text-white/40 font-normal">(optional)</span>
        </label>
        <p className="text-sm text-white/45 mb-2.5">Type it, or hold the button and speak.</p>

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
          {transcribing ? 'Writing down what you said…' : recording ? 'Listening — release to stop' : 'Hold to speak'}
        </button>
      </div>

      <div className="mt-8">
        <PrimaryButton disabled={!canContinue} onClick={onNext}>
          Continue
        </PrimaryButton>
        {!canContinue && (
          <p className="text-sm text-white/40 mt-2 text-center">
            Choose an option above, or describe what happened.
          </p>
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
  const hasLocation = geoState === 'ok' && coords
  const canSend = hasLocation || manualAddress.trim().length > 4

  return (
    <div className="pt-4">
      <BackLink onClick={onBack} />

      <h2 className="text-2xl font-bold mt-2 leading-tight">Where should we send help?</h2>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        {geoState === 'locating' && (
          <p className="text-base text-white/70">Finding your location…</p>
        )}

        {hasLocation && (
          <>
            <p className="text-xs uppercase tracking-wider text-emerald-400 font-semibold">
              Location found
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
              {geoState === 'denied' ? 'Location permission was blocked' : 'This device cannot share location'}
            </p>
            <p className="text-sm text-white/55 mt-1.5 leading-relaxed">
              Type where the emergency is instead. A landmark is enough.
            </p>
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
          Your phone number <span className="text-white/40 font-normal">(optional)</span>
        </label>
        <p className="text-sm text-white/45 mb-2.5">
          {branch === 'BYSTANDER'
            ? 'So the crew can call you if they cannot find the spot.'
            : 'So the crew can call you on the way.'}
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
          Send for help now
        </PrimaryButton>
        {!canSend && (
          <p className="text-sm text-white/40 mt-2 text-center">
            We need a location before we can send a crew.
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
            <h2 className="text-2xl font-bold leading-tight">{status.title}</h2>
            <p className="text-white/65 mt-1 leading-relaxed">{status.detail}</p>
          </div>
        </div>

        <p className="text-xs text-white/40 mt-4 font-mono">
          Reference {incident.incidentNumber}
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
              <span className={`pt-1 text-base ${reached ? 'text-white' : 'text-white/40'}`}>{label}</span>
            </li>
          )
        })}
      </ol>

      {urgency && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs uppercase tracking-wider text-white/40 font-semibold">
            How urgent this was judged
          </p>
          <p className={`text-xl font-bold mt-1.5 ${urgency.tone}`}>{urgency.label}</p>
          <p className="text-sm text-white/55 mt-1 leading-relaxed">{urgency.note}</p>
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
                Your ambulance
              </p>
              <p className="text-lg font-bold mt-1.5">{ambulance.vehicleNumber}</p>
              {eta != null && (
                <p className="text-base text-white/70 mt-0.5">
                  About <span className="font-bold text-white">{eta} minutes</span> away
                </p>
              )}
            </div>
          )}

          {hospital && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-wider text-white/40 font-semibold">
                Hospital expecting you
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
            What you can do while you wait
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
          Call {EMERGENCY_NUMBER}
        </a>

        {finished ? (
          <button
            type="button"
            onClick={onNew}
            className="w-full rounded-2xl border border-white/15 hover:border-white/35 py-3.5 font-semibold transition-colors"
          >
            Report another emergency
          </button>
        ) : (
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-2xl border border-white/15 hover:border-red-500/50 hover:text-red-300 py-3.5 font-semibold transition-colors"
          >
            Help is no longer needed — cancel
          </button>
        )}
      </div>

      <p className="text-xs text-white/35 mt-6 leading-relaxed">
        Keep this page open to follow the ambulance. If you close it, this device will
        remember the report and bring you back here.
      </p>
    </div>
  )
}
