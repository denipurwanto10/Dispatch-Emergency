import type {
  AdminUserInput,
  AdminVehicle,
  AdminVehicleInput,
  Assignment,
  AssignmentHistoryItem,
  AssignmentWithRelations,
  CreateIncidentInput,
  Incident,
  NearestResult,
  Session,
  User,
  Vehicle,
} from '../types'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '')

interface ErrorEnvelope {
  error?: {
    code?: string
    message?: string
  }
}

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    let payload: ErrorEnvelope = {}
    try {
      payload = (await response.json()) as ErrorEnvelope
    } catch {
      // Biarkan pesan fallback dipakai bila body bukan JSON.
    }
    const code = payload.error?.code ?? 'request_failed'
    const message = payload.error?.message ?? `Permintaan gagal (HTTP ${response.status}).`
    // Jejak diagnostik: endpoint + status persis yang ditolak backend.
    console.error('[api] permintaan gagal', {
      method: (options.method ?? 'GET').toUpperCase(),
      url: `${API_BASE}${path}`,
      status: response.status,
      code,
      message,
    })
    throw new ApiError(response.status, code, message)
  }

  return (await response.json()) as T
}

export async function login(email: string, password: string): Promise<Session> {
  return request<Session>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function fetchVehicles(token: string, city = ''): Promise<Vehicle[]> {
  const query = city ? `?city=${encodeURIComponent(city)}` : ''
  const payload = await request<{ vehicles: Vehicle[] }>(`/vehicles${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return payload.vehicles
}

export async function fetchIncidents(
  token: string,
  filters: { status?: string; city?: string } = {},
): Promise<Incident[]> {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.city) params.set('city', filters.city)
  const query = params.toString()
  const payload = await request<{ incidents: Incident[] }>(
    `/incidents${query ? `?${query}` : ''}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return payload.incidents
}

export async function fetchIncident(token: string, id: number): Promise<Incident> {
  const payload = await request<{ incident: Incident }>(`/incidents/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return payload.incident
}

export async function createIncident(
  token: string,
  input: CreateIncidentInput,
): Promise<Incident> {
  const payload = await request<{ incident: Incident }>('/incidents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  })
  return payload.incident
}

export async function cancelIncident(token: string, id: number): Promise<Incident> {
  const payload = await request<{ incident: Incident }>(`/incidents/${id}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  return payload.incident
}

export async function fetchNearest(token: string, id: number): Promise<NearestResult> {
  return request<NearestResult>(`/incidents/${id}/nearest`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function assignIncident(
  token: string,
  incidentId: number,
  vehicleId: number,
): Promise<Assignment> {
  const payload = await request<{ assignment: Assignment }>(`/incidents/${incidentId}/assign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ vehicle_id: vehicleId }),
  })
  return payload.assignment
}

// Backend mengirim assignment dengan relasi incident/vehicle di level yang sama
// (struct di-embed), sedangkan UI memakai bentuk bersarang { assignment, incident, vehicle }.
type AssignmentRelationsPayload = Assignment & {
  incident?: Incident | null
  vehicle?: Vehicle | null
}

function normalizeAssignmentWithRelations(
  payload: AssignmentWithRelations | AssignmentRelationsPayload,
): AssignmentWithRelations {
  if ('assignment' in payload) {
    return payload
  }
  const { incident, vehicle, ...assignment } = payload
  return { assignment, incident: incident ?? null, vehicle: vehicle ?? null }
}

export async function fetchAssignment(token: string, id: number): Promise<AssignmentWithRelations> {
  const payload = await request<{ assignment: AssignmentRelationsPayload }>(`/assignments/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return normalizeAssignmentWithRelations(payload.assignment)
}

export async function fetchMyActiveAssignment(token: string): Promise<AssignmentWithRelations | null> {
  const payload = await request<{ assignment: AssignmentRelationsPayload | null }>(
    `/assignments/mine/active`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  return payload.assignment ? normalizeAssignmentWithRelations(payload.assignment) : null
}

export async function startAssignment(token: string, id: number): Promise<Assignment> {
  const payload = await request<{ assignment: Assignment }>(`/assignments/${id}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  return payload.assignment
}

export async function completeAssignment(token: string, id: number): Promise<Assignment> {
  const payload = await request<{ assignment: Assignment }>(`/assignments/${id}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  return payload.assignment
}

export async function arriveAssignment(token: string, id: number): Promise<Assignment> {
  const payload = await request<{ assignment: Assignment }>(`/assignments/${id}/arrive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  return payload.assignment
}

export async function fetchMyHistory(token: string): Promise<AssignmentHistoryItem[]> {
  const payload = await request<{ history: AssignmentHistoryItem[] }>(`/assignments/mine/history`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return payload.history
}

// ---------- Admin (Fase 4) ----------

export async function fetchAdminUsers(token: string): Promise<User[]> {
  const payload = await request<{ users: User[] }>('/admin/users', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return payload.users
}

export async function createAdminUser(token: string, input: AdminUserInput): Promise<User> {
  const payload = await request<{ user: User }>('/admin/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  })
  return payload.user
}

export async function updateAdminUser(
  token: string,
  id: number,
  input: AdminUserInput,
): Promise<User> {
  const payload = await request<{ user: User }>(`/admin/users/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  })
  return payload.user
}

export async function deleteAdminUser(token: string, id: number): Promise<void> {
  await request<{ message: string }>(`/admin/users/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function fetchAdminVehicles(token: string, city = ''): Promise<AdminVehicle[]> {
  const query = city ? `?city=${encodeURIComponent(city)}` : ''
  const payload = await request<{ vehicles: AdminVehicle[] }>(`/admin/vehicles${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return payload.vehicles
}

export async function createAdminVehicle(
  token: string,
  input: AdminVehicleInput,
): Promise<AdminVehicle> {
  const payload = await request<{ vehicle: AdminVehicle }>('/admin/vehicles', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  })
  return payload.vehicle
}

export async function updateAdminVehicle(
  token: string,
  id: number,
  input: AdminVehicleInput,
): Promise<AdminVehicle> {
  const payload = await request<{ vehicle: AdminVehicle }>(`/admin/vehicles/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  })
  return payload.vehicle
}

export async function deleteAdminVehicle(token: string, id: number): Promise<void> {
  await request<{ message: string }>(`/admin/vehicles/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export { API_BASE }
