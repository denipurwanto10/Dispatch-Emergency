# Dispatch — Emergency Response Command Center

MVP command center respons darurat untuk **6 kota operasi di Indonesia**. Fase 1–4 sudah selesai: auth/role, seed nasional, insiden + pencarian kandidat, assignment + rute + simulasi, WebSocket real-time, layar driver, dan panel admin.

> **Tanpa Docker.** Semua layanan berjalan langsung di mesin lokal. Tidak ada `docker-compose.yml`, `Dockerfile`, atau instruksi berbasis container di proyek ini.

## Fitur MVP final

- **Auth & role** — JWT HS256, password bcrypt, role `admin`, `dispatcher`, dan `driver`.
- **Seed nasional** — 6 kota, 36 kendaraan, 14 user; semua kendaraan punya posisi dan home di kota operasinya.
- **Insiden** — dispatcher membuat, melihat daftar/detail, dan membatalkan insiden `open`. `operating_city` insiden ditentukan server, bukan client.
- **Pencarian kandidat** — maksimal 3 kendaraan `available` dari kota yang sama, diurutkan memakai durasi OSRM publik. Tipe kendaraan adalah penanda `type_match`, bukan filter keras.
- **Assignment** — dispatcher meng-assign kandidat; server mengambil rute OSRM, menyimpan polyline, jarak, ETA, dan `assigned_by` dari identitas JWT. Assignment berjalan dalam transaksi dan menghormati constraint satu assignment aktif per kendaraan.
- **Simulasi & real-time** — simulator menggerakkan kendaraan di sepanjang rute dan mengirim event WebSocket `vehicle_position` serta `assignment_status`.
- **Layar driver `/driver`** — kartu tugas muncul tanpa refresh, peta mini Leaflet dengan marker kendaraan/insiden dan polyline rute, ETA dari `eta_remaining_seconds`, tombol mulai/selesai, riwayat 20 tugas terakhir, dan reconnect WebSocket otomatis. **Tidak ada polling tugas aktif.**
- **Panel admin `/admin`** — tab Users dan Kendaraan, tabel, form create/edit, konfirmasi hapus, dan pesan error backend yang terbaca.
- **Keamanan assignment** — `assigned_by` fail-closed: request tanpa identitas JWT yang valid ditolak `401`, tidak pernah mengambil user dari body.
- **Tanpa Docker** — PostgreSQL/PostGIS, Go, dan Vite berjalan langsung di mesin.

## Cakupan kota dan seed

| Kota operasi | Pusat operasi | Kendaraan |
| --- | --- | --- |
| Medan | sekitar 3.5952, 98.6722 | 6 |
| Jakarta | sekitar -6.2088, 106.8456 | 6 |
| Bandung | sekitar -6.9175, 107.6191 | 6 |
| Semarang | sekitar -6.9667, 110.4167 | 6 |
| Surabaya | sekitar -7.2575, 112.7521 | 6 |
| Makassar | sekitar -5.1477, 119.4327 | 6 |

- Total **36 kendaraan**: 2 ambulance, 2 fire, dan 2 police per kota.
- **1 admin**, **1 dispatcher nasional** (`operating_city = NULL`), dan **12 driver** (2 per kota).
- Nilai kota kanonik hanya: **Medan, Jakarta, Bandung, Semarang, Surabaya, Makassar**. Nilai lain ditolak `400`.
- Validasi kota dan batas kasar wilayah kota ada di `internal/geo/cities.go` (radius 60 km dari pusat kota).

## Stack

| Bagian | Teknologi |
| --- | --- |
| Backend | Go + Gin, JWT (HS256), bcrypt |
| Database | PostgreSQL + PostGIS lokal |
| Routing | OSRM publik (`https://router.project-osrm.org`) untuk `/table` dan `/route` |
| Real-time | Gorilla WebSocket |
| Frontend | React + Vite + TypeScript + Leaflet (OpenStreetMap) |
| Tema | CSS variables — light untuk driver/admin, dark untuk dispatcher |

