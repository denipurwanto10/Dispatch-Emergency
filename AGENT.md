# AGENT.md — Konvensi Proyek Dispatch

Dokumen ini adalah kontrak kerja untuk agen/engineer yang melanjutkan proyek. Baca sebelum mengubah kode. Untuk panduan ringkas perintah/verifikasi, lihat [`AGENTS.md`](AGENTS.md). Untuk arsitektur dan backlog, lihat [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) dan [`docs/BACKLOG.md`](docs/BACKLOG.md).

## Status proyek

**Fase 1–4 SELESAI. MVP Dispatch sudah berjalan end-to-end.** Fondasi auth JWT + role, seed 6 kota, insiden, pencarian kandidat OSRM, assignment + rute, simulasi kendaraan, WebSocket, layar driver, dan panel admin sudah terpasang dan diverifikasi.

**FASE PENUTUP SELESAI.** Demo deterministik Bandung + 8 screenshot portofolio, perintah reset demo idempotent (`go run ./cmd/resetdemo`), poles akhir README (screenshot, demo 5 menit, arsitektur, keputusan desain), verifikasi jalan-dari-nol di DB baru (`dispatch_verify`), commit git lokal.

Fitur yang sudah ada:

- Auth JWT HS256 + bcrypt, role `admin`, `dispatcher`, `driver`.
- 6 kota operasi kanonik, 36 kendaraan, 14 user.
- Insiden create/list/detail/cancel; `operating_city` ditentukan server.
- Pencarian maksimal 3 kandidat kendaraan terdekat lewat OSRM publik.
- Assignment transaksional, rute OSRM, `assigned_by` fail-closed dari JWT.
- Simulasi pergerakan kendaraan dan event WebSocket.
- Layar driver real-time tanpa polling, peta mini, ETA, tombol tiba manual (fallback), riwayat 20 tugas.
- Panel admin CRUD user dan kendaraan dengan validasi + pesan `409`.

Jangan mengulang scaffold, menghapus fitur yang sudah bekerja, atau menambahkan Docker.

## TANPA Docker

- Proyek berjalan **100% lokal di mesin**.
- PostgreSQL + PostGIS diasumsikan sudah terpasang dan berjalan langsung (bukan container).
- **Jangan** membuat `docker-compose.yml`, `Dockerfile`, atau instruksi setup berbasis Docker.
- Konfigurasi hanya lewat environment variable; contoh ada di `.env.example`.
- Database dibuat manual sekali oleh pengguna (lihat README).

## Prinsip operasi per `operating_city`

- Nilai kota kanonik: **Medan, Jakarta, Bandung, Semarang, Surabaya, Makassar**.
- Satu-satunya sumber daftar kota dan validasi wilayah: `internal/geo/cities.go`.
- `users.operating_city`:
  - `admin` dan dispatcher nasional: `NULL`.
  - `driver`: kota tempat bertugas (wajib valid).
  - dispatcher non-nasional: boleh kota valid.
- `vehicles.operating_city`: kota tempat kendaraan di-home-kan; wajib valid.
- `incidents.operating_city`: kota terjadinya insiden. **Ditentukan server saat create**, bukan dari body client: ambil kendaraan `available` terdekat (PostGIS) dari titik insiden selama jaraknya <= `DISPATCH_RADIUS_M`. Bila tidak ada, insiden tetap dibuat dengan `operating_city = NULL`.
- **Dispatch bersifat lokal per kota.** Assignment dan pencarian kandidat hanya boleh menghubungkan kendaraan dan insiden dengan `operating_city` yang sama.
- Jangan melakukan assignment lintas kota, termasuk menjadikan kendaraan `operating_city = NULL` sebagai kandidat. Insiden dengan kota `NULL` tidak punya kandidat.
- Dispatcher nasional boleh melihat seluruh kota dan memakai filter, tetapi aksi assignment tetap dibatasi ke kota insiden.
- Filter `GET /vehicles?city=` dan `GET /admin/vehicles?city=` memakai **exact match** nama kanonik. Frontend mengirim nilai dari `frontend/src/cities.ts`; jangan mengarang alias atau variasi kapitalisasi.
- Validasi kota harus ada di handler/repository, bukan hanya frontend. Nilai tidak valid → `400`.

