# Security Policy

## Status dukungan

Dispatch adalah **MVP portofolio** yang dirancang berjalan lokal. Belum ada dukungan keamanan formal, SLA, atau jaminan untuk penggunaan produksi.

| Versi | Dukungan |
| --- | --- |
| `main` (MVP) | Perbaikan terbaik usaha; tidak ada jaminan. |

## Melaporkan kerentanan

**Jangan membuka issue publik untuk kerentanan keamanan.**

Gunakan salah satu jalur privat berikut:

- GitHub Security Advisories (jika diaktifkan untuk repo ini), atau
- Hubungi pemilik repo secara privat. **TODO:** isi kontak keamanan resmi di sini.

Sertakan:

- Deskripsi kerentanan dan dampaknya.
- Langkah reproduksi yang minimal.
- Versi/commit yang terdampak.
- Saran mitigasi bila ada.

Kami akan berusaha merespons dalam waktu wajar, tetapi tidak ada SLA. Mohon beri waktu sebelum melakukan pengungkapan publik.

## Ruang lingkup

Contoh area yang relevan:

- Autentikasi JWT, manajemen sesi, dan otorisasi role.
- Kebocoran secret (`.env`, token, password) atau data pribadi.
- Injeksi SQL/command, SSRF, path traversal.
- CORS dan konfigurasi endpoint.
- Assignment lintas kota atau bypass aturan `operating_city`.
- Akses tidak sah ke endpoint admin atau assignment milik driver lain.
- Denial of service yang mudah dilakukan (mis. brute force login tanpa batas).

## Praktik yang sudah ada

- Password disimpan sebagai bcrypt; `password_hash` tidak dikembalikan API.
- JWT HS256; `JWT_SECRET` wajib minimal 16 karakter dan tidak boleh di-commit.
- `assigned_by` diambil dari JWT tervalidasi, bukan body request.
- Role dan endpoint admin dilindungi middleware.
- Format error tidak membocorkan detail internal.
- `.env` dan `frontend/.env` di-ignore oleh Git.
- OSRM dan tile peta adalah layanan eksternal; jangan mengirim data sensitif ke sana.

## Keterbatasan keamanan yang diketahui

- Belum ada rate limiting pada `/auth/login` dan endpoint sensitif lain.
- Belum ada refresh token/revocation; token berlaku sampai `exp`.
- Belum ada audit log keamanan yang lengkap.
- Belum ada hardening produksi (TLS termination, secret manager, WAF, monitoring).
- WebSocket memakai token di query string; pastikan tidak tercatat di log/proxy.
- Basemap memakai tile Google publik tidak resmi; bukan untuk produksi.

Backlog perbaikan keamanan ada di [`docs/BACKLOG.md`](docs/BACKLOG.md).