## Prasyarat lokal

1. **Go** 1.26 atau lebih baru (`go version`).
2. **Node.js** 20 atau lebih baru + npm (`node --version`).
3. **PostgreSQL** (diuji dengan PostgreSQL 18) yang sedang berjalan.
4. **Ekstensi PostGIS** tersedia. Cek dengan:

   ```sql
   SELECT default_version FROM pg_available_extensions WHERE name = 'postgis';
   ```

   Jika kosong, pasang paket PostGIS untuk PostgreSQL lokal terlebih dahulu. Migrasi menjalankan `CREATE EXTENSION IF NOT EXISTS postgis`, dan langkah itu butuh user PostgreSQL dengan hak superuser.

Tidak perlu Docker.

## 1. Buat database (sekali saja)

**Windows (PowerShell), PostgreSQL 18:**

```powershell
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres -h localhost dispatch
```

**Linux/macOS:**

```bash
createdb -U postgres -h localhost dispatch
```

**Atau lewat psql:**

```sql
CREATE DATABASE dispatch;
```

Opsional, siapkan ekstensi lebih awal:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -d dispatch -c "CREATE EXTENSION IF NOT EXISTS postgis;"
```

## 2. Konfigurasi environment

```powershell
Copy-Item .env.example .env
```

Isi `.env`:

```dotenv
PORT=8080
DATABASE_URL=postgres://postgres:CHANGE_ME@localhost:5432/dispatch?sslmode=disable
JWT_SECRET=CHANGE_ME_TO_A_LONG_RANDOM_SECRET
JWT_TTL=24h
CORS_ORIGIN=http://localhost:5173
OSRM_BASE_URL=https://router.project-osrm.org
DISPATCH_RADIUS_M=50000
SIM_SPEED_MULTIPLIER=20
```

- `DATABASE_URL` — koneksi PostgreSQL lokal (wajib).
- `JWT_SECRET` — minimal 16 karakter; server menolak start jika kosong/terlalu pendek.
- `PORT` — port backend (default `8080`).
- `JWT_TTL` — masa berlaku token (default `24h`).
- `CORS_ORIGIN` — origin frontend yang diizinkan, bisa dipisahkan koma.
- `OSRM_BASE_URL` — base URL OSRM; default publik. Request OSRM dibatasi timeout 5 detik di kode.
- `DISPATCH_RADIUS_M` — radius awal kandidat dari titik insiden dalam meter; default `50000`.
- `SIM_SPEED_MULTIPLIER` — pengali kecepatan simulasi; default `20` (20 detik simulasi per 1 detik nyata).

Frontend memakai `frontend/.env` (opsional):

```powershell
Copy-Item frontend\.env.example frontend\.env
```

```dotenv
VITE_API_BASE_URL=http://localhost:8080
```

> Jika `PORT` atau port Vite `5173` sudah dipakai aplikasi lain, ganti `PORT` (misalnya `8090`) dan sesuaikan `VITE_API_BASE_URL` di `frontend/.env` serta `CORS_ORIGIN`. Jangan menghentikan layanan lain yang tidak terkait.

## 3. Migrasi database

Jalankan dari root proyek:

```powershell
go run ./cmd/migrate
```

Perilaku:

- File SQL di `migrations/` dijalankan berurutan (`001`, `002`, `003`, …).
- Setiap file dicatat di tabel `schema_migrations`, jadi aman dijalankan ulang.
- Setiap migrasi berjalan dalam transaksi.
- `001_enable_postgis.sql` memastikan ekstensi PostGIS aktif.
- `003_add_operating_city.sql` menambahkan `operating_city` tanpa menghapus skema Fase 1.
- Fase 3/4 tidak menambah tabel baru; assignment memakai tabel `assignments` yang sudah ada.

Skema utama:

- `users` — role, `operating_city` nullable, `password_hash` bcrypt.
- `vehicles` — posisi dan home dalam `geometry(Point, 4326)`, status, `operating_city`, `driver_id`.
- `incidents` — titik insiden, prioritas, status, `operating_city`.
- `assignments` — kendaraan, insiden, `assigned_by`, rute, jarak, ETA, progress, status, timestamp.
- Index spasial GiST untuk kendaraan dan insiden.
- Partial unique index `uniq_active_assignment_per_vehicle` untuk status `assigned`/`en_route`.
- Foreign key `assignments.assigned_by → users.id`.

## 4. Seed data demo

```powershell
go run ./cmd/seed
```

Seed idempotent untuk data nasional. Password di-hash dengan **bcrypt**.

### Akun demo

Password semua akun: **`Dispatch123!`**

| Email | Role | Nama | `operating_city` |
| --- | --- | --- | --- |
| `admin@dispatch.local` | admin | Admin Dispatch | `NULL` |
| `dispatcher@dispatch.local` | dispatcher | Dewi Lestari | `NULL` |
| `driver.medan1@dispatch.local` | driver | Rizky Nasution | Medan |
| `driver.medan2@dispatch.local` | driver | Maya Siregar | Medan |
| `driver.jakarta1@dispatch.local` | driver | Andi Wijaya | Jakarta |
| `driver.jakarta2@dispatch.local` | driver | Rina Kartika | Jakarta |
| `driver.bandung1@dispatch.local` | driver | Budi Santoso | Bandung |
| `driver.bandung2@dispatch.local` | driver | Siti Rahayu | Bandung |
| `driver.semarang1@dispatch.local` | driver | Joko Susilo | Semarang |
| `driver.semarang2@dispatch.local` | driver | Nia Puspita | Semarang |
| `driver.surabaya1@dispatch.local` | driver | Hendra Gunawan | Surabaya |
| `driver.surabaya2@dispatch.local` | driver | Lestari Wulandari | Surabaya |
| `driver.makassar1@dispatch.local` | driver | Fajar Ramadhan | Makassar |
| `driver.makassar2@dispatch.local` | driver | Nurul Hasanah | Makassar |

### Kendaraan seed

| Kota | Prefix plat | Ambulance | Fire | Police | Total | Punya driver |
| --- | --- | --- | --- | --- | --- | --- |
| Medan | `BK` | 2 | 2 | 2 | 6 | 2 |
| Jakarta | `B` | 2 | 2 | 2 | 6 | 2 |
| Bandung | `D` | 2 | 2 | 2 | 6 | 2 |
| Semarang | `H` | 2 | 2 | 2 | 6 | 2 |
| Surabaya | `L` | 2 | 2 | 2 | 6 | 2 |
| Makassar | `DD` | 2 | 2 | 2 | 6 | 2 |

- Posisi home tersebar dengan offset deterministik **< 5 km** dari pusat kota.
- Satu ambulans dan satu damkar tiap kota terhubung ke dua driver kota tersebut; empat kendaraan lainnya tanpa driver.
- Semua kendaraan berstatus `available`, dengan `pos_geom = home_geom`.

## 5. Jalankan backend

```powershell
go run ./cmd/server
```

Cek kesehatan:

```powershell
Invoke-RestMethod http://localhost:8080/health
```

## 6. Jalankan frontend

```powershell
cd frontend
npm install
npm run dev
```

Buka `http://localhost:5173`.

