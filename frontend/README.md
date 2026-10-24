# Dispatch Frontend

React 19 + Vite + TypeScript + Leaflet untuk Dispatch. Berisi peta operasi dispatcher, layar tugas driver real-time, dan panel admin.

Lihat [README](../README.md) di root proyek untuk prasyarat, cara menjalankan, kredensial seed, dan daftar endpoint.

```powershell
npm install
npm run dev
npm run build
npm run lint
```

Konfigurasi API memakai environment variable:

```dotenv
VITE_API_BASE_URL=http://localhost:8080
```

## Catatan UI

- Tema terang/gelap bisa diganti dari header semua halaman. Bawaan per peran: dispatcher gelap, driver/admin terang. Pilihan disimpan di `localStorage` dengan kunci `tanggap.theme`.
- Basemap memakai tile Google publik tanpa API key (`src/lib/basemap.ts`); tile yang gagal berulang kali otomatis diganti OpenStreetMap. Ubah `USE_GOOGLE_TILES` ke `false` untuk memakai OSM saja.
- Desain flat: kedalaman hanya dari garis tepi. Panel laporan di `/map` berubah menjadi bottom sheet pada layar sempit.
- `src/optional-vector/` hanya berisi eksperimen basemap vektor dan tidak ikut build.
