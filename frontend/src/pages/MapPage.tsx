import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import L from 'leaflet'

import {
  ApiError,
  assignIncident,
  cancelIncident,
  createIncident,
  fetchIncidents,
  fetchNearest,
  fetchVehicles,
  fetchAssignment,
} from '../api/client'
import { API_BASE } from '../api/client'
import { clearSession, homeForRole, readSession } from '../auth/session'
import { addBasemap } from '../lib/basemap'
import { syncVehicleMarkers } from '../lib/vehicleMarker'
import {
  CITY_OPTIONS,
  INDONESIA_BOUNDS,
  INDONESIA_CENTER,
  INDONESIA_ZOOM,
  findCity,
} from '../cities'
import { AppHeader } from '../components/AppHeader'
import { CitySelect } from '../components/CitySelect'
import { IconBack } from '../components/icons'
import type {
  Incident,
  IncidentPriority,
  IncidentType,
  NearestResult,
  Session,
  Vehicle,
  VehiclePositionEvent,
  AssignmentStatusEvent,
  SnapshotEvent,
  IncidentStatusEvent,
} from '../types'

const TYPE_META: Record<IncidentType, { label: string; short: string }> = {
  ambulance: { label: 'Ambulans', short: 'A' },
  fire: { label: 'Damkar', short: 'D' },
  police: { label: 'Patroli', short: 'P' },
}

const STATUS_LABEL: Record<Vehicle['status'], string> = {
  available: 'Tersedia',
  assigned: 'Ditugaskan',
  en_route: 'Menuju lokasi',
  on_scene: 'Di lokasi',
  offline: 'Offline',
}

const INCIDENT_STATUS_LABEL: Record<Incident['status'], string> = {
  open: 'Menunggu unit',
  assigned: 'Ditugaskan',
  en_route: 'Menuju lokasi',
  on_scene: 'Di lokasi',
  resolved: 'Selesai',
  cancelled: 'Dibatalkan',
}

const PRIORITY_LABEL: Record<IncidentPriority, string> = {
  low: 'Rendah',
  medium: 'Sedang',
  high: 'Tinggi',
  critical: 'Kritis',
}

const INCIDENT_TYPES: IncidentType[] = ['ambulance', 'fire', 'police']
const PRIORITIES: IncidentPriority[] = ['low', 'medium', 'high', 'critical']

type PanelMode = 'list' | 'create' | 'detail'

interface IncidentForm {
  title: string
  description: string
  type: IncidentType
  priority: IncidentPriority
}

interface DraftPoint {
  lat: number
  lng: number
}

function emptyIncidentForm(): IncidentForm {
  return { title: '', description: '', type: 'ambulance', priority: 'medium' }
}

