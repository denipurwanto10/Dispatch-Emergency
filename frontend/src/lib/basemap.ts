import L from 'leaflet'

/**
 * Basemap OpenStreetMap — tanpa API key, tanpa billing.
 * Hanya layer standar OSM (roadmap), tanpa satelit/hybrid.
 * Pakai tile OSM publik dengan User-Agent yang jelas.
 */
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

function osmLayer(className: string): L.TileLayer {
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    subdomains: 'abc',
    maxZoom: 19,
    attribution: ATTRIBUTION,
    className,
  })
}

export interface BasemapOptions {
  /** Jika true, tidak ada layer switcher (default: false) */
  simple?: boolean
}

export function addBasemap(map: L.Map, options: BasemapOptions = {}): void {
  const { simple = false } = options

  const roadmap = osmLayer('tiles-roadmap')
  roadmap.addTo(map)

  if (!simple) {
    // No layer switcher - only single OSM layer
  }

  map.attributionControl.setPrefix(false)
}
