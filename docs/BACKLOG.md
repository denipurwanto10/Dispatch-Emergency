# Backlog Dispatch

Daftar ini adalah backlog prioritas untuk pengembangan setelah MVP. Item 1 (state machine) sudah diimplementasikan; item lain belum. Urutan prioritas dapat berubah setelah diskusi dengan pemilik proyek.

Legenda prioritas:

- **P0** — fondasi keamanan/reliability; sebaiknya dikerjakan sebelum menyebut sistem siap produksi.
- **P1** — penting untuk operasi dan observability; dikerjakan setelah P0.
- **P2** — peningkatan kualitas/dokumentasi; bisa paralel atau menyusul.

## Ringkasan prioritas

| # | Item | Prioritas | Dampak utama |
| --- | --- | --- | --- |
| 1 | State machine eksplisit insiden & assignment (selesai) | P0 | Mencegah transisi ilegal dan inkonsistensi status. |
| 2 | Audit logging event domain | P0 | Akuntabilitas dan investigasi insiden. |
| 3 | Timeout & auto-reassignment | P0 | Mencegah assignment menggantung. |
| 4 | Crash recovery | P0 | Memulihkan state setelah restart. |
| 5 | Rate limiting endpoint sensitif | P0 | Mengurangi brute force/abuse. |
| 6 | Metrik & monitoring | P1 | Deteksi masalah sebelum pengguna melapor. |
| 7 | OpenAPI/Swagger | P1 | Kontrak API yang dapat diverifikasi. |
| 8 | Unit/integration/e2e test | P1 | Mencegah regresi. |
| 9 | Lint/format/test otomatis di CI | P1 | Menjaga kualitas baseline. |
| 10 | Hardening kecil lain | P2 | Perbaikan bertahap. |

## 1. State machine eksplisit untuk siklus hidup insiden dan assignment

**Prioritas:** P0

**Status:** Selesai di `internal/state`. Transisi dipakai handler, repository, dan simulator; unit test mencakup seluruh pasangan status legal/ilegal. Endpoint cancel/reject assignment belum ditambahkan.

**Masalah:** Transisi status saat ini dijaga tersebar di handler, repository, dan simulator. Beberapa aturan (mis. `arrived` dianggap aktif, `cancelled` assignment belum punya endpoint) hanya ada di kode/dokumen, bukan satu kontrak yang dapat diuji.

**Usulan:**

- Definisikan transisi legal untuk `incidents` dan `assignments` dalam satu paket domain (mis. `internal/domain/state`), tanpa mengubah nama status/tabel.
- Validasi transisi sebelum update; kembalikan `409` dengan kode error yang konsisten.
- Tambahkan endpoint eksplisit untuk cancel assignment bila diperlukan, dengan aturan kompensasi kendaraan/insiden.
- Pastikan simulator memakai aturan transisi yang sama.

**Acceptance criteria:**

- Tabel transisi terdokumentasi dan punya unit test untuk setiap transisi legal/ilegal.
- Tidak ada update status langsung yang melewati validator.
- Perilaku endpoint yang sudah ada tidak berubah selain penanganan transisi ilegal yang lebih konsisten.

**Risiko:** Perubahan semantik state; butuh persetujuan pemilik proyek.

## 2. Audit logging event domain

**Prioritas:** P0

**Masalah:** Belum ada jejak siapa melakukan apa dan kapan selain `assigned_by`/timestamp. Sulit menginvestigasi assignment ganda, perubahan status manual, atau penghapusan data admin.

**Usulan:**

- Tabel `domain_events` (append-only) berisi `event_type`, `entity_type`, `entity_id`, `actor_id`, `payload` JSONB, `created_at`.
- Catat event: incident created/cancelled/resolved, assignment created/started/arrived/completed/cancelled, admin user/vehicle create/update/delete, login gagal/berhasil (tanpa password/token).
- Tulis event dalam transaksi yang sama dengan perubahan state bila memungkinkan.
- Endpoint admin read-only untuk melihat audit trail (opsional, fase berikutnya).

