package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"dispatch/internal/model"
	"dispatch/internal/state"
)

var ErrIncidentNotOpen = errors.New("insiden tidak berstatus open")

type IncidentRepository struct {
	db *sql.DB
}

func NewIncidentRepository(db *sql.DB) *IncidentRepository {
	return &IncidentRepository{db: db}
}

func (r *IncidentRepository) DB() *sql.DB {
	return r.db
}

type CreateIncidentParams struct {
	Lat           float64
	Lng           float64
	Title         string
	Description   *string
	Type          string
	Priority      string
	Status        state.IncidentStatus
	CreatedBy     int64
	OperatingCity *string
}

type rowScanner interface {
	Scan(dest ...any) error
}

const incidentColumns = `
	id,
	ST_Y(geom) AS lat,
	ST_X(geom) AS lng,
	title,
	description,
	type,
	priority,
	status,
	operating_city,
	created_by,
	created_at,
	resolved_at`

func scanIncident(row rowScanner) (model.Incident, error) {
	var (
		incident      model.Incident
		description   sql.NullString
		operatingCity sql.NullString
		resolvedAt    sql.NullTime
	)
	if err := row.Scan(
		&incident.ID, &incident.Lat, &incident.Lng, &incident.Title,
		&description, &incident.Type, &incident.Priority, &incident.Status,
		&operatingCity, &incident.CreatedBy, &incident.CreatedAt, &resolvedAt,
	); err != nil {
		return model.Incident{}, err
	}
	if description.Valid {
		incident.Description = &description.String
	}
	if operatingCity.Valid {
		incident.OperatingCity = &operatingCity.String
	}
	if resolvedAt.Valid {
		incident.ResolvedAt = &resolvedAt.Time
	}
	return incident, nil
}

func (r *IncidentRepository) Create(ctx context.Context, params CreateIncidentParams) (model.Incident, error) {
	if !state.IsInitialIncidentStatus(params.Status) {
		return model.Incident{}, fmt.Errorf("status awal insiden tidak valid: %q", params.Status)
	}

	var description any
	if params.Description != nil {
		description = *params.Description
	}
	var operatingCity any
	if params.OperatingCity != nil {
		operatingCity = *params.OperatingCity
	}

	row := r.db.QueryRowContext(ctx, `
		INSERT INTO incidents
			(geom, title, description, type, priority, status, created_by, operating_city)
		VALUES
			(ST_SetSRID(ST_MakePoint($1, $2), 4326),
			 $3, $4, $5, $6, $7, $8, $9)
		RETURNING `+incidentColumns,
		params.Lng, params.Lat, params.Title, description,
		params.Type, params.Priority, string(params.Status), params.CreatedBy, operatingCity,
	)
	incident, err := scanIncident(row)
	if err != nil {
		return model.Incident{}, fmt.Errorf("buat insiden: %w", err)
	}
	return incident, nil
}

func (r *IncidentRepository) List(ctx context.Context, status, city string) ([]model.Incident, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT `+incidentColumns+`
		FROM incidents
		WHERE ($1 = '' OR status = $1)
		  AND ($2 = '' OR operating_city = $2)
		ORDER BY created_at DESC, id DESC`, status, city)
	if err != nil {
		return nil, fmt.Errorf("daftar insiden: %w", err)
	}
	defer rows.Close()

	incidents := make([]model.Incident, 0)
	for rows.Next() {
		incident, err := scanIncident(rows)
		if err != nil {
			return nil, fmt.Errorf("scan insiden: %w", err)
		}
		incidents = append(incidents, incident)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterasi insiden: %w", err)
	}
	return incidents, nil
}

func (r *IncidentRepository) GetByID(ctx context.Context, id int64) (model.Incident, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT `+incidentColumns+`
		FROM incidents
		WHERE id = $1`, id)

	incident, err := scanIncident(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Incident{}, ErrNotFound
	}
	if err != nil {
		return model.Incident{}, fmt.Errorf("ambil insiden: %w", err)
	}
	return incident, nil
}

func (r *IncidentRepository) Cancel(ctx context.Context, id int64) (model.Incident, error) {
	incident, err := r.GetByID(ctx, id)
	if err != nil {
		return model.Incident{}, err
	}
	if !state.CanTransition(state.IncidentStatus(incident.Status), state.IncidentCancelled) {
		return model.Incident{}, ErrIncidentNotOpen
	}

	row := r.db.QueryRowContext(ctx, `
		UPDATE incidents
		SET status = $2
		WHERE id = $1 AND status = $3
		RETURNING `+incidentColumns, id, string(state.IncidentCancelled), incident.Status)

	updated, err := scanIncident(row)
	if errors.Is(err, sql.ErrNoRows) {
		return model.Incident{}, ErrIncidentNotOpen
	}
	if err != nil {
		return model.Incident{}, fmt.Errorf("batalkan insiden: %w", err)
	}
	return updated, nil
}
