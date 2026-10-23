package handler

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/mail"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"

	"dispatch/internal/geo"
	"dispatch/internal/httpx"
	"dispatch/internal/middleware"
	"dispatch/internal/repository"
)

type AdminHandler struct {
	users    *repository.UserRepository
	vehicles *repository.VehicleRepository
}

func NewAdminHandler(users *repository.UserRepository, vehicles *repository.VehicleRepository) *AdminHandler {
	return &AdminHandler{users: users, vehicles: vehicles}
}

// ListUsers mengembalikan daftar user tanpa password_hash.
func (h *AdminHandler) ListUsers(c *gin.Context) {
	users, err := h.users.List(c.Request.Context())
	if err != nil {
		log.Printf("admin/users: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil daftar user.")
		return
	}

	c.JSON(http.StatusOK, gin.H{"users": users})
}

// ---------- Admin users ----------

type createUserRequest struct {
	Name          string `json:"name"`
	Email         string `json:"email"`
	Password      string `json:"password"`
	Role          string `json:"role"`
	OperatingCity string `json:"operating_city"`
}

type updateUserRequest struct {
	Name          string `json:"name"`
	Password      string `json:"password"`
	Role          string `json:"role"`
	OperatingCity string `json:"operating_city"`
}

func (h *AdminHandler) CreateUser(c *gin.Context) {
	var req createUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid_request", "Body user tidak valid.")
		return
	}

	name, email, role, city, message := validateUserFields(
		req.Name, req.Email, req.Role, req.OperatingCity,
	)
	if message != "" {
		httpx.Error(c, http.StatusBadRequest, "invalid_user", message)
		return
	}
	if email == "" {
		httpx.Error(c, http.StatusBadRequest, "invalid_email", "Email wajib diisi.")
		return
	}
	if len(req.Password) < 6 {
		httpx.Error(c, http.StatusBadRequest, "invalid_password", "Password minimal 6 karakter.")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("admin/users: hash password: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengamankan password.")
		return
	}

	user, err := h.users.Create(c.Request.Context(), repository.CreateUserParams{
		Email:         email,
		PasswordHash:  string(hash),
		Role:          role,
		Name:          name,
		OperatingCity: city,
	})
	if err != nil {
		if code, constraint := pgErrorInfo(err); code == "23505" && constraint == "users_email_key" {
			httpx.Error(c, http.StatusConflict, "email_duplicate", "Email sudah dipakai user lain.")
			return
		}
		log.Printf("admin/users: buat: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal membuat user.")
		return
	}

	c.JSON(http.StatusCreated, gin.H{"user": user})
}

func (h *AdminHandler) UpdateUser(c *gin.Context) {
	id, ok := parseAdminID(c)
	if !ok {
		return
	}

	var req updateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid_request", "Body user tidak valid.")
		return
	}

	current, err := h.users.GetByID(c.Request.Context(), id)
	if errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusNotFound, "not_found", "User tidak ditemukan.")
		return
	}
	if err != nil {
		log.Printf("admin/users: ambil: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil user.")
		return
	}

	name, _, role, city, message := validateUserFields(
		req.Name, current.Email, req.Role, req.OperatingCity,
	)
	if message != "" {
		httpx.Error(c, http.StatusBadRequest, "invalid_user", message)
		return
	}

	if current.Role == "driver" && role != "driver" {
		count, err := h.users.CountVehiclesForDriver(c.Request.Context(), id)
		if err != nil {
			log.Printf("admin/users: hitung kendaraan: %v", err)
			httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal memeriksa kendaraan driver.")
			return
		}
		if count > 0 {
			httpx.Error(c, http.StatusConflict, "driver_has_vehicles",
				"Driver masih terhubung ke kendaraan. Lepaskan driver dari kendaraan terlebih dahulu.")
			return
		}
	}

	var passwordHash *string
	if req.Password != "" {
		if len(req.Password) < 6 {
			httpx.Error(c, http.StatusBadRequest, "invalid_password", "Password minimal 6 karakter.")
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			log.Printf("admin/users: hash password: %v", err)
			httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengamankan password.")
			return
		}
		value := string(hash)
		passwordHash = &value
	}

	user, err := h.users.Update(c.Request.Context(), id, repository.UpdateUserParams{
		Name:          name,
		Role:          role,
		OperatingCity: city,
		PasswordHash:  passwordHash,
	})
	if errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusNotFound, "not_found", "User tidak ditemukan.")
		return
	}
	if err != nil {
		log.Printf("admin/users: ubah: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengubah user.")
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": user})
}

