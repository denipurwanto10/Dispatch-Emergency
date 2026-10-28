package handler

import (
	"errors"
	"log"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"dispatch/internal/httpx"
	"dispatch/internal/middleware"
	"dispatch/internal/model"
	"dispatch/internal/osrm"
	"dispatch/internal/repository"
	"dispatch/internal/state"
	"dispatch/internal/ws"
)

type IncidentHandler struct {
	incidents *repository.IncidentRepository
	vehicles  *repository.VehicleRepository
	osrm      *osrm.Client
	radiusM   int
	broadcast func(eventType string, data any)
}

func NewIncidentHandler(
	incidents *repository.IncidentRepository,
	vehicles *repository.VehicleRepository,
	osrmClient *osrm.Client,
	radiusM int,
	broadcast func(eventType string, data any),
) *IncidentHandler {
	return &IncidentHandler{
		incidents: incidents,
		vehicles:  vehicles,
		osrm:      osrmClient,
		radiusM:   radiusM,
		broadcast: broadcast,
	}
}

type createIncidentRequest struct {
	Lat         *float64 `json:"lat"`
	Lng         *float64 `json:"lng"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Type        string   `json:"type"`
	Priority    string   `json:"priority"`
}

func (h *IncidentHandler) Create(c *gin.Context) {
	var req createIncidentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid_request", "Body insiden tidak valid.")
		return
	}

	if req.Lat == nil || req.Lng == nil {
		httpx.Error(c, http.StatusBadRequest, "invalid_coordinates", "lat dan lng wajib diisi.")
		return
	}
	lat, lng := *req.Lat, *req.Lng
	if math.IsNaN(lat) || math.IsNaN(lng) || math.IsInf(lat, 0) || math.IsInf(lng, 0) ||
		lat < -11 || lat > 6 || lng < 95 || lng > 141 {
		httpx.Error(c, http.StatusBadRequest, "invalid_coordinates", "Koordinat harus berada di wilayah Indonesia (lat -11..6, lng 95..141).")
		return
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		httpx.Error(c, http.StatusBadRequest, "invalid_title", "Title wajib diisi.")
		return
	}

	incidentType := strings.ToLower(strings.TrimSpace(req.Type))
	if !isIncidentType(incidentType) {
		httpx.Error(c, http.StatusBadRequest, "invalid_type", "Type harus ambulance, fire, atau police.")
		return
	}

	priority := strings.ToLower(strings.TrimSpace(req.Priority))
	if !isIncidentPriority(priority) {
		httpx.Error(c, http.StatusBadRequest, "invalid_priority", "Priority harus low, medium, high, atau critical.")
		return
	}

	userIDValue, exists := c.Get(middleware.ContextUserID)
	userID, ok := userIDValue.(int64)
	if !exists || !ok {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized", "Identitas user tidak ditemukan.")
		return
	}

	operatingCity, err := h.vehicles.NearestAvailableCity(
		c.Request.Context(), lat, lng, h.radiusM,
	)
	if err != nil {
		log.Printf("incidents: tentukan kota: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal menentukan kota operasi insiden.")
		return
	}

	var description *string
	if trimmed := strings.TrimSpace(req.Description); trimmed != "" {
		description = &trimmed
	}

	incident, err := h.incidents.Create(c.Request.Context(), repository.CreateIncidentParams{
		Lat:           lat,
		Lng:           lng,
		Title:         title,
		Description:   description,
		Type:          incidentType,
		Priority:      priority,
		Status:        state.IncidentOpen,
		CreatedBy:     userID,
		OperatingCity: operatingCity,
	})
	if err != nil {
		log.Printf("incidents: buat: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal membuat insiden.")
		return
	}

	// Semua dispatcher/admin yang terhubung langsung melihat laporan baru.
	h.broadcastIncident(incident)

	c.JSON(http.StatusCreated, gin.H{"incident": incident})
}

func (h *IncidentHandler) List(c *gin.Context) {
	status := strings.TrimSpace(c.Query("status"))
	city := strings.TrimSpace(c.Query("city"))

	incidents, err := h.incidents.List(c.Request.Context(), status, city)
	if err != nil {
		log.Printf("incidents: daftar: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil daftar insiden.")
		return
	}

	c.JSON(http.StatusOK, gin.H{"incidents": incidents})
}

func (h *IncidentHandler) Get(c *gin.Context) {
	id, ok := parseIncidentID(c)
	if !ok {
		return
	}

	incident, err := h.incidents.GetByID(c.Request.Context(), id)
	if errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusNotFound, "not_found", "Insiden tidak ditemukan.")
		return
	}
	if err != nil {
		log.Printf("incidents: detail: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil insiden.")
		return
	}

	c.JSON(http.StatusOK, gin.H{"incident": incident})
}

func (h *IncidentHandler) Cancel(c *gin.Context) {
	id, ok := parseIncidentID(c)
	if !ok {
		return
	}

	incident, err := h.incidents.Cancel(c.Request.Context(), id)
	if errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusNotFound, "not_found", "Insiden tidak ditemukan.")
		return
	}
	if errors.Is(err, repository.ErrIncidentNotOpen) {
		httpx.Error(c, http.StatusConflict, "incident_not_open", "Insiden hanya bisa dibatalkan saat status open.")
		return
	}
	if err != nil {
		log.Printf("incidents: batalkan: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal membatalkan insiden.")
		return
	}

	h.broadcastIncident(incident)

	c.JSON(http.StatusOK, gin.H{"incident": incident})
}

// broadcastIncident mengirim perubahan status insiden ke seluruh klien WebSocket.
func (h *IncidentHandler) broadcastIncident(incident model.Incident) {
	if h.broadcast == nil {
		return
	}
	h.broadcast("incident_status", ws.IncidentStatusEvent{Incident: incident})
}

func (h *IncidentHandler) Nearest(c *gin.Context) {
	id, ok := parseIncidentID(c)
	if !ok {
		return
	}

	incident, err := h.incidents.GetByID(c.Request.Context(), id)
	if errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusNotFound, "not_found", "Insiden tidak ditemukan.")
		return
	}
	if err != nil {
		log.Printf("incidents: nearest: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil insiden.")
		return
	}
	if incident.Status != "open" {
		httpx.Error(c, http.StatusConflict, "incident_not_open", "Pencarian kandidat hanya untuk insiden berstatus open.")
		return
	}

	result := model.NearestResult{
		IncidentID: incident.ID,
		RadiusM:    h.radiusM,
		Candidates: make([]model.NearestCandidate, 0),
	}

	city := ""
	if incident.OperatingCity != nil {
		city = *incident.OperatingCity
	}
	vehicles, err := h.vehicles.ListAvailableWithinCityRadius(
		c.Request.Context(), city, incident.Lat, incident.Lng, h.radiusM,
	)
	if err != nil {
		log.Printf("incidents: kandidat awal: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil kandidat kendaraan.")
		return
	}
	if len(vehicles) == 0 {
		result.Reason = "no_available_vehicle_within_radius"
		c.JSON(http.StatusOK, result)
		return
	}

	points := make([]osrm.Point, 0, len(vehicles))
	for _, vehicle := range vehicles {
		points = append(points, osrm.Point{Lat: vehicle.Lat, Lng: vehicle.Lng})
	}

	table, err := h.osrm.Table(
		c.Request.Context(), points, osrm.Point{Lat: incident.Lat, Lng: incident.Lng},
	)
	if err != nil {
		log.Printf("incidents: OSRM: %v", err)
		httpx.Error(c, http.StatusBadGateway, "routing_unavailable",
			"Layanan routing OSRM tidak bisa dihubungi. Coba lagi beberapa saat.")
		return
	}

	for i, vehicle := range vehicles {
		duration := tableValue(table.Durations, i)
		distance := tableValue(table.Distances, i)
		if duration == nil || distance == nil || *duration < 0 || *distance < 0 {
			continue
		}

		result.Candidates = append(result.Candidates, model.NearestCandidate{
			VehicleID:       vehicle.ID,
			Name:            vehicle.Name,
			Plate:           vehicle.Plate,
			Type:            vehicle.Type,
			OperatingCity:   vehicle.OperatingCity,
			DriverName:      vehicle.DriverName,
			DurationSeconds: *duration,
			DistanceM:       *distance,
			ETAMinutes:      int(math.Ceil(*duration / 60)),
			TypeMatch:       vehicle.Type == incident.Type,
		})
	}

	sort.Slice(result.Candidates, func(i, j int) bool {
		if result.Candidates[i].DurationSeconds == result.Candidates[j].DurationSeconds {
			return result.Candidates[i].DistanceM < result.Candidates[j].DistanceM
		}
		return result.Candidates[i].DurationSeconds < result.Candidates[j].DurationSeconds
	})

	if len(result.Candidates) == 0 {
		result.Reason = "no_reachable_vehicle"
		c.JSON(http.StatusOK, result)
		return
	}
	if len(result.Candidates) > 3 {
		result.Candidates = result.Candidates[:3]
	}

	c.JSON(http.StatusOK, result)
}

func parseIncidentID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		httpx.Error(c, http.StatusBadRequest, "invalid_id", "ID insiden tidak valid.")
		return 0, false
	}
	return id, true
}

func isIncidentType(value string) bool {
	switch value {
	case "ambulance", "fire", "police":
		return true
	default:
		return false
	}
}

func isIncidentPriority(value string) bool {
	switch value {
	case "low", "medium", "high", "critical":
		return true
	default:
		return false
	}
}

func tableValue(rows [][]*float64, index int) *float64 {
	if index < 0 || index >= len(rows) || len(rows[index]) == 0 {
		return nil
	}
	return rows[index][0]
}
