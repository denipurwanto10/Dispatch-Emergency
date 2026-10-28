import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import { createRouteLine } from '../lib/routeLine'

import {
  API_BASE,
  ApiError,
  arriveAssignment,
  completeAssignment,
  fetchMyActiveAssignment,
  fetchMyHistory,
  fetchVehicles,
  startAssignment,
} from '../api/client'
import { clearSession, readSession } from '../auth/session'
import { addBasemap } from '../lib/basemap'
import { syncVehicleMarkers } from '../lib/vehicleMarker'
import { findCity } from '../cities'
import { AppShell } from '../components/AppShell'
import type {
  AssignmentHistoryItem,
  AssignmentStatusEvent,
  AssignmentWithRelations,
  Session,
  Vehicle,
  VehiclePositionEvent,
  WSMessage,
} from '../types'

const STATUS_LABEL: Record<string, string> = {
  assigned: 'Ditugaskan',
  en_route: 'Menuju lokasi',
  arrived: 'Sudah di lokasi',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
}

const TYPE_LABEL: Record<string, string> = {
  ambulance: 'Ambulans',
  fire: 'Damkar',
  police: 'Patroli',
}

const PRIORITY_LABEL: Record<string, string> = {
  low: 'Rendah',
  medium: 'Sedang',
  high: 'Tinggi',
  critical: 'Kritis',
}

const VEHICLE_STATUS_LABEL: Record<string, string> = {
  available: 'Tersedia',
  assigned: 'Ditugaskan',
  en_route: 'Menuju lokasi',
  on_scene: 'Di lokasi',
  offline: 'Offline',
}

function incidentMarkerIcon(): L.DivIcon {
  return L.divIcon({
    className: 'incident-marker-wrap',
    html: '<span class="incident-marker incident-marker--critical"><span>!</span></span>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('id-ID', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function formatResponseTime(seconds: number | null): string {
  if (seconds == null) return 'Waktu tiba belum tercatat'
  if (seconds < 60) return `${seconds} detik`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes} menit` : `${minutes} menit ${rest} detik`
}

function formatCountdown(seconds: number | null): string {
  if (seconds == null) return '—'
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

function formatDistance(meters: number | null | undefined): string {
  if (meters == null || meters <= 0) return '—'
  return `${(meters / 1000).toFixed(1)} km`
}

// Helper to safely get bounds from route line
function getRouteBounds(routeLine: L.FeatureGroup | null): L.LatLngBounds | null {
  if (!routeLine) return null
  try {
    return routeLine.getBounds()
  } catch {
    return null
  }
}

// OSRM Route response types
interface OSRMRouteResponse {
  code: string
  routes: Array<{
    geometry: { coordinates: number[][]; type: string }
    distance: number
    duration: number
    legs: Array<{ distance: number; duration: number }>
  }>
  waypoints: Array<{ location: number[] }>
}

/**
 * Fetch route from OSRM directly (frontend fallback)
 * Uses public OSRM demo server - in production should use self-hosted
 */
async function fetchRouteFromOSRM(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): Promise<{ coordinates: number[][]; distanceM: number; durationSec: number } | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&steps=false`
  
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.warn('[OSRM] HTTP error:', response.status)
      return null
    }
    const data = await response.json() as OSRMRouteResponse
    if (data.code !== 'Ok' || !data.routes?.length) {
      console.warn('[OSRM] No route found:', data.code)
      return null
    }
    const route = data.routes[0]
    return {
      coordinates: route.geometry.coordinates,
      distanceM: route.distance,
      durationSec: Math.round(route.duration),
    }
  } catch (err) {
    console.error('[OSRM] Fetch error:', err)
    return null
  }
}