## Stack & konvensi

### Backend

- **Go + Gin + PostgreSQL/PostGIS**.
- Entrypoint: `cmd/server`. Migrasi: `cmd/migrate`. Seed: `cmd/seed`. **Reset demo: `cmd/resetdemo`**.
- Lapisan: `handler` → `repository`; service layer hanya bila benar-benar perlu. Jangan over-engineering.
- Format error: `{"error":{"code":"...","message":"..."}}` lewat `internal/httpx`.
- Semua konfigurasi dari env: `PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_TTL`, `CORS_ORIGIN`, `OSRM_BASE_URL`, `DISPATCH_RADIUS_M`, `SIM_SPEED_MULTIPLIER`.
- `OSRM_BASE_URL` default `https://router.project-osrm.org`; request OSRM dibatasi timeout **5 detik** di `internal/osrm`.
- `DISPATCH_RADIUS_M` default `50000` meter. Jangan menaruh angka radius tersebar di handler/repository.
- `SIM_SPEED_MULTIPLIER` default `20`; nilai harus > 0. Simulator berjalan dengan ticker 1 detik.
- Password hanya disimpan sebagai hash bcrypt; `password_hash` tidak pernah keluar di JSON.
- Sebelum selesai: `gofmt -l .` kosong, `go vet ./...`, `go test ./...`, dan `go build ./...` lolos.

### Database

- Migrasi SQL polos di `migrations/`, berurutan (`001_`, `002_`, `003_`, …), idempotent, dan dicatat di `schema_migrations`.
- Jangan mengubah migrasi yang sudah diterapkan di lingkungan lain; buat file baru.
- Ekstensi PostGIS wajib aktif (`CREATE EXTENSION IF NOT EXISTS postgis`).
- Geometri memakai SRID **4326**:
  - `vehicles.pos_geom`, `vehicles.home_geom` — `Point`
  - `incidents.geom` — `Point`
  - `assignments.route_geom` — `LineString` (nullable)
- Koordinat di API diturunkan dengan `ST_Y(pos_geom)` (lat) dan `ST_X(pos_geom)` (lng).
- `operating_city` ada di `users`, `vehicles`, dan `incidents` sebagai `TEXT NULL`.
- Index biasa: `idx_vehicles_operating_city`, `idx_incidents_operating_city`.
- Index spasial: `idx_vehicles_pos_geom` (GiST), `idx_incidents_geom` (GiST).
- Foreign key `assignments.assigned_by → users.id` sudah ada. Jangan mengisi `assigned_by` dari body/vehicle/insiden.
- Migrasi `003_add_operating_city.sql` mem-backfill data demo Fase 1 ke `Bandung`. Jangan menghapus kolom/index ini.

### Frontend

- **React + Vite + TypeScript + Leaflet** (Leaflet langsung, bukan react-leaflet).
- API base dari `VITE_API_BASE_URL` (default `http://localhost:8080`).
- JWT disimpan di `localStorage` (`dispatch.session.v1`).
- Tema dari CSS variables di `src/styles.css`; `data-theme` diatur menurut role (dispatcher gelap, driver/admin terang).
- Jangan menambahkan data mock/hardcoded untuk kendaraan, insiden, assignment, atau peta. Semua dari API/WebSocket.
- Peta awal dispatcher memakai bounds Indonesia (`fitBounds`), bukan pusat Bandung.
- Dropdown kota berisi **Semua Kota + 6 kota operasi**; perubahan filter wajib mengirim `?city=` ke API dan memindahkan peta ke pusat kota terpilih.
- Klik area peta (bukan marker) membuka form create insiden dengan koordinat dari klik. Jangan mengirim `operating_city` dari client.
- Marker insiden harus berbeda jelas dari marker kendaraan dan berwarna menurut priority: critical merah, high oranye, medium kuning, low abu/biru.
- Detail insiden memanggil `GET /incidents/:id/nearest`; tampilkan kandidat terurut, jarak km 1 desimal, ETA menit, driver, dan badge `Sesuai Tipe` bila `type_match`.
- Tombol assign hanya untuk dispatcher dan hanya pada insiden `open`.
- Layar driver **tidak boleh polling** `/assignments/mine/active`. Pemuatan awal sekali; pembaruan lewat WebSocket. Reconnect otomatis setiap 3 detik, lalu refresh state sekali setelah reconnect.
- Peta driver memakai Leaflet dengan marker kendaraan yang bergerak, marker insiden, dan polyline rute. Jangan membuat instance peta ganda saat kartu tugas muncul/hilang; gunakan callback ref container.
- Panel admin memakai tab Users/Kendaraan, form create/edit, dan konfirmasi hapus. Tampilkan pesan error backend apa adanya agar `409` terbaca.
- Sebelum selesai: `npm run build`, `npm run lint`, dan `npm run typecheck` lolos.

