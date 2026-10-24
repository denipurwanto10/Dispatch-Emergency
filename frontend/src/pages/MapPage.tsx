import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import L from 'leaflet'
import { toast } from 'sonner'
import { createRouteLine } from '../lib/routeLine'

import {
  ApiError,
  assignIncident,
  cancelIncident,
  createIncident,
  fetchIncidents,
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
} from '../cities'
import { AppHeader } from '../components/AppHeader'
import { CitySelect } from '../components/CitySelect'
import { IconBack, IconPlus } from '../components/icons'
import { useTheme } from '../context/ThemeContext'
import {
  featureBounds,
  featureContains,
  loadCities,
  loadDistricts,
  loadProvinces,
  findProvinceByKey,
  findCityByName,
  findProvinceByName,
  operationCitiesForProvince,
  operationCityForAdm2,
  operationCityTarget,
  regionLabel,
  type RegionBounds,
  type RegionFeature,
  type RegionLevel,
} from '../lib/regions'
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
  WSMessage,
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
  assigned: 'Unit ditugaskan',
  en_route: 'Unit Menuju Lokasi',
  on_scene: 'Unit Tiba di Lokasi',
  resolved: 'Laporan Selesai',
  cancelled: 'Dibatalkan',
}

// Status insiden yang sudah tidak bisa dibatalkan lagi.
const CLOSED_INCIDENT_STATUS: Incident['status'][] = ['resolved', 'cancelled']

function upsertIncident(list: Incident[], incident: Incident): Incident[] {
  const index = list.findIndex((item) => item.id === incident.id)
  if (index === -1) return [incident, ...list]
  const next = list.slice()
  next[index] = incident
  return next
}

const PRIORITY_LABEL: Record<IncidentPriority, string> = {
  low: 'Rendah',
  medium: 'Sedang',
  high: 'Tinggi',
  critical: 'Kritis',
}

const INCIDENT_TYPES: IncidentType[] = ['ambulance', 'fire', 'police']
const PRIORITIES: IncidentPriority[] = ['low', 'medium', 'high', 'critical']

interface RegionPalette {
  stroke: string
  fill: string
  selectedStroke: string
  selectedFill: string
  hoverStroke: string
  hoverFill: string
}

const REGION_PALETTES: Record<'light' | 'dark', RegionPalette> = {
  light: {
    stroke: '#0f766e',
    fill: '#0f766e',
    selectedStroke: '#005a54',
    selectedFill: '#00776f',
    hoverStroke: '#005a54',
    hoverFill: '#00776f',
  },
  dark: {
    stroke: '#38c9bb',
    fill: '#38c9bb',
    selectedStroke: '#7ae3d8',
    selectedFill: '#38c9bb',
    hoverStroke: '#7ae3d8',
    hoverFill: '#38c9bb',
  },
}

