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
import { AppHeader } from '../components/AppHeader'
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
      setError(err instanceof ApiError ? err.message : 'Tugas aktif gagal dimuat. Tarik ulang halaman ini.')
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
      setError(err instanceof ApiError ? err.message : 'Riwayat tugas gagal dimuat.')
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
          routeLineRef.current = L.polyline(latlngs, {
            color: '#0b8f86',
            weight: 5,
            opacity: 0.9,
          }).addTo(map)
        }
      } catch (err) {
        console.error('Route parse error:', err)
      }
    }

    const assignmentId = assignment?.assignment?.id
    if (assignmentId && fittedAssignmentRef.current !== assignmentId) {
      fittedAssignmentRef.current = assignmentId
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
    if (!session || !assignment?.assignment?.id) return
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
      setError(err instanceof ApiError ? err.message : 'Perjalanan belum bisa dimulai. Coba lagi.')
    } finally {
      setStarting(false)
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

  const etaLabel =
    status === 'arrived'
      ? 'Tiba di lokasi'
      : status === 'en_route'
        ? formatCountdown(etaRemaining)
        : assignment?.assignment?.eta_seconds
          ? `${Math.ceil((assignment.assignment?.eta_seconds ?? 0) / 60)} menit`
          : '—'

  const distanceLabel = assignment?.assignment?.distance_m
    ? `${(assignment.assignment.distance_m / 1000).toFixed(1)} km`
    : '—'

  return (
    <div className="driver-shell">
      <AppHeader subtitle="Layar driver" session={session} onLogout={handleLogout}>
        <span className={`connection ${wsConnected ? '' : 'connection--off'}`}>
          <span className="connection-dot" aria-hidden="true" />
          {wsConnected ? 'Tersambung' : 'Menyambung ulang…'}
        </span>
      </AppHeader>

      <main className="driver-main">
        {error ? (
          <div className="driver-alert" role="alert">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="driver-loading">
            <span className="spinner" aria-hidden="true" />
            Memeriksa tugas…
          </div>
        ) : assignment ? (
          <div className="driver-content">
            <section className="driver-task-card" aria-label="Tugas aktif">
              <header className="driver-task-header">
                <div>
                  <p className="driver-kicker">Tugas Anda saat ini</p>
                  <h1>{incident?.title ?? 'Tugas tanpa judul'}</h1>
                </div>
                <span className={`driver-status driver-status--${assignment.assignment?.status ?? 'assigned'}`}>
                  {STATUS_LABEL[assignment.assignment?.status ?? 'assigned'] ?? assignment.assignment?.status ?? 'Ditugaskan'}
                </span>
              </header>

              <div className="driver-task-grid">
                <div ref={setMapNode} className="driver-map" aria-label="Peta tugas aktif" />

                <div className="driver-task-side">
                  <div className={`driver-eta ${status === 'arrived' ? 'driver-eta--text' : ''}`}>
                    <span className="driver-eta-label">
                      {status === 'arrived' ? 'Posisi' : 'Perkiraan tiba'}
                    </span>
                    <strong>{etaLabel}</strong>
                    <span className="driver-eta-sub">Jarak rute {distanceLabel}</span>
                  </div>

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

                  <div className="driver-task-actions">
                    {status === 'assigned' ? (
                      <button
                        className="button button-primary"
                        type="button"
                        onClick={handleStart}
                        disabled={starting}
                      >
                        {starting ? 'Memulai…' : 'Berangkat sekarang'}
                      </button>
                    ) : null}
                    {status === 'arrived' ? (
                      <button
                        className="button button-primary"
                        type="button"
                        onClick={handleComplete}
                        disabled={completing}
                      >
                        {completing ? 'Menutup tugas…' : 'Tugas selesai'}
                      </button>
                    ) : null}
                    {status === 'en_route' ? (
                      <button className="button button-ghost" type="button" disabled>
                        Dalam perjalanan ke lokasi
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
      </main>
    </div>
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
