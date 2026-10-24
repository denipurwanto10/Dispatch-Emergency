package middleware

import (
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"dispatch/internal/auth"
	"dispatch/internal/httpx"
)

const (
	ContextUserID = "user_id"
	ContextRole   = "role"
	ContextName   = "name"
	ContextEmail  = "email"
)

// RequireAuth memvalidasi Bearer JWT dan menaruh identitas user di context.
func RequireAuth(manager *auth.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" || !strings.HasPrefix(header, "Bearer ") {
			httpx.Error(c, http.StatusUnauthorized, "unauthorized", "Token Bearer wajib disertakan.")
			return
		}

		raw := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
		if raw == "" {
			httpx.Error(c, http.StatusUnauthorized, "unauthorized", "Token tidak boleh kosong.")
			return
		}

		claims, err := manager.Parse(raw)
		if err != nil {
			httpx.Error(c, http.StatusUnauthorized, "unauthorized", "Token tidak valid atau sudah kedaluwarsa.")
			return
		}

		c.Set(ContextUserID, claims.UserID)
		c.Set(ContextRole, claims.Role)
		c.Set(ContextName, claims.Name)
		c.Set(ContextEmail, claims.Email)
		c.Next()
	}
}

// RequireRole hanya meloloskan user dengan salah satu role yang diberikan.
// Perbandingan role dinormalisasi (trim + lowercase) agar nilai dari JWT
// seperti "Admin" atau " admin " tetap dikenali sebagai "admin".
func RequireRole(roles ...string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		allowed[normalizeRole(role)] = struct{}{}
	}

	return func(c *gin.Context) {
		roleValue, ok := c.Get(ContextRole)
		role, isString := roleValue.(string)
		if !ok || !isString {
			httpx.Error(c, http.StatusUnauthorized, "unauthorized", "Identitas user tidak ditemukan.")
			return
		}
		if _, ok := allowed[normalizeRole(role)]; !ok {
			log.Printf("middleware: role %q ditolak pada %s %s", role, c.Request.Method, c.Request.URL.Path)
			httpx.Error(c, http.StatusForbidden, "forbidden", "Role kamu tidak punya akses ke endpoint ini.")
			return
		}
		c.Next()
	}
}

func normalizeRole(role string) string {
	return strings.ToLower(strings.TrimSpace(role))
}

// CORS mengizinkan origin frontend yang terdaftar lewat CORS_ORIGIN.
func CORS(origins []string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		allowed[origin] = struct{}{}
	}

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if _, ok := allowed[origin]; ok && origin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Vary", "Origin")
			c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			c.Writer.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			c.Writer.Header().Set("Access-Control-Max-Age", "600")
		}

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