## Status legal

### Kendaraan (`vehicles.status`)

```text
available | assigned | en_route | on_scene | offline
```

### Insiden (`incidents.status`)

```text
open | assigned | en_route | on_scene | resolved | cancelled
```

### Prioritas insiden (`incidents.priority`)

```text
low | medium | high | critical
```

### Assignment (`assignments.status`)

```text
assigned | en_route | arrived | completed | cancelled
```

### Tipe kendaraan (`vehicles.type`)

```text
ambulance | fire | police
```

### Tipe insiden (`incidents.type`)

```text
ambulance | fire | police
```

`vehicles.type`, `incidents.priority`, `incidents.status`, dan `assignments.status` ditegakkan dengan `CHECK`. `incidents.type` divalidasi di handler create insiden. Jangan menambah nilai baru tanpa migrasi baru + pembaruan dokumen ini.

### Role user (`users.role`)

```text
dispatcher | driver | admin
```

`operating_city` bertipe `TEXT NULL`; nilai kanonik dijaga oleh `internal/geo`, seed, frontend, dan aturan dispatch di atas.

## Assignment: constraint dan state machine

### Constraint database

Satu kendaraan **hanya boleh memiliki satu assignment aktif** pada satu waktu untuk status:

```text
assigned | en_route
```

Ditegakkan oleh partial unique index:

```sql
CREATE UNIQUE INDEX uniq_active_assignment_per_vehicle
    ON assignments (vehicle_id)
    WHERE status IN ('assigned', 'en_route');
```

Handler wajib menangkap pelanggaran constraint ini dan mengembalikan `409`, bukan `500`.

### State machine terpusat

Sumber kebenaran ada di `internal/state`. Handler, repository, dan simulator wajib memakai tabel ini; jangan menulis status langsung tanpa validator.

**Insiden (`incidents.status`)**

| Dari | Tujuan legal |
| --- | --- |
| `open` | `assigned`, `cancelled` |
| `assigned` | `en_route` |
| `en_route` | `on_scene` |
| `on_scene` | `resolved` |
| `resolved` | — |
| `cancelled` | — |

**Assignment (`assignments.status`)**

| Dari | Tujuan legal |
| --- | --- |
| `assigned` | `en_route`, `cancelled` |
| `en_route` | `arrived`, `cancelled` |
| `arrived` | `completed` |
| `completed` | — |
| `cancelled` | — |

- Transisi ilegal → `409`; data tidak boleh berubah.
- `start` memvalidasi assignment `assigned → en_route` dan insiden `assigned → en_route`.
- `arrive` memvalidasi assignment `en_route → arrived` dan insiden `en_route → on_scene`.
- `complete` memvalidasi assignment `arrived → completed` dan insiden `on_scene → resolved`.
- Simulator memakai validator yang sama; state tidak konsisten dilewati dan dicatat ke log.
- `POST /assignments/:id/start` hanya untuk driver pemilik kendaraan dan hanya dari `assigned`.
- Simulator mengubah `en_route` → `arrived` saat progress mencapai `distance_m`.
- `POST /assignments/:id/arrive` adalah fallback manual untuk driver pemilik kendaraan dari `en_route`; frontend menampilkan tombol "Sampai di Lokasi".
- `POST /assignments/:id/complete` hanya dari `arrived`, boleh oleh driver pemilik, dispatcher, atau admin.
- Complete mengubah kendaraan menjadi `available` di lokasi insiden dan insiden menjadi `resolved`.
- `cancelled` ada di status legal dan tabel transisi, tetapi belum ada endpoint cancel/reject assignment terpisah di MVP.

