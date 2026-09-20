import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor — attach token
api.interceptors.request.use((config) => {
  const stored = localStorage.getItem('mediroute-auth')
  if (stored) {
    const { state } = JSON.parse(stored)
    if (state?.token) {
      config.headers['Authorization'] = `Bearer ${state.token}`
    }
  }
  return config
})

// Response interceptor — handle errors globally
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('mediroute-auth')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
