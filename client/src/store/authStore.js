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
