import type { Role, Session } from '../types'

const STORAGE_KEY = 'dispatch.session.v1'

const ROLES: Role[] = ['dispatcher', 'driver', 'admin']

function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Session>
  return (
    typeof candidate.token === 'string' &&
    candidate.token.length > 0 &&
    typeof candidate.user === 'object' &&
    candidate.user !== null &&
    typeof candidate.user.id === 'number' &&
    typeof candidate.user.name === 'string' &&
    typeof candidate.user.email === 'string' &&
    ROLES.includes(candidate.user.role as Role)
  )
}

export function readSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveSession(session: Session): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  window.localStorage.removeItem(STORAGE_KEY)
}

export function homeForRole(role: Role): string {
  switch (role) {
    case 'dispatcher':
      return '/map'
    case 'driver':
      return '/driver'
    case 'admin':
      return '/admin'
  }
}
