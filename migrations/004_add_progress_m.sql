-- 004_add_progress_m.sql
-- Menambah kolom progress_m ke tabel assignments untuk simulasi pergerakan.
-- Dijalankan setelah 003_add_operating_city.sql.

ALTER TABLE IF EXISTS assignments
    ADD COLUMN IF NOT EXISTS progress_m DOUBLE PRECISION NOT NULL DEFAULT 0;