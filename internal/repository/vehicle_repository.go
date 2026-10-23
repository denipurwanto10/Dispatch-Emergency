package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"dispatch/internal/model"
)

type VehicleRepository struct {
	db *sql.DB
}

func NewVehicleRepository(db *sql.DB) *VehicleRepository {
	return &VehicleRepository{db: db}
}

func (r *VehicleRepository) DB() *sql.DB {
	return r.db
}

// GetByID mengambil kendaraan berdasarkan ID.
func (r *VehicleRepository) GetByID(ctx context.Context, id int64) (model.Vehicle, error) {
	var (
		vehicle       model.Vehicle
		operatingCity sql.NullString
		driverID      sql.NullInt64
		driverName    sql.NullString
	)
	err := r.db.QueryRowContext(ctx, `
		SELECT
			v.id,
			v.name,
			v.plate,
			v.type,
			v.status,
			ST_Y(v.pos_geom) AS lat,
			ST_X(v.pos_geom) AS lng,
			v.operating_city,
			v.driver_id,
			u.name AS driver_name,
			v.pos_updated_at,
			v.created_at
		FROM vehicles v
		LEFT JOIN users u ON u.id = v.driver_id
		WHERE v.id = $1`, id).Scan(
		&vehicle.ID, &vehicle.Name, &vehicle.Plate, &vehicle.Type, &vehicle.Status,
		&vehicle.Lat, &vehicle.Lng, &operatingCity, &driverID, &driverName,
		&vehicle.PosUpdatedAt, &vehicle.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Vehicle{}, ErrNotFound
	}
	if err != nil {
		return model.Vehicle{}, fmt.Errorf("ambil kendaraan: %w", err)
	}
	if operatingCity.Valid {
		vehicle.OperatingCity = &operatingCity.String
	}
	if driverID.Valid {
		vehicle.DriverID = &driverID.Int64
	}
	if driverName.Valid {
		vehicle.DriverName = &driverName.String
	}
	return vehicle, nil
}

// List mengambil kendaraan beserta koordinat pos_geom dan nama driver.
// city kosong berarti semua kota; city terisi memfilter operating_city.
func (r *VehicleRepository) List(ctx context.Context, city string) ([]model.Vehicle, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT
			v.id,
			v.name,
			v.plate,
			v.type,
			v.status,
			ST_Y(v.pos_geom) AS lat,
			ST_X(v.pos_geom) AS lng,
			v.operating_city,
			v.driver_id,
			u.name AS driver_name,
			v.pos_updated_at,
			v.created_at
		FROM vehicles v
		LEFT JOIN users u ON u.id = v.driver_id
		WHERE ($1 = '' OR v.operating_city = $1)
		ORDER BY v.id`, city)
	if err != nil {
		return nil, fmt.Errorf("daftar kendaraan: %w", err)
	}
	defer rows.Close()

	vehicles := make([]model.Vehicle, 0)
	for rows.Next() {
		var (
			vehicle       model.Vehicle
			operatingCity sql.NullString
			driverID      sql.NullInt64
			driverName    sql.NullString
		)
		if err := rows.Scan(
			&vehicle.ID, &vehicle.Name, &vehicle.Plate, &vehicle.Type, &vehicle.Status,
			&vehicle.Lat, &vehicle.Lng, &operatingCity, &driverID, &driverName,
			&vehicle.PosUpdatedAt, &vehicle.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan kendaraan: %w", err)
		}
		if operatingCity.Valid {
			vehicle.OperatingCity = &operatingCity.String
		}
		if driverID.Valid {
			vehicle.DriverID = &driverID.Int64
		}
		if driverName.Valid {
			vehicle.DriverName = &driverName.String
		}
		vehicles = append(vehicles, vehicle)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterasi kendaraan: %w", err)
	}
	return vehicles, nil
}

// NearestAvailableCity menentukan kota operasi kendaraan available terdekat
// dari titik insiden selama masih dalam radius. Ini dipakai server saat
// membuat insiden; kota tidak pernah diambil dari body request.
func (r *VehicleRepository) NearestAvailableCity(
	ctx context.Context,
	lat, lng float64,
	radiusM int,
) (*string, error) {
	var operatingCity sql.NullString
	err := r.db.QueryRowContext(ctx, `
		SELECT v.operating_city
		FROM vehicles v
		WHERE v.status = 'available'
		  AND ST_DWithin(
		        v.pos_geom::geography,
		        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
		        $3
		      )
		ORDER BY ST_Distance(
		           v.pos_geom::geography,
		           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
		         ), v.id
		LIMIT 1`,
		lat, lng, radiusM,
	).Scan(&operatingCity)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("cari kota kendaraan terdekat: %w", err)
	}
	if !operatingCity.Valid {
		return nil, nil
	}
	return &operatingCity.String, nil
}

// ListAvailableWithinCityRadius mengambil kendaraan available di kota yang
// sama dengan insiden dan berada dalam radius. Tipe kendaraan tidak difilter;
// type_match dihitung di handler.
func (r *VehicleRepository) ListAvailableWithinCityRadius(
	ctx context.Context,
	city string,
	lat, lng float64,
	radiusM int,
) ([]model.Vehicle, error) {
	if city == "" {
		return make([]model.Vehicle, 0), nil
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT
			v.id,
			v.name,
			v.plate,
			v.type,
			v.status,
			ST_Y(v.pos_geom) AS lat,
			ST_X(v.pos_geom) AS lng,
			v.operating_city,
			v.driver_id,
			u.name AS driver_name,
			v.pos_updated_at,
			v.created_at
		FROM vehicles v
		LEFT JOIN users u ON u.id = v.driver_id
		WHERE v.status = 'available'
		  AND v.operating_city = $1
		  AND ST_DWithin(
		        v.pos_geom::geography,
		        ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
		        $4
		      )
		ORDER BY v.id`, city, lat, lng, radiusM)
	if err != nil {
		return nil, fmt.Errorf("daftar kendaraan dalam radius: %w", err)
	}
	defer rows.Close()

	vehicles := make([]model.Vehicle, 0)
	for rows.Next() {
		var (
			vehicle       model.Vehicle
			operatingCity sql.NullString
			driverID      sql.NullInt64
			driverName    sql.NullString
		)
		if err := rows.Scan(
			&vehicle.ID, &vehicle.Name, &vehicle.Plate, &vehicle.Type, &vehicle.Status,
			&vehicle.Lat, &vehicle.Lng, &operatingCity, &driverID, &driverName,
			&vehicle.PosUpdatedAt, &vehicle.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan kendaraan dalam radius: %w", err)
		}
		if operatingCity.Valid {
			vehicle.OperatingCity = &operatingCity.String
		}
		if driverID.Valid {
			vehicle.DriverID = &driverID.Int64
		}
		if driverName.Valid {
			vehicle.DriverName = &driverName.String
		}
		vehicles = append(vehicles, vehicle)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterasi kendaraan dalam radius: %w", err)
	}
	return vehicles, nil
}

