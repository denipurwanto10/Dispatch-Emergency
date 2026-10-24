import L from 'leaflet'

import type { Vehicle, VehicleType } from '../types'

/**
 * Marker kendaraan gaya "puck armada" (seperti Groundwork): ikon tampak atas yang
 * berputar mengikuti arah gerak, dengan cincin status dan lampu sirene yang berkedip.
 * Arah (heading) dihitung dari dua posisi berurutan, karena API belum mengirim heading.
 */

// ---------- Ikon SVG tampak atas (menghadap ke atas / utara) ----------
// Semua warna solid (flat). Cahaya dibuat dari bentuk transparan, bukan gradien.
// Id <defs> tidak dipakai: setiap bagian memakai fill langsung, jadi aman diulang di satu halaman.

const INK = '#0f172a'
const GLASS = '#1e293b'
const GLASS_HI = '#334155'

/** Roda: balok gelap yang menyembul di sisi bodi. */
const WHEELS = (ys: number[]) =>
  ys
    .map(
      y => `
  <rect x="1.4" y="${y}" width="5.2" height="11" rx="2.2" fill="${INK}"/>
  <rect x="33.4" y="${y}" width="5.2" height="11" rx="2.2" fill="${INK}"/>`,
    )
    .join('')

/** Spion samping. */
const MIRRORS = (y: number, fill: string) => `
  <rect x="0.8" y="${y}" width="4.6" height="3.6" rx="1.6" fill="${fill}"/>
  <rect x="34.6" y="${y}" width="4.6" height="3.6" rx="1.6" fill="${fill}"/>`

/** Sorot lampu depan: dua baji transparan datar, hanya tampil saat unit aktif/tersedia. */
const BEAMS = `
  <g class="vm-beam">
    <path d="M7 5 L2 -22 H15 L13 5 Z" fill="#fff4b8"/>
    <path d="M27 5 L25 -22 H38 L33 5 Z" fill="#fff4b8"/>
  </g>`

/**
 * Lampu depan LED: rumah gelap, lensa putih hangat, dan strip DRL tipis.
 * Bentuknya meruncing ke arah tengah bodi seperti lampu mobil modern.
 */
const HEADLIGHTS = `
  <path d="M6.6 6.4 Q6.2 3.6 8.6 3.2 L14.6 3.8 Q15.6 4 15.4 5.4 L14.8 8 Q11 7.2 6.6 8.2 Z" fill="${INK}"/>
  <path d="M33.4 6.4 Q33.8 3.6 31.4 3.2 L25.4 3.8 Q24.4 4 24.6 5.4 L25.2 8 Q29 7.2 33.4 8.2 Z" fill="${INK}"/>
  <path d="M8 6.2 Q8 4.7 9.4 4.5 L13.6 4.9 L13.2 6.6 Q10.6 6.2 8 6.9 Z" class="vm-head" fill="#fffbe6"/>
  <path d="M32 6.2 Q32 4.7 30.6 4.5 L26.4 4.9 L26.8 6.6 Q29.4 6.2 32 6.9 Z" class="vm-head" fill="#fffbe6"/>`

/** Lampu belakang LED: rumah gelap, lensa merah, dan garis terang di tengah. */
const TAILLIGHTS = (h: number) => `
  <rect x="6" y="${h - 7.4}" width="9.4" height="4.2" rx="1.8" fill="${INK}"/>
  <rect x="24.6" y="${h - 7.4}" width="9.4" height="4.2" rx="1.8" fill="${INK}"/>
  <rect x="6.9" y="${h - 6.6}" width="7.6" height="2.6" rx="1.2" class="vm-tail" fill="#ef2b2d"/>
  <rect x="25.5" y="${h - 6.6}" width="7.6" height="2.6" rx="1.2" class="vm-tail" fill="#ef2b2d"/>
  <rect x="7.8" y="${h - 5.8}" width="5.8" height="0.9" rx=".45" fill="#ffb4b4"/>
  <rect x="26.4" y="${h - 5.8}" width="5.8" height="0.9" rx=".45" fill="#ffb4b4"/>`

/**
 * Lightbar atap: rumah gelap dengan empat segmen merah/biru. Segmen berkedip
 * bergantian (A lalu B); "halo" adalah cahaya datar transparan di belakangnya.
 */
const LIGHTBAR = (x: number, y: number, w: number) => {
  const seg = (w - 4) / 4
  const sx = (i: number) => x + 2 + i * seg
  const cls = (i: number) => (i < 2 ? 'a' : 'b')
  const col = (i: number) => (i < 2 ? '#ef4444' : '#3b82f6')
  const halos = [0, 1]
    .map(
      i => `<rect class="vm-halo vm-halo-${i ? 'b' : 'a'}" x="${x - 3 + i * (w / 2 + 3)}" y="${y - 3.5}" width="${w / 2 + 3}" height="13" rx="6.5" fill="${i ? '#3b82f6' : '#ef4444'}"/>`,
    )
    .join('')
  const leds = [0, 1, 2, 3]
    .map(
      i =>
        `<rect class="vm-led vm-led-${cls(i)}" x="${sx(i) + 0.4}" y="${y + 1.3}" width="${seg - 0.8}" height="4.4" rx="1.4" fill="${col(i)}"/>`,
    )
    .join('')
  return `
  ${halos}
  <rect x="${x}" y="${y}" width="${w}" height="7" rx="3.5" fill="${INK}"/>
  ${leds}
  <rect x="${x + 3}" y="${y + 1.5}" width="${w - 6}" height="0.8" rx=".4" fill="#fff" opacity=".22"/>`
}

