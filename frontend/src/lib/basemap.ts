import L from 'leaflet'

/**
 * Basemap tampilan Google Maps, tanpa API key (tile publik, tidak resmi).
 * Ganti USE_GOOGLE_TILES ke false untuk kembali ke OpenStreetMap.
 * Bila tile Google gagal dimuat berulang kali, otomatis pindah ke OSM.
 */
const USE_GOOGLE_TILES = true

const GOOGLE_URL = 'https://mt{s}.google.com/vt/lyrs=m&hl=id&gl=ID&x={x}&y={y}&z={z}'
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

export interface BasemapOptions {
  simple?: boolean
}

function osmLayer(): L.TileLayer {
  return L.tileLayer(OSM_URL, {
    subdomains: 'abc',
    maxZoom: 19,
    className: 'tiles-osm',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  })
}

export function addBasemap(map: L.Map, _options: BasemapOptions = {}): void {
  map.attributionControl.setPrefix(false)

  if (!USE_GOOGLE_TILES) {
    osmLayer().addTo(map)
    return
  }

  const google = L.tileLayer(GOOGLE_URL, {
    subdomains: '0123',
    maxZoom: 20,
    className: 'tiles-google',
    keepBuffer: 4,
    attribution: 'Map data &copy; Google',
  }).addTo(map)

  let errors = 0
  google.on('tileerror', () => {
    errors += 1
    if (errors === 6) {
      map.removeLayer(google)
      osmLayer().addTo(map)
    }
  })
}
