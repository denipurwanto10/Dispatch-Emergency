# Pull Request

## Ringkasan

Jelaskan perubahan dan alasannya.

## Jenis perubahan

- [ ] Bug fix
- [ ] Fitur baru
- [ ] Refactor
- [ ] Dokumentasi
- [ ] Test/CI
- [ ] Perubahan database/migrasi

## Perubahan utama

-
-

## Cara menguji

Tuliskan langkah manual atau perintah yang dipakai.

```powershell
# Backend
gofmt -l .
go vet ./...
go test ./...
go build ./...

# Frontend
cd frontend
npm run lint
npm run typecheck
npm run build
```

## Hasil verifikasi

Tempelkan ringkasan hasil (lulus/gagal + alasan). Jangan menyertakan secret.

## Risiko dan rollback

Apakah ada perubahan skema/API/state machine? Bagaimana cara rollback?

## Checklist

- [ ] Perubahan terfokus dan tidak menghapus fitur yang berjalan.
- [ ] Tidak ada `.env`, secret, token, atau password.
- [ ] Migrasi baru (jika ada) additive, idempotent, dan tidak mengubah migrasi lama.
- [ ] Dokumentasi diperbarui (`README.md`, `AGENT.md`, `docs/`).
- [ ] `frontend/src/types.ts` diperbarui bila kontrak API/WebSocket berubah.
- [ ] Test ditambahkan/diperbarui untuk perubahan perilaku.
- [ ] Tidak menambah dependensi besar tanpa persetujuan.
- [ ] Tidak membuat Dockerfile/docker-compose.

## Catatan untuk reviewer

Area yang perlu perhatian khusus, keputusan desain, atau pertanyaan terbuka.