function regionStyle(
  level: RegionLevel,
  selected: boolean,
  palette: RegionPalette,
): L.PathOptions {
  const province = level === 'indonesia'
  return {
    color: selected ? palette.selectedStroke : palette.stroke,
    weight: selected ? 2.4 : province ? 1.1 : 1.4,
    opacity: 0.95,
    fillColor: selected ? palette.selectedFill : palette.fill,
    fillOpacity: selected ? 0.16 : 0.045,
    lineCap: 'round',
    lineJoin: 'round',
    className: 'region-polygon',
  }
}

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
  const { theme } = useTheme()
  const [session] = useState<Session | null>(() => readSession())
  const [city, setCity] = useState('')
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null)

  // Drill-down wilayah
  const [regionLevel, setRegionLevel] = useState<RegionLevel>('indonesia')
  const [provinces, setProvinces] = useState<RegionFeature[]>([])
  const [cities, setCities] = useState<RegionFeature[]>([])
  const [districts, setDistricts] = useState<RegionFeature[]>([])
  const [selectedProvince, setSelectedProvince] = useState<RegionFeature | null>(null)
  const [selectedCity, setSelectedCity] = useState<RegionFeature | null>(null)
  const [selectedDistrict, setSelectedDistrict] = useState<RegionFeature | null>(null)
  const [regionLoading, setRegionLoading] = useState(true)
  const [regionError, setRegionError] = useState<string | null>(null)
  const [pickingLocation, setPickingLocation] = useState(false)

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
  const [wsConnected, setWsConnected] = useState(false)
  const routePolylineRef = useRef<L.FeatureGroup | null>(null)
  // Status terakhir per assignment agar toast hanya muncul saat status berubah.
  const assignmentStatusRef = useRef<Map<number, string>>(new Map())
  const hasConnectedRef = useRef(false)
  // Refs untuk callback load/loadIncidents agar effect WebSocket tidak
  // ter-trigger reconnect saat callback berubah. Diinisialisasi dengan no-op
  // lalu di-update setelah useCallback didefinisikan.
  const loadRef = useRef<() => Promise<void>>(async () => {})
  const loadIncidentsRef = useRef<() => Promise<void>>(async () => {})

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const regionLayerRef = useRef<L.LayerGroup | null>(null)
  const markerLayerRef = useRef<L.LayerGroup | null>(null)
  const vehicleMarkersRef = useRef<Map<number, L.Marker>>(new Map())
  const incidentLayerRef = useRef<L.LayerGroup | null>(null)
  const requestIDRef = useRef(0)
  const incidentRequestIDRef = useRef(0)
  const regionRequestIDRef = useRef(0)

  const handleUnauthorized = useCallback(() => {
    clearSession()
    navigate('/login', { replace: true })
  }, [navigate])

  const load = useCallback(async () => {
    if (!session) return
    const requestID = ++requestIDRef.current
    try {
      // Semua unit dimuat sekali; penyaringan kota/wilayah dilakukan di klien
      // agar drill-down dan filter kota tidak saling bertabrakan.
      const data = await fetchVehicles(session.token)
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
  }, [session, handleUnauthorized])

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

  // Sync refs so WebSocket effect always calls latest versions without
  // adding them to its dependency array.
  useEffect(() => {
    loadRef.current = load
  }, [load])
  useEffect(() => {
    loadIncidentsRef.current = loadIncidents
  }, [loadIncidents])

  const palette = REGION_PALETTES[theme]

  const loadRegionData = useCallback(async () => {
    setRegionLoading(true)
    setRegionError(null)
    try {
      const [provinceData, cityData] = await Promise.all([loadProvinces(), loadCities()])
      setProvinces(provinceData.features as RegionFeature[])
      setCities(cityData.features as RegionFeature[])
    } catch (err) {
      setRegionError(
        err instanceof Error ? err.message : 'Batas wilayah gagal dimuat. Coba lagi.',
      )
    } finally {
      setRegionLoading(false)
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- memuat batas wilayah statis saat mount
    void loadRegionData()
  }, [loadRegionData])

  const flyToRegion = useCallback((bounds: RegionBounds, maxZoom: number) => {
    const map = mapRef.current
    if (!map) return

    const width = window.innerWidth
    const compact = width <= 820
    const desktop = width > 1180

    map.flyToBounds(bounds, {
      paddingTopLeft: desktop ? [340, 48] : [24, compact ? 84 : 64],
      paddingBottomRight: desktop ? [420, 48] : compact ? [24, 248] : [392, 64],
      maxZoom,
      duration: 0.75,
    })
  }, [])

  const resetToIndonesia = useCallback(() => {
    regionRequestIDRef.current += 1
    setRegionLevel('indonesia')
    setSelectedProvince(null)
    setSelectedCity(null)
    setSelectedDistrict(null)
    setDistricts([])
    setPickingLocation(false)
    setCity('')
    mapRef.current?.flyToBounds(INDONESIA_BOUNDS, { padding: [24, 24], duration: 0.75 })
  }, [])

  const backToProvince = useCallback(() => {
    if (!selectedProvince) {
      resetToIndonesia()
      return
    }
    regionRequestIDRef.current += 1
    setRegionLevel('province')
    setSelectedCity(null)
    setSelectedDistrict(null)
    setDistricts([])
    setPickingLocation(false)
    setCity('')
    const bounds = featureBounds(selectedProvince)
    if (bounds) flyToRegion(bounds, 8)
  }, [selectedProvince, flyToRegion, resetToIndonesia])

  const backToCity = useCallback(() => {
    if (!selectedCity) {
      backToProvince()
      return
    }
    setRegionLevel('city')
    setSelectedDistrict(null)
    setPickingLocation(false)
    setCity(operationCityForAdm2(selectedCity) ?? '')
    const bounds = featureBounds(selectedCity)
    if (bounds) flyToRegion(bounds, 11)
  }, [selectedCity, backToProvince, flyToRegion])

  const beginIncidentAt = useCallback((lat: number, lng: number) => {
    setDraft({
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
    })
    setPanelMode('create')
    setSelectedIncident(null)
    setForm(emptyIncidentForm())
    setFormError(null)
    setNearest(null)
    setNearestError(null)
    setCancelError(null)
    setPickingLocation(false)
  }, [])

  const openProvince = useCallback(
    (feature: RegionFeature) => {
      regionRequestIDRef.current += 1
      setSelectedProvince(feature)
      setSelectedCity(null)
      setSelectedDistrict(null)
      setDistricts([])
      setRegionLevel('province')
      setPickingLocation(false)
      setCity('')
      const bounds = featureBounds(feature)
      if (bounds) flyToRegion(bounds, 8)
    },
    [flyToRegion],
  )

  const openCity = useCallback(
    async (feature: RegionFeature) => {
      const requestID = ++regionRequestIDRef.current
      setSelectedCity(feature)
      setSelectedDistrict(null)
      setRegionLevel('city')
      setPickingLocation(false)
      setCity(operationCityForAdm2(feature) ?? '')

      const bounds = featureBounds(feature)
      if (bounds) flyToRegion(bounds, 11)

      const provinceGid = feature.properties.GID_1
      if (!provinceGid) {
        setDistricts([])
        return
      }

      setRegionLoading(true)
      setRegionError(null)
      try {
        const districtData = await loadDistricts(provinceGid)
        if (requestID !== regionRequestIDRef.current) return
        setDistricts(
          districtData.features.filter(
            (item) => item.properties.GID_2 === feature.properties.GID_2,
          ) as RegionFeature[],
        )
      } catch (err) {
        if (requestID !== regionRequestIDRef.current) return
        setDistricts([])
        setRegionError(
          err instanceof Error ? err.message : 'Batas kecamatan gagal dimuat. Coba lagi.',
        )
      } finally {
        if (requestID === regionRequestIDRef.current) setRegionLoading(false)
      }
    },
    [flyToRegion],
  )

  const openDistrict = useCallback(
    (feature: RegionFeature) => {
      setSelectedDistrict(feature)
      setRegionLevel('district')
      setPickingLocation(false)
      const bounds = featureBounds(feature)
      if (bounds) flyToRegion(bounds, 13)
    },
    [flyToRegion],
  )

  const focusOperationCity = useCallback(
    async (name: string) => {
      const target = operationCityTarget(name)
      if (!target) return

      const requestID = ++regionRequestIDRef.current
      setRegionError(null)
      try {
        const [provinceData, cityData] = await Promise.all([loadProvinces(), loadCities()])
        if (requestID !== regionRequestIDRef.current) return

        setProvinces(provinceData.features as RegionFeature[])
        setCities(cityData.features as RegionFeature[])

        const province = provinceData.features.find(
          (item) => item.properties.NAME_1 === target.provinceName,
        ) as RegionFeature | undefined
        if (!province) {
          setRegionError('Provinsi untuk kota ini tidak ditemukan di data wilayah.')
          return
        }

        setSelectedProvince(province)
        setSelectedDistrict(null)
        setDistricts([])

        if (!target.cityName) {
          setSelectedCity(null)
          setRegionLevel('province')
          const bounds = featureBounds(province)
          if (bounds) flyToRegion(bounds, 10)
          return
        }

        const cityFeature = cityData.features.find(
          (item) =>
            item.properties.NAME_1 === target.provinceName &&
            item.properties.NAME_2 === target.cityName,
        ) as RegionFeature | undefined
        if (!cityFeature) {
          setSelectedCity(null)
          setRegionLevel('province')
          setRegionError('Kota/kabupaten untuk kota operasi ini tidak ditemukan.')
          const bounds = featureBounds(province)
          if (bounds) flyToRegion(bounds, 8)
          return
        }

        setSelectedCity(cityFeature)
        setRegionLevel('city')
        const bounds = featureBounds(cityFeature)
        if (bounds) flyToRegion(bounds, 11)

        const provinceGid = cityFeature.properties.GID_1
        if (!provinceGid) return

        setRegionLoading(true)
        const districtData = await loadDistricts(provinceGid)
        if (requestID !== regionRequestIDRef.current) return
        setDistricts(
          districtData.features.filter(
            (item) => item.properties.GID_2 === cityFeature.properties.GID_2,
          ) as RegionFeature[],
        )
      } catch (err) {
        if (requestID !== regionRequestIDRef.current) return
        setRegionError(
          err instanceof Error ? err.message : 'Batas wilayah kota gagal dimuat. Coba lagi.',
        )
      } finally {
        if (requestID === regionRequestIDRef.current) setRegionLoading(false)
      }
    },
    [flyToRegion],
  )

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

    regionLayerRef.current = L.layerGroup().addTo(map)
    markerLayerRef.current = L.layerGroup().addTo(map)
    incidentLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    map.fitBounds(INDONESIA_BOUNDS, { padding: [24, 24] })

    map.on('click', (event: L.LeafletMouseEvent) => {
      beginIncidentAt(event.latlng.lat, event.latlng.lng)
    })

    return () => {
      map.remove()
      mapRef.current = null
      regionLayerRef.current = null
      markerLayerRef.current = null
      vehicleMarkersRef.current = new Map()
      incidentLayerRef.current = null
    }
  }, [beginIncidentAt])

  // Handler event WebSocket. Didefinisikan sebelum effect koneksi dan hanya
  // bergantung pada setter stabil, sehingga socket tidak ikut reconnect saat
  // state lain berubah.
  const handleWSMessage = useCallback((msg: WSMessage) => {
    if (!msg.type) return

    switch (msg.type) {
      case 'snapshot': {
        const data = msg.data as SnapshotEvent
        setVehicles(data.vehicles)
        setIncidents(data.incidents)
        // Simpan status awal agar reconnect tidak memunculkan toast untuk
        // kejadian yang sudah lewat.
        assignmentStatusRef.current = new Map(
          data.assignments.map((assignment) => [assignment.id, assignment.status]),
        )
        // Restore route polyline for active assignments
        for (const assignment of data.assignments) {
          if (assignment.status === 'en_route' && assignment.route_geojson) {
            const geojson = JSON.parse(assignment.route_geojson)
            if (geojson.type === 'LineString' && geojson.coordinates.length >= 2) {
              const latlngs = geojson.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number])
              const polyline = createRouteLine(latlngs).addTo(mapRef.current!)
              routePolylineRef.current = polyline
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
        const { assignment, incident, vehicle } = data
        const previousStatus = assignmentStatusRef.current.get(assignment.id)
        assignmentStatusRef.current.set(assignment.id, assignment.status)

        if (incident) {
          setIncidents((prev) => upsertIncident(prev, incident))
          // Panel "Detail laporan" memakai state sendiri, jadi ikut disinkronkan.
          setSelectedIncident((prev) =>
            prev && prev.id === incident.id ? incident : prev,
          )
        }
        if (vehicle) {
          setVehicles(prev => prev.map(v => v.id === vehicle.id ? vehicle : v))
        }
        if (assignment.status === 'completed' || assignment.status === 'cancelled') {
          if (routePolylineRef.current) {
            mapRef.current?.removeLayer(routePolylineRef.current)
            routePolylineRef.current = null
          }
        }

        // Toast hanya saat status benar-benar berubah, bukan tiap event berulang.
        if (previousStatus === assignment.status) break

        if (assignment.status === 'arrived') {
          toast.success(`Unit ${vehicle?.name ?? 'bantuan'} telah tiba di lokasi!`, {
            description: incident?.title,
          })
        } else if (assignment.status === 'completed') {
          toast.success(
            `Laporan ${incident?.title ?? 'kejadian'} telah diselesaikan oleh ${
              vehicle?.name ?? 'unit terkait'
            }!`,
          )
        }
        break
      }
      case 'incident_status': {
        const data = msg.data as IncidentStatusEvent
        setIncidents(prev => upsertIncident(prev, data.incident))
        setSelectedIncident((prev) =>
          prev && prev.id === data.incident.id ? data.incident : prev,
        )
        break
      }
    }
  }, [])

  // WebSocket connection dengan reconnect otomatis. Semua dispatcher yang login
  // menerima broadcast yang sama dari hub.
  useEffect(() => {
    if (!session) return

    let cancelled = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null

    const connect = () => {
      if (cancelled) return

      const wsUrl = `${API_BASE.replace('http', 'ws')}/ws?token=${session.token}`
      socket = new WebSocket(wsUrl)

      socket.onopen = () => {
        if (cancelled) return
        setWsConnected(true)
        if (hasConnectedRef.current) {
          // Setelah reconnect, tarik ulang data agar event yang terlewat tersusul.
          void loadIncidentsRef.current()
          void loadRef.current()
        }
        hasConnectedRef.current = true
      }

      socket.onmessage = (event) => {
        try {
          handleWSMessage(JSON.parse(event.data) as WSMessage)
        } catch (err) {
          console.error('WS parse error:', err)
        }
      }

      socket.onclose = () => {
        if (cancelled) return
        setWsConnected(false)
        reconnectTimer = window.setTimeout(connect, 3000)
      }

      socket.onerror = () => {
        if (cancelled) return
        socket?.close()
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [session, handleWSMessage])

  const visibleVehicles = useMemo(() => {
    if (regionLevel === 'indonesia') return []

    const base = city ? vehicles.filter((item) => item.operating_city === city) : vehicles

    if (regionLevel === 'province') {
      const allowed = operationCitiesForProvince(selectedProvince)
      if (allowed.length === 0) return []
      return base.filter(
        (item) => item.operating_city != null && allowed.includes(item.operating_city),
      )
    }

    if (!selectedCity) return []
    const operationCity = operationCityForAdm2(selectedCity)
    if (!operationCity) return []

    // Di level kota, unit disaring juga secara geometris supaya kota administrasi
    // DKI (mis. Jakarta Selatan) tidak menampilkan seluruh armada Jakarta.
    let list = base.filter(
      (item) =>
        item.operating_city === operationCity &&
        featureContains(selectedCity, item.lat, item.lng),
    )

    if (regionLevel === 'district' && selectedDistrict) {
      list = list.filter((item) =>
        featureContains(selectedDistrict, item.lat, item.lng),
      )
    }

    return list
  }, [regionLevel, selectedProvince, selectedCity, selectedDistrict, vehicles, city])

  const regionScope =
    regionLevel === 'district'
      ? selectedDistrict
      : regionLevel === 'city'
        ? selectedCity
        : selectedProvince
  const regionScopeLabel = regionLabel(regionScope)

  // Gambar ulang polygon setiap level/pilihan berubah. Jumlah polygon per level
  // kecil (provinsi 34, kota per provinsi < 40, kecamatan per kota < 50), jadi
  // layer SVG Leaflet masih sangat ringan.
  useEffect(() => {
    const layer = regionLayerRef.current
    if (!layer) return

    layer.clearLayers()

    let features: RegionFeature[] = []
    if (regionLevel === 'indonesia') {
      features = provinces
    } else if (regionLevel === 'province' && selectedProvince) {
      const provinceGid = selectedProvince.properties.GID_1
      features = cities.filter((item) => item.properties.GID_1 === provinceGid)
    } else if ((regionLevel === 'city' || regionLevel === 'district') && selectedCity) {
      features = districts
    }

    if (features.length === 0) return

    const selectedDistrictGid =
      regionLevel === 'district' ? selectedDistrict?.properties.GID_3 : undefined

    const isSelected = (feature: RegionFeature) =>
      selectedDistrictGid != null &&
      feature.properties.GID_3 === selectedDistrictGid

    const collection = { type: 'FeatureCollection' as const, features }
    const geoLayer = L.geoJSON(collection, {
      bubblingMouseEvents: false,
      style: (feature) =>
        regionStyle(
          regionLevel,
          isSelected(feature as RegionFeature),
          palette,
        ),
      onEachFeature: (feature, path) => {
        const item = feature as RegionFeature
        const shape = path as L.Path
        const selected = isSelected(item)

        shape.bindTooltip(regionLabel(item), {
          sticky: true,
          direction: 'top',
          className: 'region-tooltip',
          opacity: 1,
          offset: [0, -4],
        })

        shape.on('mouseover', () => {
          const base = regionStyle(regionLevel, selected, palette)
          shape.setStyle({
            color: palette.hoverStroke,
            weight: (base.weight ?? 1.4) + 0.9,
            fillColor: palette.hoverFill,
            fillOpacity: selected ? 0.24 : 0.13,
          })
          shape.bringToFront()
        })

        shape.on('mouseout', () => {
          shape.setStyle(regionStyle(regionLevel, selected, palette))
        })

        shape.on('click', (event: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(event.originalEvent)
          if (pickingLocation) {
            beginIncidentAt(event.latlng.lat, event.latlng.lng)
            return
          }
          if (regionLevel === 'indonesia') {
            openProvince(item)
          } else if (regionLevel === 'province') {
            void openCity(item)
          } else {
            openDistrict(item)
          }
        })
      },
    })

    geoLayer.addTo(layer)

    return () => {
      layer.clearLayers()
    }
  }, [
    provinces,
    cities,
    districts,
    regionLevel,
    selectedProvince,
    selectedCity,
    selectedDistrict,
    palette,
    pickingLocation,
    beginIncidentAt,
    openProvince,
    openCity,
    openDistrict,
  ])

  useEffect(() => {
    const layer = markerLayerRef.current
    if (!layer) return

    syncVehicleMarkers(layer, vehicleMarkersRef.current, visibleVehicles, buildVehiclePopup)
  }, [visibleVehicles])

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
        setPickingLocation(false)
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

  async function handleCityChange(nextValue: string) {
    if (nextValue === city) return
    setCity(nextValue)
    setError(null)
    setPickingLocation(false)

    if (!nextValue) {
      resetToIndonesia()
      return
    }

    const requestID = ++regionRequestIDRef.current
    setRegionLoading(true)
    setRegionError(null)

    try {
      // Muat data provinsi dan kota jika belum ada
      const [provinceData, cityData] = await Promise.all([
        provinces.length > 0 ? Promise.resolve({ features: provinces }) : loadProvinces(),
        cities.length > 0 ? Promise.resolve({ features: cities }) : loadCities(),
      ])
      if (requestID !== regionRequestIDRef.current) return

      const provFeatures = provinceData.features as RegionFeature[]
      const cityFeatures = cityData.features as RegionFeature[]

      // Cek apakah value adalah province key (NAME_1 seperti "JawaBarat")
      const provinceByKey = findProvinceByKey(provFeatures, nextValue)
      if (provinceByKey) {
        // User memilih provinsi
        regionRequestIDRef.current += 1
        setSelectedProvince(provinceByKey)
        setSelectedCity(null)
        setSelectedDistrict(null)
        setDistricts([])
        setRegionLevel('province')
        setCity('') // clear city filter karena level provinsi
        const bounds = featureBounds(provinceByKey)
        if (bounds) flyToRegion(bounds, 8)
        return
      }

      // Cek apakah value adalah nama provinsi tampilan (seperti "Jawa Barat")
      const provinceByName = findProvinceByName(provFeatures, nextValue)
      if (provinceByName) {
        regionRequestIDRef.current += 1
        setSelectedProvince(provinceByName)
        setSelectedCity(null)
        setSelectedDistrict(null)
        setDistricts([])
        setRegionLevel('province')
        setCity('')
        const bounds = featureBounds(provinceByName)
        if (bounds) flyToRegion(bounds, 8)
        return
      }

      // Cek apakah value adalah nama kota/kabupaten tampilan (seperti "Kota Bandung")
      const cityFeature = findCityByName(cityFeatures, nextValue)
      if (cityFeature) {
        // User memilih kota/kabupaten
        // Pertama tentukan provinsinya
        const provinceGid = cityFeature.properties.GID_1
        const provinceFeature = provinceByKey ? provinceByKey : provFeatures.find(f => f.properties.GID_1 === provinceGid)

        regionRequestIDRef.current += 1
        if (provinceFeature) {
          setSelectedProvince(provinceFeature)
        }
        setSelectedCity(cityFeature)
        setSelectedDistrict(null)
        setRegionLevel('city')
        setCity(operationCityForAdm2(cityFeature) ?? '')

        const bounds = featureBounds(cityFeature)
        if (bounds) flyToRegion(bounds, 11)

        // Load districts untuk kota ini
        if (provinceGid) {
          setRegionLoading(true)
          try {
            const districtData = await loadDistricts(provinceGid)
            if (requestID !== regionRequestIDRef.current) return
            setDistricts(
              districtData.features.filter(
                (item) => item.properties.GID_2 === cityFeature.properties.GID_2,
              ) as RegionFeature[],
            )
          } catch {
            setDistricts([])
          } finally {
            if (requestID === regionRequestIDRef.current) setRegionLoading(false)
          }
        }
        return
      }

      // Fallback: coba focusOperationCity untuk 6 kota operasi
      void focusOperationCity(nextValue)
    } catch (err) {
      if (requestID !== regionRequestIDRef.current) return
      setRegionError(
        err instanceof Error ? err.message : 'Gagal memuat wilayah. Coba lagi.',
      )
    } finally {
      if (requestID === regionRequestIDRef.current) setRegionLoading(false)
    }
  }

  function startPickingLocation() {
    setPickingLocation(true)
    setPanelMode('create')
    setDraft(null)
    setSelectedIncident(null)
    setForm(emptyIncidentForm())
    setFormError(null)
    setNearest(null)
    setNearestError(null)
    setCancelError(null)
  }

  function openIncidentDetail(incident: Incident) {
    setSelectedIncident(incident)
    setPanelMode('detail')
    setDraft(null)
    setFormError(null)
    setNearest(null)
    setNearestError(null)
    setCancelError(null)
    setPickingLocation(false)
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

  async function handleAssign(incidentId: number, vehicleId: number) {
    if (!session) return
    try {
      const assignment = await assignIncident(session.token, incidentId, vehicleId)
      // Draw route polyline
      const geojson = JSON.parse(assignment.route_geojson)
      if (geojson.type === 'LineString' && geojson.coordinates.length >= 2) {
        const latlngs = geojson.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number])
        if (routePolylineRef.current) {
          mapRef.current?.removeLayer(routePolylineRef.current)
        }
        const polyline = createRouteLine(latlngs).addTo(mapRef.current!)
        routePolylineRef.current = polyline
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
        <span className={`connection ${connectionError || !wsConnected ? 'connection--off' : ''}`}>
          <span className="connection-dot" aria-hidden="true" />
          {connectionError
            ? 'Koneksi bermasalah'
            : wsConnected
              ? 'Tersambung'
              : 'Menyambung ulang…'}
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

          <p className="fleet-scope">
            {regionLevel === 'indonesia'
              ? 'Pilih provinsi di peta untuk menampilkan unit.'
              : visibleVehicles.length === 0
                ? `Tidak ada unit di ${regionScopeLabel || 'wilayah ini'}.`
                : `${visibleVehicles.length} unit di ${regionScopeLabel}.`}
          </p>

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
            <div
              ref={mapContainerRef}
              className={`map-canvas ${pickingLocation ? 'map-canvas--picking' : ''}`}
              aria-label="Peta posisi unit dan laporan"
            />

            <div className="map-region-bar">
              <nav className="map-breadcrumbs" aria-label="Telusuri wilayah">
                <button
                  className="crumb"
                  type="button"
                  onClick={resetToIndonesia}
                  aria-current={regionLevel === 'indonesia' ? 'page' : undefined}
                >
                  Indonesia
                </button>
                {selectedProvince ? (
                  <>
                    <span className="crumb-sep" aria-hidden="true">/</span>
                    <button
                      className="crumb"
                      type="button"
                      onClick={backToProvince}
                      aria-current={regionLevel === 'province' ? 'page' : undefined}
                    >
                      {regionLabel(selectedProvince)}
                    </button>
                  </>
                ) : null}
                {selectedCity ? (
                  <>
                    <span className="crumb-sep" aria-hidden="true">/</span>
                    <button
                      className="crumb"
                      type="button"
                      onClick={backToCity}
                      aria-current={regionLevel === 'city' ? 'page' : undefined}
                    >
                      {regionLabel(selectedCity)}
                    </button>
                  </>
                ) : null}
                {selectedDistrict ? (
                  <>
                    <span className="crumb-sep" aria-hidden="true">/</span>
                    <button
                      className="crumb crumb--current"
                      type="button"
                      aria-current="page"
                      onClick={() => {
                        const bounds = featureBounds(selectedDistrict)
                        if (bounds) flyToRegion(bounds, 13)
                      }}
                    >
                      {regionLabel(selectedDistrict)}
                    </button>
                  </>
                ) : null}
              </nav>

              <button
                className={`button button-sm map-report-button ${
                  pickingLocation ? 'button-primary' : 'button-ghost'
                }`}
                type="button"
                onClick={startPickingLocation}
                aria-pressed={pickingLocation}
                title="Tandai lokasi laporan baru di peta"
              >
                <IconPlus size={16} />
                Laporan
              </button>
            </div>

            <p className="map-hint">
              {pickingLocation
                ? 'Klik peta untuk menandai lokasi laporan'
                : regionLevel === 'indonesia'
                  ? 'Klik provinsi untuk menelusuri wilayah'
                  : regionLevel === 'province'
                    ? 'Klik kota/kabupaten untuk melihat kecamatan'
                    : regionLevel === 'city'
                      ? 'Klik kecamatan untuk memfilter unit'
                      : regionLevel === 'district'
                        ? 'Klik kecamatan lain untuk berpindah'
                        : 'Klik area pada peta untuk melihat detail unit'}
            </p>

            {regionLoading ? (
              <div className="region-status" role="status">
                <span className="spinner" aria-hidden="true" />
                Memuat batas wilayah…
              </div>
            ) : null}

            {regionError ? (
              <div className="region-status region-status--error" role="alert">
                <span>{regionError}</span>
                <button
                  className="button button-ghost button-sm"
                  type="button"
                  onClick={() => void loadRegionData()}
                >
                  Coba lagi
                </button>
              </div>
            ) : null}

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
                    setPickingLocation(false)
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
                <div className="incident-detail-header">
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
                  {!CLOSED_INCIDENT_STATUS.includes(selectedIncident.status) ? (
                    <button
                      className="button button-ghost button-danger"
                      type="button"
                      onClick={handleCancel}
                      disabled={cancelling}
                    >
                      {cancelling ? 'Membatalkan…' : 'Batalkan laporan'}
                    </button>
                  ) : null}
                </div>

                <div className="incident-detail-content">
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
                  <div className="incident-meta-grid">
                    <p className="incident-coords">
                      <span>Lokasi</span>
                      {selectedIncident.lat.toFixed(5)}, {selectedIncident.lng.toFixed(5)}
                    </p>
                    <p className="incident-created">
                      <span>Dilaporkan</span>
                      {formatIncidentTime(selectedIncident.created_at)}
                    </p>
                  </div>
                </div>

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
                        {nearest.candidates.map((candidate) => {
                          const hasDriver = !!candidate.driver_name;
                          return (
                            <li className="nearest-candidate" key={candidate.vehicle_id}>
                              <div className="nearest-candidate-head">
                                <strong>{candidate.name}</strong>
                                <span className="vehicle-popup-plate">{candidate.plate}</span>
                              </div>
                              <p className="nearest-candidate-meta">
                                {TYPE_META[candidate.type]?.label ?? candidate.type}, driver{' '}
                                {candidate.driver_name ? (
                                  <>
                                    {candidate.driver_name}
                                    {candidate.type_match && (
                                      <span className="badge badge-match">Jenis sesuai</span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-warning">belum ditentukan</span>
                                )}
                              </p>
                              <p className="nearest-eta">
                                <strong>
                                  {candidate.eta_minutes}
                                  <small>menit</small>
                                </strong>
                                <span>{formatDistance(candidate.distance_m)} lewat jalan</span>
                              </p>
                              <button
                                className="button button-primary assign-btn"
                                type="button"
                                onClick={() => handleAssign(nearest.incident_id, candidate.vehicle_id)}
                                disabled={!hasDriver}
                              >
                                {hasDriver ? 'Tugaskan unit ini' : 'Butuh driver'}
                              </button>
                            </li>
                          );
                        })}
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
