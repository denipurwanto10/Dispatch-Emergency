package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"dispatch/internal/model"
)

var ErrAssignmentConflict = errors.New("assignment conflict: kendaraan sudah memiliki assignment aktif")

const AssignmentColumns = `
	id,
	incident_id,
	vehicle_id,
	assigned_by,
	ST_AsGeoJSON(route_geom) AS route_geojson,
	distance_m,
	eta_seconds,
	progress_m,
	status,
	assigned_at,
	started_at,
	arrived_at,
	completed_at`

type AssignmentRepository struct {
	db *sql.DB
}

func NewAssignmentRepository(db *sql.DB) *AssignmentRepository {
	return &AssignmentRepository{db: db}
}

func (r *AssignmentRepository) DB() *sql.DB {
	return r.db
}

func scanAssignment(row interface {
	Scan(dest ...any) error
}) (model.Assignment, error) {
	var (
		assignment   model.Assignment
		routeGeoJSON sql.NullString
		startedAt    sql.NullTime
		arrivedAt    sql.NullTime
		completedAt  sql.NullTime
	)
	if err := row.Scan(
		&assignment.ID,
		&assignment.IncidentID,
		&assignment.VehicleID,
		&assignment.AssignedBy,
		&routeGeoJSON,
		&assignment.DistanceM,
		&assignment.ETASecs,
		&assignment.ProgressM,
		&assignment.Status,
		&assignment.AssignedAt,
		&startedAt,
		&arrivedAt,
		&completedAt,
	); err != nil {
		return model.Assignment{}, err
	}
	if routeGeoJSON.Valid {
		assignment.RouteGeoJSON = routeGeoJSON.String
	}
	if startedAt.Valid {
		assignment.StartedAt = &startedAt.Time
	}
	if arrivedAt.Valid {
		assignment.ArrivedAt = &arrivedAt.Time
	}
	if completedAt.Valid {
		assignment.CompletedAt = &completedAt.Time
	}
	return assignment, nil
}

func (r *AssignmentRepository) Create(ctx context.Context, params CreateAssignmentParams) (model.Assignment, error) {
	var routeGeoJSON any
	if params.RouteGeoJSON != "" {
		routeGeoJSON = params.RouteGeoJSON
	}

	row := r.db.QueryRowContext(ctx, `
		INSERT INTO assignments
			(incident_id, vehicle_id, assigned_by, route_geom, distance_m, eta_seconds, progress_m, status)
		VALUES
			($1, $2, $3, ST_GeomFromGeoJSON($4), $5, $6, 0, 'assigned')
		RETURNING `+AssignmentColumns,
		params.IncidentID, params.VehicleID, params.AssignedBy,
		routeGeoJSON, params.DistanceM, params.ETASecs,
	)

	assignment, err := scanAssignment(row)
	if err != nil {
		return model.Assignment{}, fmt.Errorf("buat assignment: %w", err)
	}
	return assignment, nil
}

type CreateAssignmentParams struct {
	IncidentID   int64
	VehicleID    int64
	AssignedBy   int64
	RouteGeoJSON string
	DistanceM    float64
	ETASecs      int
}

func (r *AssignmentRepository) GetByID(ctx context.Context, id int64) (model.Assignment, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT `+AssignmentColumns+`
		FROM assignments
		WHERE id = $1`, id)

	assignment, err := scanAssignment(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Assignment{}, ErrNotFound
	}
	if err != nil {
		return model.Assignment{}, fmt.Errorf("ambil assignment: %w", err)
	}
	return assignment, nil
}

func (r *AssignmentRepository) GetActiveByVehicleID(ctx context.Context, vehicleID int64) (model.Assignment, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT `+AssignmentColumns+`
		FROM assignments
		WHERE vehicle_id = $1
		  AND status IN ('assigned', 'en_route', 'arrived')
		ORDER BY assigned_at DESC
		LIMIT 1`, vehicleID)

	assignment, err := scanAssignment(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Assignment{}, ErrNotFound
	}
	if err != nil {
		return model.Assignment{}, fmt.Errorf("ambil assignment aktif kendaraan: %w", err)
	}
	return assignment, nil
}

func (r *AssignmentRepository) GetActiveByIncidentID(ctx context.Context, incidentID int64) (model.Assignment, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT `+AssignmentColumns+`
		FROM assignments
		WHERE incident_id = $1
		  AND status IN ('assigned', 'en_route', 'arrived')
		ORDER BY assigned_at DESC
		LIMIT 1`, incidentID)

	assignment, err := scanAssignment(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Assignment{}, ErrNotFound
	}
	if err != nil {
		return model.Assignment{}, fmt.Errorf("ambil assignment aktif insiden: %w", err)
	}
	return assignment, nil
}

func (r *AssignmentRepository) GetDriverActiveAssignment(ctx context.Context, driverID int64) (model.Assignment, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT `+AssignmentColumns+`
		FROM assignments
		WHERE vehicle_id IN (SELECT id FROM vehicles WHERE driver_id = $1)
		  AND status IN ('assigned', 'en_route', 'arrived')
		ORDER BY assigned_at DESC
		LIMIT 1`, driverID)

	assignment, err := scanAssignment(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Assignment{}, ErrNotFound
	}
	if err != nil {
		return model.Assignment{}, fmt.Errorf("ambil assignment aktif driver: %w", err)
	}
	return assignment, nil
}