- Login menyimpan JWT di `localStorage` (`dispatch.session.v1`).
- Dispatcher diarahkan ke `/map` (tema gelap, peta Indonesia dengan 36 kendaraan).
- Driver diarahkan ke `/driver` (tema terang, layar tugas real-time).
- Admin diarahkan ke `/admin` (tema terang, panel pengelolaan).
- Peta dispatcher memakai tile OpenStreetMap, marker kendaraan, marker insiden berwarna prioritas, form insiden dari klik peta, daftar insiden `open`, detail, pencarian kandidat, tombol assign, dan detail assignment.
- Setelah assign, polyline rute dan posisi kendaraan ikut diperbarui lewat WebSocket.

Build produksi frontend:

```powershell
npm run build
```

## Halaman dan role

| Route | Role yang memakai | Isi |
| --- | --- | --- |
| `/login` | semua | Form login |
| `/map` | dispatcher, admin | Peta operasi, insiden, kandidat, assign, detail assignment |
| `/driver` | driver | Tugas aktif real-time, peta mini, aksi status, riwayat |
| `/admin` | admin | CRUD user dan kendaraan |

Otorisasi sebenarnya tetap ditegakkan backend. Role yang salah mendapat `403`, request tanpa token mendapat `401`.

## Endpoint

| Method | Path | Auth | Keterangan |
| --- | --- | --- | --- |
| `GET` | `/health` | — | Status server + ping database |
| `POST` | `/auth/login` | — | Login email + password; response memuat `operating_city` |
| `GET` | `/vehicles` | Bearer JWT (semua role) | Semua kendaraan, termasuk `operating_city` |
| `GET` | `/vehicles?city=Bandung` | Bearer JWT (semua role) | Filter kendaraan berdasarkan `operating_city` |
| `POST` | `/incidents` | `dispatcher` | Buat insiden; `201` + `{incident}` |
| `GET` | `/incidents` | `dispatcher`/`admin` | Daftar insiden terbaru; filter `?status=` dan `?city=` |
| `GET` | `/incidents/:id` | `dispatcher`/`admin` | Detail insiden; `404` bila tidak ada |
| `POST` | `/incidents/:id/cancel` | `dispatcher` | Batalkan insiden `open`; status lain `409` |
| `GET` | `/incidents/:id/nearest` | `dispatcher`/`admin` | Maksimal 3 kandidat dari OSRM; insiden non-open `409` |
| `POST` | `/incidents/:id/assign` | `dispatcher` | Assign kendaraan; body `{vehicle_id}`; `201` + `{assignment}` |
| `POST` | `/assignments/:id/start` | `driver` pemilik kendaraan | `assigned` → `en_route` |
| `POST` | `/assignments/:id/complete` | driver pemilik, `dispatcher`, `admin` | `arrived` → `completed`; insiden resolved |
| `GET` | `/assignments/mine/active` | `driver` | Assignment aktif driver (`assigned`, `en_route`, `arrived`) atau `null` |
| `GET` | `/assignments/mine/history` | `driver` | Maksimal 20 assignment `completed`/`cancelled`, terbaru dulu |
| `GET` | `/assignments/:id` | `dispatcher`/`admin`; driver pemilik | Detail assignment + insiden + kendaraan |
| `GET` | `/admin/users` | `admin` | Daftar user tanpa `password_hash` |
| `POST` | `/admin/users` | `admin` | Buat user |
| `PUT` | `/admin/users/:id` | `admin` | Ubah nama/role/kota/password |
| `DELETE` | `/admin/users/:id` | `admin` | Hapus user dengan aturan di bawah |
| `GET` | `/admin/vehicles` | `admin` | Daftar kendaraan; filter opsional `?city=` |
| `POST` | `/admin/vehicles` | `admin` | Buat kendaraan |
| `PUT` | `/admin/vehicles/:id` | `admin` | Ubah kendaraan |
| `DELETE` | `/admin/vehicles/:id` | `admin` | Hapus kendaraan dengan aturan di bawah |
| `GET` | `/ws?token=<JWT>` | JWT di query | WebSocket real-time |

