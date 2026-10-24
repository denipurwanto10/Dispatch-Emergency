import L from 'leaflet'

import type { Vehicle, VehicleType } from '../types'

/**
 * Marker kendaraan gaya "puck armada" (seperti Groundwork): ikon tampak atas yang
 * berputar mengikuti arah gerak, dengan cincin status dan lampu sirene yang berkedip.
 * Arah (heading) dihitung dari dua posisi berurutan, karena API belum mengirim heading.
 */

// ---------- Ikon SVG tampak atas (menghadap ke atas / utara) ----------
// Setiap ikon punya <defs> dengan id unik per tipe (isinya identik di semua instance,
// jadi aman dipakai berulang di satu halaman).

/** Roda: balok gelap yang menyembul di sisi bodi. */
const WHEELS = (ys: number[], fill = '#0b1220') =>
  ys
    .map(
      y => `
  <rect x="1.6" y="${y}" width="5" height="11" rx="2.4" fill="${fill}"/>
  <rect x="33.4" y="${y}" width="5" height="11" rx="2.4" fill="${fill}"/>`,
    )
    .join('')

/** Spion samping. */
const MIRRORS = (y: number, fill: string) => `
  <rect x="1" y="${y}" width="4" height="3.4" rx="1.4" fill="${fill}"/>
  <rect x="35" y="${y}" width="4" height="3.4" rx="1.4" fill="${fill}"/>`

/** Lightbar atap: dasar gelap, dua LED merah/biru yang berkedip, plus halo cahaya. */
const LIGHTBAR = (x: number, y: number, w: number) => `
  <rect x="${x - 1}" y="${y - 1}" width="${w + 2}" height="8" rx="4" fill="#0b1220" opacity=".35"/>
  <rect x="${x}" y="${y}" width="${w}" height="6" rx="3" fill="#0b1220"/>
  <rect class="vm-halo vm-halo-a" x="${x - 3}" y="${y - 3}" width="${w / 2 + 3}" height="12" rx="6" fill="#ef4444"/>
  <rect class="vm-halo vm-halo-b" x="${x + w / 2}" y="${y - 3}" width="${w / 2 + 3}" height="12" rx="6" fill="#3b82f6"/>
  <rect class="vm-led vm-led-a" x="${x + 1.2}" y="${y + 1.2}" width="${w / 2 - 1.8}" height="3.6" rx="1.8" fill="#ef4444"/>
  <rect class="vm-led vm-led-b" x="${x + w / 2 + 0.6}" y="${y + 1.2}" width="${w / 2 - 1.8}" height="3.6" rx="1.8" fill="#3b82f6"/>
  <rect x="${x + 2}" y="${y + 1.4}" width="${w - 4}" height="1" rx=".5" fill="#fff" opacity=".28"/>`

/** Lampu depan (dengan sorot tipis) dan lampu belakang. */
const HEAD_TAIL = (h: number) => `
  <path d="M7 3.2 Q10 1.4 13.2 3.2 L12.6 5.4 H7.6 Z" fill="#fef3c7"/>
  <path d="M26.8 3.2 Q30 1.4 33 3.2 L32.4 5.4 H27.4 Z" fill="#fef3c7"/>
  <rect x="7" y="${h - 5.2}" width="6.4" height="2.6" rx="1.3" fill="#dc2626"/>
  <rect x="26.6" y="${h - 5.2}" width="6.4" height="2.6" rx="1.3" fill="#dc2626"/>`

