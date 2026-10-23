export type Role = 'dispatcher' | 'driver' | 'admin'
export type VehicleType = 'ambulance' | 'fire' | 'police'
export type IncidentType = VehicleType
export type IncidentPriority = 'low' | 'medium' | 'high' | 'critical'
export type IncidentStatus =
  | 'open'
  | 'assigned'
  | 'en_route'
  | 'on_scene'
  | 'resolved'
  | 'cancelled'

export interface User {
  id: number
  name: string
  email: string
  role: Role
  operating_city: string | null
}

export interface Session {
  token: string
  user: User
}

export interface Vehicle {
  id: number
  name: string
  plate: string
  type: VehicleType
  status: 'available' | 'assigned' | 'en_route' | 'on_scene' | 'offline'
  lat: number
  lng: number
  operating_city: string | null
  driver_id: number | null
  driver_name: string | null
  pos_updated_at: string
  created_at: string
}

export interface AdminVehicle extends Vehicle {
  home_lat: number
  home_lng: number
}

export interface Incident {
  id: number
  lat: number
  lng: number
  title: string
  description: string | null
  type: IncidentType
  priority: IncidentPriority
  status: IncidentStatus
  operating_city: string | null
  created_by: number
  created_at: string
  resolved_at: string | null
}

export interface CreateIncidentInput {
  lat: number
  lng: number
  title: string
  description: string
  type: IncidentType
  priority: IncidentPriority
}

export interface NearestCandidate {
  vehicle_id: number
  name: string
  plate: string
  type: VehicleType
  operating_city: string | null
  driver_name: string | null
  duration_seconds: number
  distance_m: number
  eta_minutes: number
  type_match: boolean
}

export interface NearestResult {
  incident_id: number
  radius_m: number
  candidates: NearestCandidate[]
  reason?: string
}

export type AssignmentStatus = 'assigned' | 'en_route' | 'arrived' | 'completed' | 'cancelled'

export interface Assignment {
  id: number
  incident_id: number
  vehicle_id: number
  assigned_by: number
  route_geojson: string
  distance_m: number
  eta_seconds: number
  progress_m: number
  status: AssignmentStatus
  assigned_at: string
  started_at: string | null
  arrived_at: string | null
  completed_at: string | null
}

export interface AssignmentWithRelations {
  assignment: Assignment
  incident: Incident | null
  vehicle: Vehicle | null
}

export interface AssignmentHistoryItem {
  id: number
  incident_title: string
  incident_type: IncidentType
  incident_priority: IncidentPriority
  operating_city: string | null
  assigned_at: string
  started_at: string | null
  arrived_at: string | null
  completed_at: string | null
  response_seconds: number | null
}

export interface AdminUserInput {
  name: string
  email: string
  password: string
  role: Role
  operating_city: string
}

export interface AdminVehicleInput {
  name: string
  plate: string
  type: VehicleType
  operating_city: string
  home_lat: number
  home_lng: number
  driver_id: number | null
  status?: 'available' | 'offline'
}

export interface SnapshotEvent {
  vehicles: Vehicle[]
  incidents: Incident[]
  assignments: Assignment[]
}

export interface VehiclePositionEvent {
  vehicle_id: number
  assignment_id: number
  lat: number
  lng: number
  progress_pct: number
  eta_remaining_seconds: number
}

export interface AssignmentStatusEvent {
  assignment: Assignment
  incident: Incident | null
  vehicle: Vehicle | null
}

export interface IncidentStatusEvent {
  incident: Incident
}

export interface WSMessage {
  type: string
  data: unknown
}
