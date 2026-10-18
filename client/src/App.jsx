/**
 * ==============================================================================
 * MEDIROUTE - ROOT APPLICATION & CLIENT-SIDE ROUTER (App.jsx)
 * ==============================================================================
 * 
 * WHAT IS WHERE:
 * - Line 1-10:   Core Module & Page Component Imports
 * - Line 12-23:  ProtectedRoute Wrapper (Role-Based Access Control / RBAC)
 * - Line 25-80:  Main Application Component & Declarative Route Configuration:
 *                - `/`          -> Public Landing Page & Feature Showcase (Landing.jsx)
 *                - `/login`     -> Interactive Multi-Role Portal Login (LoginPage.jsx)
 *                - `/sos`       -> PUBLIC anonymous emergency reporting (SosPortal.jsx)
 *                - `/patient`   -> Citizen SOS & Emergency PWA Tracking (PatientPortal.jsx)
 *                - `/paramedic` -> Real-time Ambulance HUD & Geonav (ParamedicPortal.jsx)
 *                - `/hospital`  -> ER Trauma Center Bed & Inbound Triage (HospitalPortal.jsx)
 *                - `/admin`     -> Smart City Emergency Command Center (AdminPortal.jsx)
 * ==============================================================================
 */

import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'

/**
 * SosPortal is imported eagerly: it is the emergency path and must render
 * without waiting on a second network round-trip. Everything else is lazy, so
 * a citizen opening /sos never downloads Mapbox GL or Recharts.
 */
import SosPortal from './pages/SosPortal'

const Landing = lazy(() => import('./pages/Landing'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const PatientPortal = lazy(() => import('./pages/PatientPortal'))
const ParamedicPortal = lazy(() => import('./pages/ParamedicPortal'))
const HospitalPortal = lazy(() => import('./pages/HospitalPortal'))
const AdminPortal = lazy(() => import('./pages/AdminPortal'))

// Global Authentication State Store (Zustand)
import { useAuthStore } from './store/authStore'

/**
 * ------------------------------------------------------------------------------
 * ProtectedRoute: Role-Based Access Control Guard (RBAC)
 * ------------------------------------------------------------------------------
 * Inspects global Zustand authentication store for an active JWT token and user profile.
 * - If unauthenticated: redirects browser to `/login`.
 * - If authenticated but insufficient role: redirects browser to `/`.
 * - If authorized: renders protected child component.
 */
function ProtectedRoute({ children, allowedRoles }) {
  const { user, token } = useAuthStore()
  
  // Guard 1: Verify token and user presence
  if (!token || !user) return <Navigate to="/login" replace />
  
  // Guard 2: Verify role authorization
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to="/" replace />
  
  return children
}

/**
 * ------------------------------------------------------------------------------
 * App: Root Router & Global Layout Provider
 * ------------------------------------------------------------------------------
 */
export default function App() {
  return (
    <BrowserRouter>
      {/* Global Toast Notification System */}
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

      {/* Declarative Application Routes */}
      <Suspense fallback={<RouteLoading />}>
        <Routes>
        {/* Public Routes */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<LoginPage />} />

        {/*
          Emergency reporting is deliberately OUTSIDE ProtectedRoute. A citizen
          in an emergency must never meet a login wall, so /sos is open to
          anonymous users and issues a one-time tracking token instead of a
          session. /patient remains protected for the saved medical profile and
          report history, which do need an account.
        */}
        <Route path="/sos" element={<SosPortal />} />

        {/* Protected Role Routes */}
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
      </Suspense>
    </BrowserRouter>
  )
}

/** Shown while a lazily loaded portal chunk is in flight. */
function RouteLoading() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] grid place-items-center">
      <div className="text-center">
        <div className="h-10 w-10 mx-auto rounded-full border-2 border-white/10 border-t-red-500 animate-spin" />
        <p className="mt-4 text-sm text-white/40">Loading…</p>
      </div>
    </div>
  )
}
