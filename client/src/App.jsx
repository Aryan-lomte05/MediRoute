import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Landing from './pages/Landing'
import PatientPortal from './pages/PatientPortal'
import ParamedicPortal from './pages/ParamedicPortal'
import HospitalPortal from './pages/HospitalPortal'
import AdminPortal from './pages/AdminPortal'
import LoginPage from './pages/LoginPage'
import { useAuthStore } from './store/authStore'

function ProtectedRoute({ children, allowedRoles }) {
  const { user, token } = useAuthStore()
  if (!token || !user) return <Navigate to="/login" replace />
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#0f0f1a',
            color: '#fff',
            border: '1px solid #1e1e35',
            fontFamily: 'Inter, sans-serif',
          },
        }}
      />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/patient"
          element={
            <ProtectedRoute allowedRoles={['patient']}>
              <PatientPortal />
            </ProtectedRoute>
          }
        />
        <Route
          path="/paramedic"
          element={
            <ProtectedRoute allowedRoles={['paramedic']}>
              <ParamedicPortal />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hospital"
          element={
            <ProtectedRoute allowedRoles={['hospital_staff']}>
              <HospitalPortal />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminPortal />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
