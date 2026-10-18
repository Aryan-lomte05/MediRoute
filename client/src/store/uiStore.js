/**
 * ==============================================================================
 * MEDIROUTE - UI PREFERENCE STORE (store/uiStore.js)
 * ==============================================================================
 *
 * WHAT IS WHERE:
 * - Line 30-55:  Density mode ('simple' | 'pro') per portal
 * - Line 57-75:  Guided tour completion tracking
 * - Line 77-90:  Jargon glossary toggle
 *
 * WHY THIS EXISTS:
 * Review feedback was that the portals are hard for civilians to understand.
 * Rather than redesigning the interface, each portal can render at two
 * densities from the same data:
 *
 *   simple - only the actions that matter, in plain language, large targets
 *   pro    - the full tactical readout for trained responders
 *
 * Defaults are chosen per portal rather than globally: a citizen opening the
 * SOS page should never see a tactical HUD, while a paramedic on shift should
 * not have to switch modes every time they open their own console.
 * ==============================================================================
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Sensible starting density by portal. Citizen-facing surfaces start simple;
 * professional consoles start pro.
 */
const DEFAULT_MODES = {
  sos: 'simple',
  patient: 'simple',
  paramedic: 'pro',
  hospital: 'pro',
  admin: 'pro',
}

export const useUiStore = create(
  persist(
    (set, get) => ({
      modes: { ...DEFAULT_MODES },

      /** Current density for a portal, falling back to its default. */
      getMode: (portal) => get().modes[portal] || DEFAULT_MODES[portal] || 'simple',

      isSimple: (portal) => (get().modes[portal] || DEFAULT_MODES[portal] || 'simple') === 'simple',

      setMode: (portal, mode) =>
        set((state) => ({ modes: { ...state.modes, [portal]: mode } })),

      toggleMode: (portal) =>
        set((state) => {
          const current = state.modes[portal] || DEFAULT_MODES[portal] || 'simple'
          return { modes: { ...state.modes, [portal]: current === 'simple' ? 'pro' : 'simple' } }
        }),

      // ── Guided tours ───────────────────────────────────────────────────────
      // Tracks which in-page tours a person has finished, so a returning user
      // is not interrupted by the same walkthrough twice. Keyed by tour id.
      completedTours: {},

      hasCompletedTour: (tourId) => Boolean(get().completedTours[tourId]),

      completeTour: (tourId) =>
        set((state) => ({
          completedTours: { ...state.completedTours, [tourId]: new Date().toISOString() },
        })),

      /** Let someone replay a walkthrough from the help button. */
      resetTour: (tourId) =>
        set((state) => {
          const next = { ...state.completedTours }
          delete next[tourId]
          return { completedTours: next }
        }),

      resetAllTours: () => set({ completedTours: {} }),

      // ── Plain-language help ────────────────────────────────────────────────
      // When on, clinical shorthand (ESI, GCS, SpO2) renders with its meaning
      // spelled out inline instead of only in a tooltip.
      explainJargon: true,
      toggleJargon: () => set((state) => ({ explainJargon: !state.explainJargon })),
    }),
    {
      name: 'mediroute-ui',
      partialize: (state) => ({
        modes: state.modes,
        completedTours: state.completedTours,
        explainJargon: state.explainJargon,
      }),
    }
  )
)
