import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'

import {
  API_BASE,
  ApiError,
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
import { ThemeToggle } from '../components/ThemeToggle'
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
  arrived: 'Di lokasi (ON SCENE)',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
}

const TYPE_LABEL: Record<string, string> = {
  ambulance: 'Ambulans',
  fire: 'Damkar',
  police: 'Patroli',
}

const PRIORITY_LABEL: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
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
  if (seconds == null) return 'Belum tiba'
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

export function DriverPage() {
  const navigate = useNavigate()
  const [session] = useState<Session | null>(() => readSession())
  const [assignment, setAssignment] = useState<AssignmentWithRelations | null>(null)
  const [myVehicle, setMyVehicle] = useState<Vehicle | null>(null)
  const [history, setHistory] = useState<AssignmentHistoryItem[]>([])
  const [etaRemaining, setEtaRemaining] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)

  const [mapNode, setMapNode] = useState<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const vehicleMarkerRef = useRef<L.Marker | null>(null)
  const vehicleMarkersRef = useRef<Map<number, L.Marker>>(new Map())
  const incidentMarkerRef = useRef<L.Marker | null>(null)
  const routeLineRef = useRef<L.Polyline | null>(null)
  const assignmentRef = useRef<AssignmentWithRelations | null>(null)
  const myVehicleIDRef = useRef<number | null>(null)
  const fittedAssignmentRef = useRef<number | null>(null)
  const hasConnectedRef = useRef(false)

  const handleUnauthorized = useCallback(() => {
    clearSession()
    navigate('/login', { replace: true })
  }, [navigate])

  const loadActive = useCallback(async () => {
    if (!session) return
    try {
      const data = await fetchMyActiveAssignment(session.token)
      assignmentRef.current = data
      setAssignment(data)
      setEtaRemaining(data ? data.assignment.eta_seconds : null)
      setError(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Gagal memuat tugas aktif.')
    }
  }, [session, handleUnauthorized])

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
      setError(err instanceof ApiError ? err.message : 'Gagal memuat riwayat tugas.')
    }
  }, [session, handleUnauthorized])

  useEffect(() => {
    let cancelled = false
    async function initialLoad() {
      await Promise.all([loadActive(), loadVehicle(), loadHistory()])
      if (!cancelled) setLoading(false)
    }
    // oxlint-disable-next-line react/set-state-in-effect -- pemuatan awal data driver
    void initialLoad()
    return () => {
      cancelled = true
    }
  }, [loadActive, loadVehicle, loadHistory])

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
        void loadHistory()
        void loadVehicle()
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
      if (event.assignment.status === 'arrived') {
        setEtaRemaining(0)
      } else if (event.assignment.status === 'assigned') {
        setEtaRemaining(event.assignment.eta_seconds)
      }
    }

    const applyVehiclePosition = (event: VehiclePositionEvent) => {
      if (assignmentRef.current?.assignment.id !== event.assignment_id) return
      setEtaRemaining(event.eta_remaining_seconds)
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
        if (hasConnectedRef.current) {
          // Setelah reconnect, segarkan state supaya tidak ada event yang terlewat.
          void loadActive()
          void loadVehicle()
          void loadHistory()
        }
        hasConnectedRef.current = true
      }

      socket.onmessage = (event) => {
        try {
          handleMessage(JSON.parse(event.data) as WSMessage)
        } catch (err) {
          console.error('WS parse error:', err)
        }
      }

      socket.onclose = () => {
        setWsConnected(false)
        if (!cancelled) {
          reconnectTimer = window.setTimeout(connect, 3000)
        }
      }

      socket.onerror = () => {
        socket?.close()
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [session, loadActive, loadVehicle, loadHistory])

  useEffect(() => {
    if (!mapNode) return

    const city = findCity(session?.user.operating_city ?? '')
    const map = L.map(mapNode, {
      center: city?.center ?? [-2.5, 118.0],
      zoom: city?.zoom ?? 5,
      zoomControl: true,
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

  useEffect(() => {
    const map = mapRef.current
    if (!map || !myVehicle) return
    const store = vehicleMarkersRef.current
    syncVehicleMarkers(map, store, [myVehicle], (vehicle) =>
      `<strong>${vehicle.name}</strong><br/>${vehicle.plate} · ${
        VEHICLE_STATUS_LABEL[vehicle.status] ?? vehicle.status
      }`,
    )
    vehicleMarkerRef.current = store.get(myVehicle.id) ?? null
  }, [myVehicle, mapNode])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

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
    incidentMarkerRef.current = L.marker([incident.lat, incident.lng], {
      icon: incidentMarkerIcon(),
      title: incident.title,
    })
      .bindPopup(`<strong>${incident.title}</strong><br/>${TYPE_LABEL[incident.type] ?? incident.type}`)
      .addTo(map)

    if (assignment.assignment.route_geojson) {
      try {
        const geojson = JSON.parse(assignment.assignment.route_geojson) as {
          type: string
          coordinates: number[][]
        }
        if (geojson.type === 'LineString' && geojson.coordinates.length >= 2) {
          const latlngs = geojson.coordinates.map(
            (coordinate) => [coordinate[1], coordinate[0]] as [number, number],
          )
          routeLineRef.current = L.polyline(latlngs, {
            color: '#0e7490',
            weight: 4,
            opacity: 0.85,
            dashArray: '8, 4',
          }).addTo(map)
        }
      } catch (err) {
        console.error('Route parse error:', err)
      }
    }

    if (fittedAssignmentRef.current !== assignment.assignment.id) {
      fittedAssignmentRef.current = assignment.assignment.id
      const bounds = L.latLngBounds([
        [incident.lat, incident.lng],
        myVehicle ? [myVehicle.lat, myVehicle.lng] : [incident.lat, incident.lng],
      ])
      if (routeLineRef.current) {
        bounds.extend(routeLineRef.current.getBounds())
      }
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 })
    }
  }, [assignment, myVehicle, mapNode])

  async function handleStart() {
    if (!session || !assignment) return
    setStarting(true)
    setError(null)
    try {
      const updated = await startAssignment(session.token, assignment.assignment.id)
      const next: AssignmentWithRelations = { ...assignment, assignment: updated }
      assignmentRef.current = next
      setAssignment(next)
      setEtaRemaining(updated.eta_seconds)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Gagal memulai tugas.')
    } finally {
      setStarting(false)
    }
  }

  async function handleComplete() {
    if (!session || !assignment) return
    setCompleting(true)
    setError(null)
    try {
      await completeAssignment(session.token, assignment.assignment.id)
      assignmentRef.current = null
      setAssignment(null)
      setEtaRemaining(null)
      await Promise.all([loadHistory(), loadVehicle()])
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Gagal menyelesaikan tugas.')
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
  const etaLabel =
    assignment?.assignment.status === 'arrived'
      ? 'Tiba di lokasi'
      : assignment?.assignment.status === 'en_route'
        ? formatCountdown(etaRemaining)
        : assignment?.assignment.eta_seconds
          ? `${Math.ceil(assignment.assignment.eta_seconds / 60)} menit`
          : '—'

  return (
    <div className="driver-shell">
      <header className="driver-header">
        <div className="driver-brand">
          <span className="brand-mark brand-mark--small" aria-hidden="true">
            <span />
            <span />
          </span>
          <div>
            <p className="brand-name">Dispatch</p>
            <p className="driver-sub">Layar Driver · MVP</p>
          </div>
        </div>
        <div className="driver-user">
          <span className={`connection ${wsConnected ? '' : 'connection--off'}`}>
            <span className="connection-dot" aria-hidden="true" />
            {wsConnected ? 'Live WebSocket' : 'Menyambung ulang…'}
          </span>
          <span className="driver-user-name">
            <span className="avatar" aria-hidden="true">
              {session.user.name.charAt(0).toUpperCase()}
            </span>
            <span>{session.user.name}</span>
          </span>
          <ThemeToggle />
          <button className="button button-ghost" type="button" onClick={handleLogout}>
            Keluar
          </button>
        </div>
      </header>

      <main className="driver-main">
        {error ? (
          <div className="driver-alert" role="alert">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="driver-loading">
            <span className="spinner" aria-hidden="true" />
            Memuat tugas…
          </div>
        ) : assignment ? (
          <div className="driver-content">
            <section className="driver-task-card" aria-label="Tugas aktif">
              <div className="driver-task-header">
                <h2>{incident?.title ?? 'Tugas'}</h2>
                <span className={`driver-status driver-status--${assignment.assignment.status}`}>
                  {STATUS_LABEL[assignment.assignment.status] ?? assignment.assignment.status}
                </span>
              </div>

              <div className="driver-task-grid">
                <div ref={setMapNode} className="driver-map" aria-label="Peta tugas aktif" />

                <dl className="driver-task-details">
                  <div>
                    <dt>Jenis</dt>
                    <dd>{TYPE_LABEL[incident?.type ?? ''] ?? incident?.type}</dd>
                  </div>
                  <div>
                    <dt>Prioritas</dt>
                    <dd>{PRIORITY_LABEL[incident?.priority ?? ''] ?? incident?.priority}</dd>
                  </div>
                  <div>
                    <dt>Lokasi</dt>
                    <dd>
                      {incident ? `${incident.lat.toFixed(5)}, ${incident.lng.toFixed(5)}` : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Kota</dt>
                    <dd>{incident?.operating_city ?? 'Tanpa kota'}</dd>
                  </div>
                  <div>
                    <dt>Kendaraan</dt>
                    <dd>
                      {assignment.vehicle?.name ?? '—'} ({assignment.vehicle?.plate ?? '—'})
                    </dd>
                  </div>
                  <div>
                    <dt>Jarak</dt>
                    <dd>
                      {assignment.assignment.distance_m
                        ? `${(assignment.assignment.distance_m / 1000).toFixed(1)} km`
                        : '—'}
                    </dd>
                  </div>
                  <div className="driver-eta">
                    <dt>ETA</dt>
                    <dd>{etaLabel}</dd>
                  </div>
                </dl>
              </div>

              {incident?.description ? (
                <div className="driver-task-desc">
                  <dt>Deskripsi</dt>
                  <dd>{incident.description}</dd>
                </div>
              ) : null}

              <div className="driver-task-actions">
                {assignment.assignment.status === 'assigned' ? (
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={handleStart}
                    disabled={starting}
                  >
                    {starting ? 'Memulai…' : 'Mulai'}
                  </button>
                ) : null}
                {assignment.assignment.status === 'arrived' ? (
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={handleComplete}
                    disabled={completing}
                  >
                    {completing ? 'Menyelesaikan…' : 'Selesai Ditangani'}
                  </button>
                ) : null}
                {assignment.assignment.status === 'en_route' ? (
                  <button className="button button-ghost" type="button" disabled>
                    Sedang menuju lokasi…
                  </button>
                ) : null}
              </div>
            </section>

            <section className="driver-history" aria-label="Riwayat tugas">
              <div className="driver-history-head">
                <h2>Riwayat Tugas</h2>
                <span className="muted">Maksimal 20 tugas terakhir</span>
              </div>
              <HistoryList history={history} />
            </section>
          </div>
        ) : (
          <div className="driver-content driver-content--empty">
            <section className="driver-empty" aria-label="Tidak ada tugas aktif">
              <p>Tidak ada tugas aktif.</p>
              <p className="muted">Menunggu assign dari dispatcher. Kartu tugas akan muncul otomatis lewat WebSocket.</p>
              <div className="driver-vehicle-info">
                <p className="eyebrow">Kendaraan kamu</p>
                {myVehicle ? (
                  <dl>
                    <div>
                      <dt>Nama</dt>
                      <dd>{myVehicle.name}</dd>
                    </div>
                    <div>
                      <dt>Tipe</dt>
                      <dd>{TYPE_LABEL[myVehicle.type] ?? myVehicle.type}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{VEHICLE_STATUS_LABEL[myVehicle.status] ?? myVehicle.status}</dd>
                    </div>
                    <div>
                      <dt>Kota</dt>
                      <dd>{myVehicle.operating_city ?? '—'}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="muted">Belum ada kendaraan yang terhubung ke akun driver ini.</p>
                )}
              </div>
              <div ref={setMapNode} className="driver-map driver-map--empty" aria-label="Peta kendaraan" />
            </section>

            <section className="driver-history" aria-label="Riwayat tugas">
              <div className="driver-history-head">
                <h2>Riwayat Tugas</h2>
                <span className="muted">Maksimal 20 tugas terakhir</span>
              </div>
              <HistoryList history={history} />
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

function HistoryList({ history }: { history: AssignmentHistoryItem[] }) {
  if (history.length === 0) {
    return <p className="driver-history-empty">Belum ada tugas yang selesai.</p>
  }

  return (
    <ul className="driver-history-list">
      {history.map((item) => (
        <li key={item.id} className="driver-history-item">
          <div className="driver-history-main">
            <strong>{item.incident_title}</strong>
            <span className="muted">
              {item.operating_city ?? 'Tanpa kota'} · {TYPE_LABEL[item.incident_type] ?? item.incident_type} ·{' '}
              {PRIORITY_LABEL[item.incident_priority] ?? item.incident_priority}
            </span>
          </div>
          <div className="driver-history-side">
            <span>{formatDateTime(item.completed_at)}</span>
            <span className="driver-response">Response {formatResponseTime(item.response_seconds)}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
