import { Navigate, Outlet } from 'react-router-dom'

import { readSession } from '../auth/session'

export function ProtectedRoute() {
  return readSession() ? <Outlet /> : <Navigate to="/login" replace />
}
