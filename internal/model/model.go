package model

import "time"

type User struct {
	ID            int64     `json:"id"`
	Email         string    `json:"email"`
	PasswordHash  string    `json:"-"`
	Role          string    `json:"role"`
	Name          string    `json:"name"`
	OperatingCity *string   `json:"operating_city"`
	CreatedAt     time.Time `json:"created_at"`
}

type Vehicle struct {
	ID            int64     `json:"id"`
	Name          string    `json:"name"`
	Plate         string    `json:"plate"`
	Type          string    `json:"type"`
	Status        string    `json:"status"`
	Lat           float64   `json:"lat"`
	Lng           float64   `json:"lng"`
	OperatingCity *string   `json:"operating_city"`
	DriverID      *int64    `json:"driver_id"`
	DriverName    *string   `json:"driver_name"`
	PosUpdatedAt  time.Time `json:"pos_updated_at"`
	CreatedAt     time.Time `json:"created_at"`
}

type Incident struct {
	ID            int64      `json:"id"`
	Lat           float64    `json:"lat"`
	Lng           float64    `json:"lng"`
	Title         string     `json:"title"`
	Description   *string    `json:"description"`
	Type          string     `json:"type"`
	Priority      string     `json:"priority"`
	Status        string     `json:"status"`
	OperatingCity *string    `json:"operating_city"`
	CreatedBy     int64      `json:"created_by"`
	CreatedAt     time.Time  `json:"created_at"`
	ResolvedAt    *time.Time `json:"resolved_at"`
}

type NearestCandidate struct {
	VehicleID       int64   `json:"vehicle_id"`
	Name            string  `json:"name"`
	Plate           string  `json:"plate"`
	Type            string  `json:"type"`
	OperatingCity   *string `json:"operating_city"`
	DriverName      *string `json:"driver_name"`
	DurationSeconds float64 `json:"duration_seconds"`
	DistanceM       float64 `json:"distance_m"`
	ETAMinutes      int     `json:"eta_minutes"`
	TypeMatch       bool    `json:"type_match"`
}

type NearestResult struct {
	IncidentID int64              `json:"incident_id"`
	RadiusM    int                `json:"radius_m"`
	Candidates []NearestCandidate `json:"candidates"`
	Reason     string             `json:"reason,omitempty"`
}

type Assignment struct {
	ID           int64      `json:"id"`
	IncidentID   int64      `json:"incident_id"`
	VehicleID    int64      `json:"vehicle_id"`
	AssignedBy   int64      `json:"assigned_by"`
	RouteGeoJSON string     `json:"route_geojson"`
	DistanceM    float64    `json:"distance_m"`
	ETASecs      int        `json:"eta_seconds"`
	ProgressM    float64    `json:"progress_m"`
	Status       string     `json:"status"`
	AssignedAt   time.Time  `json:"assigned_at"`
	StartedAt    *time.Time `json:"started_at"`
	ArrivedAt    *time.Time `json:"arrived_at"`
	CompletedAt  *time.Time `json:"completed_at"`
}

type AssignmentWithRelations struct {
	Assignment
	Incident *Incident `json:"incident,omitempty"`
	Vehicle  *Vehicle  `json:"vehicle,omitempty"`
}

// AdminVehicle menambahkan koordinat home_geom yang dibutuhkan form admin.
type AdminVehicle struct {
	Vehicle
	HomeLat float64 `json:"home_lat"`
	HomeLng float64 `json:"home_lng"`
}

// AssignmentHistoryItem adalah satu baris riwayat tugas driver.
type AssignmentHistoryItem struct {
	ID               int64      `json:"id"`
	IncidentTitle    string     `json:"incident_title"`
	IncidentType     string     `json:"incident_type"`
	IncidentPriority string     `json:"incident_priority"`
	OperatingCity    *string    `json:"operating_city"`
	AssignedAt       time.Time  `json:"assigned_at"`
	StartedAt        *time.Time `json:"started_at"`
	ArrivedAt        *time.Time `json:"arrived_at"`
	CompletedAt      *time.Time `json:"completed_at"`
	ResponseSeconds  *int64     `json:"response_seconds"`
}
