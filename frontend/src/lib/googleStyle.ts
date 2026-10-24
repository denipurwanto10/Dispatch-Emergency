import type { StyleSpecification, LayerSpecification } from 'maplibre-gl'

/**
 * Style bergaya Google Maps untuk tile vektor OpenFreeMap (data OpenStreetMap).
 * Gratis, tanpa API key. Skema layer: OpenMapTiles.
 */
export type MapMode = 'light' | 'dark'

interface Palette {
  land: string; water: string; park: string; wood: string; sand: string
  building: string; buildingLine: string
  hospital: string; school: string; industrial: string; commercial: string; cemetery: string
  roadMinor: string; roadMinorCase: string
  roadMain: string; roadMainCase: string
  roadPrimary: string; roadPrimaryCase: string
  roadTrunk: string; roadTrunkCase: string
  roadMotorway: string; roadMotorwayCase: string
  path: string; rail: string; boundary: string
  text: string; textMuted: string; halo: string
  place: string; waterText: string; parkText: string
}

const PALETTES: Record<MapMode, Palette> = {
  light: {
    land: '#f2efe9', water: '#aadaff', park: '#c8e6b8', wood: '#b7dfa6', sand: '#f1e6c8',
    building: '#e6e0d4', buildingLine: '#d9d1c1',
    hospital: '#f8dedb', school: '#f1e8d2', industrial: '#ebe7df', commercial: '#efe9dc', cemetery: '#cfe5c9',
    roadMinor: '#ffffff', roadMinorCase: '#dcd8d0',
    roadMain: '#ffffff', roadMainCase: '#d0cbc0',
    roadPrimary: '#fff1c2', roadPrimaryCase: '#e2c97e',
    roadTrunk: '#fcd988', roadTrunkCase: '#e0b25c',
    roadMotorway: '#fbc660', roadMotorwayCase: '#e5a23a',
    path: '#c9c3b6', rail: '#b9b4a8', boundary: '#b0a9c4',
    text: '#202124', textMuted: '#5f6368', halo: '#ffffff',
    place: '#202124', waterText: '#4a7ebb', parkText: '#2e7d32',
  },
  dark: {
    land: '#242f3e', water: '#17263c', park: '#263c3f', wood: '#223636', sand: '#2d3340',
    building: '#2c3a4d', buildingLine: '#34445a',
    hospital: '#3a2f3d', school: '#2b3646', industrial: '#27313f', commercial: '#29364a', cemetery: '#25383a',
    roadMinor: '#38414e', roadMinorCase: '#212a37',
    roadMain: '#46505e', roadMainCase: '#212a37',
    roadPrimary: '#5a5f66', roadPrimaryCase: '#1f2835',
    roadTrunk: '#6b6556', roadTrunkCase: '#1f2835',
    roadMotorway: '#746855', roadMotorwayCase: '#1f2835',
    path: '#4a5565', rail: '#4a5565', boundary: '#6b7a90',
    text: '#d5dae3', textMuted: '#9ca5b3', halo: '#242f3e',
    place: '#d59563', waterText: '#515c6d', parkText: '#6b9a76',
  },
}

const FONT_REGULAR = ['Noto Sans Regular']
const FONT_BOLD = ['Noto Sans Bold']
const FONT_ITALIC = ['Noto Sans Italic']

type Stops = Array<[number, number]>
const width = (stops: Stops, add = 0): any => [
  'interpolate', ['exponential', 1.5], ['zoom'],
  ...stops.flatMap(([z, w]) => [z, w === 0 ? 0 : w + add]),
]
const cls = (...c: string[]): any => ['match', ['get', 'class'], c, true, false]

