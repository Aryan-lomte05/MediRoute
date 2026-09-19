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
