# AGENTS.md — Panduan Kerja Agen

Dokumen ini adalah panduan singkat dan actionable untuk agen/engineer yang mengubah repo Dispatch. Kontrak domain yang lebih detail ada di [`AGENT.md`](AGENT.md); arsitektur ada di [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); backlog ada di [`docs/BACKLOG.md`](docs/BACKLOG.md).

## Ringkasan repo

Dispatch adalah MVP command center respons darurat yang berjalan **100% lokal tanpa Docker**:

- Backend Go + Gin di `cmd/server`, dengan PostgreSQL/PostGIS dan integrasi OSRM publik.
- Frontend React 19 + Vite + TypeScript + Leaflet di `frontend/`.
- Database dimigrasikan lewat `cmd/migrate`, di-seed lewat `cmd/seed`, dan di-reset lewat `cmd/resetdemo`.
- Real-time memakai WebSocket `/ws`; simulator kendaraan berjalan di proses backend.

## Perintah utama

Jalankan perintah backend dari **root repo** dan perintah frontend dari **`frontend/`**.

### Backend

| Tujuan | Perintah |
| --- | --- |
| Migrasi database | `go run ./cmd/migrate` |
| Seed data demo | `go run ./cmd/seed` |
| Reset data demo | `go run ./cmd/resetdemo` |
| Jalankan server | `go run ./cmd/server` |
| Test | `go test ./...` |
| Test smoke auth | `go test ./internal/auth -v` |
| Vet | `go vet ./...` |
| Build | `go build ./...` |
| Cek format | `gofmt -l .` (harus kosong) |
| Rapikan format | `gofmt -w .` |

Server default: `http://localhost:8080`; cek `GET /health`.

### Frontend

| Tujuan | Perintah |
| --- | --- |
| Install dependensi | `npm install` |
| Jalankan dev server | `npm run dev` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Build produksi | `npm run build` |
| Preview build | `npm run preview` |

Belum ada test runner frontend (Vitest/RTL belum dipasang). Jangan mengarang perintah `npm test`; smoke test kritis saat ini ada di backend (`internal/auth/jwt_test.go`). Penambahan test frontend masuk backlog dan butuh persetujuan karena menambah dependensi.

## Urutan verifikasi sebelum selesai

1. `gofmt -l .` — harus tidak menghasilkan output.
2. `go vet ./...` — harus lolos.
3. `go test ./...` — harus lolos.
4. `go build ./...` — harus lolos.
5. `cd frontend`
6. `npm run lint` — boleh ada warning lama, tetapi jangan menambah warning/error baru.
7. `npm run typecheck` — harus lolos.
8. `npm run build` — harus lolos.
9. Jika database tersedia: `go run ./cmd/migrate`, `go run ./cmd/seed`, `go run ./cmd/server`, lalu cek `GET /health` dan satu alur login.
10. Jika perubahan menyentuh API/WebSocket: perbarui `README.md`, `AGENT.md`, `frontend/src/types.ts`, dan `docs/ARCHITECTURE.md` bila relevan.

Jangan menyatakan selesai jika salah satu perintah gagal. Jelaskan kegagalan, penyebab, dan apakah kegagalan sudah ada sebelum perubahan.

## Struktur direktori dan tanggung jawab

```text
cmd/
  server/        entrypoint HTTP, lifecycle server, simulator
  migrate/       runner migrasi SQL berurutan + schema_migrations
  seed/          seed 6 kota, user, kendaraan (bcrypt)
  resetdemo/     reset data demo ke baseline seed
internal/
  auth/          JWT HS256 (generate/parse)
  config/        env + .env lokal
  database/      pool PostgreSQL (pgx stdlib)
  geo/           daftar 6 kota kanonik + validasi radius
  handler/       HTTP handler (auth, insiden, assignment, admin, health)
  httpx/         format error standar
  middleware/    auth, role, CORS
  model/         model domain + JSON tags
  osrm/          client OSRM /table dan /route (timeout 5 detik)
  repository/    query SQL
  router/        registrasi route + wiring WebSocket/simulator
  simulation/    ticker pergerakan kendaraan
  ws/            hub WebSocket
migrations/      SQL additive, idempotent, berurutan (001, 002, ...)
frontend/
  src/api/       client REST
  src/auth/      session localStorage
  src/components/ komponen UI bersama
  src/context/   ThemeContext
  src/lib/       basemap, marker, region, route line
  src/pages/     Login, Map, Driver, Admin
  public/geo/    GeoJSON GADM statis
docs/            arsitektur, backlog, screenshot
```

## Konvensi kode yang sudah ada

### Backend

- Alur `handler → repository`; jangan menambah service layer kecuali benar-benar perlu.
- Format error wajib lewat `internal/httpx`: `{"error":{"code":"...","message":"..."}}`.
- Pesan error/user-facing dalam bahasa Indonesia; kode error dalam `snake_case`.
- Semua konfigurasi dari env; jangan hardcode port, radius, URL OSRM, atau multiplier simulasi.
- Password hanya bcrypt; `password_hash` tidak boleh keluar di JSON.
- `assigned_by` selalu dari `middleware.ContextUserID` (JWT tervalidasi), **tidak pernah** dari body.
- Transaksi database untuk operasi multi-tabel (mis. assign); rollback semua bila satu langkah gagal.
- Tangkap pelanggaran unique constraint assignment aktif dan petakan ke `409`, bukan `500`.
- Gunakan `context` request untuk query; jangan ganti ke `context.Background()` di jalur request.
- Log error dengan konteks yang cukup, tanpa membocorkan secret/token/password.

