/**
 * ==============================================================================
 * MEDIROUTE - WALKTHROUGH TRACKS, ONE PER ROLE (components/tourTracks.jsx)
 * ==============================================================================
 *
 * WHAT IS WHERE:
 * - Line 40-130:   Shared mock primitives (phone frame, console frame, rows)
 * - Line 132-330:  Citizen scenes
 * - Line 332-470:  Paramedic scenes
 * - Line 472-590:  Hospital scenes
 * - Line 592-700:  Control room scenes
 * - Line 702-900:  TRACKS - the four scripts
 *
 * WHY FOUR TRACKS:
 * The original walkthrough told the citizen's story and gave the three staff
 * roles one shared chapter at the end. Each role does a different job on a
 * different screen, so each now gets its own narrated run through their own
 * work, reachable from the landing page and from the help button inside their
 * own portal.
 *
 * Scenes are built from live DOM rather than recorded video: nothing to host,
 * nothing that drifts out of date when the UI changes, readable on a slow
 * connection, and the narration is selectable text rather than burnt-in pixels.
 * ==============================================================================
 */

import { motion } from 'framer-motion'

// ──────────────────────────────────────────────────────────────────────────────
// SHARED PRIMITIVES
// ──────────────────────────────────────────────────────────────────────────────

export function Rise({ children, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
    >
      {children}
    </motion.div>
  )
}

/** A phone frame, for the citizen-facing screens. */
export function Phone({ children, label }) {
  return (
    <div className="relative mx-auto" style={{ width: 232 }}>
      <div
        className="rounded-[2rem] border-[6px] border-white/12 bg-[#0A0A0F] overflow-hidden shadow-2xl"
        style={{ height: 420 }}
      >
        <div className="h-5 bg-black/60 flex items-center justify-center">
          <div className="h-1 w-10 rounded-full bg-white/20" />
        </div>
        <div className="p-3 h-[calc(100%-1.25rem)] overflow-hidden">{children}</div>
      </div>
      {label && (
        <p className="text-center text-[10px] font-mono uppercase tracking-wider text-white/30 mt-2">
          {label}
        </p>
      )}
    </div>
  )
}

/** A desktop console frame, for the three staff portals. */
export function Console({ children, title, label }) {
  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="rounded-2xl border border-white/12 bg-[#0A0A0F] overflow-hidden shadow-2xl">
        <div className="h-8 bg-white/[0.04] border-b border-white/10 flex items-center gap-2 px-3">
          <span className="h-2 w-2 rounded-full bg-red-500/60" />
          <span className="h-2 w-2 rounded-full bg-amber-500/60" />
          <span className="h-2 w-2 rounded-full bg-emerald-500/60" />
          <span className="ml-2 text-[10px] font-mono text-white/40">{title}</span>
        </div>
        <div className="p-4 space-y-2.5 min-h-[300px]">{children}</div>
      </div>
      {label && (
        <p className="text-center text-[10px] font-mono uppercase tracking-wider text-white/30 mt-2">
          {label}
        </p>
      )}
    </div>
  )
}

/** One row in a console list. */
export function Row({ left, right, tone = 'neutral', delay = 0 }) {
  const tones = {
    neutral: 'border-white/10 bg-white/[0.03]',
    danger: 'border-red-500/30 bg-red-500/[0.07]',
    warn: 'border-amber-500/30 bg-amber-500/[0.07]',
    good: 'border-emerald-500/30 bg-emerald-500/[0.07]',
    cyan: 'border-cyan-400/30 bg-cyan-400/[0.07]',
  }
  return (
    <Rise delay={delay}>
      <div className={`rounded-xl border px-3 py-2.5 flex items-center justify-between gap-3 ${tones[tone]}`}>
        <span className="text-[11px] text-white/85 leading-snug">{left}</span>
        {right && <span className="text-[10px] font-mono text-white/55 shrink-0">{right}</span>}
      </div>
    </Rise>
  )
}

