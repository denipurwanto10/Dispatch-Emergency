import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'

/**
 * Data batas wilayah untuk drill-down peta.
 *
 * File statis ada di public/geo dan dibuat oleh scripts/build-regions.mjs dari
 * GADM 4.1. Semua file dimuat malas (lazy) dan disimpan di cache modul, jadi
 * berpindah level berulang kali tidak mengunduh ulang.
 */

export type RegionLevel = 'indonesia' | 'province' | 'city' | 'district'

export interface RegionProperties {
  GID_1?: string
  NAME_1?: string
  GID_2?: string
  NAME_2?: string
  TYPE_2?: string
  GID_3?: string
  NAME_3?: string
}

export type RegionFeature = Feature<Geometry, RegionProperties>
export type RegionCollection = FeatureCollection<Geometry, RegionProperties>

/** [[south, west], [north, east]] — format yang diterima Leaflet. */
export type RegionBounds = [[number, number], [number, number]]

const BASE = `${import.meta.env.BASE_URL}geo/`
const cache = new Map<string, Promise<RegionCollection>>()

function load(url: string): Promise<RegionCollection> {
  const pending = cache.get(url)
  if (pending) return pending

  const request = fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Batas wilayah tidak bisa dimuat (HTTP ${response.status}).`)
      }
      return response.json() as Promise<RegionCollection>
    })
    .catch((error: unknown) => {
      // Jangan simpan kegagalan agar tombol "Coba lagi" bisa mengulang.
      cache.delete(url)
      throw error
    })

  cache.set(url, request)
  return request
}

export function loadProvinces(): Promise<RegionCollection> {
  return load(`${BASE}adm1.geojson`)
}

export function loadCities(): Promise<RegionCollection> {
  return load(`${BASE}adm2.geojson`)
}

/** Harus sama dengan fileKey() di scripts/build-regions.mjs. */
export function provinceFileKey(gid: string): string {
  return gid
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function loadDistricts(provinceGid: string): Promise<RegionCollection> {
  return load(`${BASE}adm3-${provinceFileKey(provinceGid)}.geojson`)
}

// ---------- Nama tampilan ----------

/** GADM menulis nama tanpa spasi ("KotaMedan"); beberapa perlu nama resmi. */
const PROVINCE_LABELS: Record<string, string> = {
  JakartaRaya: 'DKI Jakarta',
  Yogyakarta: 'DI Yogyakarta',
  BangkaBelitung: 'Kepulauan Bangka Belitung',
}

function readable(raw: string): string {
  return raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
}

export function regionLabel(feature: RegionFeature | null | undefined): string {
  if (!feature) return ''
  const { NAME_1, NAME_2, NAME_3, TYPE_2 } = feature.properties

  if (NAME_3) return readable(NAME_3)

  if (NAME_2) {
    const pretty = readable(NAME_2)
    if (TYPE_2 === 'Kota') return /^kota\b/i.test(pretty) ? pretty : `Kota ${pretty}`
    if (TYPE_2 === 'Kabupaten') {
      return /^kabupaten\b/i.test(pretty) ? pretty : `Kabupaten ${pretty}`
    }
    return pretty
  }

  if (NAME_1) return PROVINCE_LABELS[NAME_1] ?? readable(NAME_1)
  return 'Wilayah'
}

// ---------- Hubungan wilayah dengan 6 kota operasi ----------

interface OperationTarget {
  /** NAME_1 pada GADM. */
  provinceName: string
  /** NAME_2 pada GADM; kosong berarti seluruh provinsi (DKI Jakarta). */
  cityName?: string
}

const OPERATION_TARGETS: Record<string, OperationTarget> = {
  Medan: { provinceName: 'SumateraUtara', cityName: 'KotaMedan' },
  Jakarta: { provinceName: 'JakartaRaya' },
  Bandung: { provinceName: 'JawaBarat', cityName: 'KotaBandung' },
  Semarang: { provinceName: 'JawaTengah', cityName: 'KotaSemarang' },
  Surabaya: { provinceName: 'JawaTimur', cityName: 'Surabaya' },
  Makassar: { provinceName: 'SulawesiSelatan', cityName: 'Makassar' },
}

export function operationCityTarget(city: string): OperationTarget | undefined {
  return OPERATION_TARGETS[city]
}

export function operationCitiesForProvince(feature: RegionFeature | null): string[] {
  const provinceName = feature?.properties.NAME_1
  if (!provinceName) return []
  return Object.entries(OPERATION_TARGETS)
    .filter(([, target]) => target.provinceName === provinceName)
    .map(([city]) => city)
}

export function operationCityForAdm2(feature: RegionFeature | null): string | null {
  if (!feature) return null
  const provinceName = feature.properties.NAME_1
  const cityName = feature.properties.NAME_2
  // Kendaraan memakai "Jakarta" untuk seluruh DKI, bukan per kota administrasi.
  if (provinceName === 'JakartaRaya') return 'Jakarta'

  for (const [city, target] of Object.entries(OPERATION_TARGETS)) {
    if (target.provinceName === provinceName && target.cityName === cityName) return city
  }
  return null
}

// ---------- Geometri ----------

export function featureBounds(feature: RegionFeature): RegionBounds | null {
  let minLat = Number.POSITIVE_INFINITY
  let minLng = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY

  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      const [lng, lat] = value as [number, number]
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      return
    }
    for (const child of value) visit(child)
  }

  const visitGeometry = (geometry: Geometry) => {
    if (geometry.type === 'GeometryCollection') {
      for (const child of geometry.geometries) visitGeometry(child)
      return
    }
    visit(geometry.coordinates)
  }

  visitGeometry(feature.geometry)
  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) return null
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ]
}

/** Ray casting sederhana untuk Polygon/MultiPolygon. */
function ringContains(ring: Position[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number]
    const [xj, yj] = ring[j] as [number, number]
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function polygonContains(rings: Position[][], x: number, y: number): boolean {
  if (rings.length === 0 || !ringContains(rings[0], x, y)) return false
  for (let i = 1; i < rings.length; i += 1) {
    if (ringContains(rings[i], x, y)) return false
  }
  return true
}

export function featureContains(feature: RegionFeature, lat: number, lng: number): boolean {
  const geometry = feature.geometry
  if (geometry.type === 'Polygon') return polygonContains(geometry.coordinates, lng, lat)
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => polygonContains(polygon, lng, lat))
  }
  return false
}

// ---------- Pencarian fitur berdasarkan nama ----------

/** Cari provinsi berdasarkan NAME_1 (kunci GADM seperti "JawaBarat") */
export function findProvinceByKey(
  provinces: RegionFeature[],
  provinceKey: string
): RegionFeature | undefined {
  return provinces.find((f) => f.properties.NAME_1 === provinceKey)
}

/** Cari kota/kabupaten berdasarkan nama tampilan (seperti "Kota Bandung") */
export function findCityByName(
  cities: RegionFeature[],
  cityDisplayName: string
): RegionFeature | undefined {
  return cities.find((f) => {
    const label = regionLabel(f)
    return label === cityDisplayName
  })
}

/** Cari provinsi berdasarkan nama tampilan (seperti "Jawa Barat") */
export function findProvinceByName(
  provinces: RegionFeature[],
  provinceDisplayName: string
): RegionFeature | undefined {
  return provinces.find((f) => regionLabel(f) === provinceDisplayName)
}