const ROADS: Array<{ id: string; classes: string[]; minzoom: number; stops: Stops; fill: keyof Palette; casing: keyof Palette }> = [
  { id: 'minor', classes: ['minor', 'service', 'track'], minzoom: 13, stops: [[13, 0.5], [14, 1.5], [16, 5], [18, 13], [20, 30]], fill: 'roadMinor', casing: 'roadMinorCase' },
  { id: 'tertiary', classes: ['tertiary'], minzoom: 11, stops: [[11, 0.6], [14, 2.5], [16, 7], [18, 16], [20, 34]], fill: 'roadMain', casing: 'roadMainCase' },
  { id: 'secondary', classes: ['secondary'], minzoom: 9, stops: [[9, 0.6], [14, 3], [16, 8], [18, 18], [20, 36]], fill: 'roadMain', casing: 'roadMainCase' },
  { id: 'primary', classes: ['primary'], minzoom: 7, stops: [[7, 0.6], [14, 4], [16, 9], [18, 20], [20, 38]], fill: 'roadPrimary', casing: 'roadPrimaryCase' },
  { id: 'trunk', classes: ['trunk'], minzoom: 5, stops: [[5, 0.6], [14, 4.5], [16, 10], [18, 22], [20, 40]], fill: 'roadTrunk', casing: 'roadTrunkCase' },
  { id: 'motorway', classes: ['motorway'], minzoom: 4, stops: [[4, 0.6], [14, 5], [16, 11], [18, 24], [20, 42]], fill: 'roadMotorway', casing: 'roadMotorwayCase' },
]