/** A labelled readout tile. */
export function Tile({ label, value, tone = 'text-white', delay = 0, sub }) {
  return (
    <Rise delay={delay}>
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
        <p className="text-[9px] font-mono uppercase tracking-wider text-white/40">{label}</p>
        <p className={`text-lg font-bold mt-0.5 ${tone}`}>{value}</p>
        {sub && <p className="text-[10px] text-white/45 mt-0.5 leading-snug">{sub}</p>}
      </div>
    </Rise>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// CITIZEN SCENES
// ──────────────────────────────────────────────────────────────────────────────

function CitizenOverview() {
  const roles = [
    { label: 'You', detail: 'Report an emergency', tone: 'text-red-400' },
    { label: 'Ambulance crew', detail: 'Get sent to you', tone: 'text-cyan-300' },
    { label: 'Hospital', detail: 'Prepares before you arrive', tone: 'text-emerald-400' },
    { label: 'City control', detail: 'Watches the whole network', tone: 'text-purple-300' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
      {roles.map((r, i) => (
        <Rise key={r.label} delay={i * 0.18}>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 h-full">
            <p className={`text-sm font-bold ${r.tone}`}>{r.label}</p>
            <p className="text-xs text-white/50 mt-1 leading-snug">{r.detail}</p>
          </div>
        </Rise>
      ))}
    </div>
  )
}

function CitizenTwoChoices() {
  return (
    <Phone label="The only screen you start on">
      <p className="text-base font-bold text-white leading-tight">Get emergency help</p>
      <p className="text-[10px] text-white/45 mt-1">No account needed.</p>
      <div className="mt-4 space-y-2">
        <Rise delay={0.2}>
          <div className="rounded-xl bg-red-600 px-3 py-4">
            <p className="text-sm font-bold">I need help</p>
            <p className="text-[10px] text-white/75">Something is wrong with me</p>
          </div>
        </Rise>
        <Rise delay={0.45}>
          <div className="rounded-xl border-2 border-white/15 px-3 py-4">
            <p className="text-sm font-bold">Someone else needs help</p>
            <p className="text-[10px] text-white/45">I can see a person who is hurt</p>
          </div>
        </Rise>
      </div>
    </Phone>
  )
}

function CitizenSelfReport() {
  const chips = ['Chest pain', "Can't breathe properly", 'Bleeding badly', 'I had an accident']
  return (
    <Phone label="Pick the closest option">
      <p className="text-sm font-bold text-white">What&apos;s wrong?</p>
      <div className="mt-3 space-y-1.5">
        {chips.map((c, i) => (
          <Rise key={c} delay={i * 0.2}>
            <div
              className={`rounded-xl border px-3 py-2.5 text-[11px] font-semibold ${
                i === 0 ? 'border-cyan-400 bg-cyan-400/10' : 'border-white/10 text-white/70'
              }`}
            >
              {c}
            </div>
          </Rise>
        ))}
      </div>
      <Rise delay={1}>
        <div className="mt-3 rounded-xl border border-white/15 py-2.5 text-center text-[11px] font-semibold text-white/70">
          Hold to speak
        </div>
      </Rise>
    </Phone>
  )
}

function CitizenBystander() {
  const qs = [
    { q: 'Is the person awake?', a: 'No' },
    { q: 'Are they breathing?', a: 'Yes' },
    { q: 'How many are hurt?', a: '1' },
  ]
  return (
    <Phone label="Only what you can see">
      <p className="text-sm font-bold text-white">What has happened?</p>
      <div className="mt-3 space-y-3">
        {qs.map((item, i) => (
          <Rise key={item.q} delay={i * 0.3}>
            <div>
              <p className="text-[11px] font-semibold text-white">{item.q}</p>
              <div className="grid grid-cols-3 gap-1 mt-1.5">
                {['Yes', 'No', 'Not sure'].map((opt) => (
                  <div
                    key={opt}
                    className={`rounded-lg border py-1.5 text-center text-[10px] font-semibold ${
                      opt === item.a
                        ? 'border-cyan-400 bg-cyan-400/15'
                        : 'border-white/10 text-white/50'
                    }`}
                  >
                    {opt}
                  </div>
                ))}
              </div>
            </div>
          </Rise>
        ))}
      </div>
    </Phone>
  )
}

function CitizenTriage() {
  return (
    <div className="max-w-md mx-auto space-y-3">
      <Rise>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[10px] font-mono uppercase tracking-wider text-white/40">What you said</p>
          <p className="text-sm text-white/80 mt-1 leading-snug">
            &ldquo;Scooter hit a car, the rider is not moving, bleeding from the head.&rdquo;
          </p>
        </div>
      </Rise>
      <Rise delay={0.5}>
        <p className="text-center text-[10px] font-mono text-cyan-300 py-1">clinical AI reads it…</p>
      </Rise>
      <Rise delay={1}>
        <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.07] p-4">
          <p className="text-[10px] font-mono uppercase tracking-wider text-white/40">How urgent</p>
          <p className="text-xl font-bold text-red-400 mt-1">Most urgent</p>
          <p className="text-xs text-white/60 mt-1.5 leading-relaxed">
            A trauma crew and a trauma centre are chosen, not just the nearest hospital.
          </p>
        </div>
      </Rise>
    </div>
  )
}

function CitizenTracking() {
  const steps = ['Report received', 'Urgency assessed', 'Ambulance assigned', 'On the way to you']
  return (
    <Phone label="Follow it on your phone">
      <div className="rounded-xl border border-red-500/30 bg-red-500/[0.07] p-3">
        <p className="text-sm font-bold">Ambulance on the way</p>
      </div>
      <div className="mt-3 space-y-0">
        {steps.map((s, i) => (
          <Rise key={s} delay={i * 0.3}>
            <div className="flex items-center gap-2 py-1">
              <span className="h-5 w-5 rounded-full grid place-items-center text-[9px] font-bold bg-emerald-500 text-black">
                ✓
              </span>
              <span className="text-[11px] text-white/85">{s}</span>
            </div>
          </Rise>
        ))}
      </div>
      <Rise delay={1.3}>
        <div className="mt-3 rounded-xl border border-cyan-400/25 bg-cyan-400/[0.06] p-3">
          <p className="text-[9px] font-mono uppercase text-cyan-300">Your ambulance</p>
          <p className="text-sm font-bold mt-0.5">MH-AMB-001</p>
          <p className="text-[11px] text-white/70">About 6 minutes away</p>
        </div>
      </Rise>
    </Phone>
  )
}

function CitizenFirstAid() {
  const actions = [
    'Keep the airway clear, do not move the neck',
    'Press firmly on the bleeding with clean cloth',
    'Stay with them and keep them warm',
  ]
  return (
    <div className="max-w-md mx-auto">
      <Rise>
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5">
          <p className="text-[10px] font-mono uppercase tracking-wider text-emerald-300">
            What you can do while you wait
          </p>
          <ul className="mt-3 space-y-2.5">
            {actions.map((a, i) => (
              <Rise key={a} delay={0.3 + i * 0.3}>
                <li className="flex gap-2.5 text-sm text-white/85 leading-relaxed">
                  <span className="text-emerald-400 shrink-0">•</span>
                  <span>{a}</span>
                </li>
              </Rise>
            ))}
          </ul>
        </div>
      </Rise>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// PARAMEDIC SCENES
// ──────────────────────────────────────────────────────────────────────────────

function MedicDispatch() {
  return (
    <Console title="Field console" label="A job arrives">
      <Row left="New dispatch" right="just now" tone="danger" />
      <Rise delay={0.3}>
        <div className="rounded-xl border border-red-500/30 bg-red-500/[0.07] p-3">
          <p className="text-sm font-bold text-white">Bike crash, rider unconscious</p>
          <p className="text-[11px] text-white/55 mt-1">Most urgent · head injury suspected</p>
        </div>
      </Rise>
      <div className="grid grid-cols-3 gap-2 pt-1">
        <Tile label="Distance" value="4.3 km" delay={0.6} />
        <Tile label="ETA" value="9 min" tone="text-emerald-400" delay={0.75} />
        <Tile label="Speed" value="42 km/h" tone="text-cyan-300" delay={0.9} />
      </div>
    </Console>
  )
}

function MedicNavigation() {
  return (
    <Console title="Navigation" label="Your own phone drives it">
      <Row left="GPS from this device" right="live" tone="cyan" />
      <Row left="Position sent to control room" right="every 8s" delay={0.3} />
      <Row left="Patient sees you moving" right="live" tone="good" delay={0.6} />
      <Rise delay={0.9}>
        <p className="text-[11px] text-white/45 leading-relaxed pt-1">
          If it reads &ldquo;no GPS&rdquo;, location permission is off. The console says so
          rather than showing a made-up speed.
        </p>
      </Rise>
    </Console>
  )
}

function MedicChecklist() {
  const items = [
    { t: 'Maintain C-spine immobilisation', done: true },
    { t: 'Control external bleeding', done: true },
    { t: 'Large-bore IV access', done: false },
    { t: 'Hand over to receiving ER team', done: false },
  ]
  return (
    <Console title="Interventions" label="Generated for this patient">
      {items.map((it, i) => (
        <Rise key={it.t} delay={i * 0.25}>
          <div
            className={`rounded-xl border px-3 py-2.5 flex items-center gap-2.5 ${
              it.done
                ? 'border-emerald-500/40 bg-emerald-500/[0.08]'
                : 'border-white/10 bg-white/[0.03]'
            }`}
          >
            <span className="text-sm">{it.done ? '☑' : '☐'}</span>
            <span className="text-[11px] text-white/85">{it.t}</span>
          </div>
        </Rise>
      ))}
      <Rise delay={1.1}>
        <p className="text-[11px] text-white/45 leading-relaxed pt-1">
          Built from this patient&apos;s own assessment, not a fixed protocol. Ticking one
          shows on the hospital&apos;s screen immediately.
        </p>
      </Rise>
    </Console>
  )
}

function MedicVitals() {
  return (
    <Console title="Vitals" label="Measured readings can change the triage">
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Heart rate" value="148" tone="text-red-400" sub="bpm" />
        <Tile label="SpO2" value="86%" tone="text-red-400" delay={0.2} />
        <Tile label="Blood pressure" value="84/52" tone="text-amber-400" delay={0.4} />
        <Tile label="GCS" value="7" tone="text-red-400" delay={0.6} />
      </div>
      <Rise delay={0.9}>
        <div className="rounded-xl border border-red-500/30 bg-red-500/[0.07] p-3 mt-1">
          <p className="text-[11px] text-red-200 leading-relaxed">
            These are worse than the phone description suggested. The case is reassessed,
            the severity raised, and the hospital told before you arrive.
          </p>
        </div>
      </Rise>
    </Console>
  )
}

function MedicDictation() {
  return (
    <Console title="Notes" label="Real transcription, not a canned line">
      <Row left="Tap the microphone, speak, tap again" right="Whisper" tone="cyan" />
      <Rise delay={0.4}>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] font-mono text-white/40">14:21 · dictated</p>
          <p className="text-[11px] text-white/80 mt-1 leading-relaxed">
            &ldquo;Airway clear, collar applied, two large-bore lines running, patient
            responds to pain only.&rdquo;
          </p>
        </div>
      </Rise>
      <Rise delay={0.9}>
        <p className="text-[11px] text-white/45 leading-relaxed">
          The note is attached to the patient record and reaches the emergency department
          as you say it, not at handover.
        </p>
      </Rise>
    </Console>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// HOSPITAL SCENES
// ──────────────────────────────────────────────────────────────────────────────

function HospitalQueue() {
  return (
    <Console title="Emergency department" label="Who is on the way to you">
      <Row left="Bike crash, unconscious · Most urgent" right="ETA 9 min" tone="danger" />
      <Row left="Chest pain, 61 · Very urgent" right="ETA 14 min" tone="warn" delay={0.3} />
      <Row left="Fall at home, conscious · Urgent" right="ETA 22 min" delay={0.6} />
      <Rise delay={0.9}>
        <p className="text-[11px] text-white/45 leading-relaxed pt-1">
          The list updates while the crew works, not only when they arrive.
        </p>
      </Rise>
    </Console>
  )
}

function HospitalPrep() {
  const items = [
    { t: 'Receiving team alerted and briefed', done: true },
    { t: 'Trauma bay cleared and equipped', done: true },
    { t: 'Crossmatch samples and O-negative ready', done: false },
    { t: 'CT scanner cleared for priority imaging', done: false },
  ]
  return (
    <Console title="Pre-arrival" label="Specific to this patient">
      {items.map((it, i) => (
        <Rise key={it.t} delay={i * 0.25}>
          <div
            className={`rounded-xl border px-3 py-2.5 flex items-center gap-2.5 ${
              it.done
                ? 'border-emerald-500/40 bg-emerald-500/[0.08]'
                : 'border-white/10 bg-white/[0.03]'
            }`}
          >
            <span className="text-sm">{it.done ? '☑' : '☐'}</span>
            <span className="text-[11px] text-white/85">{it.t}</span>
          </div>
        </Rise>
      ))}
      <Rise delay={1.1}>
        <p className="text-[11px] text-white/45 leading-relaxed pt-1">
          A cardiac case and a head injury get different steps. The crew sees what you
          have already done.
        </p>
      </Rise>
    </Console>
  )
}

function HospitalResources() {
  return (
    <Console title="Resources" label="Saved, and visible city-wide">
      <div className="grid grid-cols-2 gap-2">
        <Tile label="O-negative" value="18 units" tone="text-red-400" />
        <Tile label="Plasma" value="24 units" delay={0.2} />
        <Tile label="Ventilators" value="5 / 18" tone="text-cyan-300" delay={0.4} sub="available" />
        <Tile label="Bays free" value="6 / 16" tone="text-emerald-400" delay={0.6} />
      </div>
      <Rise delay={0.9}>
        <p className="text-[11px] text-white/45 leading-relaxed">
          Tap a bay to move it between available, occupied and cleaning. Ordering blood is
          saved to this hospital&apos;s record, so the control room sees it at once.
        </p>
      </Rise>
    </Console>
  )
}

function HospitalMissing() {
  return (
    <Console title="Handover" label="Missing data is shown as missing">
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Heart rate" value="148" tone="text-red-400" sub="bpm" />
        <Tile label="SpO2" value="Not recorded" tone="text-white/30" delay={0.2} />
      </div>
      <Rise delay={0.6}>
        <p className="text-[11px] text-white/45 leading-relaxed pt-1">
          Where a reading says &ldquo;Not recorded&rdquo;, the crew genuinely has not sent
          one. The screen never fills in a plausible number for a measurement nobody took.
        </p>
      </Rise>
    </Console>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// CONTROL ROOM SCENES
// ──────────────────────────────────────────────────────────────────────────────

function AdminMap() {
  return (
    <Console title="City command" label="Everything live, on one map">
      <Row left="Active emergencies" right="2" tone="danger" />
      <Row left="Units available" right="3 of 4" tone="good" delay={0.25} />
      <Row left="Hospitals on diversion" right="1" tone="warn" delay={0.5} />
      <Rise delay={0.8}>
        <div className="rounded-xl border border-red-500/30 bg-red-500/[0.07] p-3">
          <p className="text-[11px] text-white/80 leading-relaxed">
            The red line is the road the ambulance is actually driving, from the routing
            engine. Selecting a case frames its whole route.
          </p>
        </div>
      </Rise>
    </Console>
  )
}

function AdminFleet() {
  return (
    <Console title="Fleet" label="An open job holds its unit">
      <Row left="MH-AMB-001 · available" right="idle" tone="good" />
      <Row left="MH-AMB-003 · en route to patient" right="42 km/h" tone="cyan" delay={0.25} />
      <Row left="MH-AMB-002 · available" right="idle" tone="good" delay={0.5} />
      <Rise delay={0.8}>
        <p className="text-[11px] text-white/45 leading-relaxed pt-1">
          Only available units can be dispatched, so a job left open quietly removes a
          vehicle from service. Closing abandoned cases returns them.
        </p>
      </Rise>
    </Console>
  )
}

function AdminForecast() {
  return (
    <Console title="Demand forecast" label="Statistics, and it says so">
      <Row left="18:00" right="load 74 · confidence 83%" tone="warn" />
      <Row left="19:00" right="load 81 · confidence 83%" tone="danger" delay={0.25} />
      <Row left="03:00" right="load 21 · confidence 35%" delay={0.5} />
      <Rise delay={0.8}>
        <p className="text-[11px] text-white/45 leading-relaxed pt-1">
          Built from this deployment&apos;s own incident history, bucketed by hour. A low
          confidence means there is not enough history yet, not that the city is quiet.
          This one is not AI, and it is not labelled as AI.
        </p>
      </Rise>
    </Console>
  )
}

function AdminHonesty() {
  return (
    <div className="max-w-md mx-auto space-y-3">
      <Rise>
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.07] p-4">
          <p className="text-[10px] font-mono uppercase tracking-wider text-emerald-300">
            AI online
          </p>
          <p className="text-xs text-white/70 mt-1.5 leading-relaxed">
            Assessed by openai/gpt-oss-120b
          </p>
        </div>
      </Rise>
      <Rise delay={0.5}>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] p-4">
          <p className="text-[10px] font-mono uppercase tracking-wider text-amber-300">
            AI degraded
          </p>
          <p className="text-xs text-white/70 mt-1.5 leading-relaxed">
            Assessed by the offline clinical protocol, not the AI. Reassess on arrival.
          </p>
        </div>
      </Rise>
      <Rise delay={1}>
        <p className="text-[11px] text-white/45 leading-relaxed">
          Every assessment records which engine produced it. A fallback is never presented
          as an AI result.
        </p>
      </Rise>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// THE FOUR SCRIPTS
// ──────────────────────────────────────────────────────────────────────────────

export const TRACKS = {
  citizen: {
    id: 'citizen',
    name: 'I am a member of the public',
    short: 'Citizen',
    blurb: 'Reporting an emergency and following the ambulance',
    accent: 'border-red-500/40 hover:border-red-500',
    chapters: [
      {
        id: 'what',
        title: 'What this is',
        caption:
          'MediRoute connects four people in one emergency: you, the ambulance crew, the hospital, and the city control room. You only ever deal with the first part.',
        ms: 9000,
        Scene: CitizenOverview,
      },
      {
        id: 'start',
        title: 'Starting a report',
        caption:
          'Open the emergency page and you get two buttons. No sign-up, no password, no form to fill in first. Choose whether the emergency is yours or someone else’s.',
        ms: 9500,
        Scene: CitizenTwoChoices,
      },
      {
        id: 'self',
        title: 'If it is you',
        caption:
          'Tap the closest description. You do not need the right medical words. If nothing fits, type it or hold the button and say it out loud.',
        ms: 9500,
        Scene: CitizenSelfReport,
      },
      {
        id: 'bystander',
        title: 'If it is someone else',
        caption:
          'Helping a stranger is different: you will not know their blood group. So you are only asked what anyone can see. “Not sure” is a perfectly good answer.',
        ms: 10500,
        Scene: CitizenBystander,
      },
      {
        id: 'triage',
        title: 'How urgency is decided',
        caption:
          'A clinical AI reads your description and decides how serious it is. That decision picks the type of crew and the kind of hospital, so a cardiac case goes somewhere with a cath lab rather than merely the closest building.',
        ms: 11000,
        Scene: CitizenTriage,
      },
      {
        id: 'track',
        title: 'Following the ambulance',
        caption:
          'The page shows where things stand in plain words, which vehicle is coming, and roughly how far away it is. Close the page and your phone brings you back to it.',
        ms: 10000,
        Scene: CitizenTracking,
      },
      {
        id: 'firstaid',
        title: 'While you wait',
        caption:
          'You also get a few things you can safely do before the crew arrives, matched to this emergency. Only do what feels safe, and never move someone unless they are in danger.',
        ms: 10000,
        Scene: CitizenFirstAid,
      },
    ],
  },

  paramedic: {
    id: 'paramedic',
    name: 'I am an ambulance crew member',
    short: 'Paramedic',
    blurb: 'Taking a job, navigating, and handing over',
    accent: 'border-cyan-400/40 hover:border-cyan-400',
    chapters: [
      {
        id: 'dispatch',
        title: 'A job arrives',
        caption:
          'You are assigned automatically: the nearest available unit to the patient. The screen opens with what happened, how urgent it is, and how far you have to go.',
        ms: 9500,
        Scene: MedicDispatch,
      },
      {
        id: 'nav',
        title: 'Navigation runs off your phone',
        caption:
          'Speed, distance and ETA come from this device. Your position is sent to the control room and to the person who called, so they can see you coming. Nothing is simulated while you are signed in.',
        ms: 10500,
        Scene: MedicNavigation,
      },
      {
        id: 'checklist',
        title: 'Your checklist is for this patient',
        caption:
          'The interventions listed were generated from this patient’s own assessment, not a fixed protocol. Ticking one is saved and appears on the receiving hospital’s screen.',
        ms: 10500,
        Scene: MedicChecklist,
      },
      {
        id: 'vitals',
        title: 'Recording vitals can change the triage',
        caption:
          'When you send measured vitals, the case is reassessed. If the numbers are worse than the phone description suggested, the severity is raised and the hospital is told before you arrive.',
        ms: 11000,
        Scene: MedicVitals,
      },
      {
        id: 'notes',
        title: 'Dictation is real transcription',
        caption:
          'Tap the microphone, speak, then tap again. The recording is transcribed and attached to the patient record, and the emergency department sees it straight away.',
        ms: 10000,
        Scene: MedicDictation,
      },
    ],
  },

  hospital: {
    id: 'hospital',
    name: 'I work in an emergency department',
    short: 'Hospital ER',
    blurb: 'Seeing who is inbound and preparing for them',
    accent: 'border-emerald-400/40 hover:border-emerald-400',
    chapters: [
      {
        id: 'queue',
        title: 'Who is on the way to you',
        caption:
          'The queue shows patients an ambulance is bringing in, with how urgent they are and what the crew has found so far. It updates while they work, not only at handover.',
        ms: 9500,
        Scene: HospitalQueue,
      },
      {
        id: 'prep',
        title: 'The pre-arrival list is per patient',
        caption:
          'It is generated from that specific patient’s assessment, so a cardiac case and a head injury get different steps. Ticking an item is saved and the crew sees it.',
        ms: 10500,
        Scene: HospitalPrep,
      },
      {
        id: 'resources',
        title: 'Bays, blood and ventilators are live',
        caption:
          'Tap a bay to move it between available, occupied and cleaning. Blood stock changes are saved to this hospital’s record, so the city control room sees them immediately.',
        ms: 10500,
        Scene: HospitalResources,
      },
      {
        id: 'missing',
        title: 'Missing data is shown as missing',
        caption:
          'Where a vital sign reads “Not recorded”, the crew has genuinely not sent one yet. The screen will never fill in a plausible number for a reading nobody measured.',
        ms: 10000,
        Scene: HospitalMissing,
      },
    ],
  },

  admin: {
    id: 'admin',
    name: 'I run the city control room',
    short: 'City control',
    blurb: 'Watching the network and keeping it dispatchable',
    accent: 'border-purple-400/40 hover:border-purple-400',
    chapters: [
      {
        id: 'map',
        title: 'The whole city at once',
        caption:
          'Every live emergency, every ambulance and every hospital on one map. Nothing here is a simulation: it is read from the same database the crews and hospitals write to.',
        ms: 10000,
        Scene: AdminMap,
      },
      {
        id: 'fleet',
        title: 'Keeping the fleet dispatchable',
        caption:
          'An incident holds its ambulance until it is closed, and only available units can be dispatched. A job left open quietly removes a vehicle from service, so closing abandoned cases matters more than it sounds.',
        ms: 11000,
        Scene: AdminFleet,
      },
      {
        id: 'forecast',
        title: 'The forecast admits what it does not know',
        caption:
          'Demand is projected from this deployment’s own incident history, bucketed by hour of day, with confidence scaled to how much history backs each hour. It is statistics, not AI, and it is labelled that way.',
        ms: 11000,
        Scene: AdminForecast,
      },
      {
        id: 'honesty',
        title: 'You can always see what decided',
        caption:
          'Every assessment records the engine that produced it. If the clinical AI is unreachable, a deterministic protocol takes over and says so, rather than a fallback quietly being presented as an AI result.',
        ms: 11000,
        Scene: AdminHonesty,
      },
    ],
  },
}

export const TRACK_ORDER = ['citizen', 'paramedic', 'hospital', 'admin']