func (h *AdminHandler) DeleteUser(c *gin.Context) {
	id, ok := parseAdminID(c)
	if !ok {
		return
	}

	currentUserID, exists := currentUserID(c)
	if !exists {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized", "Identitas user tidak ditemukan.")
		return
	}
	if id == currentUserID {
		httpx.Error(c, http.StatusConflict, "cannot_delete_self", "Tidak bisa menghapus akun sendiri.")
		return
	}

	user, err := h.users.GetByID(c.Request.Context(), id)
	if errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusNotFound, "not_found", "User tidak ditemukan.")
		return
	}
	if err != nil {
		log.Printf("admin/users: ambil: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil user.")
		return
	}

	if user.Role == "admin" {
		count, err := h.users.CountAdmins(c.Request.Context())
		if err != nil {
			log.Printf("admin/users: hitung admin: %v", err)
			httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal memeriksa admin.")
			return
		}
		if count <= 1 {
			httpx.Error(c, http.StatusConflict, "last_admin", "Admin terakhir tidak boleh dihapus.")
			return
		}
	}

	if user.Role == "driver" {
		vehicleCount, err := h.users.CountVehiclesForDriver(c.Request.Context(), id)
		if err != nil {
			log.Printf("admin/users: hitung kendaraan: %v", err)
			httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal memeriksa kendaraan driver.")
			return
		}
		if vehicleCount > 0 {
			httpx.Error(c, http.StatusConflict, "driver_has_vehicles",
				"Driver masih terhubung ke kendaraan. Lepaskan driver dari kendaraan terlebih dahulu.")
			return
		}

		activeCount, err := h.users.CountActiveAssignmentsForDriver(c.Request.Context(), id)
		if err != nil {
			log.Printf("admin/users: hitung assignment: %v", err)
			httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal memeriksa assignment driver.")
			return
		}
		if activeCount > 0 {
			httpx.Error(c, http.StatusConflict, "driver_has_active_assignment",
				"Driver masih memiliki assignment aktif.")
			return
		}
	}

	if err := h.users.Delete(c.Request.Context(), id); err != nil {
		if code, _ := pgErrorInfo(err); code == "23503" {
			httpx.Error(c, http.StatusConflict, "user_in_use",
				"User masih dipakai data insiden atau assignment dan tidak bisa dihapus.")
			return
		}
		if errors.Is(err, repository.ErrNotFound) {
			httpx.Error(c, http.StatusNotFound, "not_found", "User tidak ditemukan.")
			return
		}
		log.Printf("admin/users: hapus: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal menghapus user.")
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "User dihapus."})
}

// ---------- Admin vehicles ----------

func (h *AdminHandler) ListVehicles(c *gin.Context) {
	city := strings.TrimSpace(c.Query("city"))
	if city != "" {
		canonical, valid := geo.Canonical(city)
		if !valid {
			httpx.Error(c, http.StatusBadRequest, "invalid_city", "Kota operasi tidak valid.")
			return
		}
		city = canonical
	}

	vehicles, err := h.vehicles.AdminList(c.Request.Context(), city)
	if err != nil {
		log.Printf("admin/vehicles: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil daftar kendaraan.")
		return
	}

	c.JSON(http.StatusOK, gin.H{"vehicles": vehicles})
}

type createVehicleRequest struct {
	Name          string   `json:"name"`
	Plate         string   `json:"plate"`
	Type          string   `json:"type"`
	OperatingCity string   `json:"operating_city"`
	HomeLat       *float64 `json:"home_lat"`
	HomeLng       *float64 `json:"home_lng"`
	DriverID      *int64   `json:"driver_id"`
}