func (r *AssignmentRepository) ListActiveEnRoute(ctx context.Context) ([]model.Assignment, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT `+AssignmentColumns+`
		FROM assignments
		WHERE status = 'en_route'
		ORDER BY assigned_at`)
	if err != nil {
		return nil, fmt.Errorf("daftar assignment en_route: %w", err)
	}
	defer rows.Close()

	assignments := make([]model.Assignment, 0)
	for rows.Next() {
		assignment, err := scanAssignment(rows)
		if err != nil {
			return nil, fmt.Errorf("scan assignment en_route: %w", err)
		}
		assignments = append(assignments, assignment)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterasi assignment en_route: %w", err)
	}
	return assignments, nil
}

func (r *AssignmentRepository) UpdateStatusAndTimes(ctx context.Context, id int64, status string, startedAt, arrivedAt, completedAt *time.Time) (model.Assignment, error) {
	query := `UPDATE assignments SET status = $1`
	args := []any{status}
	argIdx := 2

	if startedAt != nil {
		query += fmt.Sprintf(", started_at = $%d", argIdx)
		args = append(args, *startedAt)
		argIdx++
	}
	if arrivedAt != nil {
		query += fmt.Sprintf(", arrived_at = $%d", argIdx)
		args = append(args, *arrivedAt)
		argIdx++
	}
	if completedAt != nil {
		query += fmt.Sprintf(", completed_at = $%d", argIdx)
		args = append(args, *completedAt)
		argIdx++
	}

	query += fmt.Sprintf(" WHERE id = $%d RETURNING "+AssignmentColumns, argIdx)
	args = append(args, id)

	row := r.db.QueryRowContext(ctx, query, args...)
	assignment, err := scanAssignment(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Assignment{}, ErrNotFound
	}
	if err != nil {
		return model.Assignment{}, fmt.Errorf("update assignment status: %w", err)
	}
	return assignment, nil
}

func (r *AssignmentRepository) UpdateProgress(ctx context.Context, id int64, progressM float64) (model.Assignment, error) {
	row := r.db.QueryRowContext(ctx, `
		UPDATE assignments
		SET progress_m = $1
		WHERE id = $2
		RETURNING `+AssignmentColumns, progressM, id)

	assignment, err := scanAssignment(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Assignment{}, ErrNotFound
	}
	if err != nil {
		return model.Assignment{}, fmt.Errorf("update assignment progress: %w", err)
	}
	return assignment, nil
}

func (r *AssignmentRepository) UpdateProgressAndStatus(ctx context.Context, id int64, progressM float64, status string, arrivedAt *time.Time) (model.Assignment, error) {
	query := `UPDATE assignments SET progress_m = $1, status = $2`
	args := []any{progressM, status}
	argIdx := 3

	if arrivedAt != nil {
		query += fmt.Sprintf(", arrived_at = $%d", argIdx)
		args = append(args, *arrivedAt)
		argIdx++
	}

	query += fmt.Sprintf(" WHERE id = $%d RETURNING "+AssignmentColumns, argIdx)
	args = append(args, id)

	row := r.db.QueryRowContext(ctx, query, args...)
	assignment, err := scanAssignment(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Assignment{}, ErrNotFound
	}
	if err != nil {
		return model.Assignment{}, fmt.Errorf("update assignment progress+status: %w", err)
	}
	return assignment, nil
}

// ListDriverHistory mengambil maksimal 20 assignment selesai/batal milik
// kendaraan yang dikemudikan driver, terbaru lebih dulu.
func (r *AssignmentRepository) ListDriverHistory(ctx context.Context, driverID int64, limit int) ([]model.AssignmentHistoryItem, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT
			a.id,
			i.title,
			i.type,
			i.priority,
			i.operating_city,
			a.assigned_at,
			a.started_at,
			a.arrived_at,
			a.completed_at,
			CASE
				WHEN a.arrived_at IS NULL THEN NULL
				ELSE GREATEST(0, EXTRACT(EPOCH FROM (a.arrived_at - a.assigned_at))::bigint)
			END AS response_seconds
		FROM assignments a
		JOIN vehicles v ON v.id = a.vehicle_id
		JOIN incidents i ON i.id = a.incident_id
		WHERE v.driver_id = $1
		  AND a.status IN ('completed', 'cancelled')
		ORDER BY a.assigned_at DESC, a.id DESC
		LIMIT $2`, driverID, limit)
	if err != nil {
		return nil, fmt.Errorf("daftar riwayat driver: %w", err)
	}
	defer rows.Close()

	items := make([]model.AssignmentHistoryItem, 0)
	for rows.Next() {
		var (
			item          model.AssignmentHistoryItem
			operatingCity sql.NullString
			startedAt     sql.NullTime
			arrivedAt     sql.NullTime
			completedAt   sql.NullTime
			responseSecs  sql.NullInt64
		)
		if err := rows.Scan(
			&item.ID,
			&item.IncidentTitle,
			&item.IncidentType,
			&item.IncidentPriority,
			&operatingCity,
			&item.AssignedAt,
			&startedAt,
			&arrivedAt,
			&completedAt,
			&responseSecs,
		); err != nil {
			return nil, fmt.Errorf("scan riwayat driver: %w", err)
		}
		if operatingCity.Valid {
			item.OperatingCity = &operatingCity.String
		}
		if startedAt.Valid {
			item.StartedAt = &startedAt.Time
		}
		if arrivedAt.Valid {
			item.ArrivedAt = &arrivedAt.Time
		}
		if completedAt.Valid {
			item.CompletedAt = &completedAt.Time
		}
		if responseSecs.Valid {
			value := responseSecs.Int64
			item.ResponseSeconds = &value
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterasi riwayat driver: %w", err)
	}
	return items, nil
}