// ---------- Admin CRUD kendaraan (Fase 4) ----------

const adminVehicleColumns = `
	v.id,
	v.name,
	v.plate,
	v.type,
	v.status,
	ST_Y(v.pos_geom) AS lat,
	ST_X(v.pos_geom) AS lng,
	ST_Y(v.home_geom) AS home_lat,
	ST_X(v.home_geom) AS home_lng,
	v.operating_city,
	v.driver_id,
	u.name AS driver_name,
	v.pos_updated_at,
	v.created_at`

func scanAdminVehicle(row interface {
	Scan(dest ...any) error
}) (model.AdminVehicle, error) {
	var (
		vehicle       model.AdminVehicle
		operatingCity sql.NullString
		driverID      sql.NullInt64
		driverName    sql.NullString
	)
	if err := row.Scan(
		&vehicle.ID, &vehicle.Name, &vehicle.Plate, &vehicle.Type, &vehicle.Status,
		&vehicle.Lat, &vehicle.Lng, &vehicle.HomeLat, &vehicle.HomeLng,
		&operatingCity, &driverID, &driverName,
		&vehicle.PosUpdatedAt, &vehicle.CreatedAt,
	); err != nil {
		return model.AdminVehicle{}, err
	}
	if operatingCity.Valid {
		vehicle.OperatingCity = &operatingCity.String
	}
	if driverID.Valid {
		vehicle.DriverID = &driverID.Int64
	}
	if driverName.Valid {
		vehicle.DriverName = &driverName.String
	}
	return vehicle, nil
}