Format error standar:

```json
{
  "error": {
    "code": "invalid_credentials",
    "message": "Email atau password salah."
  }
}
```

## Alur assignment

1. Dispatcher membuat insiden. Server menentukan `operating_city` dari kendaraan `available` terdekat dalam radius.
2. Dispatcher memanggil `GET /incidents/:id/nearest` dan memilih kandidat.
3. `POST /incidents/:id/assign` memvalidasi:
   - insiden masih `open` dan punya `operating_city`;
   - kendaraan `available` dan kota sama;
   - identitas JWT valid (fail-closed `401`);
   - OSRM `/route` berhasil.
4. Dalam satu transaksi, server membuat assignment (`assigned`), mengubah kendaraan menjadi `assigned`, dan insiden menjadi `assigned`. Partial unique index mencegah dua assignment aktif untuk kendaraan yang sama; pelanggaran dipetakan ke `409`.
5. Driver menekan **Mulai** → assignment `en_route`, kendaraan `en_route`, insiden `en_route`.
6. Simulator menggerakkan kendaraan setiap detik. Saat progress mencapai jarak rute, assignment menjadi `arrived`, kendaraan `on_scene`, insiden `on_scene`, dan event WebSocket dikirim.
7. Driver menekan **Selesai Ditangani** → assignment `completed`, kendaraan kembali `available` di lokasi insiden, insiden `resolved`.

