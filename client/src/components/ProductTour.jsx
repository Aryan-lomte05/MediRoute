/**
 * ==============================================================================
 * MEDIROUTE - INTERACTIVE PRODUCT TOUR (components/ProductTour.jsx)
 * ==============================================================================
 *
 * WHAT IS WHERE:
 * - Line 40-80:    Phone frame + shared mock primitives
 * - Line 82-300:   Scene components, one per chapter
 * - Line 302-400:  CHAPTERS - the tour script (narration + duration + scene)
 * - Line 402-520:  Playback engine (timer, progress, keyboard, reduced motion)
 * - Line 522-660:  Chrome - transport controls, chapter list, captions
 *
 * WHY THIS EXISTS INSTEAD OF A VIDEO:
 * Review feedback was that civilians could not tell what the app does or how to
 * use it. This plays like a narrated walkthrough but is built from live DOM, so
 * it costs no video hosting, never drifts out of date when the UI changes, is
 * readable on a slow connection, and its captions are real selectable text
 * rather than burnt-in pixels.
 *
 * ACCESSIBILITY:
 * - Captions are always visible, not an optional track.
 * - Space/arrow keys drive playback; every control is a real button.
 * - Honours prefers-reduced-motion by not auto-advancing.
 * ==============================================================================
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ──────────────────────────────────────────────────────────────────────────────
// SHARED MOCK PRIMITIVES
// ──────────────────────────────────────────────────────────────────────────────

/** A phone-shaped frame. Scenes render the app's real screens inside it. */
function Phone({ children, label }) {
  return (
    <div className="relative mx-auto" style={{ width: 232 }}>
      <div className="rounded-[2rem] border-[6px] border-white/12 bg-[#0A0A0F] overflow-hidden shadow-2xl" style={{ height: 420 }}>
        <div className="h-5 bg-black/60 flex items-center justify-center">
          <div className="h-1 w-10 rounded-full bg-white/20" />
        </div>
        <div className="p-3 h-[calc(100%-1.25rem)] overflow-hidden">{children}</div>
      </div>
      {label && (
        <p className="text-center text-[10px] font-mono uppercase tracking-wider text-white/30 mt-2">{label}</p>
      )}
    </div>
  )
}

/** An animated tap indicator, used to show where a finger goes. */
function Tap({ delay = 0.6, x = '50%', y = '50%' }) {
  return (
    <motion.span
      className="absolute h-9 w-9 rounded-full border-2 border-cyan-300 pointer-events-none"
      style={{ left: x, top: y, marginLeft: -18, marginTop: -18 }}
      initial={{ scale: 0.3, opacity: 0 }}
      animate={{ scale: [0.3, 1, 1.5], opacity: [0, 1, 0] }}
      transition={{ delay, duration: 1.4, repeat: Infinity, repeatDelay: 0.8 }}
    />
  )
}

function MockButton({ children, tone = 'red', small }) {
  const tones = {
    red: 'bg-red-600 text-white',
    ghost: 'border border-white/15 text-white/80',
    cyan: 'border border-cyan-400 bg-cyan-400/10 text-white',
  }
  return (
    <div className={`rounded-xl font-bold ${small ? 'px-3 py-2 text-[11px]' : 'px-4 py-3 text-xs'} ${tones[tone]}`}>
      {children}
    </div>
  )
}

function Rise({ children, delay = 0 }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.35 }}>
      {children}
    </motion.div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// SCENES
// ──────────────────────────────────────────────────────────────────────────────

function SceneOverview() {
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

function SceneTwoChoices() {
  return (
    <Phone label="The only screen you start on">
      <div className="relative">
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
        <Tap delay={1} x="50%" y="46%" />
      </div>
    </Phone>
  )
}

function SceneSelfReport() {
  const chips = ['Chest pain', "Can't breathe properly", 'Bleeding badly', 'I had an accident']
  return (
    <Phone label="Pick the closest option">
      <p className="text-sm font-bold text-white">What&apos;s wrong?</p>
      <p className="text-[10px] text-white/45 mt-0.5">Pick the closest one.</p>
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
        <div className="mt-3">
          <MockButton small>Hold to speak</MockButton>
        </div>
      </Rise>
    </Phone>
  )
}

function SceneBystander() {
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
                      opt === item.a ? 'border-cyan-400 bg-cyan-400/15' : 'border-white/10 text-white/50'
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

function SceneTriage() {
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
        <div className="flex items-center justify-center py-1">
          <span className="text-[10px] font-mono text-cyan-300">clinical AI reads it…</span>
        </div>
      </Rise>

      <Rise delay={1}>
        <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.07] p-4">
          <p className="text-[10px] font-mono uppercase tracking-wider text-white/40">How urgent</p>
          <p className="text-xl font-bold text-red-400 mt-1">Most urgent</p>
          <p className="text-xs text-white/60 mt-1.5 leading-relaxed">
            Treated as immediately life-threatening. A trauma crew and a trauma centre are
            chosen, not just the nearest hospital.
          </p>
        </div>
      </Rise>
    </div>
  )
}