func (h *AdminHandler) CreateVehicle(c *gin.Context) {
	var req createVehicleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid_request", "Body kendaraan tidak valid.")
		return
	}

	name := strings.TrimSpace(req.Name)
	plate := strings.TrimSpace(req.Plate)
	vehicleType := strings.TrimSpace(req.Type)
	if name == "" || plate == "" {
		httpx.Error(c, http.StatusBadRequest, "invalid_vehicle", "Nama dan plat wajib diisi.")
		return
	}
	if !isVehicleType(vehicleType) {
		httpx.Error(c, http.StatusBadRequest, "invalid_type", "Tipe harus ambulance, fire, atau police.")
		return
	}
	city, valid := geo.Canonical(req.OperatingCity)
	if !valid {
		httpx.Error(c, http.StatusBadRequest, "invalid_city", "Kota operasi harus salah satu dari 6 kota operasi.")
		return
	}
	if req.HomeLat == nil || req.HomeLng == nil {
		httpx.Error(c, http.StatusBadRequest, "invalid_coordinates", "home_lat dan home_lng wajib diisi.")
		return
	}
	if !geo.WithinCity(city, *req.HomeLat, *req.HomeLng) {
		httpx.Error(c, http.StatusBadRequest, "invalid_coordinates", "Koordinat home berada di luar wilayah kota.")
		return
	}
	if req.DriverID != nil {
		if err := h.validateDriver(c, *req.DriverID, city); err != nil {
			return
		}
	}

	vehicle, err := h.vehicles.CreateVehicle(c.Request.Context(), repository.CreateVehicleParams{
		Name:          name,
		Plate:         plate,
		Type:          vehicleType,
		OperatingCity: city,
		HomeLat:       *req.HomeLat,
		HomeLng:       *req.HomeLng,
		DriverID:      req.DriverID,
	})
	if err != nil {
		if code, constraint := pgErrorInfo(err); code == "23505" && constraint == "vehicles_plate_key" {
			httpx.Error(c, http.StatusConflict, "plate_duplicate", "Plat kendaraan sudah dipakai.")
			return
		}
		log.Printf("admin/vehicles: buat: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal membuat kendaraan.")
		return
	}

	c.JSON(http.StatusCreated, gin.H{"vehicle": vehicle})
}

type optionalInt64 struct {
	Set   bool
	Value *int64
}

func (o *optionalInt64) UnmarshalJSON(data []byte) error {
	o.Set = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	var value int64
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	o.Value = &value
	return nil
}

type updateVehicleRequest struct {
	Name          *string       `json:"name"`
	Plate         *string       `json:"plate"`
	Type          *string       `json:"type"`
	OperatingCity *string       `json:"operating_city"`
	HomeLat       *float64      `json:"home_lat"`
	HomeLng       *float64      `json:"home_lng"`
	DriverID      optionalInt64 `json:"driver_id"`
	Status        *string       `json:"status"`
}