`assigned_by` selalu diambil dari JWT yang sudah divalidasi middleware. Body request tidak bisa menentukannya.

## Riwayat driver

`GET /assignments/mine/history` mengembalikan maksimal **20** assignment milik kendaraan driver tersebut dengan status `completed` atau `cancelled`, urut `assigned_at` terbaru. Setiap item memuat:

- `incident_title`, `incident_type`, `incident_priority`, `operating_city`
- `assigned_at`, `started_at`, `arrived_at`, `completed_at`
- `response_seconds` — selisih `arrived_at - assigned_at`; `null` bila belum tiba

## WebSocket

Driver membuka:

```
ws://localhost:8080/ws?token=<JWT>
```

- Token divalidasi saat handshake; token tidak valid → `401`.
- Driver **tidak melakukan polling** `/assignments/mine/active`. Data awal dimuat sekali, lalu pembaruan datang lewat WebSocket.
- Jika koneksi putus, frontend mencoba reconnect setiap 3 detik. Setelah reconnect, state aktif/kendaraan/riwayat disegarkan sekali untuk menutup event yang terlewat.
- Event yang dipakai:
  - `assignment_status` — `{assignment, incident, vehicle}` saat assign, start, arrived, completed.
  - `vehicle_position` — `{vehicle_id, assignment_id, lat, lng, progress_pct, eta_remaining_seconds}` setiap tick simulasi.
- Driver memfilter event berdasarkan kendaraan/assignment miliknya.

## Aturan panel admin

### User

- Role hanya `dispatcher`, `driver`, `admin`.
- `driver` wajib punya `operating_city` valid; `admin` selalu `NULL`; dispatcher boleh nasional (`NULL`) atau kota valid.
- Email unik. Duplikat → `409` (`email_duplicate`).
- Password minimal 6 karakter; disimpan sebagai bcrypt.
- Tidak boleh menghapus akun sendiri → `409`.
- Admin terakhir tidak boleh dihapus → `409`.
- Driver yang masih terhubung ke kendaraan tidak boleh dihapus atau diubah role-nya → `409`.
- Driver dengan assignment aktif tidak boleh dihapus → `409`.
- User yang masih dipakai data insiden/assignment tidak bisa dihapus → `409`.

### Kendaraan

- `operating_city` wajib salah satu dari 6 kota kanonik; nilai lain → `400`.
- Plat unik. Duplikat → `409` (`plate_duplicate`).
- Driver opsional, tetapi jika diisi harus role `driver` dan berada di kota yang sama; beda kota → `409`.
- `home_lat`/`home_lng` wajib dan harus dalam radius kasar kota (60 km).
- Status manual hanya `available` atau `offline`; status lain → `400`.
- Assignment aktif (`assigned`, `en_route`, `arrived`) memblokir perubahan driver, kota, home, status, dan penghapusan → `409`.
- Nama, plat, dan tipe masih boleh diubah saat assignment aktif.
- Menghapus kendaraan juga menghapus riwayat assignment non-aktif miliknya secara transaksional agar foreign key tidak menggantung. Assignment aktif selalu diblokir lebih dulu.

## Cara kerja pencarian kandidat terdekat

`GET /incidents/:id/nearest`:

