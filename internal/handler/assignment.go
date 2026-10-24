package handler

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"

	"dispatch/internal/httpx"
	"dispatch/internal/middleware"
	"dispatch/internal/model"
	"dispatch/internal/osrm"
	"dispatch/internal/repository"
	"dispatch/internal/ws"
)

type AssignmentHandler struct {
	incidents   *repository.IncidentRepository
	vehicles    *repository.VehicleRepository
	assignments *repository.AssignmentRepository
	osrmTable   *osrm.Client
	osrmRoute   *osrm.RouteClient
	simSpeed    int
	broadcast   func(eventType string, data any)
}

func NewAssignmentHandler(
	incidents *repository.IncidentRepository,
	vehicles *repository.VehicleRepository,
	assignments *repository.AssignmentRepository,
	osrmTable *osrm.Client,
	osrmRoute *osrm.RouteClient,
	simSpeed int,
	broadcast func(eventType string, data any),
) *AssignmentHandler {
	return &AssignmentHandler{
		incidents:   incidents,
		vehicles:    vehicles,
		assignments: assignments,
		osrmTable:   osrmTable,
		osrmRoute:   osrmRoute,
		simSpeed:    simSpeed,
		broadcast:   broadcast,
	}
}

type assignRequest struct {
	VehicleID int64 `json:"vehicle_id"`
}

func (h *AssignmentHandler) Assign(c *gin.Context) {
	id, ok := parseIncidentID(c)
	if !ok {
		return
	}

	var req assignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid_request", "Body harus berisi vehicle_id.")
		return
	}
	if req.VehicleID <= 0 {
		httpx.Error(c, http.StatusBadRequest, "invalid_vehicle_id", "vehicle_id tidak valid.")
		return
	}

	// assigned_by wajib berasal dari identitas JWT yang sudah divalidasi
	// middleware. Jangan pernah mengambilnya dari body, vehicle, atau insiden.
	userIDValue, exists := c.Get(middleware.ContextUserID)
	userID, ok := userIDValue.(int64)
	if !exists || !ok || userID <= 0 {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized", "Identitas user tidak ditemukan.")
		return
	}

	// a. Muat insiden; status harus open
	incident, err := h.incidents.GetByID(c.Request.Context(), id)
	if errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusNotFound, "not_found", "Insiden tidak ditemukan.")
		return
	}
	if err != nil {
		log.Printf("assignments: get incident: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil insiden.")
		return
	}
	if incident.Status != "open" {
		httpx.Error(c, http.StatusConflict, "incident_not_open", "Insiden hanya bisa di-assign saat status open.")
		return
	}
	if incident.OperatingCity == nil {
		httpx.Error(c, http.StatusConflict, "incident_unreachable", "Insiden tidak memiliki operating_city (belum terjangkau armada).")
		return
	}

	// b. Muat kendaraan; harus available dan operating_city sama
	vehicle, err := h.vehicles.GetByID(c.Request.Context(), req.VehicleID)
	if errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusNotFound, "not_found", "Kendaraan tidak ditemukan.")
		return
	}
	if err != nil {
		log.Printf("assignments: get vehicle: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil kendaraan.")
		return
	}
	if vehicle.Status != "available" {
		httpx.Error(c, http.StatusConflict, "vehicle_not_available", "Kendaraan tidak tersedia (status bukan available).")
		return
	}
	if vehicle.OperatingCity == nil || *vehicle.OperatingCity != *incident.OperatingCity {
		httpx.Error(c, http.StatusConflict, "vehicle_wrong_city", "Kendaraan berada di operating_city yang berbeda dengan insiden.")
		return
	}

	// c. Ambil rute dari OSRM /route
	route, err := h.osrmRoute.Route(
		c.Request.Context(),
		osrm.Point{Lat: vehicle.Lat, Lng: vehicle.Lng},
		osrm.Point{Lat: incident.Lat, Lng: incident.Lng},
	)
	if err != nil {
		log.Printf("assignments: OSRM route: %v", err)
		httpx.Error(c, http.StatusBadGateway, "routing_unavailable",
			"Layanan routing OSRM tidak bisa dihubungi atau tidak menemukan rute. Coba lagi beberapa saat.")
		return
	}
	if route.Geometry == "" {
		httpx.Error(c, http.StatusBadGateway, "routing_unavailable", "OSRM tidak mengembalikan geometri rute.")
		return
	}

	// d. Transaksi database: insert assignment + update vehicle + update incident
	tx, err := h.incidents.DB().BeginTx(c.Request.Context(), nil)
	if err != nil {
		log.Printf("assignments: begin tx: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal memulai transaksi.")
		return
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p)
		}
	}()

	// Insert assignment
	assignment, err := h.createAssignmentTx(tx, repository.CreateAssignmentParams{
		IncidentID:   incident.ID,
		VehicleID:    vehicle.ID,
		AssignedBy:   userID,
		RouteGeoJSON: route.Geometry,
		DistanceM:    route.Distance,
		ETASecs:      int(math.Round(route.Duration)),
	})
	if err != nil {
		_ = tx.Rollback()
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "uniq_active_assignment_per_vehicle" {
			httpx.Error(c, http.StatusConflict, "vehicle_has_active_assignment", "Kendaraan sudah memiliki assignment aktif.")
			return
		}
		log.Printf("assignments: create assignment: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal membuat assignment.")
		return
	}

	// Update vehicle status to assigned (conditional on available)
	res, err := tx.ExecContext(c.Request.Context(), `
		UPDATE vehicles SET status = 'assigned', pos_updated_at = now() WHERE id = $1 AND status = 'available'`, vehicle.ID)
	if err != nil {
		_ = tx.Rollback()
		log.Printf("assignments: update vehicle: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengupdate status kendaraan.")
		return
	}
	rowsAffected, _ := res.RowsAffected()
	if rowsAffected == 0 {
		_ = tx.Rollback()
		httpx.Error(c, http.StatusConflict, "vehicle_not_available", "Kendaraan sudah tidak available saat assign.")
		return
	}

	// Update incident status to assigned
	_, err = tx.ExecContext(c.Request.Context(), `
		UPDATE incidents SET status = 'assigned' WHERE id = $1 AND status = 'open'`, incident.ID)
	if err != nil {
		_ = tx.Rollback()
		log.Printf("assignments: update incident: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengupdate status insiden.")
		return
	}

	if err := tx.Commit(); err != nil {
		log.Printf("assignments: commit tx: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal commit transaksi.")
		return
	}

	h.broadcastAssignment(c.Request.Context(), "assignment_status", assignment)

	c.JSON(http.StatusCreated, gin.H{"assignment": assignment})
}