**Acceptance criteria:**

- Event penting tercatat atomik dengan perubahan state.
- Tidak ada secret/token/password di payload.
- Ada test bahwa kegagalan insert audit menggagalkan transaksi bisnis (fail-closed) atau strategi outbox yang disepakati.

## 3. Metrik dan monitoring

**Prioritas:** P1

**Masalah:** Logging teks ke stdout belum cukup untuk melihat latency, error rate, queue WebSocket, atau jumlah assignment aktif.

**Usulan:**

- Tambahkan endpoint `/metrics` (Prometheus) dengan metrik:
  - HTTP request count/duration per route/status.
  - Error rate OSRM (`/table`, `/route`) dan latency.
  - Jumlah assignment per status, umur assignment aktif.
  - WebSocket connections, event dropped, reconnect.
  - Simulator tick duration/error.
- Tambahkan health check detail (DB ping, OSRM reachability opsional) tanpa membocorkan kredensial.
- Dokumentasikan alert dasar (mis. OSRM error > 5% selama 5 menit, assignment aktif > 15 menit).

**Acceptance criteria:**

- Metrik dapat di-scrape dan punya dokumentasi nama/label.
- Tidak ada label berisi data pribadi/token.
- Health endpoint tetap kompatibel dengan `GET /health` yang ada.

**Catatan:** Menambah Prometheus client adalah dependensi baru; butuh persetujuan.

## 4. Timeout dan auto-reassignment

**Prioritas:** P0

**Masalah:** Assignment yang tidak dimulai/diikuti driver dapat menggantung tanpa batas. Tidak ada aturan kapan dispatcher boleh reassign.

**Usulan:**

- Definisikan timeout per tahap: `assigned → en_route` (mis. 2 menit) dan `en_route` yang tidak bergerak (mis. 10 menit).
- Simulator/worker periodik menandai assignment `expired`/`cancelled` atau mengembalikan kendaraan ke `available`.
- Bila insiden masih `open`/`assigned`, izinkan reassign ke kandidat lain dengan audit event.
- Konfigurasi lewat env (mis. `ASSIGNMENT_START_TIMEOUT`, `ASSIGNMENT_STALE_TIMEOUT`), bukan hardcode.

**Acceptance criteria:**

- Timeout tidak menghapus riwayat assignment; status dan alasan tercatat.
- Kendaraan tidak bisa memiliki dua assignment aktif.
- Ada test untuk timeout, reassign, dan race dengan driver yang baru mulai.

**Risiko:** Perubahan state machine; koordinasikan dengan item 1.

## 5. Crash recovery

**Prioritas:** P0

**Masalah:** Setelah proses backend restart, assignment `en_route` tetap ada di DB tetapi posisi/progress bisa tidak konsisten. Simulator tidak melakukan rekonsiliasi saat start.

**Usulan:**

- Saat startup, lakukan rekonsiliasi:
  - Assignment `en_route` dengan `route_geom` valid → lanjutkan simulasi dari `progress_m`.
  - Assignment `arrived` → pastikan kendaraan `on_scene` dan insiden `on_scene`.
  - Assignment `assigned` yang sudah melewati timeout → tandai untuk reassign/cancel.
- Tambahkan lock/lease agar hanya satu instance simulator memproses satu assignment (bila nanti multi-instance).
- Dokumentasikan prosedur recovery manual.

**Acceptance criteria:**

- Restart di tengah simulasi tidak membuat kendaraan "hilang" atau assignment ganda.
- Ada integration test dengan DB yang direstart/disimulasikan.

## 6. Rate limiting endpoint sensitif

**Prioritas:** P0

**Masalah:** `/auth/login`, assign, dan endpoint admin dapat di-abuse tanpa batas.

**Usulan:**

- Middleware rate limit per IP + per akun untuk `/auth/login` (mis. 5 percobaan/menit, backoff).
- Limit terpisah untuk operasi tulis (`POST/PUT/DELETE`) dan WebSocket handshake.
- Kembalikan `429` dengan format error standar dan header `Retry-After`.
- Konfigurasi lewat env; jangan menyimpan state di memori tanpa batas (pertimbangkan Redis hanya bila disetujui).