1. Insiden harus ada dan berstatus `open`; selain itu `409`.
2. Ambil radius dari `DISPATCH_RADIUS_M`.
3. Kandidat awal: kendaraan `available` dengan kota yang sama dan `pos_geom` dalam radius (`ST_DWithin(..., geography)`).
4. Jika kosong → `200` dengan `candidates: []` dan `reason: "no_available_vehicle_within_radius"`.
5. Panggil OSRM `/table` (`sources` kendaraan, `destinations` insiden, `annotations=duration,distance`).
6. Jika OSRM error/timeout → `502`; tidak ada fallback jarak garis lurus.
7. Buang hasil `null`/tidak valid, urutkan durasi lalu jarak, ambil 3 teratas.
8. Setiap kandidat memuat `vehicle_id`, `name`, `plate`, `type`, `operating_city`, `driver_name`, `duration_seconds`, `distance_m`, `eta_minutes`, dan `type_match`.

**Tipe kendaraan bukan filter keras.** Semua kendaraan available di kota yang sama ikut diurutkan; `type_match` hanya penanda.

## Struktur proyek

```text
Rescue/
├── cmd/
│   ├── server/        # entrypoint HTTP + simulator + WebSocket hub
│   ├── migrate/       # runner migrasi SQL
│   └── seed/          # seed 6 kota (user + kendaraan, bcrypt)
├── internal/
│   ├── auth/          # JWT manager
│   ├── config/        # env + .env
│   ├── database/      # pool PostgreSQL
│   ├── geo/           # 6 kota kanonik + validasi wilayah
│   ├── handler/       # HTTP handler (auth, insiden, assignment, admin)
│   ├── httpx/         # format error
│   ├── middleware/    # auth, role, CORS
│   ├── model/         # model domain
│   ├── osrm/          # client OSRM /table dan /route
│   ├── repository/    # query SQL
│   ├── router/        # registrasi route + wiring WebSocket
│   ├── simulation/    # ticker pergerakan kendaraan
│   └── ws/            # hub WebSocket
├── migrations/        # SQL berurutan & idempotent
├── frontend/          # React + Vite + TypeScript + Leaflet
│   └── src/
│       ├── api/       # client API
│       ├── auth/      # session localStorage
│       ├── lib/       # utilitas (vehicleMarker.ts)
│       ├── pages/     # Login, Map, Driver, Admin
│       └── cities.ts  # pusat 6 kota + bounds Indonesia
├── .playwright-cli/   # Playwright test artifacts (auto-generated)
├── docs/screenshots/  # Screenshot demo (Playwright output)
├── .env.example
├── AGENT.md
└── README.md
```

## Verifikasi

Backend:

```powershell
gofmt -l .
go vet ./...
go build ./...
```

Frontend:

```powershell
cd frontend
npm run build
npm run lint
```

Tidak boleh ada file Docker:

```powershell
Get-ChildItem -Recurse -Force -Include Dockerfile,docker-compose.yml,docker-compose.yaml
```

## Sengaja belum dibuat (di luar MVP)

- Registrasi publik, lupa password, refresh token, push notification.
- Self-host OSRM atau Docker.
- Multi-dispatcher per kota, penjadwalan shift, dan audit log penuh.
- Filter/export laporan lanjutan dan dashboard analitik.

## Screenshot Portfolio

Screenshot demo tersedia di folder `docs/screenshots/`. Jalankan `npm run test:e2e` (Playwright) untuk menghasilkan screenshot terbaru dari skenario demo Bandung.

## Demo dalam 5 Menit

### Prasyarat
- **PostgreSQL + PostGIS lokal** (diuji PostgreSQL 18). Tidak perlu Docker.
- **Go** 1.26+, **Node.js** 20+ + npm.

### Langkah-langkah

