/**
 * ==============================================================================
 * MEDIROUTE - LIVE OPERATIONAL STATE (store/incidentStore.js)
 *
 * WHAT IS WHERE:
 * - setIncidents / setActiveIncident / setAmbulances / setHospitals  bulk replace
 * - updateAmbulanceLocation()  patches one vehicle in place
 * - updateIncidentStatus()     patches one incident in place
 *
 * WHY THE TARGETED UPDATERS EXIST:
 * Socket events arrive far more often than the 15-20s polls. Replacing the whole
 * collection on every GPS ping would re-render every row and lose local UI state,
 * so a position or status update mutates only the affected record.
 *
 * Deliberately not persisted: this is live operational data and a stale copy
 * restored from localStorage would be worse than an empty screen.
 * ==============================================================================
 */
import { create } from 'zustand'

export const useIncidentStore = create((set, get) => ({
  incidents: [],
  activeIncident: null,
  ambulances: [],
  hospitals: [],

  setIncidents: (incidents) => set({ incidents }),
  setActiveIncident: (incident) => set({ activeIncident: incident }),
  setAmbulances: (ambulances) => set({ ambulances }),
  setHospitals: (hospitals) => set({ hospitals }),

  updateAmbulanceLocation: (ambulanceId, location) => {
    set((state) => ({
      ambulances: state.ambulances.map((a) =>
        a._id === ambulanceId ? { ...a, currentLocation: location } : a
      ),
    }))
  },

  updateIncidentStatus: (incidentId, status) => {
    set((state) => ({
      incidents: state.incidents.map((i) =>
        i._id === incidentId ? { ...i, status } : i
      ),
    }))
  },
}))