function SceneDispatch() {
  const steps = [
    { label: 'Nearest free ambulance found', delay: 0.2 },
    { label: 'Hospital with the right specialists picked', delay: 0.8 },
    { label: 'Crew and hospital both alerted', delay: 1.4 },
  ]
  return (
    <div className="max-w-md mx-auto space-y-2.5">
      {steps.map((s) => (
        <Rise key={s.label} delay={s.delay}>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5">
            <span className="h-6 w-6 rounded-full bg-emerald-500 text-black grid place-items-center text-xs font-bold shrink-0">
              ✓
            </span>
            <span className="text-sm text-white/85">{s.label}</span>
          </div>
        </Rise>
      ))}
      <Rise delay={2}>
        <p className="text-center text-[11px] font-mono text-white/35 pt-1">
          all of this happens in a few seconds, with no call
        </p>
      </Rise>
    </div>
  )
}

function SceneTracking() {
  const steps = ['Report received', 'Urgency assessed', 'Ambulance assigned', 'On the way to you']
  return (
    <Phone label="Follow it on your phone">
      <div className="rounded-xl border border-red-500/30 bg-red-500/[0.07] p-3">
        <p className="text-sm font-bold">Ambulance on the way</p>
        <p className="text-[10px] text-white/60 mt-0.5">A crew is heading to you.</p>
      </div>
      <div className="mt-3 space-y-0">
        {steps.map((s, i) => (
          <Rise key={s} delay={i * 0.3}>
            <div className="flex items-center gap-2 py-1">
              <span
                className={`h-5 w-5 rounded-full grid place-items-center text-[9px] font-bold ${
                  i < 4 ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white/40'
                }`}
              >
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

function SceneFirstAid() {
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
          <Rise delay={1.4}>
            <p className="text-[11px] text-white/40 mt-4 leading-relaxed">
              These steps come from the same clinical assessment that was used to rank the
              emergency, so they match this specific situation.
            </p>
          </Rise>
        </div>
      </Rise>
    </div>
  )
}

function SceneProfessionals() {
  const portals = [
    { name: 'Ambulance crew', detail: 'Turn-by-turn route, patient vitals, dictated notes', tone: 'border-cyan-400/30' },
    { name: 'Hospital ER', detail: 'Who is inbound, how urgent, bays and blood stock', tone: 'border-emerald-400/30' },
    { name: 'City control', detail: 'Every unit and hospital on one map', tone: 'border-purple-400/30' },
  ]
  return (
    <div className="max-w-md mx-auto space-y-2.5">
      {portals.map((p, i) => (
        <Rise key={p.name} delay={i * 0.25}>
          <div className={`rounded-2xl border bg-white/[0.03] p-4 ${p.tone}`}>
            <p className="text-sm font-bold text-white">{p.name}</p>
            <p className="text-xs text-white/50 mt-1 leading-snug">{p.detail}</p>
          </div>
        </Rise>
      ))}
      <Rise delay={0.9}>
        <p className="text-center text-[11px] font-mono text-white/35 pt-1">
          these need a staff login — the emergency page never does
        </p>
      </Rise>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// THE SCRIPT
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Each chapter is a title, the narration shown as a caption, how long it holds,
 * and the scene to render. Durations are generous: this is read, not watched.
 */
const CHAPTERS = [
  {
    id: 'what',
    title: 'What this is',
    caption:
      'MediRoute connects four people in one emergency: you, the ambulance crew, the hospital, and the city control room. You only ever deal with the first part.',
    ms: 9000,
    Scene: SceneOverview,
  },
  {
    id: 'start',
    title: 'Starting a report',
    caption:
      'Open the emergency page and you get two buttons. There is no sign-up, no password, and no form to fill in first. Choose whether the emergency is yours or someone else’s.',
    ms: 9500,
    Scene: SceneTwoChoices,
  },
  {
    id: 'self',
    title: 'If it is you',
    caption:
      'Tap the closest description. You do not need the right medical words. If nothing fits, choose “Something else” and type it, or hold the button and just say it out loud.',
    ms: 10000,
    Scene: SceneSelfReport,
  },
  {
    id: 'bystander',
    title: 'If it is someone else',
    caption:
      'Helping a stranger is different: you will not know their blood group. So you are only asked what anyone can see — are they awake, are they breathing, how many are hurt. “Not sure” is a perfectly good answer.',
    ms: 11000,
    Scene: SceneBystander,
  },
  {
    id: 'triage',
    title: 'How urgency is decided',
    caption:
      'A clinical AI reads your description and decides how serious it is. That decision picks the type of crew and the kind of hospital — a cardiac case goes somewhere with a cath lab, not merely to the closest building.',
    ms: 11000,
    Scene: SceneTriage,
  },
  {
    id: 'dispatch',
    title: 'What happens next',
    caption:
      'The nearest free ambulance is assigned, a hospital with the right specialists is chosen, and both are alerted at once. You do not have to phone anybody or explain it twice.',
    ms: 10000,
    Scene: SceneDispatch,
  },
  {
    id: 'track',
    title: 'Following the ambulance',
    caption:
      'The page then shows you where things stand in plain words, which vehicle is coming, and roughly how far away it is. Close the page and your phone brings you back to it.',
    ms: 10000,
    Scene: SceneTracking,
  },
  {
    id: 'firstaid',
    title: 'While you wait',
    caption:
      'You also get a few things you can safely do before the crew arrives, matched to this particular emergency. Only do what feels safe, and never move someone unless they are in danger.',
    ms: 10000,
    Scene: SceneFirstAid,
  },
  {
    id: 'pros',
    title: 'The professional side',
    caption:
      'Meanwhile the crew, the hospital and the control room are working the same case on their own screens. Those need a staff login. The emergency page never does.',
    ms: 9500,
    Scene: SceneProfessionals,
  },
]

const TOTAL_MS = CHAPTERS.reduce((sum, c) => sum + c.ms, 0)

// ──────────────────────────────────────────────────────────────────────────────
// PLAYER
// ──────────────────────────────────────────────────────────────────────────────

export default function ProductTour({ onClose, onStartSos }) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [elapsedInChapter, setElapsedInChapter] = useState(0)

  const chapter = CHAPTERS[index]
  const tickRef = useRef(null)

  // Someone who asked for less motion gets the tour as a stepper rather than
  // something that moves on without them.
  const reducedMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ).current

  useEffect(() => {
    if (reducedMotion) setPlaying(false)
  }, [reducedMotion])

  const goTo = useCallback((i) => {
    setIndex(Math.max(0, Math.min(CHAPTERS.length - 1, i)))
    setElapsedInChapter(0)
  }, [])

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= CHAPTERS.length) {
        setPlaying(false)
        return i
      }
      return i + 1
    })
    setElapsedInChapter(0)
  }, [])

  // Advance on a 100ms tick so the progress bar moves smoothly and the
  // remaining time is honest.
  useEffect(() => {
    if (!playing) return
    tickRef.current = setInterval(() => {
      setElapsedInChapter((e) => {
        if (e + 100 >= chapter.ms) {
          next()
          return 0
        }
        return e + 100
      })
    }, 100)
    return () => clearInterval(tickRef.current)
  }, [playing, chapter.ms, next])

  // Keyboard transport.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'ArrowRight') {
        goTo(index + 1)
      } else if (e.key === 'ArrowLeft') {
        goTo(index - 1)
      } else if (e.key === 'Escape') {
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, goTo, onClose])

  const msBefore = CHAPTERS.slice(0, index).reduce((s, c) => s + c.ms, 0)
  const overallPct = Math.min(100, ((msBefore + elapsedInChapter) / TOTAL_MS) * 100)
  const atEnd = index === CHAPTERS.length - 1 && !playing && elapsedInChapter === 0

  const { Scene } = chapter

  return (
    <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm overflow-y-auto">
      <div className="min-h-full flex flex-col max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
              How MediRoute works
            </p>
            <h2 className="text-xl sm:text-2xl font-bold text-white mt-1">{chapter.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl border border-white/15 hover:border-white/40 px-3 py-2 text-sm text-white/70 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>

        {/* Stage */}
        <div className="flex-1 grid place-items-center py-8 min-h-[440px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={chapter.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.3 }}
              className="w-full"
            >
              <Scene />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Caption. Always on: this is the narration, not an optional track. */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5">
          <p className="text-sm sm:text-base text-white/85 leading-relaxed">{chapter.caption}</p>
        </div>

        {/* Transport */}
        <div className="mt-4">
          <div className="h-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-red-500 transition-[width] duration-100 ease-linear"
              style={{ width: `${overallPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between gap-3 mt-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => goTo(index - 1)}
                disabled={index === 0}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm disabled:opacity-30 hover:border-white/40 transition-colors"
                aria-label="Previous chapter"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => (atEnd ? goTo(0) : setPlaying((p) => !p))}
                className="rounded-lg bg-white/10 hover:bg-white/20 px-4 py-2 text-sm font-semibold transition-colors min-w-[88px]"
              >
                {atEnd ? 'Replay' : playing ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                onClick={() => goTo(index + 1)}
                disabled={index === CHAPTERS.length - 1}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm disabled:opacity-30 hover:border-white/40 transition-colors"
                aria-label="Next chapter"
              >
                →
              </button>
            </div>

            <p className="text-[11px] font-mono text-white/35 hidden sm:block">
              {index + 1} of {CHAPTERS.length} · space to pause
            </p>

            <button
              type="button"
              onClick={onStartSos}
              className="rounded-xl bg-red-600 hover:bg-red-500 px-4 py-2.5 text-sm font-bold transition-colors"
            >
              Open emergency page
            </button>
          </div>

          {/* Chapter list, so nobody has to sit through it in order. */}
          <div className="flex flex-wrap gap-1.5 mt-4">
            {CHAPTERS.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => goTo(i)}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  i === index
                    ? 'bg-white/15 text-white'
                    : i < index
                    ? 'text-white/50 hover:text-white/80'
                    : 'text-white/30 hover:text-white/60'
                }`}
              >
                {c.title}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