func (h *AssignmentHandler) createAssignmentTx(tx *sql.Tx, params repository.CreateAssignmentParams) (model.Assignment, error) {
	var routeGeoJSON any
	if params.RouteGeoJSON != "" {
		routeGeoJSON = params.RouteGeoJSON
	}

	row := tx.QueryRowContext(context.Background(), `
		INSERT INTO assignments
			(incident_id, vehicle_id, assigned_by, route_geom, distance_m, eta_seconds, progress_m, status)
		VALUES
			($1, $2, $3, ST_GeomFromGeoJSON($4), $5, $6, 0, 'assigned')
		RETURNING `+repository.AssignmentColumns,
		params.IncidentID, params.VehicleID, params.AssignedBy,
		routeGeoJSON, params.DistanceM, params.ETASecs,
	)

	return h.scanAssignmentRow(row)
}

func (h *AssignmentHandler) scanAssignmentRow(row interface {
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

// GetByID - GET /assignments/:id
func (h *AssignmentHandler) GetByID(c *gin.Context) {
	id, ok := parseAssignmentID(c)
	if !ok {
		return
	}

	assignment, err := h.assignments.GetByID(c.Request.Context(), id)
	if errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusNotFound, "not_found", "Assignment tidak ditemukan.")
		return
	}
	if err != nil {
		log.Printf("assignments: get by id: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil assignment.")
		return
	}

	// Authorization: dispatcher/admin always allowed, driver only if owns the vehicle
	userIDValue, _ := c.Get(middleware.ContextUserID)
	userID, _ := userIDValue.(int64)
	roleValue, _ := c.Get(middleware.ContextRole)
	role, _ := roleValue.(string)

	if role == "driver" {
		vehicle, err := h.vehicles.GetByID(c.Request.Context(), assignment.VehicleID)
		if err != nil || vehicle.DriverID == nil || *vehicle.DriverID != userID {
			httpx.Error(c, http.StatusForbidden, "forbidden", "Driver hanya bisa melihat assignment kendaraannya sendiri.")
			return
		}
	}

	// Enrich with incident and vehicle
	incident, _ := h.incidents.GetByID(c.Request.Context(), assignment.IncidentID)
	vehicle, _ := h.vehicles.GetByID(c.Request.Context(), assignment.VehicleID)

	resp := model.AssignmentWithRelations{
		Assignment: assignment,
		Incident:   &incident,
		Vehicle:    &vehicle,
	}
	c.JSON(http.StatusOK, gin.H{"assignment": resp})
}