func (h *AdminHandler) UpdateVehicle(c *gin.Context) {
	id, ok := parseAdminID(c)
	if !ok {
		return
	}

	var req updateVehicleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid_request", "Body kendaraan tidak valid.")
		return
	}

	current, err := h.vehicles.AdminGetByID(c.Request.Context(), id)
	if errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusNotFound, "not_found", "Kendaraan tidak ditemukan.")
		return
	}
	if err != nil {
		log.Printf("admin/vehicles: ambil: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil kendaraan.")
		return
	}

	name := current.Name
	if req.Name != nil {
		name = strings.TrimSpace(*req.Name)
	}
	plate := current.Plate
	if req.Plate != nil {
		plate = strings.TrimSpace(*req.Plate)
	}
	vehicleType := current.Type
	if req.Type != nil {
		vehicleType = strings.TrimSpace(*req.Type)
	}
	city := ""
	if current.OperatingCity != nil {
		city = *current.OperatingCity
	}
	if req.OperatingCity != nil {
		city = strings.TrimSpace(*req.OperatingCity)
	}
	homeLat := current.HomeLat
	homeLng := current.HomeLng
	if req.HomeLat != nil {
		homeLat = *req.HomeLat
	}
	if req.HomeLng != nil {
		homeLng = *req.HomeLng
	}
	driverID := current.DriverID
	if req.DriverID.Set {
		driverID = req.DriverID.Value
	}
	status := current.Status
	statusRequested := req.Status != nil && strings.TrimSpace(*req.Status) != ""
	if statusRequested {
		status = strings.TrimSpace(*req.Status)
	}

	if name == "" || plate == "" {
		httpx.Error(c, http.StatusBadRequest, "invalid_vehicle", "Nama dan plat wajib diisi.")
		return
	}
	if !isVehicleType(vehicleType) {
		httpx.Error(c, http.StatusBadRequest, "invalid_type", "Tipe harus ambulance, fire, atau police.")
		return
	}
	canonicalCity, valid := geo.Canonical(city)
	if !valid {
		httpx.Error(c, http.StatusBadRequest, "invalid_city", "Kota operasi harus salah satu dari 6 kota operasi.")
		return
	}
	city = canonicalCity
	if (req.HomeLat == nil) != (req.HomeLng == nil) {
		httpx.Error(c, http.StatusBadRequest, "invalid_coordinates", "home_lat dan home_lng harus diisi bersamaan.")
		return
	}
	if !geo.WithinCity(city, homeLat, homeLng) {
		httpx.Error(c, http.StatusBadRequest, "invalid_coordinates", "Koordinat home berada di luar wilayah kota.")
		return
	}

	if statusRequested && status != "available" && status != "offline" {
		httpx.Error(c, http.StatusBadRequest, "invalid_status", "Status manual hanya available atau offline.")
		return
	}
	if req.DriverID.Set && driverID != nil {
		if err := h.validateDriver(c, *driverID, city); err != nil {
			return
		}
	}

	sensitiveChanged := !int64PtrEqual(current.DriverID, driverID) ||
		(current.OperatingCity == nil || *current.OperatingCity != city) ||
		current.HomeLat != homeLat || current.HomeLng != homeLng ||
		current.Status != status

	activeCount, err := h.vehicles.CountActiveAssignments(c.Request.Context(), id)
	if err != nil {
		log.Printf("admin/vehicles: hitung assignment: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal memeriksa assignment kendaraan.")
		return
	}
	if activeCount > 0 && sensitiveChanged {
		httpx.Error(c, http.StatusConflict, "vehicle_has_active_assignment",
			"Kendaraan punya assignment aktif. Driver, kota, home, dan status tidak bisa diubah sebelum assignment selesai.")
		return
	}

	homeChanged := current.HomeLat != homeLat || current.HomeLng != homeLng
	vehicle, err := h.vehicles.UpdateVehicle(c.Request.Context(), id, repository.UpdateVehicleParams{
		Name:          name,
		Plate:         plate,
		Type:          vehicleType,
		OperatingCity: city,
		HomeLat:       homeLat,
		HomeLng:       homeLng,
		DriverID:      driverID,
		Status:        status,
		ResetPosition: homeChanged || (current.OperatingCity == nil || *current.OperatingCity != city),
	})
	if errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusNotFound, "not_found", "Kendaraan tidak ditemukan.")
		return
	}
	if err != nil {
		if code, constraint := pgErrorInfo(err); code == "23505" && constraint == "vehicles_plate_key" {
			httpx.Error(c, http.StatusConflict, "plate_duplicate", "Plat kendaraan sudah dipakai.")
			return
		}
		log.Printf("admin/vehicles: ubah: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengubah kendaraan.")
		return
	}

	c.JSON(http.StatusOK, gin.H{"vehicle": vehicle})
}

