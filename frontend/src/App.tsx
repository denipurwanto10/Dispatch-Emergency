import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { homeForRole, readSession } from './auth/session'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useTheme } from './context/ThemeContext'
import { LoginPage } from './pages/LoginPage'
import { MapPage } from './pages/MapPage'
import { DriverPage } from './pages/DriverPage'
import { AdminPage } from './pages/AdminPage'

function IndexRedirect() {
  const session = readSession()
  return <Navigate to={session ? homeForRole(session.user.role) : '/login'} replace />
}

/** Dispatcher memakai tema gelap, driver dan admin tema terang, kecuali pengguna memilih sendiri. */
function ThemeSync() {
  const location = useLocation()
  const { applyDefault } = useTheme()

  useEffect(() => {
    const role = readSession()?.user.role
    applyDefault(role === 'dispatcher' ? 'dark' : 'light')
  }, [location.pathname, applyDefault])

  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeSync />
      <AnimatedRoutes />
    </BrowserRouter>
  )
}

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <div className="page-transition" key={location.pathname}>
      <Routes location={location}>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/map" element={<MapPage />} />
          <Route path="/driver" element={<ErrorBoundary><DriverPage /></ErrorBoundary>} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>
        <Route path="/" element={<IndexRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