### Database

- Migrasi SQL polos di `migrations/`, berurutan, idempotent, dicatat di `schema_migrations`.
- **Jangan mengubah migrasi lama** yang mungkin sudah diterapkan; buat file baru.
- SRID 4326. Koordinat API diturunkan dengan `ST_Y(geom)` (lat) dan `ST_X(geom)` (lng).
- Index spasial GiST untuk `vehicles.pos_geom` dan `incidents.geom`.
- Partial unique index `uniq_active_assignment_per_vehicle` mengunci `assigned`/`en_route`; aturan `arrived` adalah kebijakan aplikasi.
- Jangan mengganti nama tabel/kolom/endpoint publik tanpa alasan kuat dan persetujuan.

### Frontend

- React function components + TypeScript; Leaflet dipakai langsung (bukan react-leaflet).
- API base dari `VITE_API_BASE_URL` (default `http://localhost:8080`).
- JWT disimpan di `localStorage` (`dispatch.session.v1`); tema di `tanggap.theme`.
- Jangan menambahkan data mock/hardcoded untuk kendaraan, insiden, assignment, atau peta.
- Driver tidak polling assignment aktif; update lewat WebSocket, reconnect 3 detik, refresh sekali setelah reconnect.
- Jangan membuat instance Leaflet ganda; gunakan callback ref container.
- Pertahankan gaya flat, tema terang/gelap, aksesibilitas keyboard/ARIA, dan target sentuh minimal 40 px.

## Dependensi eksternal dan environment

- **PostgreSQL + PostGIS** lokal; ekstensi `postgis` harus tersedia. Tidak ada Docker.
- **OSRM publik** default `https://router.project-osrm.org`; timeout 5 detik; error → `502`; tidak ada fallback jarak garis lurus.
- **Tile peta** Google publik tanpa API key, fallback otomatis ke OpenStreetMap.
- Env backend: `PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_TTL`, `CORS_ORIGIN`, `OSRM_BASE_URL`, `DISPATCH_RADIUS_M`, `SIM_SPEED_MULTIPLIER`, opsional `MIGRATIONS_DIR`.
- Env frontend: `VITE_API_BASE_URL`.
- Contoh nilai ada di `.env.example` dan `frontend/.env.example`; **jangan menyalin nilai secret asli ke dokumen, log, issue, atau commit**.

## Larangan

- **Jangan commit `.env`, `frontend/.env`, token, password, atau secret apa pun.** File itu sudah di-ignore; jangan hapus aturan ignore.
- **Jangan mengubah migrasi lama** tanpa alasan kuat; tambahkan migrasi baru.
- **Jangan menambah dependensi besar** (framework, ORM, queue, test runner, observability stack) tanpa persetujuan pengguna.
- **Jangan membuat Dockerfile/docker-compose** atau instruksi berbasis container.
- **Jangan menghapus fitur** yang sudah berjalan atau menurunkan kualitas UI/aksesibilitas.
- **Jangan mengganti nama endpoint publik, nama tabel, atau skema database** tanpa alasan kuat.
- **Jangan melakukan assignment lintas kota** atau menjadikan kendaraan kota lain sebagai kandidat.
- **Jangan menerima `assigned_by`/`operating_city` dari body client.**
- **Jangan menambah polling** di layar driver.
- **Jangan menulis test yang menguji mock** atau menambah method khusus test ke kode produksi.
- Jangan menyentuh perubahan working tree yang tidak terkait; periksa `git status` dan `git diff` lebih dulu.

## Berhenti dan tanya jika...

Hentikan pekerjaan dan minta keputusan pengguna bila menghadapi salah satu hal berikut:

- Perubahan skema yang **breaking** (rename/hapus tabel/kolom, ubah tipe, ubah constraint lama).
- Perubahan kontrak API/WebSocket yang memengaruhi client lain, atau rename endpoint publik.
- Perubahan semantik state machine assignment/insiden (mis. menambah status, auto-assign, auto-cancel).
- Penambahan service layer, message queue, cache, auth provider, atau infrastruktur baru.
- Penambahan dependensi besar atau tool baru di CI.
- Perubahan cara deployment, hosting, atau keputusan pindah dari OSRM publik.
- Penghapusan fitur atau data seed.
- Konflik dengan perubahan pengguna yang belum di-commit dan tidak jelas tujuannya.

Sertakan ringkasan opsi, dampak, dan rekomendasi sebelum meminta keputusan.

## Definition of done

- Perubahan kecil, terfokus, mengikuti pola yang ada.
- Semua perintah verifikasi di atas lolos (atau kegagalan dijelaskan dengan jujur).
- Dokumentasi yang terdampak diperbarui (`README.md`, `AGENT.md`, `docs/`).
- Tidak ada secret, `.env`, artefak build, atau file sementara yang ikut ter-commit.
- Ringkasan akhir memuat: audit singkat, file dibuat/diubah, perintah + hasil, asumsi, dan rekomendasi berikutnya.
