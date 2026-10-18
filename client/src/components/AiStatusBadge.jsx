/**
 * ==============================================================================
 * MEDIROUTE - AI STATUS BADGE (components/AiStatusBadge.jsx)
 * ==============================================================================
 *
 * Reports whether the clinical AI is genuinely reachable right now, by polling
 * GET /api/ai/health.
 *
 * WHY THIS EXISTS:
 * The AI had been failing in production for a long time without anyone
 * noticing, because every triage call silently fell back to a keyword rule
 * engine whose output looked like an AI assessment. Nothing in the interface
 * distinguished the two. This badge makes the difference visible, and
 * `TriageEngineNote` labels any individual result that came from the fallback.
 * ==============================================================================
 */

import { useState, useEffect } from 'react'
import api from '../lib/api'

export default function AiStatusBadge({ className = '' }) {
  const [health, setHealth] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      try {
        const { data } = await api.get('/ai/health')
        if (!cancelled) {
          setHealth(data)
          setFailed(false)
        }
      } catch {
        if (!cancelled) setFailed(true)
      }
    }

    check()
    // Five minutes: a provider decommissioning a model is the failure mode
    // this guards against, and that does not need second-by-second polling.
    const id = setInterval(check, 300000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (!health && !failed) return null

  const online = Boolean(health?.ok) && !failed

  return (
    <span
      title={
        online
          ? `Clinical AI online — ${health.model}`
          : failed
          ? 'Could not reach the server to check AI status'
          : health?.message || 'Clinical AI unavailable; triage is using the offline protocol'
      }
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono font-semibold ${
        online
          ? 'border-emerald-500/40 bg-emerald-950/50 text-emerald-300'
          : 'border-amber-500/40 bg-amber-950/50 text-amber-300'
      } ${className}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-amber-400'}`}
      />
      {online ? 'AI ONLINE' : 'AI DEGRADED'}
    </span>
  )
}

/**
 * Labels one triage result with the engine that actually produced it.
 *
 * @param {string} engine The incident's triageData.engine, e.g.
 *   'groq:openai/gpt-oss-120b' or 'rules'.
 */
export function TriageEngineNote({ engine, className = '' }) {
  if (!engine) return null

  const isFallback = engine.startsWith('rules')

  return (
    <p className={`text-[10px] font-mono leading-relaxed ${isFallback ? 'text-amber-300/80' : 'text-white/30'} ${className}`}>
      {isFallback
        ? 'Assessed by the offline clinical protocol, not the AI. Reassess on arrival.'
        : `Assessed by ${engine.replace(/^groq:/, '')}`}
    </p>
  )
}