### Assignment aktif untuk driver/admin

- `GET /assignments/mine/active` menganggap `assigned`, `en_route`, dan `arrived` sebagai aktif.
- Admin memblokir perubahan sensitif dan penghapusan kendaraan selama assignment `assigned`, `en_route`, atau `arrived`.
- Index database hanya mengunci `assigned`/`en_route`; aturan `arrived` adalah kebijakan aplikasi. Jangan mengubah salah satunya tanpa memahami efeknya.

### `assigned_by` fail-closed

- `assigned_by` **wajib** berasal dari `middleware.ContextUserID` (klaim JWT yang sudah divalidasi).
- Jika identitas tidak ada/tidak valid → `401`, jangan fallback ke body, driver, atau insiden.
- Jangan pernah menerima `assigned_by` dari request client.

### Assignment transaksional

`POST /incidents/:id/assign` harus:

1. Memvalidasi insiden `open` dan punya `operating_city`.
2. Memvalidasi kendaraan `available` dan kota sama.
3. Mengambil rute OSRM `/route`.
4. Dalam satu transaksi: insert assignment, update kendaraan `assigned`, update insiden `assigned`.
5. Rollback seluruhnya bila salah satu langkah gagal.
6. Broadcast `assignment_status` setelah commit.

## Aturan panel admin

### User

- Role hanya `dispatcher`, `driver`, `admin`.
- `driver` wajib punya `operating_city` valid; `admin` selalu `NULL`; dispatcher boleh `NULL` atau kota valid.
- Email unik; duplikat → `409` (`email_duplicate`).
- Password minimal 6 karakter; bcrypt.
- Tidak boleh menghapus akun sendiri → `409`.
- Admin terakhir tidak boleh dihapus → `409`.
- Driver yang masih terhubung ke kendaraan tidak boleh dihapus atau diubah role-nya → `409`.
- Driver dengan assignment aktif tidak boleh dihapus → `409`.
- User yang masih dipakai data insiden/assignment → `409` (`user_in_use`).
- `GET /admin/users` tidak boleh mengembalikan `password_hash`.

### Kendaraan

- `operating_city` wajib kota kanonik; nilai lain → `400`.
- Plat unik; duplikat → `409` (`plate_duplicate`).
- Driver opsional; jika diisi harus role `driver` dan kota sama. Beda kota → `409`; bukan driver → `400`.
- `home_lat`/`home_lng` wajib dan harus dalam radius kasar kota (60 km).
- Status manual hanya `available` atau `offline`; status lain → `400`.
- Assignment aktif (`assigned`, `en_route`, `arrived`) memblokir perubahan driver, kota, home, status, dan penghapusan → `409`.
- Nama, plat, dan tipe masih boleh diubah saat assignment aktif.
- Mengubah home atau kota me-reset posisi kendaraan ke home baru.
- Menghapus kendaraan menghapus riwayat assignment non-aktif secara transaksional; assignment aktif selalu diblokir lebih dulu.
- Jangan menghapus kendaraan yang masih direferensikan data lain tanpa menangani foreign key.

## Auth & role