func (r *VehicleRepository) AdminGetByID(ctx context.Context, id int64) (model.AdminVehicle, error) {
	vehicle, err := scanAdminVehicle(r.db.QueryRowContext(ctx, `
		SELECT `+adminVehicleColumns+`
		FROM vehicles v
		LEFT JOIN users u ON u.id = v.driver_id
		WHERE v.id = $1`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return model.AdminVehicle{}, ErrNotFound
	}
	if err != nil {
		return model.AdminVehicle{}, fmt.Errorf("ambil kendaraan admin: %w", err)
	}
	return vehicle, nil
}

func (r *VehicleRepository) AdminList(ctx context.Context, city string) ([]model.AdminVehicle, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT `+adminVehicleColumns+`
		FROM vehicles v
		LEFT JOIN users u ON u.id = v.driver_id
		WHERE ($1 = '' OR v.operating_city = $1)
		ORDER BY v.id`, city)
	if err != nil {
		return nil, fmt.Errorf("daftar kendaraan admin: %w", err)
	}
	defer rows.Close()

	vehicles := make([]model.AdminVehicle, 0)
	for rows.Next() {
		vehicle, err := scanAdminVehicle(rows)
		if err != nil {
			return nil, fmt.Errorf("scan kendaraan admin: %w", err)
		}
		vehicles = append(vehicles, vehicle)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterasi kendaraan admin: %w", err)
	}
	return vehicles, nil
}

type CreateVehicleParams struct {
	Name          string
	Plate         string
	Type          string
	OperatingCity string
	HomeLat       float64
	HomeLng       float64
	DriverID      *int64
}

func (r *VehicleRepository) CreateVehicle(ctx context.Context, params CreateVehicleParams) (model.AdminVehicle, error) {
	var id int64
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO vehicles AS v
			(name, plate, type, operating_city, driver_id, pos_geom, home_geom, status, pos_updated_at)
		VALUES
			($1, $2, $3, $4, $5,
			 ST_SetSRID(ST_MakePoint($7, $6), 4326),
			 ST_SetSRID(ST_MakePoint($7, $6), 4326),
			 'available', now())
		RETURNING v.id`,
		params.Name, params.Plate, params.Type, params.OperatingCity,
		params.DriverID, params.HomeLat, params.HomeLng).Scan(&id)
	if err != nil {
		return model.AdminVehicle{}, fmt.Errorf("buat kendaraan: %w", err)
	}
	return r.AdminGetByID(ctx, id)
}

type UpdateVehicleParams struct {
	Name          string
	Plate         string
	Type          string
	OperatingCity string
	HomeLat       float64
	HomeLng       float64
	DriverID      *int64
	Status        string
	ResetPosition bool
}

func (r *VehicleRepository) UpdateVehicle(ctx context.Context, id int64, params UpdateVehicleParams) (model.AdminVehicle, error) {
	posExpr := `v.pos_geom`
	if params.ResetPosition {
		posExpr = `ST_SetSRID(ST_MakePoint($7, $6), 4326)`
	}

	var updatedID int64
	err := r.db.QueryRowContext(ctx, `
		UPDATE vehicles v
		SET name = $2,
		    plate = $3,
		    type = $4,
		    operating_city = $5,
		    home_geom = ST_SetSRID(ST_MakePoint($7, $6), 4326),
		    pos_geom = `+posExpr+`,
		    driver_id = $8,
		    status = $9,
		    pos_updated_at = now()
		WHERE v.id = $1
		RETURNING v.id`,
		id, params.Name, params.Plate, params.Type, params.OperatingCity,
		params.HomeLat, params.HomeLng, params.DriverID, params.Status).Scan(&updatedID)
	if errors.Is(err, sql.ErrNoRows) {
		return model.AdminVehicle{}, ErrNotFound
	}
	if err != nil {
		return model.AdminVehicle{}, fmt.Errorf("ubah kendaraan: %w", err)
	}
	return r.AdminGetByID(ctx, updatedID)
}

func (r *VehicleRepository) CountActiveAssignments(ctx context.Context, vehicleID int64) (int, error) {
	var count int
	if err := r.db.QueryRowContext(ctx, `
		SELECT count(*)
		FROM assignments
		WHERE vehicle_id = $1
		  AND status IN ('assigned', 'en_route', 'arrived')`, vehicleID).Scan(&count); err != nil {
		return 0, fmt.Errorf("hitung assignment aktif kendaraan: %w", err)
	}
	return count, nil
}

// DeleteVehicle menghapus kendaraan dan riwayat assignment non-aktifnya dalam
// satu transaksi. Assignment aktif harus sudah ditolak handler.
func (r *VehicleRepository) DeleteVehicle(ctx context.Context, id int64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("mulai transaksi hapus kendaraan: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		`DELETE FROM assignments WHERE vehicle_id = $1`, id); err != nil {
		return fmt.Errorf("hapus riwayat assignment kendaraan: %w", err)
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM vehicles WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("hapus kendaraan: %w", err)
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return ErrNotFound
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit hapus kendaraan: %w", err)
	}
	return nil
}