const SVG: Record<VehicleType, { w: number; h: number; markup: string }> = {
  // ----- Mobil patroli (sedan) -----
  police: {
    w: 40,
    h: 76,
    markup: `
      <defs>
        <linearGradient id="vmp-body" x1="0" x2="1">
          <stop offset="0" stop-color="#3563d6"/><stop offset=".5" stop-color="#3563d6"/><stop offset="1" stop-color="#3563d6"/>
        </linearGradient>
        <linearGradient id="vmp-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#26334d"/><stop offset="1" stop-color="#26334d"/>
        </linearGradient>
        <linearGradient id="vmp-roof" x1="0" x2="1">
          <stop offset="0" stop-color="#e2e8f0"/><stop offset=".5" stop-color="#e2e8f0"/><stop offset="1" stop-color="#e2e8f0"/>
        </linearGradient>
      </defs>
      ${WHEELS([13, 55])}
      ${MIRRORS(22, '#16286b')}
      <rect x="4" y="2" width="32" height="72" rx="13" fill="url(#vmp-body)" stroke="#ffffff" stroke-width="1.5"/>
      <path d="M9 7 Q20 3 31 7 L30 15 Q20 12 10 15 Z" fill="#fff" opacity=".16"/>
      <path d="M9 19 Q20 13.5 31 19 L29.5 29 H10.5 Z" fill="url(#vmp-glass)"/>
      <path d="M12 20.6 Q20 17.4 25 19" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".35"/>
      <rect x="8" y="29" width="24" height="23" rx="5" fill="url(#vmp-roof)"/>
      <rect x="12" y="45" width="16" height="2.2" rx="1.1" fill="#1e3a8a" opacity=".55"/>
      <path d="M10.5 53 H29.5 L31 61 Q20 65 9 61 Z" fill="url(#vmp-glass)"/>
      <rect x="10" y="66" width="20" height="5" rx="2.5" fill="#fff" opacity=".13"/>
      <path d="M20 4 V70" stroke="#fff" stroke-width=".8" opacity=".12"/>
      ${LIGHTBAR(10, 34, 20)}
      ${HEAD_TAIL(76)}`,
  },

  // ----- Ambulans (van) -----
  ambulance: {
    w: 40,
    h: 82,
    markup: `
      <defs>
        <linearGradient id="vma-body" x1="0" x2="1">
          <stop offset="0" stop-color="#eef2f6"/><stop offset=".5" stop-color="#eef2f6"/><stop offset="1" stop-color="#eef2f6"/>
        </linearGradient>
        <linearGradient id="vma-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#26334d"/><stop offset="1" stop-color="#26334d"/>
        </linearGradient>
      </defs>
      ${WHEELS([13, 58], '#1e293b')}
      ${MIRRORS(19, '#94a3b8')}
      <rect x="4" y="2" width="32" height="78" rx="11" fill="url(#vma-body)" stroke="#94a3b8" stroke-width="1.5"/>
      <path d="M9 14 Q20 8.5 31 14 L29.5 25 H10.5 Z" fill="url(#vma-glass)"/>
      <path d="M12 15.6 Q20 12.4 25 14" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".35"/>
      <rect x="4.8" y="27" width="30.4" height="3" fill="#d92d3f"/>
      <rect x="4.8" y="72" width="30.4" height="3" fill="#d92d3f"/>
      <rect x="9" y="40" width="22" height="30" rx="4" fill="#f1f5f9" stroke="#cbd5e1" stroke-width=".8"/>
      <circle cx="20" cy="55" r="11" fill="none" stroke="#d92d3f" stroke-width="1.5"/>
      <rect x="17.2" y="46.5" width="5.6" height="17" rx="1.4" fill="#d92d3f"/>
      <rect x="11.5" y="52.2" width="17" height="5.6" rx="1.4" fill="#d92d3f"/>
      <path d="M20 31 V39" stroke="#94a3b8" stroke-width=".8"/>
      <rect x="9" y="76.4" width="22" height=".9" fill="#94a3b8" opacity=".7"/>
      ${LIGHTBAR(10, 31, 20)}
      ${HEAD_TAIL(82)}`,
  },

  // ----- Mobil pemadam (truk tangga) -----
  fire: {
    w: 40,
    h: 104,
    markup: `
      <defs>
        <linearGradient id="vmf-body" x1="0" x2="1">
          <stop offset="0" stop-color="#e03428"/><stop offset=".5" stop-color="#e03428"/><stop offset="1" stop-color="#e03428"/>
        </linearGradient>
        <linearGradient id="vmf-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#26334d"/><stop offset="1" stop-color="#26334d"/>
        </linearGradient>
        <linearGradient id="vmf-steel" x1="0" x2="1">
          <stop offset="0" stop-color="#b6c2d2"/><stop offset=".5" stop-color="#b6c2d2"/><stop offset="1" stop-color="#b6c2d2"/>
        </linearGradient>
      </defs>
      ${WHEELS([12, 60, 79])}
      ${MIRRORS(19, '#0b1220')}
      <rect x="4" y="2" width="32" height="100" rx="10" fill="url(#vmf-body)" stroke="#ffffff" stroke-width="1.5"/>
      <rect x="6" y="2.6" width="28" height="4" rx="2" fill="url(#vmf-steel)"/>
      <path d="M9 11 Q20 6.5 31 11 L30 21 H10 Z" fill="url(#vmf-glass)"/>
      <path d="M12 12.4 Q20 9.6 25 11" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".35"/>
      <rect x="7" y="23" width="26" height="9" rx="3" fill="#b91c1c"/>
      <rect x="4.8" y="34" width="30.4" height="2.2" fill="#fbbf24"/>
      <rect x="7" y="39" width="26" height="58" rx="3" fill="#7f1d1d" opacity=".85"/>
      <g stroke="#450a0a" stroke-width=".8" opacity=".55">
        <path d="M7 55H12M28 55H33M7 71H12M28 71H33M7 87H12M28 87H33"/>
      </g>
      <rect x="12" y="38" width="2.6" height="60" rx="1.3" fill="url(#vmf-steel)"/>
      <rect x="25.4" y="38" width="2.6" height="60" rx="1.3" fill="url(#vmf-steel)"/>
      <g stroke="#e2e8f0" stroke-width="1.5" stroke-linecap="round">
        <path d="M14.6 43H25.4M14.6 49.5H25.4M14.6 56H25.4M14.6 62.5H25.4M14.6 69H25.4M14.6 75.5H25.4M14.6 82H25.4M14.6 88.5H25.4M14.6 95H25.4"/>
      </g>
      <path d="M7 98.4 L12 96 M12 98.4 L17 96 M17 98.4 L22 96 M22 98.4 L27 96 M27 98.4 L32 96" stroke="#fde68a" stroke-width="1.6" stroke-linecap="round" opacity=".9"/>
      ${LIGHTBAR(10, 25, 20)}
      ${HEAD_TAIL(104)}`,
  },
}