1. **Buat database**
   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -U postgres -h localhost dispatch
   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -d dispatch -c "CREATE EXTENSION IF NOT EXISTS postgis;"
   ```

2. **Konfigurasi environment**
   ```powershell
   Copy-Item .env.example .env
   # Edit .env: isi DATABASE_URL (password PostgreSQL), JWT_SECRET (min 16 char), PORT=8080
   Copy-Item frontend\.env.example frontend\.env
   # Edit frontend/.env: VITE_API_BASE_URL=http://localhost:8080
   ```

3. **Migrasi & seed**
   ```powershell
   go run ./cmd/migrate
   go run ./cmd/seed
   ```

4. **Jalankan backend + frontend** (terminal terpisah)
   ```powershell
   # Terminal 1 - Backend
   go run ./cmd/server
   # Cek: Invoke-RestMethod http://localhost:8080/health

   # Terminal 2 - Frontend
   cd frontend
   npm install
   npm run dev
   ```

5. **Buka http://localhost:5173** dan login dengan akun demo (semua password: `Dispatch123!`):

   | Email | Role | Catatan |
   |-------|------|---------|
   | `admin@dispatch.local` | admin | Panel admin `/admin` |
   | `dispatcher@dispatch.local` | dispatcher | Peta nasional `/map` |
   | `driver.bandung2@dispatch.local` | driver | Layar tugas `/driver` (Siti Rahayu, Damkar Bandung 01) |

### Skenario Demo Bandung (Deterministik)

1. **Login sebagai dispatcher** → buka `/map` (tema gelap, peta Indonesia 36 marker)
2. **Filter kota "Bandung"** di panel armada
3. **Klik peta di sekitar Alun-alun Bandung** (koordinat ~`-6.9218, 107.6071`) → buat insiden:
   - Judul: `Kebakaran Pasar Baru`
   - Jenis: `Damkar` (fire)
   - Prioritas: `High`
   - Klik **Simpan Insiden**
4. **Klik "Cari Kendaraan Terdekat"** → panel menampilkan 3 kandidat (termasuk **Damkar Bandung 01** yang punya driver Siti Rahayu, badge "Sesuai Tipe")
5. **Klik "Assign" pada Damkar Bandung 01** → assignment dibuat, rute OSRM diambil, kendaraan jadi `assigned`, insiden jadi `assigned`
6. **Buka tab baru** → `http://localhost:5173` → login sebagai `driver.bandung2@dispatch.local` (Siti Rahayu) → layar `/driver` menampilkan kartu tugas aktif
7. **Driver klik "Mulai"** → status `en_route`, kendaraan bergerak di peta mini, ETA countdown berjalan
8. **Tunggu hingga simulator mendatangkan kendaraan** (sekitar 30–60 detik real-time dengan `SIM_SPEED_MULTIPLIER=20`) → status jadi `arrived` → `on_scene` (lencana ON SCENE di dispatcher)
9. **Driver klik "Selesai Ditangani"** → assignment `completed`, kendaraan `available` di lokasi insiden, insiden `resolved`
10. **Cek riwayat driver** → tugas baru muncul dengan `response_seconds` terisi

### Reset Data Demo (Idempotent)

Setelah demo, bersihkan data uji sambil mempertahankan seed baseline:

```powershell
go run ./cmd/resetdemo
```

Perintah ini:
- Menghapus **semua insiden dan assignment** (data demo/uji)
- Mengembalikan **seluruh kendaraan** ke `pos_geom = home_geom` + `status = available`
- **Memvalidasi** baseline tetap 14 user / 36 kendaraan (rollback jika tidak sesuai)
- **Tidak menghapus** user/vehicle seed

Hasil akhir database bersih: 36 kendaraan available, 0 insiden, 0 assignment.

## Ringkasan Arsitektur