**Acceptance criteria:**

- Login brute force dibatasi tanpa mengunci akun permanen.
- Ada test untuk limit dan reset window.
- Tidak ada bypass lewat header `X-Forwarded-For` tanpa trust proxy yang benar.

## 7. Dokumentasi OpenAPI/Swagger

**Prioritas:** P1

**Masalah:** Kontrak API hanya ada di README/AGENT; rawan drift dari kode.

**Usulan:**

- Tulis `openapi.yaml` (OpenAPI 3.1) untuk seluruh endpoint yang ada, termasuk skema error dan WebSocket event (via `description`/`x-websocket`).
- Sajikan Swagger UI opsional di development saja.
- Tambahkan test validasi spec terhadap route (mis. cek semua route terdaftar).

**Acceptance criteria:**

- Semua endpoint di `internal/router` terdokumentasi.
- Contoh request/response tidak memuat secret.
- Spec dapat divalidasi otomatis di CI.

## 8. Unit, integration, dan e2e test

**Prioritas:** P1

**Masalah:** Saat ini hanya ada smoke test JWT; belum ada test untuk assignment, OSRM, simulator, atau frontend.

**Usulan:**

- **Unit:** state machine, validasi handler, format error, JWT, geo/radius, parsing OSRM.
- **Integration:** repository dengan PostgreSQL/PostGIS test lokal (tanpa Docker sesuai aturan proyek); transaksi assign, constraint unik, cancel, complete.
- **E2E:** alur dispatcher create → nearest → assign → driver start → arrive → complete, memakai OSRM stub/fake agar deterministik.
- **Frontend:** pertimbangkan Vitest + React Testing Library (dependensi baru; butuh persetujuan) untuk komponen kritis dan normalisasi payload assignment.

**Acceptance criteria:**

- Test tidak bergantung pada OSRM publik.
- Test integration memakai database terpisah dan membersihkan data.
- CI menjalankan test yang tidak membutuhkan layanan eksternal.

## 9. Linting dan formatting otomatis di CI

**Prioritas:** P1

**Masalah:** Verifikasi masih manual; `npm run lint` hanya warning dan build bisa gagal karena import tak terpakai.

**Usulan:**

- Workflow GitHub Actions:
  - Backend: `gofmt -l .`, `go vet ./...`, `go test ./...`, `go build ./...`.
  - Frontend: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build`.
- Tambahkan cache Go/npm.
- Jadikan `gofmt` dan error TypeScript sebagai gate; warning oxlint dapat dijadikan gate bertahap setelah dibersihkan.
- Tambahkan `.editorconfig` (sudah ada) dan dokumentasikan perintah lokal.

**Acceptance criteria:**

- PR gagal jika format/test/build gagal.
- Tidak ada secret di workflow.
- Waktu CI wajar (< 10 menit) dan tidak membutuhkan PostgreSQL/OSRM untuk job dasar.

## 10. Hardening kecil lain (P2)

- Hapus atau implementasikan `fetchAdminAssignments` yang mengarah ke `/admin/assignments` yang belum ada.
- Ganti interpolasi linear simulator dengan interpolasi sepanjang `route_geom` (LineString) agar posisi mengikuti jalan.
- Optimalkan persist `progress_m`/posisi (batch/interval, bukan setiap tick) dan hapus query no-op `SET progress_m = progress_m`.
- Tambahkan pagination pada daftar insiden/assignment bila data bertambah.
- Tambahkan WebSocket room per kota/role untuk mengurangi broadcast global.
- Tambahkan dukungan `If-None-Match`/cache untuk dataset GeoJSON statis.
- Tambahkan dokumentasi troubleshooting OSRM/tile dan prosedur rotasi `JWT_SECRET`.
- Tinjau ulang aturan `arrived` di partial unique index vs kebijakan aplikasi.
- Tambahkan lisensi setelah pemilik proyek memilihnya (lihat TODO di README).
