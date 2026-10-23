package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Config berisi seluruh konfigurasi runtime Dispatch.
// Semua nilai berasal dari environment variable (opsional dari file .env lokal).
type Config struct {
	Port               string
	DatabaseURL        string
	JWTSecret          string
	JWTTTL             time.Duration
	CORSOrigins        []string
	MigrationsDir      string
	OSRMBaseURL        string
	DispatchRadiusM    int
	SimSpeedMultiplier int
}

func Load() (Config, error) {
	// .env hanya untuk kemudahan pengembangan lokal. Environment variable
	// yang sudah ada tidak ditimpa.
	_ = godotenv.Load()

	cfg := Config{
		Port:          getenv("PORT", "8080"),
		DatabaseURL:   strings.TrimSpace(os.Getenv("DATABASE_URL")),
		JWTSecret:     strings.TrimSpace(os.Getenv("JWT_SECRET")),
		MigrationsDir: getenv("MIGRATIONS_DIR", "./migrations"),
		OSRMBaseURL:   strings.TrimRight(strings.TrimSpace(getenv("OSRM_BASE_URL", "https://router.project-osrm.org")), "/"),
	}

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL wajib diisi")
	}

	ttl, err := time.ParseDuration(getenv("JWT_TTL", "24h"))
	if err != nil {
		return Config{}, fmt.Errorf("JWT_TTL tidak valid: %w", err)
	}
	cfg.JWTTTL = ttl

	origins := getenv("CORS_ORIGIN", "http://localhost:5173")
	for _, origin := range strings.Split(origins, ",") {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			cfg.CORSOrigins = append(cfg.CORSOrigins, trimmed)
		}
	}

	rawRadius := strings.TrimSpace(getenv("DISPATCH_RADIUS_M", "50000"))
	radius, err := strconv.Atoi(rawRadius)
	if err != nil || radius <= 0 {
		return Config{}, fmt.Errorf("DISPATCH_RADIUS_M tidak valid: %q", rawRadius)
	}
	cfg.DispatchRadiusM = radius

	rawSimSpeed := strings.TrimSpace(getenv("SIM_SPEED_MULTIPLIER", "20"))
	simSpeed, err := strconv.Atoi(rawSimSpeed)
	if err != nil || simSpeed <= 0 {
		return Config{}, fmt.Errorf("SIM_SPEED_MULTIPLIER tidak valid: %q", rawSimSpeed)
	}
	cfg.SimSpeedMultiplier = simSpeed

	if cfg.OSRMBaseURL == "" {
		return Config{}, fmt.Errorf("OSRM_BASE_URL tidak boleh kosong")
	}

	return cfg, nil
}

func getenv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

// PortNumber mengembalikan PORT sebagai angka untuk dipakai http.Server.
func (c Config) PortNumber() (int, error) {
	port, err := strconv.Atoi(c.Port)
	if err != nil || port < 1 || port > 65535 {
		return 0, fmt.Errorf("PORT tidak valid: %q", c.Port)
	}
	return port, nil
}