export function DriverPage() {
  const navigate = useNavigate()
  const [session] = useState<Session | null>(() => readSession())
  const [assignment, setAssignment] = useState<AssignmentWithRelations | null>(null)
  const [myVehicle, setMyVehicle] = useState<Vehicle | null>(null)
  const [history, setHistory] = useState<AssignmentHistoryItem[]>([])
  const [etaRemaining, setEtaRemaining] = useState<number | null>(null)
  const [distanceRemaining, setDistanceRemaining] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [starting, setStarting] = useState(false)
  const [arriving, setArriving] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [fetchingRoute, setFetchingRoute] = useState(false)

  const [mapNode, setMapNode] = useState<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const vehicleMarkerRef = useRef<L.Marker | null>(null)
  const vehicleMarkersRef = useRef<Map<number, L.Marker>>(new Map())
  const incidentMarkerRef = useRef<L.Marker | null>(null)
  const routeLineRef = useRef<L.FeatureGroup | null>(null)

  const assignmentRef = useRef<AssignmentWithRelations | null>(null)
  const myVehicleIDRef = useRef<number | null>(null)
  const fittedAssignmentRef = useRef<number | null>(null)
  const hasConnectedRef = useRef(false)
  const routeFetchedRef = useRef(false) // prevent duplicate OSRM calls
  const fetchingRouteRef = useRef(false) // prevent duplicate OSRM calls in flight
  // Refs untuk callback load agar effect WebSocket tidak
  // ter-trigger reconnect saat callback berubah. Diinisialisasi dengan no-op
  // lalu di-update setelah useCallback didefinisikan.
  const loadActiveRef = useRef<() => Promise<void>>(async () => {})
  const loadVehicleRef = useRef<() => Promise<void>>(async () => {})
  const loadHistoryRef = useRef<() => Promise<void>>(async () => {})

  const handleUnauthorized = useCallback(() => {
    clearSession()
    navigate('/login', { replace: true })
  }, [navigate])

  const loadActive = useCallback(async () => {
    if (!session) return
    try {
      const data = await fetchMyActiveAssignment(session.token)
      console.log('[DriverPage] PAYLOAD ASSIGNMENT:', JSON.stringify(data, null, 2))
      assignmentRef.current = data
      setAssignment(data)
      // A finished request means the earlier failure (if any) is stale
      setError(null)
      if (data) {
        // Initialize from assignment data
        setEtaRemaining(data.assignment.eta_seconds)
        setDistanceRemaining(data.assignment.distance_m)
        // Reset route fetched flag for new assignment
        routeFetchedRef.current = false
        // Check if we need fallback routing
        const hasRouteGeoJSON = !!data.assignment.route_geojson
        const hasValidEta = data.assignment.eta_seconds > 0
        const hasValidDistance = data.assignment.distance_m > 0
        
        if (!hasRouteGeoJSON || !hasValidEta || !hasValidDistance) {
          // The map effect below triggers the OSRM fallback once assignment state lands
          setRouteError('Mengambil rute dari layanan peta...')
        } else {
          setRouteError(null)
        }
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      if (err instanceof ApiError && err.status === 403) {
        setError('Akses ditolak: Anda tidak memiliki tugas aktif atau token tidak valid.')
      } else if (err instanceof ApiError && err.status === 404) {
        setError('Tidak ada tugas aktif untuk Anda.')
      } else {
        setError(err instanceof ApiError ? err.message : 'Tugas aktif gagal dimuat. Periksa koneksi dan coba lagi.')
      }
      console.error('[DriverPage] loadActive error:', err)
    }
  }, [session, handleUnauthorized])

  // Fallback routing function - calls OSRM directly from frontend
  const fetchAndApplyRouteFallback = useCallback(
    async (startLat: number, startLng: number, endLat: number, endLng: number) => {
      if (fetchingRouteRef.current || routeFetchedRef.current) return

      // Validate coordinates
      const hasValidCoords = [startLat, startLng, endLat, endLng].every(
        (value) => Number.isFinite(value),
      )
      if (!hasValidCoords) {
        console.warn('[Fallback] Invalid coordinates:', { startLat, startLng, endLat, endLng })
        setRouteError('Koordinat tidak valid untuk perhitungan rute')
        return
      }

      fetchingRouteRef.current = true
      setFetchingRoute(true)
      setRouteError('Menghitung rute...')

      try {
        const routeData = await fetchRouteFromOSRM(startLat, startLng, endLat, endLng)
        if (!routeData) {
          // Mark as attempted so the effect does not retry OSRM in a loop
          routeFetchedRef.current = true
          setRouteError('Gagal menghitung rute. Coba lagi atau hubungi dispatcher.')
          return
        }

        routeFetchedRef.current = true
        console.log('[Fallback] Route fetched:', routeData)

        const routeGeoJSON = JSON.stringify({
          type: 'LineString',
          coordinates: routeData.coordinates,
        })

        // Update local state for immediate UI feedback
        setEtaRemaining(routeData.durationSec)
        setDistanceRemaining(routeData.distanceM)
        setRouteError(null)

        // Update assignment with fallback data
        setAssignment((prev) =>
          prev
            ? {
                ...prev,
                assignment: {
                  ...prev.assignment,
                  route_geojson: routeGeoJSON,
                  distance_m: routeData.distanceM,
                  eta_seconds: routeData.durationSec,
                },
              }
            : prev,
        )

        // Also update the ref for WebSocket handlers
        const current = assignmentRef.current
        if (current) {
          assignmentRef.current = {
            ...current,
            assignment: {
              ...current.assignment,
              route_geojson: routeGeoJSON,
              distance_m: routeData.distanceM,
              eta_seconds: routeData.durationSec,
            },
          }
        }
      } catch (err) {
        console.error('[Fallback] Error:', err)
        routeFetchedRef.current = true
        setRouteError('Gagal menghitung rute. Periksa koneksi internet.')
      } finally {
        fetchingRouteRef.current = false
        setFetchingRoute(false)
      }
    },
    [],
  )

  const loadVehicle = useCallback(async () => {
    if (!session) return
    try {
      const vehicles = await fetchVehicles(session.token, session.user.operating_city ?? '')
      const own = vehicles.find((vehicle) => vehicle.driver_id === session.user.id) ?? null
      myVehicleIDRef.current = own?.id ?? null
      setMyVehicle(own)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
      }
      console.error('[DriverPage] loadVehicle error:', err)
    }
  }, [session, handleUnauthorized])

  const loadHistory = useCallback(async () => {
    if (!session) return
    try {
      const items = await fetchMyHistory(session.token)
      setHistory(items)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      console.error('[DriverPage] loadHistory error:', err)
    }
  }, [session, handleUnauthorized])

  // Sync refs so WebSocket effect always calls latest versions without
  // adding them to its dependency array.
  useEffect(() => {
    loadActiveRef.current = loadActive
  }, [loadActive])
  useEffect(() => {
    loadVehicleRef.current = loadVehicle
  }, [loadVehicle])
  useEffect(() => {
    loadHistoryRef.current = loadHistory
  }, [loadHistory])

  const retryLoad = useCallback(async () => {
    setRetrying(true)
    setError(null)
    setRouteError(null)
    routeFetchedRef.current = false
    await Promise.all([loadActive(), loadVehicle(), loadHistory()])
    setRetrying(false)
  }, [loadActive, loadVehicle, loadHistory])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      await Promise.all([loadActive(), loadVehicle(), loadHistory()])
      if (!cancelled) setLoading(false)
    }
    void initialLoad()
    return () => { cancelled = true }
  }, [loadActive, loadVehicle, loadHistory])

  // WebSocket connection for real-time updates
  useEffect(() => {
    if (!session) return

    let cancelled = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null

    const applyAssignmentEvent = (event: AssignmentStatusEvent) => {
      const isMine =
        event.vehicle?.driver_id === session.user.id ||
        event.assignment.vehicle_id === myVehicleIDRef.current ||
        assignmentRef.current?.assignment.id === event.assignment.id
      if (!isMine) return

      if (event.assignment.status === 'completed' || event.assignment.status === 'cancelled') {
        assignmentRef.current = null
        setAssignment(null)
        setEtaRemaining(null)
        setDistanceRemaining(null)
        setRouteError(null)
        routeFetchedRef.current = false
        void loadHistoryRef.current()
        void loadVehicleRef.current()
        return
      }

      const next: AssignmentWithRelations = {
        assignment: event.assignment,
        incident: event.incident,
        vehicle: event.vehicle,
      }
      assignmentRef.current = next
      setAssignment(next)
      if (event.vehicle) {
        myVehicleIDRef.current = event.vehicle.id
        setMyVehicle(event.vehicle)
      }
      // Update ETA/distance from assignment data
      if (event.assignment.status === 'arrived') {
        setEtaRemaining(0)
        setDistanceRemaining(0)
      } else {
        setEtaRemaining(event.assignment.eta_seconds)
        setDistanceRemaining(event.assignment.distance_m)
      }
      // If we got valid route data from backend, clear fallback flag
      if (event.assignment.route_geojson && event.assignment.eta_seconds > 0) {
        routeFetchedRef.current = false
        setRouteError(null)
      }
    }

    const applyVehiclePosition = (event: VehiclePositionEvent) => {
      if (assignmentRef.current?.assignment.id !== event.assignment_id) return
      setEtaRemaining(event.eta_remaining_seconds)
      const currentAssignment = assignmentRef.current
      if (currentAssignment?.assignment.distance_m) {
        const remainingDistance = currentAssignment.assignment.distance_m * (1 - event.progress_pct / 100)
        setDistanceRemaining(Math.max(0, remainingDistance))
      }
      setAssignment((previous) =>
        previous
          ? {
              ...previous,
              vehicle: previous.vehicle
                ? { ...previous.vehicle, lat: event.lat, lng: event.lng }
                : previous.vehicle,
            }
          : previous,
      )
      setMyVehicle((previous) =>
        previous ? { ...previous, lat: event.lat, lng: event.lng } : previous,
      )
    }

    const handleMessage = (message: WSMessage) => {
      switch (message.type) {
        case 'assignment_status':
          applyAssignmentEvent(message.data as AssignmentStatusEvent)
          break
        case 'vehicle_position':
          applyVehiclePosition(message.data as VehiclePositionEvent)
          break
      }
    }

    const connect = () => {
      if (cancelled) return
      const wsUrl = `${API_BASE.replace('http', 'ws')}/ws?token=${session.token}`
      socket = new WebSocket(wsUrl)

      socket.onopen = () => {
        setWsConnected(true)
        console.log('[DriverPage] WebSocket connected')
        if (hasConnectedRef.current) {
          void loadActiveRef.current()
          void loadVehicleRef.current()
          void loadHistoryRef.current()
        }
        hasConnectedRef.current = true
      }

      socket.onmessage = (event) => {
        try {
          handleMessage(JSON.parse(event.data) as WSMessage)
        } catch (err) {
          console.error('[DriverPage] WS parse error:', err)
        }
      }

      socket.onclose = () => {
        setWsConnected(false)
        console.log('[DriverPage] WebSocket disconnected')
        if (!cancelled) {
          reconnectTimer = window.setTimeout(connect, 3000)
        }
      }

      socket.onerror = (err) => {
        // Abaikan error dari socket yang sudah dibuang (mis. cleanup StrictMode)
        if (cancelled) return
        console.error('[DriverPage] WebSocket error:', err)
        socket?.close()
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [session])

  // Map initialization
  useEffect(() => {
    if (!mapNode) return

    const city = findCity(session?.user.operating_city ?? '')
    const map = L.map(mapNode, {
      center: city?.center ?? [-2.5, 118.0],
      zoom: city?.zoom ?? 5,
      zoomControl: true,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
    })
    addBasemap(map, { simple: true })
    mapRef.current = map
    fittedAssignmentRef.current = null

    window.setTimeout(() => map.invalidateSize(), 0)

    return () => {
      map.remove()
      mapRef.current = null
      vehicleMarkerRef.current = null
      vehicleMarkersRef.current = new Map()
      incidentMarkerRef.current = null
      routeLineRef.current = null
    }
  }, [session, mapNode])

  // Vehicle marker sync
  useEffect(() => {
    const map = mapRef.current
    if (!map || !myVehicle) return
    const store = vehicleMarkersRef.current
    syncVehicleMarkers(map, store, [myVehicle], (vehicle) =>
      `<strong>${vehicle.name}</strong><br/>${vehicle.plate}, ${(
        VEHICLE_STATUS_LABEL[vehicle.status] ?? vehicle.status
      ).toLowerCase()}`,
    )
    vehicleMarkerRef.current = store.get(myVehicle.id) ?? null
  }, [myVehicle, mapNode])

  // Map layers: incident marker, route polyline, fit bounds
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clean up previous layers
    if (routeLineRef.current) {
      map.removeLayer(routeLineRef.current)
      routeLineRef.current = null
    }
    if (incidentMarkerRef.current) {
      map.removeLayer(incidentMarkerRef.current)
      incidentMarkerRef.current = null
    }

    if (!assignment?.incident) return

    const incident = assignment.incident

    // Incident marker
    incidentMarkerRef.current = L.marker([incident.lat, incident.lng], {
      icon: incidentMarkerIcon(),
      title: incident.title,
    })
      .bindPopup(`<strong>${incident.title}</strong><br/>${TYPE_LABEL[incident.type] ?? incident.type}`)
      .addTo(map)

    // Route polyline - try backend route_geojson first, fallback to OSRM
    const drawRoute = async () => {
      // Try backend route_geojson first
      if (assignment?.assignment?.route_geojson) {
        try {
          const geojson = JSON.parse(assignment.assignment.route_geojson) as {
            type: string
            coordinates: number[][]
          }
          if (geojson.type === 'LineString' && geojson.coordinates.length >= 2) {
            const latlngs = geojson.coordinates.map(
              (coordinate) => [coordinate[1], coordinate[0]] as [number, number],
            )
            routeLineRef.current = createRouteLine(latlngs).addTo(map)
            setRouteError(null)
            return
          }
        } catch (err) {
          console.error('[DriverPage] Route parse error:', err)
        }
      }

      // Fallback: fetch from OSRM if we have coordinates and haven't fetched yet
      if (!routeFetchedRef.current && myVehicle && incident) {
        await fetchAndApplyRouteFallback(myVehicle.lat, myVehicle.lng, incident.lat, incident.lng)
        // After fallback, the assignment state will update and trigger this effect again
      } else if (routeLineRef.current) {
        // Route already drawn from fallback
        setRouteError(null)
      } else if (!fetchingRoute) {
        setRouteError('Data rute tidak tersedia. Hubungi dispatcher.')
      }
    }

    void drawRoute()

    // Fit bounds to show both vehicle and incident
    const assignmentId = assignment?.assignment?.id
    if (assignmentId && fittedAssignmentRef.current !== assignmentId) {
      fittedAssignmentRef.current = assignmentId
      const bounds = L.latLngBounds([
        [incident.lat, incident.lng],
        myVehicle ? [myVehicle.lat, myVehicle.lng] : [incident.lat, incident.lng],
      ])
      const routeBounds = getRouteBounds(routeLineRef.current)
      if (routeBounds) {
        bounds.extend(routeBounds)
      }
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 })
    }
  }, [assignment, myVehicle, mapNode, fetchAndApplyRouteFallback, fetchingRoute])

  // Action handlers
  async function handleStart() {
    if (!session || !assignment?.assignment?.id) return
    setStarting(true)
    setError(null)
    try {
      const updated = await startAssignment(session.token, assignment.assignment.id)
      const next: AssignmentWithRelations = { ...assignment, assignment: updated }
      assignmentRef.current = next
      setAssignment(next)
      setEtaRemaining(updated.eta_seconds)
      setDistanceRemaining(updated.distance_m)
      setRouteError(updated.route_geojson ? null : 'Data rute tidak tersedia')
      routeFetchedRef.current = false // Allow re-fetch if needed
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Perjalanan belum bisa dimulai. Coba lagi.')
    } finally {
      setStarting(false)
    }
  }

  async function handleArrive() {
    if (!session || !assignment?.assignment?.id) return
    setArriving(true)
    setError(null)
    try {
      const updated = await arriveAssignment(session.token, assignment.assignment.id)
      const next: AssignmentWithRelations = { ...assignment, assignment: updated }
      assignmentRef.current = next
      setAssignment(next)
      setEtaRemaining(0)
      setDistanceRemaining(0)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Gagal menandai tiba di lokasi. Coba lagi.')
    } finally {
      setArriving(false)
    }
  }

  async function handleComplete() {
    if (!session || !assignment?.assignment?.id) return
    setCompleting(true)
    setError(null)
    try {
      await completeAssignment(session.token, assignment?.assignment?.id ?? 0)
      assignmentRef.current = null
      setAssignment(null)
      setEtaRemaining(null)
      setDistanceRemaining(null)
      setRouteError(null)
      routeFetchedRef.current = false
      await Promise.all([loadHistory(), loadVehicle()])
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Tugas belum bisa ditutup. Coba lagi.')
    } finally {
      setCompleting(false)
    }
  }

  function handleLogout() {
    clearSession()
    navigate('/login', { replace: true })
  }

  if (!session) return null

  const incident = assignment?.incident ?? null
  const status = assignment?.assignment?.status ?? 'assigned'
  const isAssigned = status === 'assigned'
  const isEnRoute = status === 'en_route'
  const isArrived = status === 'arrived'
  const isCompleted = status === 'completed'
  const isCancelled = status === 'cancelled'

  // Always compute labels from assignment data as fallback
  const assignmentEtaSeconds = assignment?.assignment?.eta_seconds ?? 0
  const assignmentDistanceM = assignment?.assignment?.distance_m ?? 0

  const etaLabel = isArrived || isCompleted
    ? 'Tiba di lokasi'
    : isEnRoute
      ? formatCountdown(etaRemaining)
      : assignmentEtaSeconds > 0
        ? `${Math.ceil(assignmentEtaSeconds / 60)} menit`
        : fetchingRoute
          ? 'Menghitung...'
          : '—'

  const distanceLabel = isArrived || isCompleted
    ? '0 km'
    : formatDistance(distanceRemaining ?? assignmentDistanceM)

  const progressPercent = assignmentEtaSeconds > 0 && etaRemaining != null
    ? Math.min(100, Math.max(0, 100 - (etaRemaining / assignmentEtaSeconds) * 100))
    : 0

  return (
    <AppShell
      title="Layar driver"
      subtitle="Tugas aktif, rute, dan riwayat perjalanan"
      session={session}
      onLogout={handleLogout}
      contentClassName="shell-main--scroll"
      actions={
        <span className={`connection ${wsConnected ? '' : 'connection--off'}`}>
          <span className="connection-dot" aria-hidden="true" />
          {wsConnected ? 'Tersambung' : 'Menyambung ulang…'}
        </span>
      }
    >
      <div className="driver-main">
        {/* Error banner with retry - ONLY shows if error state is set AND no assignment data */}
        {error && !assignment ? (
          <div className="driver-alert" role="alert">
            <span>{error}</span>
            <button
              className="button button-ghost button-sm"
              type="button"
              onClick={retryLoad}
              disabled={retrying}
            >
              {retrying ? 'Memuat…' : 'Coba Lagi'}
            </button>
          </div>
        ) : null}

        {/* Route warning (non-blocking) */}
        {routeError && !error ? (
          <div className="driver-alert driver-alert--warning" role="alert">
            <span>⚠ {routeError}</span>
            {fetchingRoute ? (
              <span className="spinner" style={{ width: 16, height: 16 }} />
            ) : (
              <button
                className="button button-ghost button-sm"
                type="button"
                onClick={retryLoad}
                disabled={retrying}
              >
                {retrying ? 'Memuat…' : 'Coba Lagi'}
              </button>
            )}
          </div>
        ) : null}

        {loading ? (
          <div className="driver-loading">
            <span className="spinner" aria-hidden="true" />
            Memeriksa tugas…
          </div>
        ) : assignment && !isCompleted && !isCancelled ? (
          <div className="driver-content">
            <section className="driver-task-card" aria-label="Tugas aktif">
              <header className="driver-task-header">
                <div>
                  <p className="driver-kicker">Tugas Anda saat ini</p>
                  <h1>{incident?.title ?? 'Tugas tanpa judul'}</h1>
                </div>
                <span className={`driver-status driver-status--${status}`}>
                  {STATUS_LABEL[status] ?? status}
                </span>
              </header>

              <div className="driver-task-grid">
                <div ref={setMapNode} className="driver-map" aria-label="Peta tugas aktif" />

                <div className="driver-task-side">
                  {/* ETA & Distance Widget */}
                  <div className={`driver-eta ${isArrived || isCompleted ? 'driver-eta--text' : ''}`}>
                    <span className="driver-eta-label">
                      {isArrived || isCompleted ? 'Posisi' : isEnRoute ? 'Sisa waktu' : 'Perkiraan tiba'}
                    </span>
                    <strong>{etaLabel}</strong>
                    <span className="driver-eta-sub">Jarak tersisa {distanceLabel}</span>
                    {(isEnRoute || isArrived) && assignmentEtaSeconds > 0 && (
                      <div className="driver-progress" role="progressbar" aria-valuenow={Math.round(progressPercent)} aria-valuemin={0} aria-valuemax={100}>
                        <div className="driver-progress-bar" style={{ width: `${progressPercent}%` }} />
                      </div>
                    )}
                  </div>

                  {/* Task Details */}
                  <dl className="driver-task-details">
                    <div>
                      <dt>Jenis kejadian</dt>
                      <dd>{TYPE_LABEL[incident?.type ?? ''] ?? incident?.type}</dd>
                    </div>
                    <div>
                      <dt>Prioritas</dt>
                      <dd>
                        <span className={`priority-tag priority-tag--${incident?.priority ?? 'low'}`}>
                          {PRIORITY_LABEL[incident?.priority ?? ''] ?? incident?.priority}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Kota</dt>
                      <dd>{incident?.operating_city ?? 'Belum diatur'}</dd>
                    </div>
                    <div>
                      <dt>Kendaraan</dt>
                      <dd>{assignment.vehicle?.name ?? '—'}</dd>
                    </div>
                    <div className="driver-detail-wide">
                      <dt>Nomor polisi</dt>
                      <dd className="mono">{assignment.vehicle?.plate ?? '—'}</dd>
                    </div>
                    <div className="driver-detail-wide">
                      <dt>Titik kejadian</dt>
                      <dd className="mono">
                        {incident ? `${incident.lat.toFixed(5)}, ${incident.lng.toFixed(5)}` : '—'}
                      </dd>
                    </div>
                  </dl>

                  {incident?.description ? (
                    <div className="driver-task-desc">
                      <p className="driver-desc-label">Keterangan dari dispatcher</p>
                      <p>{incident.description}</p>
                    </div>
                  ) : null}

                  {/* Action Buttons - Full width, thumb-friendly */}
                  <div className="driver-task-actions">
                    {isAssigned ? (
                      <button
                        className="button button-primary button-lg button-full"
                        type="button"
                        onClick={handleStart}
                        disabled={starting}
                      >
                        {starting ? 'Memulai…' : 'Mulai Perjalanan'}
                      </button>
                    ) : null}

                    {isEnRoute ? (
                      <button
                        className="button button-warning button-lg button-full"
                        type="button"
                        onClick={handleArrive}
                        disabled={arriving}
                      >
                        {arriving ? 'Memproses…' : 'Sampai di Lokasi'}
                      </button>
                    ) : null}

                    {isArrived ? (
                      <button
                        className="button button-success button-lg button-full"
                        type="button"
                        onClick={handleComplete}
                        disabled={completing}
                      >
                        {completing ? 'Menyelesaikan…' : 'Selesaikan Tugas'}
                      </button>
                    ) : null}

                    {(isCompleted || isCancelled) ? (
                      <button className="button button-ghost button-lg button-full" type="button" disabled>
                        {isCompleted ? 'Tugas Selesai' : 'Tugas Dibatalkan'}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="driver-history" aria-label="Riwayat tugas">
              <div className="driver-history-head">
                <h2>Riwayat tugas</h2>
                <span className="muted">20 terakhir</span>
              </div>
              <HistoryList history={history} />
            </section>
          </div>
        ) : (
          <div className="driver-content">
            <section className="driver-empty" aria-label="Tidak ada tugas aktif">
              <div className="driver-empty-main">
                <span className="driver-status driver-status--standby">Siaga</span>
                <h1>Belum ada tugas untuk Anda</h1>
                <p className="muted">
                  Tetap di dekat kendaraan. Saat dispatcher menugaskan unit Anda, rute dan lokasi kejadian langsung tampil di sini tanpa perlu menyegarkan halaman.
                </p>

                <div className="driver-vehicle-info">
                  <p className="driver-desc-label">Kendaraan yang Anda bawa</p>
                  {myVehicle ? (
                    <dl>
                      <div>
                        <dt>Unit</dt>
                        <dd>{myVehicle.name}</dd>
                      </div>
                      <div>
                        <dt>Nomor polisi</dt>
                        <dd className="mono">{myVehicle.plate}</dd>
                      </div>
                      <div>
                        <dt>Jenis</dt>
                        <dd>{TYPE_LABEL[myVehicle.type] ?? myVehicle.type}</dd>
                      </div>
                      <div>
                        <dt>Kesiapan</dt>
                        <dd>{VEHICLE_STATUS_LABEL[myVehicle.status] ?? myVehicle.status}</dd>
                      </div>
                      <div>
                        <dt>Kota</dt>
                        <dd>{myVehicle.operating_city ?? '—'}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="muted">Akun ini belum dikaitkan dengan kendaraan. Minta admin menetapkan unit untuk Anda.</p>
                  )}
                </div>
              </div>
              <div ref={setMapNode} className="driver-map driver-map--empty" aria-label="Peta kendaraan" />
            </section>

            <section className="driver-history" aria-label="Riwayat tugas">
              <div className="driver-history-head">
                <h2>Riwayat tugas</h2>
                <span className="muted">20 terakhir</span>
              </div>
              <HistoryList history={history} />
            </section>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function HistoryList({ history }: { history: AssignmentHistoryItem[] }) {
  if (history.length === 0) {
    return <p className="driver-history-empty">Belum ada tugas yang selesai. Setelah Anda menutup tugas, riwayatnya muncul di sini.</p>
  }

  return (
    <ul className="driver-history-list">
      {history.map((item) => (
        <li key={item.id} className="driver-history-item">
          <div className="driver-history-main">
            <span className="driver-history-title">
              <strong>{item.incident_title}</strong>
              <span className={`priority-tag priority-tag--${item.incident_priority}`}>
                {PRIORITY_LABEL[item.incident_priority] ?? item.incident_priority}
              </span>
            </span>
            <span className="muted">
              {TYPE_LABEL[item.incident_type] ?? item.incident_type} di {item.operating_city ?? 'kota belum diatur'}
            </span>
          </div>
          <div className="driver-history-side">
            <span>{formatDateTime(item.completed_at)}</span>
            <span className="driver-response">
              {item.response_seconds == null
                ? formatResponseTime(null)
                : `Tiba dalam ${formatResponseTime(item.response_seconds)}`}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}