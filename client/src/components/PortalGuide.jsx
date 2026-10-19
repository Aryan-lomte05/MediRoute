/**
 * ==============================================================================
 * MEDIROUTE - IN-PORTAL GUIDANCE (components/PortalGuide.jsx)
 * ==============================================================================
 *
 * WHAT IS WHERE:
 * - Line 40-75:   GLOSSARY - clinical shorthand in plain words
 * - Line 77-130:  Jargon - inline term with an explanation on tap/hover
 * - Line 132-200: ModeToggle - the simple/pro density switch
 * - Line 202-330: GuideOverlay - a first-visit walkthrough of a portal
 * - Line 332-390: GuideButton - opens that walkthrough on demand
 *
 * WHY THIS EXISTS:
 * Review feedback was that the portals overwhelm people. Rather than redesign
 * them, each portal gets three things:
 *   1. A density switch, so the same screen can be stripped back or full.
 *   2. A walkthrough that runs once per person and can be replayed.
 *   3. Plain-language explanations attached to the clinical shorthand.
 *
 * Nothing here moves or hides data by itself; a portal opts in by reading
 * useUiStore().isSimple(portal).
 * ==============================================================================
 */

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUiStore } from '../store/uiStore'
import ProductTour from './ProductTour'

// ──────────────────────────────────────────────────────────────────────────────
// GLOSSARY
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Every piece of shorthand the interface shows a non-specialist, in words a
 * first-year student or a civilian can follow. Keys are matched case-insensitively.
 */
export const GLOSSARY = {
  ESI: 'Emergency Severity Index - how urgent a patient is, from 1 (needs saving right now) to 5 (can safely wait).',
  'ESI-1': 'The most urgent level: an immediate threat to life.',
  GCS: 'Glasgow Coma Scale - how awake and responsive someone is, from 3 (completely unresponsive) to 15 (fully alert).',
  SpO2: 'Blood oxygen saturation, as a percentage. Below about 94% is concerning; below 88% is an emergency.',
  ALS: 'Advanced Life Support - an ambulance staffed and equipped for critical patients.',
  BLS: 'Basic Life Support - an ambulance for stable patients who still need transport.',
  ICU: 'Intensive Care Unit - beds for patients who need constant monitoring and support.',
  Triage: 'Deciding who is treated first, based on how urgent each case is.',
  Diversion: 'A hospital declaring it is too full to take new emergency patients safely.',
  OSRM: 'The routing engine that works out the actual road path and travel time.',
  Dispatch: 'Assigning an ambulance to an emergency and sending it.',
  'Cath lab': 'Cardiac catheterisation lab - where blocked heart arteries are opened.',
  Polytrauma: 'Serious injuries to more than one part of the body at once.',
  Crossmatch: 'Testing a patient against donor blood so a transfusion is safe.',
  Hypoxemia: 'Dangerously low oxygen in the blood.',
  Hemorrhage: 'Heavy bleeding.',
}

// ──────────────────────────────────────────────────────────────────────────────
// INLINE TERM EXPLAINER
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a piece of shorthand so its meaning is one tap away.
 *
 * Deliberately a button, not a title attribute: a native tooltip never appears
 * on a touch device, which is where most civilian use happens.
 */
