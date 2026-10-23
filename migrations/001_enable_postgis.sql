-- 001_enable_postgis.sql
-- Pastikan ekstensi PostGIS aktif. Butuh user PostgreSQL dengan hak superuser
-- pada saat migrasi pertama (PostGIS biasanya hanya bisa dibuat superuser).

CREATE EXTENSION IF NOT EXISTS postgis;
