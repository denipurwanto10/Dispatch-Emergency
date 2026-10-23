-- 003_add_operating_city.sql
-- Fase 1.5: cakupan nasional. Migrasi ini hanya menambah kolom/index dan
-- membackfill data demo lama; tidak menghapus tabel atau kolom Fase 1.

ALTER TABLE users ADD COLUMN IF NOT EXISTS operating_city TEXT NULL;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS operating_city TEXT NULL;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS operating_city TEXT NULL;

-- Backfill data demo Fase 1 (Bandung) agar tetap terbaca setelah kolom baru ada.
UPDATE users
SET operating_city = 'Bandung'
WHERE operating_city IS NULL
  AND email IN (
    'admin@dispatch.local',
    'dispatcher@dispatch.local',
    'driver1@dispatch.local',
    'driver2@dispatch.local',
    'driver3@dispatch.local'
  );

UPDATE vehicles
SET operating_city = 'Bandung'
WHERE operating_city IS NULL
  AND plate IN (
    'D 9001 AM',
    'D 9002 PM',
    'D 9003 PL',
    'D 9004 AM',
    'D 9005 PM',
    'D 9006 PL'
  );

CREATE INDEX IF NOT EXISTS idx_vehicles_operating_city ON vehicles (operating_city);
CREATE INDEX IF NOT EXISTS idx_incidents_operating_city ON incidents (operating_city);

-- Pastikan index spasial tetap ada. Nama index sama dengan Fase 1, sehingga
-- pernyataan ini menjadi no-op bila index sudah dibuat.
CREATE INDEX IF NOT EXISTS idx_vehicles_pos_geom ON vehicles USING GIST (pos_geom);
CREATE INDEX IF NOT EXISTS idx_incidents_geom ON incidents USING GIST (geom);