/** Lebar ikon (px) per tipe; tinggi mengikuti rasio SVG. */
const ICON_WIDTH = 28

export function svgFor(type: VehicleType): string {
  const spec = SVG[type] ?? SVG.police
  const height = Math.round((ICON_WIDTH * spec.h) / spec.w)
  return `<svg class="vm-svg" viewBox="0 0 ${spec.w} ${spec.h}" width="${ICON_WIDTH}" height="${height}" aria-hidden="true" focusable="false">${spec.markup}</svg>`
}

// ---------- Arah gerak ----------

interface HeadingState {
  lat: number
  lng: number
  /** sudut kompas yang "dibuka" (boleh > 360) supaya transisi CSS tidak berputar balik */
  angle: number
}

const headings = new Map<number, HeadingState>()
const MIN_MOVE_M = 4

function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLng = (bLng - aLng) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180
  const dLng = (bLng - aLng) * rad
  const y = Math.sin(dLng) * Math.cos(bLat * rad)
  const x =
    Math.cos(aLat * rad) * Math.sin(bLat * rad) -
    Math.sin(aLat * rad) * Math.cos(bLat * rad) * Math.cos(dLng)
  return (Math.atan2(y, x) / rad + 360) % 360
}

/** Sudut putar ikon untuk unit ini; arah lama dipertahankan saat unit diam. */
export function resolveHeading(vehicle: Pick<Vehicle, 'id' | 'lat' | 'lng'>): number {
  const prev = headings.get(vehicle.id)
  if (!prev) {
    headings.set(vehicle.id, { lat: vehicle.lat, lng: vehicle.lng, angle: 0 })
    return 0
  }
  if (distanceM(prev.lat, prev.lng, vehicle.lat, vehicle.lng) < MIN_MOVE_M) return prev.angle

  const target = bearingDeg(prev.lat, prev.lng, vehicle.lat, vehicle.lng)
  const delta = ((target - (prev.angle % 360) + 540) % 360) - 180
  const next = { lat: vehicle.lat, lng: vehicle.lng, angle: prev.angle + delta }
  headings.set(vehicle.id, next)
  return next.angle
}

