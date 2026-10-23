package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	"golang.org/x/crypto/bcrypt"

	"dispatch/internal/config"
	"dispatch/internal/database"
)

const demoPassword = "Dispatch123!"

type seedCity struct {
	Name        string
	Lat         float64
	Lng         float64
	PlatePrefix string
}

type seedUser struct {
	Email         string
	Name          string
	Role          string
	OperatingCity *string
}

type seedVehicle struct {
	Name          string
	Plate         string
	Type          string
	OperatingCity string
	DriverEmail   string // kosong = tanpa driver
	Lat           float64
	Lng           float64
}

// 6 kota operasi Fase 1.5.
var seedCities = []seedCity{
	{Name: "Medan", Lat: 3.5952, Lng: 98.6722, PlatePrefix: "BK"},
	{Name: "Jakarta", Lat: -6.2088, Lng: 106.8456, PlatePrefix: "B"},
	{Name: "Bandung", Lat: -6.9175, Lng: 107.6191, PlatePrefix: "D"},
	{Name: "Semarang", Lat: -6.9667, Lng: 110.4167, PlatePrefix: "H"},
	{Name: "Surabaya", Lat: -7.2575, Lng: 112.7521, PlatePrefix: "L"},
	{Name: "Makassar", Lat: -5.1477, Lng: 119.4327, PlatePrefix: "DD"},
}

// Offset deterministik < 0.03 derajat (~3 km) dari pusat kota.
// Enam pola diputar per kota agar sebaran antar-kota tidak identik.
var vehicleOffsets = [][2]float64{
	{0.012, 0.010},
	{-0.016, 0.014},
	{0.018, -0.012},
	{-0.010, -0.019},
	{0.024, 0.004},
	{-0.004, 0.026},
}

var driverNames = map[string][2]string{
	"Medan":    {"Rizky Nasution", "Maya Siregar"},
	"Jakarta":  {"Andi Wijaya", "Rina Kartika"},
	"Bandung":  {"Budi Santoso", "Siti Rahayu"},
	"Semarang": {"Joko Susilo", "Nia Puspita"},
	"Surabaya": {"Hendra Gunawan", "Lestari Wulandari"},
	"Makassar": {"Fajar Ramadhan", "Nurul Hasanah"},
}

var citySlugs = map[string]string{
	"Medan": "medan", "Jakarta": "jakarta", "Bandung": "bandung",
	"Semarang": "semarang", "Surabaya": "surabaya", "Makassar": "makassar",
}

// Data seed lama Fase 1 — dihapus saat upgrade pertama ke cakupan nasional.
var legacyUserEmails = []string{
	"admin@dispatch.local",
	"dispatcher@dispatch.local",
	"driver1@dispatch.local",
	"driver2@dispatch.local",
	"driver3@dispatch.local",
}

// Email admin/dispatcher dipakai ulang di seed nasional, jadi hanya driver
// lama yang dijadikan penanda upgrade. Ini mencegah seed ulang menghapus
// admin/dispatcher (dan data yang mungkin sudah terhubung) di masa depan.
var legacyDriverEmails = []string{
	"driver1@dispatch.local",
	"driver2@dispatch.local",
	"driver3@dispatch.local",
}

var legacyVehiclePlates = []string{
	"D 9001 AM", "D 9002 PM", "D 9003 PL",
	"D 9004 AM", "D 9005 PM", "D 9006 PL",
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("konfigurasi: %v", err)
	}

	ctx := context.Background()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()

	hash, err := bcrypt.GenerateFromPassword([]byte(demoPassword), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("hash password: %v", err)
	}

	users, vehicles := buildSeedData()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		log.Fatalf("mulai transaksi: %v", err)
	}
	defer tx.Rollback()

	if err := removeLegacySeed(ctx, tx, legacyUserEmails, legacyDriverEmails, legacyVehiclePlates); err != nil {
		log.Fatalf("hapus seed lama: %v", err)
	}

	userIDs := make(map[string]int64, len(users))
	for _, user := range users {
		var id int64
		err := tx.QueryRowContext(ctx, `
			INSERT INTO users (email, password_hash, role, name, operating_city)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (email) DO UPDATE SET
				password_hash = EXCLUDED.password_hash,
				role = EXCLUDED.role,
				name = EXCLUDED.name,
				operating_city = EXCLUDED.operating_city
			RETURNING id`,
			user.Email, string(hash), user.Role, user.Name, user.OperatingCity,
		).Scan(&id)
		if err != nil {
			log.Fatalf("seed user %s: %v", user.Email, err)
		}
		userIDs[user.Email] = id
	}

	for _, vehicle := range vehicles {
		var driverID any
		if vehicle.DriverEmail != "" {
			driverID = userIDs[vehicle.DriverEmail]
		}

		_, err := tx.ExecContext(ctx, `
			INSERT INTO vehicles
				(name, plate, type, driver_id, pos_geom, home_geom, status,
				 pos_updated_at, operating_city)
			VALUES
				($1, $2, $3, $4,
				 ST_SetSRID(ST_MakePoint($5, $6), 4326),
				 ST_SetSRID(ST_MakePoint($5, $6), 4326),
				 'available', now(), $7)
			ON CONFLICT (plate) DO UPDATE SET
				name = EXCLUDED.name,
				type = EXCLUDED.type,
				driver_id = EXCLUDED.driver_id,
				pos_geom = EXCLUDED.pos_geom,
				home_geom = EXCLUDED.home_geom,
				status = 'available',
				pos_updated_at = now(),
				operating_city = EXCLUDED.operating_city`,
			vehicle.Name, vehicle.Plate, vehicle.Type, driverID,
			vehicle.Lng, vehicle.Lat, vehicle.OperatingCity,
		)
		if err != nil {
			log.Fatalf("seed kendaraan %s: %v", vehicle.Plate, err)
		}
	}

	if err := tx.Commit(); err != nil {
		log.Fatalf("commit seed: %v", err)
	}

	var userCount, vehicleCount int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&userCount); err != nil {
		log.Fatalf("hitung user: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM vehicles`).Scan(&vehicleCount); err != nil {
		log.Fatalf("hitung kendaraan: %v", err)
	}

	log.Printf("seed selesai: %d user, %d kendaraan", userCount, vehicleCount)
	log.Printf("password semua akun demo: %s", demoPassword)
	for _, city := range seedCities {
		var cityVehicles int
		if err := db.QueryRowContext(ctx,
			`SELECT count(*) FROM vehicles WHERE operating_city = $1`, city.Name,
		).Scan(&cityVehicles); err != nil {
			log.Fatalf("hitung kendaraan %s: %v", city.Name, err)
		}
		log.Printf("  %-9s %d kendaraan", city.Name, cityVehicles)
	}
}