export function Jargon({ term, children }) {
  const [open, setOpen] = useState(false)
  const explainJargon = useUiStore((s) => s.explainJargon)
  const ref = useRef(null)

  const key = Object.keys(GLOSSARY).find((k) => k.toLowerCase() === String(term).toLowerCase())
  const definition = key ? GLOSSARY[key] : null

  useEffect(() => {
    if (!open) return
    const onAway = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onAway)
    return () => document.removeEventListener('mousedown', onAway)
  }, [open])

  if (!definition || !explainJargon) return <>{children || term}</>

  return (
    <span className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className="underline decoration-dotted decoration-white/40 underline-offset-2 hover:decoration-white"
        aria-expanded={open}
      >
        {children || term}
      </button>

      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            role="tooltip"
            className="absolute left-0 bottom-full mb-2 z-50 block w-64 rounded-xl border border-white/15 bg-[#12121c] p-3 text-xs font-sans font-normal leading-relaxed text-white/85 shadow-2xl"
          >
            <strong className="block text-white mb-1">{key}</strong>
            {definition}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// DENSITY SWITCH
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Switches a portal between a stripped-back view and the full readout.
 *
 * @param {string} portal One of: sos, patient, paramedic, hospital, admin.
 */
export function ModeToggle({ portal, className = '' }) {
  const mode = useUiStore((s) => s.modes[portal]) || (portal === 'admin' || portal === 'hospital' || portal === 'paramedic' ? 'pro' : 'simple')
  const setMode = useUiStore((s) => s.setMode)

  return (
    <div
      className={`inline-flex items-center rounded-xl border border-white/10 bg-white/[0.03] p-0.5 ${className}`}
      role="group"
      aria-label="Display density"
    >
      {[
        { id: 'simple', label: 'Simple', hint: 'Only the essentials, in plain words' },
        { id: 'pro', label: 'Full', hint: 'Every reading and control' },
      ].map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => setMode(portal, opt.id)}
          title={opt.hint}
          aria-pressed={mode === opt.id}
          className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors ${
            mode === opt.id ? 'bg-white/15 text-white' : 'text-white/45 hover:text-white/75'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// WALKTHROUGH
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A short, sequential explanation of one portal. Steps are plain objects so
 * each portal keeps its own script next to its own code.
 *
 * @param {string} tourId  Stable id; completion is remembered against it.
 * @param {string} title
 * @param {Array<{heading: string, body: string}>} steps
 */
export function GuideOverlay({ tourId, title, steps, onClose }) {
  const [step, setStep] = useState(0)
  const completeTour = useUiStore((s) => s.completeTour)

  const finish = () => {
    completeTour(tourId)
    onClose?.()
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        completeTour(tourId)
        onClose?.()
      }
      if (e.key === 'ArrowRight') setStep((v) => Math.min(steps.length - 1, v + 1))
      if (e.key === 'ArrowLeft') setStep((v) => Math.max(0, v - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [steps.length, tourId, completeTour, onClose])

  const current = steps[step]
  const last = step === steps.length - 1

  return (
    <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm grid place-items-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-lg rounded-2xl border border-white/12 bg-[#0e0e16] p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/35">{title}</p>
            <h3 className="text-lg font-bold text-white mt-1.5">{current.heading}</h3>
          </div>
          <button
            type="button"
            onClick={finish}
            className="shrink-0 text-sm text-white/40 hover:text-white transition-colors"
          >
            Skip
          </button>
        </div>

        <p className="text-sm text-white/70 leading-relaxed mt-3">{current.body}</p>

        <div className="flex items-center gap-1.5 mt-5">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-5 bg-cyan-400' : i < step ? 'w-1.5 bg-cyan-400/50' : 'w-1.5 bg-white/15'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between mt-5">
          <button
            type="button"
            onClick={() => setStep((v) => Math.max(0, v - 1))}
            disabled={step === 0}
            className="text-sm text-white/50 hover:text-white disabled:opacity-25 transition-colors"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={() => (last ? finish() : setStep((v) => v + 1))}
            className="rounded-xl bg-cyan-500/90 hover:bg-cyan-400 text-black font-bold px-5 py-2.5 text-sm transition-colors"
          >
            {last ? 'Got it' : 'Next'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

/**
 * The help control plus the first-visit behaviour.
 *
 * Shows the walkthrough automatically the first time someone opens a portal,
 * then never again unless they ask. Returning staff are not interrupted.
 */
/**
 * @param {string} [tourTrack] A key from tourTracks (citizen, paramedic,
 *   hospital, admin). When given, a second control offers the full narrated
 *   walkthrough for that role alongside the quick orientation overlay.
 */
export function GuideButton({ tourId, title, steps, tourTrack, autoStart = true, className = '' }) {
  const hasCompleted = useUiStore((s) => Boolean(s.completedTours[tourId]))
  const resetTour = useUiStore((s) => s.resetTour)
  const [open, setOpen] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)

  useEffect(() => {
    if (autoStart && !hasCompleted) {
      // A beat of delay so the portal has painted behind the overlay.
      const t = setTimeout(() => setOpen(true), 700)
      return () => clearTimeout(t)
    }
  }, [autoStart, hasCompleted])

  return (
    <>
      {/*
        Two levels of help: a few lines of orientation that runs once on a first
        visit, and the full narrated walkthrough for this role on demand.
      */}
      {tourTrack && (
        <button
          type="button"
          onClick={() => setTourOpen(true)}
          title="Watch the walkthrough for this role"
          className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white/65 hover:text-white hover:border-white/40 transition-colors"
        >
          <span aria-hidden="true">▶</span> Walkthrough
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          resetTour(tourId)
          setOpen(true)
        }}
        title="How to use this screen"
        className={`h-8 w-8 rounded-full border border-white/15 text-white/60 hover:text-white hover:border-white/40 text-sm font-bold transition-colors ${className}`}
        aria-label="How to use this screen"
      >
        ?
      </button>

      <AnimatePresence>
        {open && (
          <GuideOverlay tourId={tourId} title={title} steps={steps} onClose={() => setOpen(false)} />
        )}
      </AnimatePresence>

      {tourOpen && <ProductTour track={tourTrack} onClose={() => setTourOpen(false)} />}
    </>
  )
}
