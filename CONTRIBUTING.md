# Contributing ke Dispatch

Terima kasih sudah tertarik berkontribusi. Repo ini adalah MVP portofolio yang berjalan **100% lokal tanpa Docker**. Baca [`AGENTS.md`](AGENTS.md) dan [`AGENT.md`](AGENT.md) sebelum mengubah kode.

## Prasyarat

- Go 1.26+ (lihat `go.mod`).
- Node.js 20+ dan npm.
- PostgreSQL + PostGIS lokal yang berjalan.
- Tidak perlu Docker.

## Setup lokal

```powershell
Copy-Item .env.example .env
# Isi DATABASE_URL dan JWT_SECRET (minimal 16 karakter) di .env.
# Jangan commit .env.

go run ./cmd/migrate
go run ./cmd/seed
go run ./cmd/server

# Terminal lain
cd frontend
Copy-Item .env.example .env
# VITE_API_BASE_URL=http://localhost:8080
npm install
npm run dev
```

Detail lengkap ada di [`README.md`](README.md).

## Alur kontribusi

1. Buat branch dari `main` dengan nama yang deskriptif, mis. `fix/assignment-timeout` atau `docs/architecture`.
2. Buat perubahan kecil dan terfokus; hindari refactor besar yang tidak terkait.
3. Periksa `git status` dan `git diff` sebelum commit. Jangan menyentuh perubahan orang lain yang belum di-commit.
4. Jalankan verifikasi di bawah.
5. Buka pull request dengan template yang tersedia.

## Konvensi commit

Gunakan [Conventional Commits](https://www.conventionalcommits.org/) seperti riwayat repo:

```text
feat(map): tambah filter kota
fix(driver): tangani assignment null
docs: perbarui endpoint assignment
test(auth): tambah smoke test JWT
chore(ci): tambah workflow verifikasi
```

Tulis pesan dalam bahasa Indonesia atau Inggris yang jelas; jelaskan **mengapa**, bukan hanya **apa**.

## Verifikasi wajib

Backend (dari root):

```powershell
gofmt -l .          # harus kosong
go vet ./...
go test ./...
go build ./...
```

Frontend (dari `frontend/`):

```powershell
npm run lint
npm run typecheck
npm run build
```

Jika database tersedia, jalankan juga migrasi/seed/server dan cek `GET /health` serta satu alur login. Jika salah satu perintah gagal, jelaskan penyebabnya di PR.

## Aturan penting

- **Jangan commit secret.** `.env`, `frontend/.env`, token, password, dan kredensial tidak boleh masuk repo.
- **Jangan mengubah migrasi lama** yang sudah diterapkan; buat file baru di `migrations/` dengan nomor berikutnya.
- **Jangan menambah dependensi besar** (framework, ORM, queue, test runner, observability stack) tanpa diskusi terlebih dahulu.
- **Jangan membuat Dockerfile/docker-compose** atau instruksi container.
- **Jangan mengganti nama endpoint publik, tabel, atau kolom** tanpa alasan kuat dan persetujuan.
- Pertahankan format error standar, bahasa pesan, pola `handler → repository`, dan gaya UI yang ada.
- Sertakan dokumentasi/test untuk perubahan perilaku.

## Pull request checklist

- [ ] Perubahan terfokus dan tidak menghapus fitur yang berjalan.
- [ ] `gofmt -l .` kosong, `go vet ./...`, `go test ./...`, `go build ./...` lolos.
- [ ] `npm run lint`, `npm run typecheck`, `npm run build` lolos.
- [ ] Tidak ada `.env`, secret, artefak build, atau file sementara.
- [ ] Migrasi baru (jika ada) additive dan idempotent.
- [ ] Dokumentasi diperbarui (`README.md`, `AGENT.md`, `docs/`).
- [ ] Perubahan API/WebSocket memperbarui `frontend/src/types.ts` dan dokumentasi terkait.

## Pertanyaan

Untuk keputusan arsitektur besar (skema breaking, state machine, auth, deployment, dependensi baru), buka diskusi terlebih dahulu. Lihat bagian "Berhenti dan tanya" di [`AGENTS.md`](AGENTS.md).