// removeLegacySeed hanya menghapus data demo Fase 1. Setelah upgrade pertama,
// data lama tidak ada lagi sehingga pemanggilan seed berikutnya tidak menyentuh
// assignment/insiden yang mungkin sudah dibuat pengguna.
func removeLegacySeed(ctx context.Context, tx *sql.Tx, userEmails, driverEmails, vehiclePlates []string) error {
	var hasLegacy bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM users WHERE email = ANY($1))
		    OR EXISTS (SELECT 1 FROM vehicles WHERE plate = ANY($2))`,
		driverEmails, vehiclePlates,
	).Scan(&hasLegacy); err != nil {
		return fmt.Errorf("deteksi seed lama: %w", err)
	}
	if !hasLegacy {
		return nil
	}

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM assignments
		WHERE vehicle_id IN (SELECT id FROM vehicles WHERE plate = ANY($1))
		   OR assigned_by IN (SELECT id FROM users WHERE email = ANY($2))
		   OR incident_id IN (
		        SELECT id FROM incidents WHERE created_by IN (
		            SELECT id FROM users WHERE email = ANY($2)
		        )
		   )`,
		vehiclePlates, userEmails,
	); err != nil {
		return fmt.Errorf("hapus assignment demo lama: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM incidents WHERE created_by IN (
			SELECT id FROM users WHERE email = ANY($1)
		)`,
		userEmails,
	); err != nil {
		return fmt.Errorf("hapus insiden demo lama: %w", err)
	}

	if _, err := tx.ExecContext(ctx,
		`DELETE FROM vehicles WHERE plate = ANY($1)`, vehiclePlates,
	); err != nil {
		return fmt.Errorf("hapus kendaraan demo lama: %w", err)
	}

	if _, err := tx.ExecContext(ctx,
		`DELETE FROM users WHERE email = ANY($1)`, userEmails,
	); err != nil {
		return fmt.Errorf("hapus user demo lama: %w", err)
	}

	return nil
}

func buildSeedData() ([]seedUser, []seedVehicle) {
	cityDrivers := make(map[string][]string, len(seedCities))

	users := []seedUser{
		{Email: "admin@dispatch.local", Name: "Admin Dispatch", Role: "admin"},
		{Email: "dispatcher@dispatch.local", Name: "Dewi Lestari", Role: "dispatcher"},
	}

	for _, city := range seedCities {
		for i, name := range driverNames[city.Name] {
			email := fmt.Sprintf("driver.%s%d@dispatch.local", citySlugs[city.Name], i+1)
			operatingCity := city.Name
			users = append(users, seedUser{
				Email:         email,
				Name:          name,
				Role:          "driver",
				OperatingCity: &operatingCity,
			})
			cityDrivers[city.Name] = append(cityDrivers[city.Name], email)
		}
	}

	vehicles := make([]seedVehicle, 0, len(seedCities)*6)
	globalNumber := 9100

	for cityIndex, city := range seedCities {
		types := []string{"ambulance", "ambulance", "fire", "fire", "police", "police"}
		label := map[string]string{"ambulance": "Ambulans", "fire": "Damkar", "police": "Patroli"}
		code := map[string]string{"ambulance": "AM", "fire": "PM", "police": "PL"}
		counters := map[string]int{"ambulance": 0, "fire": 0, "police": 0}

		for i, vehicleType := range types {
			globalNumber++
			counters[vehicleType]++
			offset := vehicleOffsets[(i+cityIndex)%len(vehicleOffsets)]

			// Dua driver per kota: satu di ambulans pertama, satu di damkar
			// pertama. Ini menjaga 12 kendaraan berdriver dan membuat skenario
			// demo kebakaran bisa memakai kendaraan fire yang punya driver.
			driverEmail := ""
			if i == 0 {
				driverEmail = cityDrivers[city.Name][0]
			} else if i == 2 {
				driverEmail = cityDrivers[city.Name][1]
			}

			vehicles = append(vehicles, seedVehicle{
				Name:          fmt.Sprintf("%s %s %02d", label[vehicleType], city.Name, counters[vehicleType]),
				Plate:         fmt.Sprintf("%s %d %s", city.PlatePrefix, globalNumber, code[vehicleType]),
				Type:          vehicleType,
				OperatingCity: city.Name,
				DriverEmail:   driverEmail,
				Lat:           city.Lat + offset[0],
				Lng:           city.Lng + offset[1],
			})
		}
	}

	return users, vehicles
}