export function buildGoogleStyle(mode: MapMode): StyleSpecification {
  const c = PALETTES[mode]
  const road = ['==', ['geometry-type'], 'LineString']
  const tunnelOpacity: any = ['case', ['==', ['get', 'brunnel'], 'tunnel'], 0.5, 1]

  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': c.land } },

    { id: 'landcover-grass', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: cls('grass', 'farmland'), paint: { 'fill-color': c.park, 'fill-opacity': 0.55 } },
    { id: 'landcover-wood', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: cls('wood'), paint: { 'fill-color': c.wood, 'fill-opacity': 0.7 } },
    { id: 'landcover-sand', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: cls('sand'), paint: { 'fill-color': c.sand } },

    { id: 'landuse-hospital', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('hospital'), paint: { 'fill-color': c.hospital } },
    { id: 'landuse-school', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('school', 'university', 'college', 'kindergarten'), paint: { 'fill-color': c.school } },
    { id: 'landuse-industrial', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('industrial', 'railway', 'military'), paint: { 'fill-color': c.industrial } },
    { id: 'landuse-commercial', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('commercial', 'retail'), paint: { 'fill-color': c.commercial } },
    { id: 'landuse-green', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('pitch', 'playground', 'garden', 'track'), paint: { 'fill-color': c.park } },
    { id: 'landuse-cemetery', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('cemetery'), paint: { 'fill-color': c.cemetery } },

    { id: 'park', type: 'fill', source: 'ofm', 'source-layer': 'park', paint: { 'fill-color': c.park } },

    { id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water', filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'fill-color': c.water } },
    { id: 'waterway', type: 'line', source: 'ofm', 'source-layer': 'waterway', minzoom: 8, paint: { 'line-color': c.water, 'line-width': width([[8, 0.5], [14, 2], [18, 6]]) } },

    { id: 'building', type: 'fill', source: 'ofm', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': c.building, 'fill-outline-color': c.buildingLine, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 1] } },

    { id: 'aeroway', type: 'line', source: 'ofm', 'source-layer': 'aeroway', minzoom: 10, paint: { 'line-color': c.roadMainCase, 'line-width': width([[10, 1], [16, 10]]) } },
    { id: 'rail', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 11, filter: ['all', road, cls('rail', 'transit')], paint: { 'line-color': c.rail, 'line-width': width([[11, 0.6], [16, 1.6]]), 'line-dasharray': [4, 3] } },
    { id: 'path', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 14, filter: ['all', road, cls('path', 'pedestrian')], paint: { 'line-color': c.path, 'line-width': width([[14, 0.6], [18, 2]]), 'line-dasharray': [2, 1.5] } },
  ]

  // Casing semua kelas dulu, baru isi — persimpangan menyatu seperti Google Maps.
  for (const r of ROADS) {
    layers.push({
      id: `road-${r.id}-casing`, type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: r.minzoom,
      filter: ['all', road, cls(...r.classes)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c[r.casing] as string, 'line-width': width(r.stops, 1.6), 'line-opacity': tunnelOpacity },
    })
  }
  for (const r of ROADS) {
    layers.push({
      id: `road-${r.id}`, type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: r.minzoom,
      filter: ['all', road, cls(...r.classes)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c[r.fill] as string, 'line-width': width(r.stops), 'line-opacity': tunnelOpacity },
    })
  }

  layers.push(
    { id: 'boundary-state', type: 'line', source: 'ofm', 'source-layer': 'boundary', maxzoom: 10, filter: ['==', ['get', 'admin_level'], 4], paint: { 'line-color': c.boundary, 'line-width': 1, 'line-dasharray': [3, 2] } },
    { id: 'boundary-country', type: 'line', source: 'ofm', 'source-layer': 'boundary', filter: ['==', ['get', 'admin_level'], 2], paint: { 'line-color': c.boundary, 'line-width': width([[2, 0.8], [10, 2]]) } },

    // Label
    { id: 'water-name', type: 'symbol', source: 'ofm', 'source-layer': 'water_name', layout: { 'text-field': ['get', 'name'], 'text-font': FONT_ITALIC, 'text-size': 12, 'text-letter-spacing': 0.1 }, paint: { 'text-color': c.waterText, 'text-halo-color': c.water, 'text-halo-width': 1 } },
    { id: 'road-name', type: 'symbol', source: 'ofm', 'source-layer': 'transportation_name', minzoom: 13,
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT_REGULAR, 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 14], 'symbol-placement': 'line', 'text-rotation-alignment': 'map', 'text-pitch-alignment': 'viewport' },
      paint: { 'text-color': c.textMuted, 'text-halo-color': c.halo, 'text-halo-width': 2 } },

    { id: 'poi-dot', type: 'circle', source: 'ofm', 'source-layer': 'poi', minzoom: 15, filter: ['<=', ['get', 'rank'], 20],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 3, 18, 6],
        'circle-stroke-width': 1.5, 'circle-stroke-color': c.halo,
        'circle-color': ['match', ['get', 'class'],
          ['hospital', 'fire_station', 'pharmacy'], '#d93025',
          ['police', 'school', 'college', 'shop', 'bank'], '#1a73e8',
          ['restaurant', 'cafe', 'bar', 'fast_food'], '#e8710a',
          ['park', 'garden'], '#188038',
          ['lodging'], '#a142f4',
          c.textMuted],
      } },
    { id: 'poi-name', type: 'symbol', source: 'ofm', 'source-layer': 'poi', minzoom: 16, filter: ['<=', ['get', 'rank'], 20],
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT_REGULAR, 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.8], 'text-max-width': 7 },
      paint: { 'text-color': c.textMuted, 'text-halo-color': c.halo, 'text-halo-width': 1.5 } },

    { id: 'place-suburb', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 12, maxzoom: 17, filter: cls('suburb', 'neighbourhood', 'quarter'),
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT_REGULAR, 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 14], 'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 8 },
      paint: { 'text-color': c.textMuted, 'text-halo-color': c.halo, 'text-halo-width': 1.5 } },
    { id: 'place-village', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 10, filter: cls('village', 'hamlet', 'island'),
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT_REGULAR, 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 16, 15], 'text-max-width': 8 },
      paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.5 } },
    { id: 'place-town', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 7, filter: cls('town'),
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 7, 11, 14, 17], 'text-max-width': 8 },
      paint: { 'text-color': c.place, 'text-halo-color': c.halo, 'text-halo-width': 1.8 } },
    { id: 'place-city', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 3, filter: cls('city'),
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 10, 18, 14, 22], 'text-max-width': 8 },
      paint: { 'text-color': c.place, 'text-halo-color': c.halo, 'text-halo-width': 2 } },
    { id: 'place-state', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 4, maxzoom: 8, filter: cls('state'),
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT_REGULAR, 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': 0.12, 'text-max-width': 8 },
      paint: { 'text-color': c.textMuted, 'text-halo-color': c.halo, 'text-halo-width': 1.5 } },
    { id: 'place-country', type: 'symbol', source: 'ofm', 'source-layer': 'place', maxzoom: 7, filter: cls('country'),
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT_BOLD, 'text-size': ['interpolate', ['linear'], ['zoom'], 1, 11, 6, 18], 'text-transform': 'uppercase', 'text-letter-spacing': 0.1, 'text-max-width': 6 },
      paint: { 'text-color': c.textMuted, 'text-halo-color': c.halo, 'text-halo-width': 2 } },
  )

  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      ofm: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    },
    layers,
  }
}
