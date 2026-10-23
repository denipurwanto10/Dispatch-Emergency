export interface CityOption {
  name: string
  center: [number, number]
  zoom: number
}

/** 6 kota operasi Fase 1.5 — urutan sama dengan seed backend. */
export const CITY_OPTIONS: CityOption[] = [
  { name: 'Medan', center: [3.5952, 98.6722], zoom: 12 },
  { name: 'Jakarta', center: [-6.2088, 106.8456], zoom: 12 },
  { name: 'Bandung', center: [-6.9175, 107.6191], zoom: 12 },
  { name: 'Semarang', center: [-6.9667, 110.4167], zoom: 12 },
  { name: 'Surabaya', center: [-7.2575, 112.7521], zoom: 12 },
  { name: 'Makassar', center: [-5.1477, 119.4327], zoom: 12 },
]

export const INDONESIA_CENTER: [number, number] = [-2.5, 118.0]
export const INDONESIA_ZOOM = 5
export const INDONESIA_BOUNDS: [[number, number], [number, number]] = [
  [-11.0, 94.5],
  [6.5, 141.5],
]

export function findCity(name: string): CityOption | undefined {
  return CITY_OPTIONS.find((city) => city.name === name)
}
