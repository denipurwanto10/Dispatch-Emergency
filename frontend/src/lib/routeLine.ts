import L from 'leaflet'

/**
 * Garis rute modern yang ringan (tanpa animasi, tanpa filter):
 *  1. casing - garis tepi putih tipis agar kontras dengan jalan
 *  2. main   - garis utama biru, ujung membulat
 *
 * Bagian rute yang sudah dilalui kendaraan dipudarkan (class `route-done`)
 * supaya sisa perjalanan tetap menonjol dan peta terlihat rapi.
 *
 * Sengaja statis: animasi SVG (stroke-dashoffset) memaksa repaint tiap frame
 * dan membuat peta lag. Mengembalikan FeatureGroup, jadi tetap bisa
 * getBounds() dan removeLayer() seperti polyline biasa.
 * Warna diatur di styles.css (.route-*).
 */
export interface RouteLineOptions {
  /** Ketebalan garis utama dalam px (default 5) */
  weight?: number
}

export interface LatLngLike {
  lat: number
  lng: number
}

export interface RouteLine extends L.FeatureGroup {
  /**
   * Perbarui posisi kendaraan. Bagian rute sebelum posisi ini dipudarkan.
   * Panggil dengan `null` untuk menampilkan rute utuh.
   */
  setVehicle(position: LatLngLike | null): void
}

const EARTH_RADIUS_M = 6371008.8
const RAD = Math.PI / 180
/** Abaikan pembaruan kecil agar polyline tidak digambar ulang tiap tick. */
const MIN_MOVE_M = 4

interface Projection {
  /** Indeks segmen tempat proyeksi jatuh. */
  index: number
  /** Posisi 0..1 di dalam segmen. */
  t: number
  /** Jarak tegak lurus kendaraan ke rute (meter). */
  offset: number
  /** Jarak tempuh dari awal rute sampai titik proyeksi (meter). */
  along: number
}

/**
 * Proyeksikan posisi kendaraan ke polyline rute dan hitung jarak tempuhnya.
 * Memakai proyeksi planar lokal (meter) - akurat untuk skala kota.
 */
function projectOnRoute(route: LatLngLike[], position: LatLngLike): Projection {
  const cosLat = Math.cos(position.lat * RAD)
  const toXY = (point: LatLngLike) => ({
    x: (point.lng - position.lng) * RAD * cosLat * EARTH_RADIUS_M,
    y: (point.lat - position.lat) * RAD * EARTH_RADIUS_M,
  })

  let best: Projection = { index: 0, t: 0, offset: Infinity, along: 0 }
  let along = 0

  for (let i = 0; i < route.length - 1; i += 1) {
    const a = toXY(route[i])
    const b = toXY(route[i + 1])
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSq = dx * dx + dy * dy
    const segmentLength = Math.sqrt(lengthSq)
    const rawT = lengthSq === 0 ? 0 : -(a.x * dx + a.y * dy) / lengthSq
    const t = Math.min(1, Math.max(0, rawT))
    const px = a.x + dx * t
    const py = a.y + dy * t
    const offset = Math.hypot(px, py)

    if (offset < best.offset) {
      best = { index: i, t, offset, along: along + segmentLength * t }
    }
    along += segmentLength
  }

  return best
}

/** Potong rute pada titik proyeksi menjadi bagian dilalui dan sisa perjalanan. */
function splitRoute(route: LatLngLike[], projection: Projection) {
  const start = route[projection.index]
  const end = route[projection.index + 1] ?? route[projection.index]
  const split: LatLngLike = {
    lat: start.lat + (end.lat - start.lat) * projection.t,
    lng: start.lng + (end.lng - start.lng) * projection.t,
  }

  return {
    traveled: [...route.slice(0, projection.index + 1), split],
    remaining: [split, ...route.slice(projection.index + 1)],
  }
}

export function createRouteLine(
  latlngs: L.LatLngExpression[],
  options: RouteLineOptions = {},
): RouteLine {
  const weight = options.weight ?? 5
  const route = latlngs.map((point) => {
    const { lat, lng } = L.latLng(point)
    return { lat, lng }
  })

  const base: L.PolylineOptions = {
    lineCap: 'round',
    lineJoin: 'round',
    smoothFactor: 2, // sederhanakan titik saat render agar ringan
    interactive: false,
  }

  // Bagian yang sudah dilalui: tipis dan pudar, digambar paling bawah.
  const traveled = L.polyline([], {
    ...base,
    className: 'route-done',
    weight: Math.max(2, weight - 2),
  })
  const casing = L.polyline(latlngs, { ...base, className: 'route-casing', weight: weight + 3 })
  const main = L.polyline(latlngs, { ...base, className: 'route-main', weight })

  const group = L.featureGroup([traveled, casing, main]) as RouteLine

  let lastAlong = Number.NEGATIVE_INFINITY
  let lastIndex = -1

  group.setVehicle = (position: LatLngLike | null) => {
    if (!position || route.length < 2) {
      traveled.setLatLngs([])
      return
    }

    const projection = projectOnRoute(route, position)
    // Hindari redraw tiap tick bila kendaraan hanya bergeser beberapa meter.
    if (
      projection.index === lastIndex &&
      Math.abs(projection.along - lastAlong) < MIN_MOVE_M
    ) {
      return
    }
    lastIndex = projection.index
    lastAlong = projection.along

    const { traveled: done } = splitRoute(route, projection)
    traveled.setLatLngs(done.length >= 2 ? done : [])
  }

  return group
}