// GetMineActive - GET /assignments/mine/active (driver only)
func (h *AssignmentHandler) GetMineActive(c *gin.Context) {
	userIDValue, _ := c.Get(middleware.ContextUserID)
	userID, _ := userIDValue.(int64)

	assignment, err := h.assignments.GetDriverActiveAssignment(c.Request.Context(), userID)
	if errors.Is(err, repository.ErrNotFound) {
		c.JSON(http.StatusOK, gin.H{"assignment": nil})
		return
	}
	if err != nil {
		log.Printf("assignments: mine active: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil assignment aktif.")
		return
	}

	incident, _ := h.incidents.GetByID(c.Request.Context(), assignment.IncidentID)
	vehicle, _ := h.vehicles.GetByID(c.Request.Context(), assignment.VehicleID)

	resp := model.AssignmentWithRelations{
		Assignment: assignment,
		Incident:   &incident,
		Vehicle:    &vehicle,
	}
	c.JSON(http.StatusOK, gin.H{"assignment": resp})
}

// Start - POST /assignments/:id/start (driver only)
func (h *AssignmentHandler) Start(c *gin.Context) {
	id, ok := parseAssignmentID(c)
	if !ok {
		return
	}

	assignment, err := h.assignments.GetByID(c.Request.Context(), id)
	if errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusNotFound, "not_found", "Assignment tidak ditemukan.")
		return
	}
	if err != nil {
		log.Printf("assignments: start get: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil assignment.")
		return
	}

	// Only driver who owns the vehicle can start
	userIDValue, _ := c.Get(middleware.ContextUserID)
	userID, _ := userIDValue.(int64)
	roleValue, _ := c.Get(middleware.ContextRole)
	role, _ := roleValue.(string)

	if role != "driver" {
		httpx.Error(c, http.StatusForbidden, "forbidden", "Hanya driver yang boleh memulai assignment.")
		return
	}

	vehicle, err := h.vehicles.GetByID(c.Request.Context(), assignment.VehicleID)
	if err != nil || vehicle.DriverID == nil || *vehicle.DriverID != userID {
		httpx.Error(c, http.StatusForbidden, "forbidden", "Driver hanya bisa memulai assignment kendaraannya sendiri.")
		return
	}

	if assignment.Status != "assigned" {
		httpx.Error(c, http.StatusConflict, "assignment_not_startable", "Assignment hanya bisa dimulai dari status assigned.")
		return
	}

	now := time.Now()
	updated, err := h.assignments.UpdateStatusAndTimes(c.Request.Context(), id, "en_route", &now, nil, nil)
	if err != nil {
		log.Printf("assignments: start update: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal memulai assignment.")
		return
	}

	// Update vehicle status
	if _, err := h.vehicles.DB().ExecContext(c.Request.Context(), `
		UPDATE vehicles SET status = 'en_route', pos_updated_at = now() WHERE id = $1`, assignment.VehicleID); err != nil {
		log.Printf("assignments: start update vehicle: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal memperbarui status kendaraan.")
		return
	}
	// Update incident status
	if _, err := h.incidents.DB().ExecContext(c.Request.Context(), `
		UPDATE incidents SET status = 'en_route' WHERE id = $1`, assignment.IncidentID); err != nil {
		log.Printf("assignments: start update incident: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal memperbarui status insiden.")
		return
	}

	h.broadcastAssignment(c.Request.Context(), "assignment_status", updated)

	c.JSON(http.StatusOK, gin.H{"assignment": updated})
}