// ---------- Marker ----------

const TYPE_LABEL: Record<VehicleType, string> = {
  ambulance: 'Ambulans',
  fire: 'Damkar',
  police: 'Patroli',
}

const ACTIVE_STATUS = new Set<Vehicle['status']>(['assigned', 'en_route', 'on_scene'])

function rootClass(vehicle: Vehicle): string {
  return `vm vm--${vehicle.type} vm--${vehicle.status}`
}

function buildElement(vehicle: Vehicle, angle: number): HTMLElement {
  const root = document.createElement('div')
  root.className = rootClass(vehicle)
  root.style.setProperty('--vm-heading', `${angle}deg`)
  root.title = `${vehicle.name} · ${TYPE_LABEL[vehicle.type] ?? 'Kendaraan'}`

  const body = document.createElement('span')
  body.className = 'vm-body'
  body.innerHTML = svgFor(vehicle.type)

  const tag = document.createElement('span')
  tag.className = 'vm-tag'
  tag.textContent = vehicle.plate

  root.append(body, tag)
  return root
}

export function vehicleMarkerIcon(vehicle: Vehicle, angle = resolveHeading(vehicle)): L.DivIcon {
  return L.divIcon({
    className: 'vm-wrap',
    html: buildElement(vehicle, angle),
    iconSize: [72, 72],
    iconAnchor: [36, 36],
    popupAnchor: [0, -30],
  })
}

function zOffset(vehicle: Vehicle): number {
  if (vehicle.status === 'offline') return -500
  return ACTIVE_STATUS.has(vehicle.status) ? 500 : 0
}

/** Perbarui posisi, arah, dan status marker tanpa membuat ulang elemennya. */
export function patchVehicleMarker(marker: L.Marker, vehicle: Vehicle): void {
  const angle = resolveHeading(vehicle)
  marker.setLatLng([vehicle.lat, vehicle.lng])
  marker.setZIndexOffset(zOffset(vehicle))

  const root = marker.getElement()?.querySelector<HTMLElement>('.vm')
  if (!root) return

  if (root.classList.contains(`vm--${vehicle.type}`)) {
    root.className = rootClass(vehicle)
    root.style.setProperty('--vm-heading', `${angle}deg`)
    const tag = root.querySelector('.vm-tag')
    if (tag && tag.textContent !== vehicle.plate) tag.textContent = vehicle.plate
  } else {
    // Tipe berubah (jarang): ganti seluruh ikon.
    marker.setIcon(vehicleMarkerIcon(vehicle, angle))
  }
}

export type PopupContent = string | HTMLElement

/**
 * Sinkronkan satu set marker dengan daftar unit: tambah yang baru, geser yang ada
 * (popup yang sedang terbuka tidak tertutup), dan buang yang sudah hilang.
 */
export function syncVehicleMarkers(
  target: L.LayerGroup | L.Map,
  store: Map<number, L.Marker>,
  vehicles: Vehicle[],
  buildPopup?: (vehicle: Vehicle) => PopupContent,
): void {
  const seen = new Set<number>()

  for (const vehicle of vehicles) {
    seen.add(vehicle.id)
    let marker = store.get(vehicle.id)

    if (!marker) {
      marker = L.marker([vehicle.lat, vehicle.lng], {
        icon: vehicleMarkerIcon(vehicle),
        title: '',
        keyboard: true,
        zIndexOffset: zOffset(vehicle),
      }).addTo(target)
      if (buildPopup) marker.bindPopup(buildPopup(vehicle))
      store.set(vehicle.id, marker)
      continue
    }

    patchVehicleMarker(marker, vehicle)
    if (buildPopup) {
      const popup = marker.getPopup()
      if (popup) popup.setContent(buildPopup(vehicle))
      else marker.bindPopup(buildPopup(vehicle))
    }
  }

  for (const [id, marker] of store) {
    if (seen.has(id)) continue
    marker.remove()
    store.delete(id)
    headings.delete(id)
  }
}
