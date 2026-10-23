package handler

import (
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"dispatch/internal/httpx"
	"dispatch/internal/repository"
)

type VehicleHandler struct {
	vehicles *repository.VehicleRepository
}

func NewVehicleHandler(vehicles *repository.VehicleRepository) *VehicleHandler {
	return &VehicleHandler{vehicles: vehicles}
}

func (h *VehicleHandler) List(c *gin.Context) {
	city := strings.TrimSpace(c.Query("city"))

	vehicles, err := h.vehicles.List(c.Request.Context(), city)
	if err != nil {
		log.Printf("vehicles: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil daftar kendaraan.")
		return
	}

	c.JSON(http.StatusOK, gin.H{"vehicles": vehicles})
}
