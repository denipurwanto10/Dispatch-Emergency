import L from 'leaflet'

/**
 * Garis rute modern yang ringan (tanpa animasi, tanpa filter):
 *  1. casing - garis tepi putih tipis agar kontras dengan jalan
 *  2. main   - garis utama biru, ujung membulat
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

export function createRouteLine(
  latlngs: L.LatLngExpression[],
  options: RouteLineOptions = {},
): L.FeatureGroup {
  const weight = options.weight ?? 5

  const base: L.PolylineOptions = {
    lineCap: 'round',
    lineJoin: 'round',
    smoothFactor: 2, // sederhanakan titik saat render agar ringan
    interactive: false,
  }

  return L.featureGroup([
    L.polyline(latlngs, { ...base, className: 'route-casing', weight: weight + 3 }),
    L.polyline(latlngs, { ...base, className: 'route-main', weight }),
  ])
}
