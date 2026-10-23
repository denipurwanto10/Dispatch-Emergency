import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { homeForRole, readSession } from './auth/session'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { MapPage } from './pages/MapPage'
import { DriverPage } from './pages/DriverPage'
import { AdminPage } from './pages/AdminPage'

function IndexRedirect() {
  const session = readSession()
  return <Navigate to={session ? homeForRole(session.user.role) : '/login'} replace />
}

/** Dispatcher memakai tema gelap; driver & admin memakai tema terang. */
function ThemeSync() {
  const location = useLocation()

  useEffect(() => {
    const role = readSession()?.user.role
    document.documentElement.dataset.theme = role === 'dispatcher' ? 'dark' : 'light'
  }, [location.pathname])

  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeSync />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/map" element={<MapPage />} />
          <Route path="/driver" element={<DriverPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>
        <Route path="/" element={<IndexRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