function incidentIcon(incident: Incident): L.DivIcon {
  const cancelled = incident.status === 'cancelled' ? ' incident-marker--cancelled' : ''
  return L.divIcon({
    className: 'incident-marker-wrap',
    html: `<span class="incident-marker incident-marker--${incident.priority}${cancelled}"><span>!</span></span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -20],
  })
}

function buildVehiclePopup(vehicle: Vehicle): HTMLElement {
  const meta = TYPE_META[vehicle.type] ?? { label: 'Kendaraan', short: '?' }

  const wrapper = document.createElement('div')
  wrapper.className = 'vehicle-popup'

  const title = document.createElement('strong')
  title.textContent = vehicle.name
  wrapper.append(title)

  const plate = document.createElement('span')
  plate.className = 'vehicle-popup-plate'
  plate.textContent = vehicle.plate
  wrapper.append(plate)

  const detail = document.createElement('p')
  detail.textContent = `${meta.label}, ${(STATUS_LABEL[vehicle.status] ?? vehicle.status).toLowerCase()}, ${
    vehicle.operating_city ?? 'kota belum diatur'
  }`
  wrapper.append(detail)

  const driver = document.createElement('p')
  driver.className = 'vehicle-popup-driver'
  driver.textContent = vehicle.driver_name ? `Driver: ${vehicle.driver_name}` : 'Belum ada driver bertugas'
  wrapper.append(driver)

  return wrapper
}

function buildIncidentPopup(incident: Incident): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'incident-popup'

  const title = document.createElement('strong')
  title.textContent = incident.title
  wrapper.append(title)

  const detail = document.createElement('p')
  detail.textContent = `${TYPE_META[incident.type]?.label ?? incident.type}, prioritas ${(
    PRIORITY_LABEL[incident.priority] ?? incident.priority
  ).toLowerCase()}`
  wrapper.append(detail)

  const status = document.createElement('p')
  status.className = 'incident-popup-status'
  status.textContent = `${INCIDENT_STATUS_LABEL[incident.status] ?? incident.status}, ${
    incident.operating_city ?? 'kota belum diatur'
  }`
  wrapper.append(status)

  return wrapper
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`
}

function formatIncidentTime(value: string): string {
  return new Date(value).toLocaleString('id-ID', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function nearestReasonText(reason: string | undefined): string {
  switch (reason) {
    case 'no_available_vehicle_within_radius':
      return 'Tidak ada unit yang tersedia dalam radius pencarian.'
    case 'no_reachable_vehicle':
      return 'Ada unit di sekitar, tetapi tidak ada yang bisa dijangkau lewat jalan.'
    default:
      return 'Belum ada unit yang bisa disarankan.'
  }
}

export function MapPage() {
  const navigate = useNavigate()
  const [session] = useState<Session | null>(() => readSession())
  const [city, setCity] = useState('')
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)

  const [incidents, setIncidents] = useState<Incident[]>([])
  const [incidentLoading, setIncidentLoading] = useState(true)
  const [incidentError, setIncidentError] = useState<string | null>(null)
  const [panelMode, setPanelMode] = useState<PanelMode>('list')
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null)
  const [draft, setDraft] = useState<DraftPoint | null>(null)
  const [form, setForm] = useState<IncidentForm>(emptyIncidentForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [nearest, setNearest] = useState<NearestResult | null>(null)
  const [nearestLoading, setNearestLoading] = useState(false)
  const [nearestError, setNearestError] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [sheetCollapsed, setSheetCollapsed] = useState(false)

  // Bottom sheet (mobile) otomatis terbuka saat mode panel berubah.
  useEffect(() => {
    setSheetCollapsed(false)
    document.querySelector('.incident-panel')?.scrollTo({ top: 0 })
  }, [panelMode])

  // Assignment & WebSocket state
  const [routePolyline, setRoutePolyline] = useState<L.Polyline | null>(null)

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerLayerRef = useRef<L.LayerGroup | null>(null)
  const vehicleMarkersRef = useRef<Map<number, L.Marker>>(new Map())
  const incidentLayerRef = useRef<L.LayerGroup | null>(null)
  const requestIDRef = useRef(0)
  const incidentRequestIDRef = useRef(0)
  const nearestRequestIDRef = useRef(0)

  const handleUnauthorized = useCallback(() => {
    clearSession()
    navigate('/login', { replace: true })
  }, [navigate])

  const load = useCallback(async () => {
    if (!session) return
    const requestID = ++requestIDRef.current
    try {
      const data = await fetchVehicles(session.token, city)
      if (requestID !== requestIDRef.current) return
      setVehicles(data)
      setLastLoaded(new Date())
      setError(null)
    } catch (err) {
      if (requestID !== requestIDRef.current) return
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      setError(
        err instanceof ApiError
          ? err.message
          : 'Server tidak merespons. Periksa koneksi lalu coba lagi.',
      )
    } finally {
      if (requestID === requestIDRef.current) setLoading(false)
    }
  }, [session, city, handleUnauthorized])

  const loadIncidents = useCallback(async () => {
    if (!session) return
    const requestID = ++incidentRequestIDRef.current
    try {
      const data = await fetchIncidents(session.token)
      if (requestID !== incidentRequestIDRef.current) return
      setIncidents(data)
      setIncidentError(null)
    } catch (err) {
      if (requestID !== incidentRequestIDRef.current) return
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      setIncidentError(
        err instanceof ApiError
          ? err.message
          : 'Daftar laporan gagal dimuat. Periksa koneksi lalu coba lagi.',
      )
    } finally {
      if (requestID === incidentRequestIDRef.current) setIncidentLoading(false)
    }
  }, [session, handleUnauthorized])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- memuat data dari API saat mount/filter berubah
    void load()
  }, [load])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- memuat insiden dari API saat mount
    void loadIncidents()
  }, [loadIncidents])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = L.map(mapContainerRef.current, {
      center: INDONESIA_CENTER,
      zoom: INDONESIA_ZOOM,
      minZoom: 3,
      zoomControl: false,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
      wheelDebounceTime: 30,
    })

    L.control.zoom({ position: 'bottomleft' }).addTo(map)

    addBasemap(map, { simple: true })

    markerLayerRef.current = L.layerGroup().addTo(map)
    incidentLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    map.fitBounds(INDONESIA_BOUNDS, { padding: [24, 24] })

    map.on('click', (event: L.LeafletMouseEvent) => {
      setDraft({
        lat: Number(event.latlng.lat.toFixed(6)),
        lng: Number(event.latlng.lng.toFixed(6)),
      })
      setPanelMode('create')
      setSelectedIncident(null)
      setForm(emptyIncidentForm())
      setFormError(null)
      setNearest(null)
      setNearestError(null)
      setCancelError(null)
    })

    return () => {
      map.remove()
      mapRef.current = null
      markerLayerRef.current = null
      vehicleMarkersRef.current = new Map()
      incidentLayerRef.current = null
    }
  }, [])

  // WebSocket connection
  useEffect(() => {
    if (!session) return

    const wsUrl = `${API_BASE.replace('http', 'ws')}/ws?token=${session.token}`
    const socket = new WebSocket(wsUrl)

    socket.onopen = () => {
    }

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        handleWSMessage(msg)
      } catch (e) {
        console.error('WS parse error:', e)
      }
    }

    socket.onclose = () => {
    }

    socket.onerror = (err) => {
      console.error('WebSocket error:', err)
    }

    return () => {
      socket.close()
    }
  }, [session])

  const handleWSMessage = useCallback((msg: any) => {
    if (!msg.type) return

    switch (msg.type) {
      case 'snapshot': {
        const data = msg.data as SnapshotEvent
        setVehicles(data.vehicles)
        setIncidents(data.incidents)
        // Restore route polyline for active assignments
        for (const assignment of data.assignments) {
          if (assignment.status === 'en_route' && assignment.route_geojson) {
            const geojson = JSON.parse(assignment.route_geojson)
            if (geojson.type === 'LineString' && geojson.coordinates.length >= 2) {
              const latlngs = geojson.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number])
              const polyline = L.polyline(latlngs, { color: '#0b8f86', weight: 5, opacity: 0.9 }).addTo(mapRef.current!)
              setRoutePolyline(polyline)
            }
          }
        }
        break
      }
      case 'vehicle_position': {
        const data = msg.data as VehiclePositionEvent
        setVehicles(prev => prev.map(v =>
          v.id === data.vehicle_id ? { ...v, lat: data.lat, lng: data.lng } : v
        ))
        break
      }
      case 'assignment_status': {
        const data = msg.data as AssignmentStatusEvent
        if (data.incident) {
          setIncidents(prev => prev.map(i => i.id === data.incident!.id ? data.incident! : i))
        }
        if (data.vehicle) {
          setVehicles(prev => prev.map(v => v.id === data.vehicle!.id ? data.vehicle! : v))
        }
        if (data.assignment.status === 'completed' || data.assignment.status === 'cancelled') {
          if (routePolyline) {
            mapRef.current?.removeLayer(routePolyline)
            setRoutePolyline(null)
          }
        }
        break
      }
      case 'incident_status': {
        const data = msg.data as IncidentStatusEvent
        setIncidents(prev => prev.map(i => i.id === data.incident.id ? data.incident : i))
        break
      }
    }
  }, [routePolyline])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const selected = findCity(city)
    if (selected) {
      map.setView(selected.center, selected.zoom)
    } else {
      map.fitBounds(INDONESIA_BOUNDS, { padding: [24, 24] })
    }
  }, [city])

  useEffect(() => {
    const layer = markerLayerRef.current
    if (!layer) return

    syncVehicleMarkers(layer, vehicleMarkersRef.current, vehicles, buildVehiclePopup)
  }, [vehicles])

  useEffect(() => {
    const layer = incidentLayerRef.current
    if (!layer) return

    layer.clearLayers()
    for (const incident of incidents) {
      const marker = L.marker([incident.lat, incident.lng], {
        icon: incidentIcon(incident),
        title: incident.title,
      })
        .bindPopup(buildIncidentPopup(incident))
        .addTo(layer)

      marker.on('click', () => {
        setSelectedIncident(incident)
        setPanelMode('detail')
        setDraft(null)
        setFormError(null)
        setNearest(null)
        setNearestError(null)
        setCancelError(null)
        mapRef.current?.setView([incident.lat, incident.lng], 15)
      })
    }
  }, [incidents])

  function handleLogout() {
    clearSession()
    navigate('/login', { replace: true })
  }

  function reload() {
    setError(null)
    setLoading(true)
    void load()
  }

  function reloadIncidents() {
    setIncidentError(null)
    setIncidentLoading(true)
    void loadIncidents()
  }

  function handleCityChange(nextCity: string) {
    if (nextCity === city) return
    setCity(nextCity)
    setLoading(true)
    setError(null)
  }

  function openIncidentDetail(incident: Incident) {
    setSelectedIncident(incident)
    setPanelMode('detail')
    setDraft(null)
    setFormError(null)
    setNearest(null)
    setNearestError(null)
    setCancelError(null)
    mapRef.current?.setView([incident.lat, incident.lng], 15)
  }

  function handleFormChange(
    field: 'title' | 'description' | 'type' | 'priority',
    value: string,
  ) {
    setForm((previous) => {
      if (field === 'type') {
        return { ...previous, type: value as IncidentType }
      }
      if (field === 'priority') {
        return { ...previous, priority: value as IncidentPriority }
      }
      return { ...previous, [field]: value }
    })
  }

  async function submitIncident(event: FormEvent) {
    event.preventDefault()
    if (!session || !draft) {
      setFormError('Pilih lokasi kejadian dengan mengklik peta.')
      return
    }
    const title = form.title.trim()
    if (!title) {
      setFormError('Isi judul laporan.')
      return
    }

    setSubmitting(true)
    setFormError(null)
    try {
      const incident = await createIncident(session.token, {
        lat: draft.lat,
        lng: draft.lng,
        title,
        description: form.description.trim(),
        type: form.type,
        priority: form.priority,
      })
      setIncidents((previous) => [incident, ...previous.filter((item) => item.id !== incident.id)])
      setSelectedIncident(incident)
      setPanelMode('detail')
      setDraft(null)
      setForm(emptyIncidentForm())
      setNearest(null)
      setNearestError(null)
      setCancelError(null)
      mapRef.current?.setView([incident.lat, incident.lng], 15)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      setFormError(errorText(err, 'Laporan belum tersimpan. Coba lagi.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleNearest() {
    if (!session || !selectedIncident) return
    const requestID = ++nearestRequestIDRef.current
    setNearestLoading(true)
    setNearestError(null)
    setNearest(null)
    try {
      const data = await fetchNearest(session.token, selectedIncident.id)
      if (requestID !== nearestRequestIDRef.current) return
      setNearest(data)
    } catch (err) {
      if (requestID !== nearestRequestIDRef.current) return
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      setNearestError(errorText(err, 'Pencarian unit gagal. Coba lagi.'))
    } finally {
      if (requestID === nearestRequestIDRef.current) setNearestLoading(false)
    }
  }

  async function handleAssign(incidentId: number, vehicleId: number) {
    if (!session) return
    try {
      const assignment = await assignIncident(session.token, incidentId, vehicleId)
      // Draw route polyline
      const geojson = JSON.parse(assignment.route_geojson)
      if (geojson.type === 'LineString' && geojson.coordinates.length >= 2) {
        const latlngs = geojson.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number])
        if (routePolyline) {
          mapRef.current?.removeLayer(routePolyline)
        }
        const polyline = L.polyline(latlngs, { color: '#0b8f86', weight: 5, opacity: 0.9 }).addTo(mapRef.current!)
        setRoutePolyline(polyline)
      }
      // Refresh incidents and vehicles
      await loadIncidents()
      await load()
      // Open assignment detail
      const fullAssignment = await fetchAssignment(session.token, assignment.id)
      setSelectedIncident(fullAssignment.incident!)
      setPanelMode('detail')
      setNearest(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      setNearestError(errorText(err, 'Unit belum bisa ditugaskan. Coba lagi.'))
    }
  }

  async function handleCancel() {
    if (!session || !selectedIncident) return
    setCancelling(true)
    setCancelError(null)
    try {
      const updated = await cancelIncident(session.token, selectedIncident.id)
      setIncidents((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      )
      setSelectedIncident(updated)
      setNearest(null)
      setNearestError(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleUnauthorized()
        return
      }
      setCancelError(errorText(err, 'Laporan belum bisa dibatalkan. Coba lagi.'))
    } finally {
      setCancelling(false)
    }
  }

  const counts = vehicles.reduce<Record<Vehicle['type'], number>>(
    (acc, vehicle) => {
      acc[vehicle.type] += 1
      return acc
    },
    { ambulance: 0, fire: 0, police: 0 },
  )

  const statusCounts = vehicles.reduce(
    (acc, vehicle) => {
      if (vehicle.status === 'available') acc.available += 1
      else if (vehicle.status === 'offline') acc.offline += 1
      else acc.busy += 1
      return acc
    },
    { available: 0, busy: 0, offline: 0 },
  )

  const openIncidents = incidents.filter((incident) => incident.status === 'open')
  const connectionError = error || incidentError

  return (
    <div className="map-shell">
      <AppHeader subtitle="Peta operasi" session={session} onLogout={handleLogout}>
        <span className={`connection ${connectionError ? 'connection--off' : ''}`}>
          <span className="connection-dot" aria-hidden="true" />
          {connectionError ? 'Koneksi bermasalah' : 'Tersambung'}
        </span>
        {session && session.user.role !== 'dispatcher' ? (
          <Link className="button button-ghost" to={homeForRole(session.user.role)}>
            <IconBack />
            {session.user.role === 'admin' ? 'Panel admin' : 'Layar driver'}
          </Link>
        ) : null}
      </AppHeader>

      <main className="map-main">
        <aside className="fleet-panel" aria-label="Ringkasan unit">
          <CitySelect
            value={city}
            options={CITY_OPTIONS.map((option) => option.name)}
            allLabel="Semua kota"
            onChange={(next) => handleCityChange(next)}
          />

          <div className="fleet-summary">
            <p className="fleet-total">
              <strong>{vehicles.length}</strong>
              <span>unit terpantau</span>
            </p>
            <div className="fleet-bar" aria-hidden="true">
              {(['ambulance', 'fire', 'police'] as const).map((type) => (
                <span
                  key={type}
                  className={`legend-dot--${type}`}
                  style={{ width: `${vehicles.length ? (counts[type] / vehicles.length) * 100 : 0}%` }}
                />
              ))}
            </div>
          </div>

          <ul className="fleet-types" aria-label="Unit menurut jenis">
            <li>
              <span className="legend-dot legend-dot--ambulance" aria-hidden="true" />
              <strong>{counts.ambulance}</strong>
              <span>Ambulans</span>
            </li>
            <li>
              <span className="legend-dot legend-dot--fire" aria-hidden="true" />
              <strong>{counts.fire}</strong>
              <span>Damkar</span>
            </li>
            <li>
              <span className="legend-dot legend-dot--police" aria-hidden="true" />
              <strong>{counts.police}</strong>
              <span>Patroli</span>
            </li>
          </ul>

          <ul className="fleet-status" aria-label="Unit menurut kesiapan">
            <li>
              <span className="status-dot status-dot--available" aria-hidden="true" />
              {statusCounts.available} siap
            </li>
            <li>
              <span className="status-dot status-dot--busy" aria-hidden="true" />
              {statusCounts.busy} bertugas
            </li>
            <li>
              <span className="status-dot status-dot--offline" aria-hidden="true" />
              {statusCounts.offline} offline
            </li>
          </ul>

          <div className="fleet-foot">
            <span className="fleet-meta">
              {lastLoaded
                ? `Data pukul ${lastLoaded.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`
                : 'Belum dimuat'}
            </span>
            <button className="button button-ghost button-sm" type="button" onClick={reload} disabled={loading}>
              {loading ? 'Memuat…' : 'Segarkan'}
            </button>
          </div>
        </aside>

        <section className="map-stage">
          <div className="map-view">
            <div ref={mapContainerRef} className="map-canvas" aria-label="Peta posisi unit dan laporan" />

            <p className="map-hint">Klik titik di peta untuk membuat laporan</p>

            {loading && vehicles.length === 0 ? (
              <div className="map-overlay">
                <span className="spinner" aria-hidden="true" />
                Memuat posisi unit…
              </div>
            ) : null}

            {error ? (
              <div className="map-overlay map-overlay--error" role="alert">
                <p>{error}</p>
                <button className="button button-primary" type="button" onClick={reload}>
                  Coba lagi
                </button>
              </div>
            ) : null}
          </div>

          <aside
            className={`incident-panel ${sheetCollapsed ? 'incident-panel--collapsed' : ''}`}
            aria-label="Laporan kejadian"
          >
            <button
              className="sheet-handle"
              type="button"
              aria-label={sheetCollapsed ? 'Buka panel laporan' : 'Tutup panel laporan'}
              aria-expanded={!sheetCollapsed}
              onClick={() => setSheetCollapsed((value) => !value)}
            />
            <div className="incident-panel-head">
              <div>
                <h2>{panelMode === 'create' ? 'Laporan baru' : panelMode === 'detail' ? 'Detail laporan' : 'Laporan masuk'}</h2>
                {panelMode === 'list' ? (
                  <p className="panel-sub">{openIncidents.length === 0 ? 'Antrean kosong' : `${openIncidents.length} belum ditangani`}</p>
                ) : null}
              </div>
              <button
                className="button button-ghost incident-refresh"
                type="button"
                onClick={reloadIncidents}
                disabled={incidentLoading}
              >
                {incidentLoading ? 'Memuat…' : 'Segarkan'}
              </button>
            </div>

            {incidentError ? (
              <div className="form-error" role="alert">
                {incidentError}
              </div>
            ) : null}

            {panelMode === 'list' ? (
              <div className="incident-panel-body">
                {incidentLoading ? <p className="muted">Memuat laporan…</p> : null}
                {!incidentLoading && openIncidents.length === 0 ? (
                  <div className="panel-empty">
                    <p>Tidak ada laporan yang menunggu.</p>
                    <p className="muted">Laporan baru dibuat dengan mengklik lokasi di peta.</p>
                  </div>
                ) : null}
                <ul className="incident-list">
                  {openIncidents.map((incident) => (
                    <li key={incident.id}>
                      <button
                        className={`incident-list-item incident-list-item--${incident.priority}`}
                        type="button"
                        onClick={() => openIncidentDetail(incident)}
                      >
                        <span className={`type-chip type-chip--${incident.type}`} aria-hidden="true">
                          {TYPE_META[incident.type]?.short ?? '?'}
                        </span>
                        <span className="incident-list-top">
                          <span className="incident-list-title">{incident.title}</span>
                          <span className={`priority-tag priority-tag--${incident.priority}`}>
                            {PRIORITY_LABEL[incident.priority] ?? incident.priority}
                          </span>
                        </span>
                        <span className="incident-list-meta">
                          {TYPE_META[incident.type]?.label ?? incident.type} di{' '}
                          {incident.operating_city ?? 'kota belum diatur'}
                        </span>
                        <span className="incident-list-time">{formatIncidentTime(incident.created_at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {panelMode === 'create' ? (
              <div className="incident-panel-body">
                <button
                  className="panel-back"
                  type="button"
                  onClick={() => {
                    setPanelMode('list')
                    setDraft(null)
                    setFormError(null)
                  }}
                >
                  <IconBack size={16} />
                  Kembali ke daftar
                </button>
                <p className="incident-coords">
                  <span>Lokasi</span>
                  {draft ? `${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}` : 'klik peta untuk memilih'}
                </p>
                <form className="incident-form" onSubmit={submitIncident}>
                  <label className="field">
                    Judul laporan
                    <input
                      value={form.title}
                      onChange={(event) => handleFormChange('title', event.target.value)}
                      placeholder="Mis. kebakaran gudang di Jl. Industri"
                      autoFocus
                    />
                  </label>
                  <label className="field">
                    Keterangan (boleh dikosongkan)
                    <textarea
                      value={form.description}
                      onChange={(event) => handleFormChange('description', event.target.value)}
                      rows={3}
                      placeholder="Jumlah korban, akses jalan, nomor pelapor"
                    />
                  </label>
                  <fieldset className="segmented">
                    <legend>Jenis unit yang dibutuhkan</legend>
                    <div className="segmented-row">
                      {INCIDENT_TYPES.map((item) => (
                        <label key={item}>
                          <input
                            type="radio"
                            name="incident-type"
                            value={item}
                            checked={form.type === item}
                            onChange={() => handleFormChange('type', item)}
                          />
                          <span>
                            <i style={{ ['--c' as string]: `var(--type-${item})` }} />
                            {TYPE_META[item].label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="segmented">
                    <legend>Prioritas</legend>
                    <div className="segmented-row">
                      {PRIORITIES.map((item) => (
                        <label key={item}>
                          <input
                            type="radio"
                            name="incident-priority"
                            value={item}
                            checked={form.priority === item}
                            onChange={() => handleFormChange('priority', item)}
                          />
                          <span>{PRIORITY_LABEL[item]}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {formError ? (
                    <p className="form-error" role="alert">
                      {formError}
                    </p>
                  ) : null}
                  <div className="form-actions">
                    <button className="button button-primary" type="submit" disabled={submitting}>
                      {submitting ? 'Menyimpan…' : 'Simpan laporan'}
                    </button>
                  </div>
                </form>
              </div>
            ) : null}

            {panelMode === 'detail' && selectedIncident ? (
              <div className="incident-panel-body">
                <button
                  className="panel-back"
                  type="button"
                  onClick={() => {
                    setPanelMode('list')
                    setSelectedIncident(null)
                    setNearest(null)
                    setNearestError(null)
                    setCancelError(null)
                  }}
                >
                  <IconBack size={16} />
                  Kembali ke daftar
                </button>
                <h3 className="incident-detail-title">{selectedIncident.title}</h3>
                <p className={`incident-status incident-status--${selectedIncident.status}`}>
                  {INCIDENT_STATUS_LABEL[selectedIncident.status] ?? selectedIncident.status}
                </p>
                <p className="incident-detail-meta">
                  <span className={`type-chip type-chip--${selectedIncident.type}`} aria-hidden="true">
                    {TYPE_META[selectedIncident.type]?.short ?? '?'}
                  </span>
                  {TYPE_META[selectedIncident.type]?.label ?? selectedIncident.type}
                  <span className={`priority-tag priority-tag--${selectedIncident.priority}`}>
                    {PRIORITY_LABEL[selectedIncident.priority] ?? selectedIncident.priority}
                  </span>
                  {selectedIncident.operating_city ?? 'Kota belum diatur'}
                </p>
                <p className="incident-description">
                  {selectedIncident.description || 'Tidak ada keterangan tambahan.'}
                </p>
                <p className="incident-coords">
                  <span>Lokasi</span>
                  {selectedIncident.lat.toFixed(5)}, {selectedIncident.lng.toFixed(5)}
                </p>
                <p className="incident-created">
                  Dilaporkan {formatIncidentTime(selectedIncident.created_at)}
                </p>

                {selectedIncident.status === 'open' ? (
                  <div className="incident-actions">
                    <button
                      className="button button-primary"
                      type="button"
                      onClick={handleNearest}
                      disabled={nearestLoading}
                    >
                      {nearestLoading ? 'Mencari unit…' : 'Cari unit terdekat'}
                    </button>
                    <button
                      className="button button-danger"
                      type="button"
                      onClick={handleCancel}
                      disabled={cancelling}
                    >
                      {cancelling ? 'Membatalkan…' : 'Batalkan laporan'}
                    </button>
                  </div>
                ) : null}

                {cancelError ? (
                  <p className="form-error" role="alert">
                    {cancelError}
                  </p>
                ) : null}
                {nearestError ? (
                  <p className="form-error" role="alert">
                    {nearestError}
                  </p>
                ) : null}

                {nearest ? (
                  nearest.candidates.length > 0 ? (
                    <div className="nearest-results">
                      <p className="nearest-summary">
                        {nearest.candidates.length} unit dalam radius{' '}
                        {Math.round(nearest.radius_m / 1000)} km, diurutkan dari yang tercepat
                      </p>
                      <ol className="nearest-list">
                        {nearest.candidates.map((candidate) => (
                          <li className="nearest-candidate" key={candidate.vehicle_id}>
                            <div className="nearest-candidate-head">
                              <strong>{candidate.name}</strong>
                              <span className="vehicle-popup-plate">{candidate.plate}</span>
                            </div>
                            <p className="nearest-candidate-meta">
                              {TYPE_META[candidate.type]?.label ?? candidate.type}, driver{' '}
                              {candidate.driver_name ?? 'belum ditentukan'}
                            </p>
                            <p className="nearest-eta">
                              <strong>
                                {candidate.eta_minutes}
                                <small>menit</small>
                              </strong>
                              <span>{formatDistance(candidate.distance_m)} lewat jalan</span>
                              {candidate.type_match ? (
                                <span className="badge badge-match">Jenis sesuai</span>
                              ) : null}
                            </p>
                            <button
                              className="button button-primary assign-btn"
                              type="button"
                              onClick={() => handleAssign(nearest.incident_id, candidate.vehicle_id)}
                              disabled={nearestLoading}
                            >
                              Tugaskan unit ini
                            </button>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : (
                    <p className="nearest-empty">{nearestReasonText(nearest.reason)}</p>
                  )
                ) : null}
              </div>
            ) : null}
          </aside>

        </section>
      </main>
    </div>
  )
}
