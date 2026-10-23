package handler

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"dispatch/internal/auth"
	"dispatch/internal/httpx"
	"dispatch/internal/repository"
)

type AuthHandler struct {
	users   *repository.UserRepository
	manager *auth.Manager
}

func NewAuthHandler(users *repository.UserRepository, manager *auth.Manager) *AuthHandler {
	return &AuthHandler{users: users, manager: manager}
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid_request", "Body harus berisi email dan password.")
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" || req.Password == "" {
		httpx.Error(c, http.StatusBadRequest, "invalid_request", "Email dan password wajib diisi.")
		return
	}

	user, err := h.users.FindByEmail(c.Request.Context(), email)
	if errors.Is(err, repository.ErrNotFound) {
		// Pesan sengaja sama dengan password salah agar tidak membocorkan
		// apakah sebuah email terdaftar.
		httpx.Error(c, http.StatusUnauthorized, "invalid_credentials", "Email atau password salah.")
		return
	}
	if err != nil {
		log.Printf("login: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Terjadi kesalahan pada server.")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		httpx.Error(c, http.StatusUnauthorized, "invalid_credentials", "Email atau password salah.")
		return
	}

	token, err := h.manager.Generate(user)
	if err != nil {
		log.Printf("login: %v", err)
		httpx.Error(c, http.StatusInternalServerError, "internal_error", "Gagal membuat token.")
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user": gin.H{
			"id":             user.ID,
			"name":           user.Name,
			"email":          user.Email,
			"role":           user.Role,
			"operating_city": user.OperatingCity,
		},
	})
}