- JWT HS256, klaim: `uid`, `role`, `name`, `email`, `sub`, `iat`, `exp`, `iss=dispatch`.
- Middleware `RequireAuth` memvalidasi Bearer token; `RequireRole(...)` membatasi role.
- `GET /vehicles` cukup login (semua role) dan mendukung query `?city=`.
- `POST /incidents`, `POST /incidents/:id/cancel`, dan `POST /incidents/:id/assign` hanya `dispatcher`/`admin`.
- `GET /incidents`, `GET /incidents/:id`, dan `GET /incidents/:id/nearest` hanya `dispatcher`/`admin`.
- `GET /assignments/mine/active` dan `GET /assignments/mine/history` hanya `driver`.
- `POST /assignments/:id/start` hanya `driver` pemilik kendaraan.
- `POST /assignments/:id/arrive` hanya `driver` pemilik kendaraan, dari `en_route`.
- `POST /assignments/:id/complete` boleh driver pemilik, `dispatcher`, atau `admin`.
- `GET /assignments/:id` boleh `dispatcher`/`admin`, atau `driver` pemilik kendaraan.
- Semua route `/admin/*` hanya `admin`; role lain `403`, tanpa token `401`.
- WebSocket `/ws?token=` memvalidasi JWT saat handshake; token tidak valid → `401`.
- Response `POST /auth/login` menyertakan `operating_city` user.
- Jangan menambahkan registrasi publik, lupa password, atau refresh token tanpa fase baru.

## WebSocket

- Hub: `internal/ws`; route: `GET /ws?token=<JWT>`.
- Broadcast bersifat global ke semua client yang terhubung; frontend memfilter event yang relevan.
- Event:
  - `assignment_status` — `{assignment, incident, vehicle}` pada assign/start/arrived/complete.
  - `vehicle_position` — `{vehicle_id, assignment_id, lat, lng, progress_pct, eta_remaining_seconds}` setiap tick simulasi.
- Driver tidak polling. Reconnect otomatis setiap 3 detik; setelah reconnect, refresh state sekali.
- Jangan mengubah event payload tanpa memperbarui `frontend/src/types.ts` dan handler terkait.
- Broadcast tidak boleh memblokir request HTTP; channel penuh boleh drop event.

## Algoritme pencarian kandidat terdekat

`GET /incidents/:id/nearest` wajib mengikuti urutan ini:

a. Muat insiden. Bila tidak ada → `404`; bila status bukan `open` → `409`.
b. Radius dari `DISPATCH_RADIUS_M`, bukan hardcode.
c. Kandidat awal: kendaraan `available` dengan `operating_city` **sama** dan `pos_geom` dalam radius, memakai `ST_DWithin(..., geography)`. Jangan pernah memasukkan kendaraan lintas kota. Insiden dengan kota `NULL` tidak punya kandidat.
d. Bila kandidat awal kosong → `200` dengan `candidates: []` dan `reason: "no_available_vehicle_within_radius"`.
e. Panggil OSRM `/table/v1/driving/{koordinat kendaraan...,koordinat insiden}` dengan `sources` semua kendaraan, `destinations` insiden, dan `annotations=duration,distance`. Format koordinat OSRM adalah **lng,lat**.
f. Bila OSRM error/timeout/`code` bukan `Ok` → `502`. **Jangan** mengarang kandidat dari jarak garis lurus.
g. Buang kandidat dengan `duration`/`distance` `null`/tidak valid. Urutkan `duration_seconds` menaik; bila seri, `distance_m` menaik. Ambil 3 teratas.
h. Bila semua terbuang → `200` dengan `candidates: []` dan `reason: "no_reachable_vehicle"`.
i. Field kandidat: `vehicle_id`, `name`, `plate`, `type`, `operating_city`, `driver_name`, `duration_seconds`, `distance_m`, `eta_minutes` (ceil durasi/60), `type_match`.

**Keputusan penting:**

- **Tipe kendaraan bukan filter keras.** Kandidat adalah semua kendaraan available di kota yang sama dan dalam radius, diurutkan murni durasi OSRM. `type_match` hanya penanda.
- **OSRM publik, bukan self-host.** Timeout 5 detik; error ditangani `502`; server tidak boleh crash.
- **Kota insiden ditentukan server saat create.** Body client tidak boleh menentukan `operating_city`.
- **Cancel insiden hanya dari `open`.** Status lain → `409`; nearest untuk insiden yang sudah cancelled → `409`.

## Endpoint (jangan menambah di luar ini tanpa fase baru)