```mermaid
flowchart LR
    subgraph Client["Client (Browser)"]
        D[Dispatcher /map]
        R[Driver /driver]
        A[Admin /admin]
    end

    subgraph Server["Go/Gin Backend :8080"]
        REST[REST API]
        WS[WebSocket Hub]
        SIM[Simulator 1s tick]
        OSRM[OSRM Client]
    end

    subgraph DB["PostgreSQL + PostGIS"]
        U[(users)]
        V[(vehicles)]
        I[(incidents)]
        AS[(assignments)]
    end

    subgraph Ext["External"]
        OSRM_SVC[OSRM Public<br/>router.project-osrm.org]
        OSM[OpenStreetMap Tiles]
    end

    D <-->|REST + WS| REST
    R <-->|REST + WS| REST
    A <-->|REST| REST

    REST <--> DB
    WS <--> DB
    SIM -->|vehicle_position<br/>assignment_status| WS
    SIM -->|route/position update| V
    OSRM -->|HTTP /table, /route| OSRM_SVC
    D -.->|Leaflet Tiles| OSM
    R -.->|Leaflet Tiles| OSM
```

**Komunikasi:**
- **REST**: CRUD insiden, assignment, admin, auth (JWT Bearer)
- **WebSocket** (`/ws?token=`): real-time `vehicle_position` (tick simulasi) dan `assignment_status` (assign/start/arrived/complete)
- **Simulator**: berjalan di proses backend, menggerakkan kendaraan per detik, mengirim event ke WebSocket hub
- **OSRM Publik**: dipakai untuk `/table` (nearest) dan `/route` (assignment), timeout 5 detik, **tanpa fallback jarak garis lurus**
- **Tile Peta**: OpenStreetMap langsung dari browser (Leaflet)

## Keputusan Desain yang Disengaja

| Keputusan | Alasan |
|-----------|--------|
| **Assign tepat 1 kendaraan dari 3 kandidat** | Dispatcher memilih manual; sistem tidak auto-assign. Menghindari asumsi "terdekat = terbaik" tanpa konteks lapangan. |
| **Satu assignment aktif per kendaraan (partial unique index)** | Ditegakkan di level database (`status IN ('assigned','en_route')`). Mencegah race condition antar dispatcher. |
| **Dispatch selalu satu `operating_city`** | Kendaraan dan insiden harus kota sama. Insiden `operating_city=NULL` tidak punya kandidat. Menghindari assignment lintas kota yang tidak realistis untuk MVP. |
| **Hasil OSRM tak terjangkau dibuang** | Kendaraan tanpa rute OSRM valid tidak masuk kandidat. Tidak ada fallback Euclidean — menghindari ETA palsu. |
| **`type_match` penanda, bukan filter** | Semua tipe kendaraan `available` di kota yang sama ikut diurutkan durasi OSRM. `type_match` hanya badge informasi. Fleksibel untuk skenario lintas tipe (mis. ambulans ke kebakaran kecil). |
| **Tiba terdeteksi otomatis oleh backend (simulator)** | Driver tidak menekan "Tiba". Simulator mengubah `en_route→arrived` saat progress ≥ jarak rute. Menghindari manipulasi/kehilangan klik. |
| **Kendaraan bebas di lokasi insiden setelah selesai** | Setelah `complete`, kendaraan `available` di `pos_geom = lokasi insiden` (bukan kembali ke `home_geom`). Realistis untuk operasi nyata; dispatcher bisa lihat posisi aktual. |
| **OSRM publik untuk MVP** | `https://router.project-osrm.org` gratis, tanpa self-host. Timeout 5 detik, error → `502`. Cocok untuk demo/portfolio. |
| **Tanpa Docker, semua lokal** | PostgreSQL, Go, Vite berjalan langsung di mesin developer. Mudah dijalankan, debug, dan dipahami tanpa lapisan container. |
| **Proyek portofolio yang berjalan lokal** | Bukan sistem produksi. Tidak ada: push notification, GPS asli, registrasi publik, refresh token, multi-dispatcher per kota, shift scheduling, audit log penuh, dashboard analitik. |

---

**Catatan:** Proyek ini adalah MVP portfolio yang dirancang untuk dijalankan **100% lokal** di mesin developer. Semua dependensi eksternal hanya OSRM publik dan tile OpenStreetMap. Tidak ada infrastruktur cloud, Docker, atau layanan tertutup yang diperlukan.
