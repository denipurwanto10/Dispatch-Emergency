-- 002_core_schema.sql
-- Skema inti Dispatch Fase 1: users, vehicles, incidents, assignments.
-- Semua pernyataan idempotent agar aman dijalankan ulang.

CREATE TABLE IF NOT EXISTS users (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    role          TEXT        NOT NULL CHECK (role IN ('dispatcher', 'driver', 'admin')),
    name          TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicles (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name           TEXT        NOT NULL,
    plate          TEXT        NOT NULL UNIQUE,
    type           TEXT        NOT NULL CHECK (type IN ('ambulance', 'fire', 'police')),
    driver_id      BIGINT      NULL REFERENCES users (id) ON DELETE SET NULL,
    pos_geom       geometry(Point, 4326) NOT NULL,
    home_geom      geometry(Point, 4326) NOT NULL,
    status         TEXT        NOT NULL DEFAULT 'available'
                   CHECK (status IN ('available', 'assigned', 'en_route', 'on_scene', 'offline')),
    pos_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incidents (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    geom        geometry(Point, 4326) NOT NULL,
    title       TEXT        NOT NULL,
    description TEXT        NULL,
    type        TEXT        NOT NULL,
    priority    TEXT        NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status      TEXT        NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'assigned', 'en_route', 'on_scene', 'resolved', 'cancelled')),
    created_by  BIGINT      NOT NULL REFERENCES users (id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS assignments (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    incident_id  BIGINT      NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
    vehicle_id   BIGINT      NOT NULL REFERENCES vehicles (id),
    assigned_by  BIGINT      NOT NULL REFERENCES users (id),
    route_geom   geometry(LineString, 4326) NULL,
    distance_m   DOUBLE PRECISION NULL,
    eta_seconds  INTEGER      NULL,
    status       TEXT         NOT NULL DEFAULT 'assigned'
                 CHECK (status IN ('assigned', 'en_route', 'arrived', 'completed', 'cancelled')),
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at   TIMESTAMPTZ NULL,
    arrived_at   TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_vehicles_pos_geom ON vehicles USING GIST (pos_geom);
CREATE INDEX IF NOT EXISTS idx_vehicles_home_geom ON vehicles USING GIST (home_geom);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles (status);
CREATE INDEX IF NOT EXISTS idx_incidents_geom ON incidents USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents (status);
CREATE INDEX IF NOT EXISTS idx_assignments_incident_id ON assignments (incident_id);
CREATE INDEX IF NOT EXISTS idx_assignments_vehicle_id ON assignments (vehicle_id);

-- Satu kendaraan hanya boleh memiliki SATU assignment aktif.
-- Assignment dianggap aktif saat status 'assigned' atau 'en_route'.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_assignment_per_vehicle
    ON assignments (vehicle_id)
    WHERE status IN ('assigned', 'en_route');