const SVG: Record<VehicleType, { w: number; h: number; markup: string }> = {
  // ----- Mobil patroli (sedan) -----
  police: {
    w: 40,
    h: 76,
    markup: `
      ${BEAMS}
      ${WHEELS([13, 55])}
      ${MIRRORS(22, '#1e3a8a')}
      <rect x="4" y="2" width="32" height="72" rx="12" fill="#2f5fd0" stroke="#ffffff" stroke-width="1.5"/>
      <rect x="4" y="30" width="32" height="14" fill="#f8fafc"/>
      <path d="M9 17 Q20 12 31 17 L29.6 28 H10.4 Z" fill="${GLASS}"/>
      <path d="M12 19 Q20 15.8 26 17.4" fill="none" stroke="${GLASS_HI}" stroke-width="1.2" stroke-linecap="round"/>
      <rect x="8.4" y="44" width="23.2" height="9" rx="3" fill="#2f5fd0"/>
      <path d="M10.4 53 H29.6 L31 61 Q20 64.6 9 61 Z" fill="${GLASS}"/>
      <rect x="12" y="46" width="16" height="1.8" rx=".9" fill="#ffffff" opacity=".85"/>
      ${LIGHTBAR(10, 33, 20)}
      ${HEADLIGHTS}
      ${TAILLIGHTS(76)}`,
  },

  // ----- Ambulans (van) -----
  ambulance: {
    w: 40,
    h: 82,
    markup: `
      ${BEAMS}
      ${WHEELS([13, 58])}
      ${MIRRORS(19, '#64748b')}
      <rect x="4" y="2" width="32" height="78" rx="11" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
      <path d="M9 15 Q20 10 31 15 L29.6 26 H10.4 Z" fill="${GLASS}"/>
      <path d="M12 17 Q20 13.8 26 15.4" fill="none" stroke="${GLASS_HI}" stroke-width="1.2" stroke-linecap="round"/>
      <rect x="4.8" y="28" width="30.4" height="3" fill="#dc2626"/>
      <rect x="4.8" y="70" width="30.4" height="3" fill="#dc2626"/>
      <rect x="9" y="40" width="22" height="26" rx="4" fill="#e2e8f0"/>
      <rect x="17.4" y="44" width="5.2" height="18" rx="1.4" fill="#dc2626"/>
      <rect x="11" y="50.4" width="18" height="5.2" rx="1.4" fill="#dc2626"/>
      ${LIGHTBAR(10, 32, 20)}
      ${HEADLIGHTS}
      ${TAILLIGHTS(82)}`,
  },

  // ----- Mobil pemadam (truk tangga) -----
  fire: {
    w: 40,
    h: 104,
    markup: `
      ${BEAMS}
      ${WHEELS([12, 60, 79])}
      ${MIRRORS(19, INK)}
      <rect x="4" y="2" width="32" height="100" rx="10" fill="#d62f24" stroke="#ffffff" stroke-width="1.5"/>
      <rect x="6" y="2.8" width="28" height="3.6" rx="1.8" fill="#cbd5e1"/>
      <path d="M9 12 Q20 7 31 12 L30 22 H10 Z" fill="${GLASS}"/>
      <path d="M12 13.6 Q20 10.6 26 12.2" fill="none" stroke="${GLASS_HI}" stroke-width="1.2" stroke-linecap="round"/>
      <rect x="7" y="24" width="26" height="9" rx="3" fill="#a61b17"/>
      <rect x="4.8" y="35" width="30.4" height="2.2" fill="#fbbf24"/>
      <rect x="7" y="40" width="26" height="56" rx="3" fill="#8f1a15"/>
      <rect x="12" y="39" width="2.4" height="58" rx="1.2" fill="#cbd5e1"/>
      <rect x="25.6" y="39" width="2.4" height="58" rx="1.2" fill="#cbd5e1"/>
      <g stroke="#e2e8f0" stroke-width="1.5" stroke-linecap="round">
        <path d="M14.6 44H25.4M14.6 50.5H25.4M14.6 57H25.4M14.6 63.5H25.4M14.6 70H25.4M14.6 76.5H25.4M14.6 83H25.4M14.6 89.5H25.4"/>
      </g>
      <path d="M7 97.6 L12 95.4 M12 97.6 L17 95.4 M17 97.6 L22 95.4 M22 97.6 L27 95.4 M27 97.6 L32 95.4" stroke="#fde68a" stroke-width="1.6" stroke-linecap="round"/>
      ${LIGHTBAR(10, 26, 20)}
      ${HEADLIGHTS}
      ${TAILLIGHTS(104)}`,
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