func (h *AdminHandler) DeleteVehicle(c *gin.Context) {
	id, ok := parseAdminID(c)
	if !ok {
		return
	}

	if _, err := h.vehicles.AdminGetByID(c.Request.Context(), id); errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusNotFound, "not_found", "Kendaraan tidak ditemukan.")
		return
	} else if err != nil {
		log.Printf("admin/vehicles: ambil: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil kendaraan.")
		return
	}

	activeCount, err := h.vehicles.CountActiveAssignments(c.Request.Context(), id)
	if err != nil {
		log.Printf("admin/vehicles: hitung assignment: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal memeriksa assignment kendaraan.")
		return
	}
	if activeCount > 0 {
		httpx.Error(c, http.StatusConflict, "vehicle_has_active_assignment",
			"Kendaraan masih punya assignment aktif dan tidak bisa dihapus.")
		return
	}

	if err := h.vehicles.DeleteVehicle(c.Request.Context(), id); err != nil {
		if code, _ := pgErrorInfo(err); code == "23503" {
			httpx.Error(c, http.StatusConflict, "vehicle_in_use",
				"Kendaraan masih dipakai data lain dan tidak bisa dihapus.")
			return
		}
		if errors.Is(err, repository.ErrNotFound) {
			httpx.Error(c, http.StatusNotFound, "not_found", "Kendaraan tidak ditemukan.")
			return
		}
		log.Printf("admin/vehicles: hapus: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal menghapus kendaraan.")
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Kendaraan dihapus."})
}

// ---------- Helpers ----------

func validateUserFields(name, email, role, city string) (string, string, string, *string, string) {
	name = strings.TrimSpace(name)
	email = strings.ToLower(strings.TrimSpace(email))
	role = strings.TrimSpace(role)
	city = strings.TrimSpace(city)

	if name == "" {
		return "", "", "", nil, "Nama wajib diisi."
	}
	if email != "" {
		parsed, err := mail.ParseAddress(email)
		if err != nil || parsed.Address != email {
			return "", "", "", nil, "Format email tidak valid."
		}
	}
	if role != "dispatcher" && role != "driver" && role != "admin" {
		return "", "", "", nil, "Role harus dispatcher, driver, atau admin."
	}

	var operatingCity *string
	switch role {
	case "admin":
		operatingCity = nil
	case "driver":
		canonical, ok := geo.Canonical(city)
		if !ok {
			return "", "", "", nil, "Driver wajib punya operating_city yang valid."
		}
		operatingCity = &canonical
	default:
		if city != "" {
			canonical, ok := geo.Canonical(city)
			if !ok {
				return "", "", "", nil, "Kota operasi tidak valid."
			}
			operatingCity = &canonical
		}
	}

	return name, email, role, operatingCity, ""
}

func (h *AdminHandler) validateDriver(c *gin.Context, driverID int64, city string) error {
	driver, err := h.users.GetByID(c.Request.Context(), driverID)
	if errors.Is(err, repository.ErrNotFound) {
		httpx.Error(c, http.StatusBadRequest, "invalid_driver", "Driver tidak ditemukan.")
		return err
	}
	if err != nil {
		log.Printf("admin/vehicles: ambil driver: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal mengambil driver.")
		return err
	}
	if driver.Role != "driver" {
		httpx.Error(c, http.StatusBadRequest, "invalid_driver", "User yang dipilih bukan driver.")
		return errors.New("bukan driver")
	}
	if driver.OperatingCity == nil || *driver.OperatingCity != city {
		httpx.Error(c, http.StatusConflict, "driver_wrong_city",
			"Driver harus berada di operating_city yang sama dengan kendaraan.")
		return errors.New("kota driver tidak sama")
	}
	return nil
}

func currentUserID(c *gin.Context) (int64, bool) {
	value, exists := c.Get(middleware.ContextUserID)
	if !exists {
		return 0, false
	}
	id, ok := value.(int64)
	if !ok || id <= 0 {
		return 0, false
	}
	return id, true
}

func parseAdminID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		httpx.Error(c, http.StatusBadRequest, "invalid_id", "ID tidak valid.")
		return 0, false
	}
	return id, true
}

func pgErrorInfo(err error) (string, string) {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code, pgErr.ConstraintName
	}
	return "", ""
}

func int64PtrEqual(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func isVehicleType(value string) bool {
	switch value {
	case "ambulance", "fire", "police":
		return true
	default:
		return false
	}
}
