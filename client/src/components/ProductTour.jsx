/**
 * ==============================================================================
 * MEDIROUTE - INTERACTIVE WALKTHROUGH (components/ProductTour.jsx)
 * ==============================================================================
 *
 * WHAT IS WHERE:
 * - Line 45-120:   RolePicker - choose whose walkthrough to watch
 * - Line 122-230:  Playback engine (timer, progress, keyboard, reduced motion)
 * - Line 232-400:  Chrome - stage, captions, transport, chapter list
 *
 * The four scripts and their scenes live in components/tourTracks.jsx.
 *
 * WHY THIS EXISTS INSTEAD OF A VIDEO:
 * Review feedback was that people could not tell what the app does or how to
 * use it. This plays like a narrated walkthrough but is built from live DOM, so
 * it costs no video hosting, never drifts out of date when the UI changes, is
 * readable on a slow connection, and its captions are real selectable text
 * rather than burnt-in pixels.
 *
 * ONE TRACK PER ROLE:
 * Each of the four people in an emergency does a different job on a different
 * screen, so each gets their own run. The landing page opens the picker; a
 * portal's help button opens that portal's track directly, via the `track` prop.
 *
 * ACCESSIBILITY:
 * - Captions are always visible, not an optional track.
 * - Space and arrow keys drive playback; every control is a real button.
 * - Honours prefers-reduced-motion by not auto-advancing.
 * ==============================================================================
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { TRACKS, TRACK_ORDER } from './tourTracks.jsx'

// ──────────────────────────────────────────────────────────────────────────────
// ROLE PICKER
// ──────────────────────────────────────────────────────────────────────────────

function RolePicker({ onPick, onClose }) {
  return (
    <div className="min-h-full flex flex-col max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
            How MediRoute works
          </p>
          <h2 className="text-xl sm:text-2xl font-bold text-white mt-1">
            Which walkthrough do you want?
          </h2>
          <p className="text-sm text-white/55 mt-1.5">
            Each role does a different job. Pick yours, or watch all four.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-xl border border-white/15 hover:border-white/40 px-3 py-2 text-sm text-white/70 hover:text-white transition-colors"
        >
          Close
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-8">
        {TRACK_ORDER.map((key, i) => {
          const track = TRACKS[key]
          return (
            <motion.button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.3 }}
              className={`text-left rounded-2xl border-2 bg-white/[0.03] hover:bg-white/[0.06] px-5 py-5 transition-all ${track.accent}`}
            >
              <p className="text-[10px] font-mono uppercase tracking-wider text-white/40">
                {track.short}
              </p>
              <p className="text-base font-bold text-white mt-1.5 leading-snug">{track.name}</p>
              <p className="text-sm text-white/55 mt-1.5 leading-snug">{track.blurb}</p>
              <p className="text-[11px] font-mono text-white/30 mt-3">
                {track.chapters.length} chapters
              </p>
            </motion.button>
          )
        })}
      </div>

      <p className="text-xs text-white/35 mt-8 leading-relaxed">
        The citizen walkthrough needs no account. The other three describe screens that
        require a staff login.
      </p>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// PLAYER
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @param {string}   [track]      Play this track directly and skip the picker.
 * @param {function} onClose
 * @param {function} [onStartSos] Shown as a call to action on the citizen track.
 */
export default function ProductTour({ track: initialTrack, onClose, onStartSos }) {
  const [trackKey, setTrackKey] = useState(initialTrack || null)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [elapsed, setElapsed] = useState(0)

  const tickRef = useRef(null)

  // Someone who asked for less motion gets a stepper rather than something that
  // moves on without them.
  const reducedMotion = useRef(
    typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ).current

  useEffect(() => {
    if (reducedMotion) setPlaying(false)
  }, [reducedMotion])

  const track = trackKey ? TRACKS[trackKey] : null
  const chapters = track?.chapters || []
  const chapter = chapters[index]
  const totalMs = chapters.reduce((sum, c) => sum + c.ms, 0)

  const goTo = useCallback(
    (i) => {
      setIndex(Math.max(0, Math.min(chapters.length - 1, i)))
      setElapsed(0)
    },
    [chapters.length]
  )

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= chapters.length) {
        setPlaying(false)
        return i
      }
      return i + 1
    })
    setElapsed(0)
  }, [chapters.length])

  // Advance on a 100ms tick so the progress bar moves smoothly.
  useEffect(() => {
    if (!playing || !chapter) return
    tickRef.current = setInterval(() => {
      setElapsed((e) => {
        if (e + 100 >= chapter.ms) {
          next()
          return 0
        }
        return e + 100
      })
    }, 100)
    return () => clearInterval(tickRef.current)
  }, [playing, chapter, next])

  // Keyboard transport.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose?.()
        return
      }
      if (!track) return
      if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'ArrowRight') {
        goTo(index + 1)
      } else if (e.key === 'ArrowLeft') {
        goTo(index - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, goTo, onClose, track])

  /** Start a track from the beginning. */
  const pickTrack = (key) => {
    setTrackKey(key)
    setIndex(0)
    setElapsed(0)
    setPlaying(!reducedMotion)
  }

  // ── Picker ───────────────────────────────────────────────────────────────
  if (!track) {
    return (
      <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm overflow-y-auto">
        <RolePicker onPick={pickTrack} onClose={onClose} />
      </div>
    )
  }

  const msBefore = chapters.slice(0, index).reduce((s, c) => s + c.ms, 0)
  const overallPct = Math.min(100, ((msBefore + elapsed) / totalMs) * 100)
  const atEnd = index === chapters.length - 1 && !playing && elapsed === 0
  const { Scene } = chapter

  return (
    <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm overflow-y-auto">
      <div className="min-h-full flex flex-col max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
              {track.short} walkthrough
            </p>
            <h2 className="text-xl sm:text-2xl font-bold text-white mt-1">{chapter.title}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Only offered when the picker was available to begin with. */}
            {!initialTrack && (
              <button
                type="button"
                onClick={() => setTrackKey(null)}
                className="rounded-xl border border-white/15 hover:border-white/40 px-3 py-2 text-sm text-white/70 hover:text-white transition-colors"
              >
                Change role
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/15 hover:border-white/40 px-3 py-2 text-sm text-white/70 hover:text-white transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Stage */}
        <div className="flex-1 grid place-items-center py-8 min-h-[400px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${track.id}-${chapter.id}`}
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
                disabled={index === chapters.length - 1}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm disabled:opacity-30 hover:border-white/40 transition-colors"
                aria-label="Next chapter"
              >
                →
              </button>
            </div>

            <p className="text-[11px] font-mono text-white/35 hidden sm:block">
              {index + 1} of {chapters.length} · space to pause
            </p>

            {track.id === 'citizen' && onStartSos ? (
              <button
                type="button"
                onClick={onStartSos}
                className="rounded-xl bg-red-600 hover:bg-red-500 px-4 py-2.5 text-sm font-bold transition-colors"
              >
                Open emergency page
              </button>
            ) : (
              <span className="w-px" />
            )}
          </div>

          {/* Chapter list, so nobody has to sit through it in order. */}
          <div className="flex flex-wrap gap-1.5 mt-4">
            {chapters.map((c, i) => (
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