- `GET /health`
- `POST /auth/login` — response memuat `operating_city`
- `GET /vehicles` (auth) — semua kendaraan, response memuat `operating_city`
- `GET /vehicles?city=Bandung` (auth) — filter exact `operating_city`
- `POST /incidents` (dispatcher/admin)
- `GET /incidents` (dispatcher/admin) — filter `?status=` dan `?city=`
- `GET /incidents/:id` (dispatcher/admin)
- `POST /incidents/:id/cancel` (dispatcher/admin)
- `GET /incidents/:id/nearest` (dispatcher/admin)
- `POST /incidents/:id/assign` (dispatcher/admin) — body `{vehicle_id}`
- `POST /assignments/:id/start` (driver pemilik)
- `POST /assignments/:id/arrive` (driver pemilik) — fallback manual `en_route → arrived`
- `POST /assignments/:id/complete` (driver pemilik/dispatcher/admin)
- `GET /assignments/mine/active` (driver)
- `GET /assignments/mine/history` (driver) — maksimal 20
- `GET /assignments/:id` (dispatcher/admin/driver pemilik)
- `GET /admin/users` (admin)
- `POST /admin/users` (admin)
- `PUT /admin/users/:id` (admin)
- `DELETE /admin/users/:id` (admin)
- `GET /admin/vehicles` (admin) — filter opsional `?city=`
- `POST /admin/vehicles` (admin)
- `PUT /admin/vehicles/:id` (admin)
- `DELETE /admin/vehicles/:id` (admin)
- `GET /ws?token=<JWT>` — WebSocket

## Seed

- 14 user: 1 admin, 1 dispatcher nasional (`operating_city = NULL`), 12 driver (2 per kota).
- 36 kendaraan: tepat 6 per kota (2 ambulance, 2 fire, 2 police).
- 12 kendaraan punya driver: satu ambulans dan satu damkar per kota; 24 kendaraan lain tanpa driver.
- Semua kendaraan `available`, `pos_geom = home_geom`, offset home deterministik < 5 km dari pusat kota.
- Password demo `Dispatch123!`, di-hash bcrypt.
- Seed idempotent. Jangan menambahkan `DELETE`/`TRUNCATE` global.

## Reset Demo (`cmd/resetdemo`)

Perintah idempotent untuk membersihkan data demo/uji **tanpa menghapus seed baseline**:

```powershell
go run ./cmd/resetdemo
```

**Perilaku:**
1. Validasi baseline: harus tepat **14 user / 36 kendaraan**. Jika tidak → rollback + error.
2. Hapus **semua assignment** (data uji/demo).
3. Hapus **semua insiden** (data uji/demo).
4. Reset **semua kendaraan**: `status = 'available'`, `pos_geom = home_geom`, `pos_updated_at = now()`.
5. Verifikasi akhir: 0 assignment, 0 insiden, 36 kendaraan available.
6. User dan kendaraan seed **tidak dihapus/diubah isinya**.

Gunakan setelah screenshot/demo selesai agar database kembali bersih untuk verifikasi atau demo berikutnya.

## Verifikasi wajib sebelum selesai

Backend:

```powershell
gofmt -l .
go vet ./...
go test ./...
go build ./...
```

Frontend:

```powershell
cd frontend
npm run build
npm run lint
npm run typecheck
```

Cek juga:

- Tidak ada `Dockerfile`, `docker-compose.yml`, atau `docker-compose.yaml`.
- Endpoint admin menolak non-admin (`403`) dan tanpa token (`401`).
- Duplikat email/plat mengembalikan `409` dengan pesan yang terbaca.
- Assignment tidak bisa lintas kota; kendaraan dengan assignment aktif tidak bisa dihapus.
- Driver menerima kartu tugas baru lewat WebSocket tanpa refresh.
- Driver tidak melakukan polling `/assignments/mine/active`.
- Riwayat driver maksimal 20 dan memuat `response_seconds`.

## Di luar MVP

- Registrasi publik, lupa password, refresh token, push notification.
- Self-host OSRM atau Docker.
- Multi-dispatcher per kota, penjadwalan shift, audit log penuh.
- Laporan/export lanjutan dan dashboard analitik.