// Arrive - POST /assignments/:id/arrive (driver only)
// Manual arrive for drivers to mark they've reached the incident location
func (h *AssignmentHandler) Arrive(c *gin.Context) {
	id, ok := parseAssignmentID(c)
	if !ok {
		return
	}

	assignment, err := h.assignments.GetByID(c.Request.Context(), id)
	if errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusNotFound, "not_found", "Assignment tidak ditemukan.")
		return
	}
	if err != nil {
		log.Printf("assignments: arrive get: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil assignment.")
		return
	}

	// Only driver who owns the vehicle can arrive
	userIDValue, _ := c.Get(middleware.ContextUserID)
	userID, _ := userIDValue.(int64)
	roleValue, _ := c.Get(middleware.ContextRole)
	role, _ := roleValue.(string)

	if role != "driver" {
		httpx.Error(c, http.StatusForbidden, "forbidden", "Hanya driver yang boleh menandai tiba di lokasi.")
		return
	}

	vehicle, err := h.vehicles.GetByID(c.Request.Context(), assignment.VehicleID)
	if err != nil || vehicle.DriverID == nil || *vehicle.DriverID != userID {
		httpx.Error(c, http.StatusForbidden, "forbidden", "Driver hanya bisa menandai tiba untuk assignment kendaraannya sendiri.")
		return
	}

	if assignment.Status != "en_route" {
		httpx.Error(c, http.StatusConflict, "assignment_not_arrivable", "Assignment hanya bisa ditandai tiba dari status en_route.")
		return
	}

	now := time.Now()
	updated, err := h.assignments.UpdateStatusAndTimes(c.Request.Context(), id, "arrived", nil, &now, nil)
	if err != nil {
		log.Printf("assignments: arrive update: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal menandai tiba di lokasi.")
		return
	}

	// Update vehicle status to on_scene
	if _, err := h.vehicles.DB().ExecContext(c.Request.Context(), `
		UPDATE vehicles SET status = 'on_scene', pos_updated_at = now() WHERE id = $1`, assignment.VehicleID); err != nil {
		log.Printf("assignments: arrive update vehicle: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal memperbarui status kendaraan.")
		return
	}
	// Update incident status to on_scene
	if _, err := h.incidents.DB().ExecContext(c.Request.Context(), `
		UPDATE incidents SET status = 'on_scene' WHERE id = $1`, assignment.IncidentID); err != nil {
		log.Printf("assignments: arrive update incident: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal memperbarui status insiden.")
		return
	}

	h.broadcastAssignment(c.Request.Context(), "assignment_status", updated)
	h.broadcastIncidentStatus(assignment.IncidentID)

	c.JSON(http.StatusOK, gin.H{"assignment": updated})
}

