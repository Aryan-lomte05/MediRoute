/**
 * ==============================================================================
 * MEDIROUTE - AUTHENTICATION STORE (store/authStore.js)
 *
 * WHAT IS WHERE:
 * - login()     POST /api/auth/login, stores the token and user
 * - register()  POST /api/auth/register
 * - logout()    Clears both and drops the Authorization default
 *
 * PERSISTENCE:
 * Zustand's persist middleware writes to localStorage under 'mediroute-auth'.
 * lib/api.js reads the token from that same key on every request, and
 * ProtectedRoute in App.jsx reads the user to decide access, so the key name is
 * load-bearing in three places.
 *
 * NOT USED BY /sos:
 * Public emergency reporting never touches this store. It holds a one-time
 * tracking token in its own localStorage key instead, so a citizen can follow
 * their report without an account.
 * ==============================================================================
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api from '../lib/api'

export const useAuthStore = create(
  persist(
    (set) => ({
      user: null,
      token: null,
      loading: false,
      login: async (email, password, role) => {
        set({ loading: true })
        try {
          const { data } = await api.post('/auth/login', { email, password, role })
          set({ user: data.user, token: data.token, loading: false })
          api.defaults.headers.common['Authorization'] = `Bearer ${data.token}`
          return data
        } catch (err) {
          set({ loading: false })
          throw err
        }
      },
      register: async (userData) => {
        set({ loading: true })
        try {
          const { data } = await api.post('/auth/register', userData)
          set({ user: data.user, token: data.token, loading: false })
          api.defaults.headers.common['Authorization'] = `Bearer ${data.token}`
          return data
        } catch (err) {
          set({ loading: false })
          throw err
        }
      },
      logout: () => {
        set({ user: null, token: null })
        delete api.defaults.headers.common['Authorization']
      },
    }),
    {
      name: 'mediroute-auth',
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
)