// Complete - POST /assignments/:id/complete (driver owner OR dispatcher)
func (h *AssignmentHandler) Complete(c *gin.Context) {
	id, ok := parseAssignmentID(c)
	if !ok {
		return
	}

	assignment, err := h.assignments.GetByID(c.Request.Context(), id)
	if errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusNotFound, "not_found", "Assignment tidak ditemukan.")
		return
	}
	if err != nil {
		log.Printf("assignments: complete get: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil assignment.")
		return
	}

	userIDValue, _ := c.Get(middleware.ContextUserID)
	userID, _ := userIDValue.(int64)
	roleValue, _ := c.Get(middleware.ContextRole)
	role, _ := roleValue.(string)

	// Authorization: driver who owns the vehicle OR dispatcher/admin
	allowed := false
	if role == "driver" {
		vehicle, _ := h.vehicles.GetByID(c.Request.Context(), assignment.VehicleID)
		if vehicle.DriverID != nil && *vehicle.DriverID == userID {
			allowed = true
		}
	} else if role == "dispatcher" || role == "admin" {
		allowed = true
	}

	if !allowed {
		httpx.Error(c, http.StatusForbidden, "forbidden", "Hanya driver pemilik atau dispatcher yang boleh menyelesaikan.")
		return
	}

	if assignment.Status != "arrived" {
		httpx.Error(c, http.StatusConflict, "assignment_not_completable", "Assignment hanya bisa diselesaikan dari status arrived (ON SCENE).")
		return
	}

	now := time.Now()
	updated, err := h.assignments.UpdateStatusAndTimes(c.Request.Context(), id, "completed", nil, nil, &now)
	if err != nil {
		log.Printf("assignments: complete update: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal menyelesaikan assignment.")
		return
	}

	// Update vehicle: available, pos_geom = incident location (keep operating_city)
	if _, err := h.vehicles.DB().ExecContext(c.Request.Context(), `
		UPDATE vehicles
		SET status = 'available',
		    pos_geom = (SELECT geom FROM incidents WHERE id = $1),
		    pos_updated_at = now()
		WHERE id = $2`, assignment.IncidentID, assignment.VehicleID); err != nil {
		log.Printf("assignments: complete update vehicle: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal memperbarui status kendaraan.")
		return
	}

	// Update incident: resolved
	if _, err := h.incidents.DB().ExecContext(c.Request.Context(), `
		UPDATE incidents SET status = 'resolved', resolved_at = $1 WHERE id = $2`, now, assignment.IncidentID); err != nil {
		log.Printf("assignments: complete update incident: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal memperbarui status insiden.")
		return
	}

	h.broadcastAssignment(c.Request.Context(), "assignment_status", updated)
	h.broadcastIncidentStatus(assignment.IncidentID)

	c.JSON(http.StatusOK, gin.H{"assignment": updated})
}

// ListMineHistory - GET /assignments/mine/history (driver only)
func (h *AssignmentHandler) ListMineHistory(c *gin.Context) {
	userIDValue, exists := c.Get(middleware.ContextUserID)
	userID, ok := userIDValue.(int64)
	if !exists || !ok || userID <= 0 {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized", "Identitas user tidak ditemukan.")
		return
	}

	history, err := h.assignments.ListDriverHistory(c.Request.Context(), userID, 20)
	if err != nil {
		log.Printf("assignments: riwayat driver: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil riwayat tugas.")
		return
	}

	c.JSON(http.StatusOK, gin.H{"history": history})
}

// broadcastAssignment mengirim status assignment terbaru beserta relasinya.
func (h *AssignmentHandler) broadcastAssignment(ctx context.Context, eventType string, assignment model.Assignment) {
	if h.broadcast == nil {
		return
	}

	incident, err := h.incidents.GetByID(ctx, assignment.IncidentID)
	if err != nil {
		log.Printf("assignments: broadcast incident: %v", err)
		return
	}
	vehicle, err := h.vehicles.GetByID(ctx, assignment.VehicleID)
	if err != nil {
		log.Printf("assignments: broadcast vehicle: %v", err)
		return
	}

	h.broadcast(eventType, ws.AssignmentStatusEvent{
		Assignment: assignment,
		Incident:   incident,
		Vehicle:    vehicle,
	})
}

// broadcastIncidentStatus menyiarkan status insiden terbaru (mis. on_scene saat
// driver tiba, resolved saat tugas selesai) agar panel dispatcher ikut berubah.
func (h *AssignmentHandler) broadcastIncidentStatus(incidentID int64) {
	if h.broadcast == nil {
		return
	}

	incident, err := h.incidents.GetByID(context.Background(), incidentID)
	if err != nil {
		log.Printf("assignments: broadcast incident status: %v", err)
		return
	}

	h.broadcast("incident_status", ws.IncidentStatusEvent{Incident: incident})
}

func parseAssignmentID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		httpx.Error(c, http.StatusBadRequest, "invalid_id", "ID assignment tidak valid.")
		return 0, false
	}
	return id, true
}
