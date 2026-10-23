package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	"dispatch/internal/config"
	"dispatch/internal/database"
)

const (
	expectedUsers    = 14
	expectedVehicles = 36
)

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

	if err := resetDemo(ctx, db); err != nil {
		log.Fatalf("reset demo gagal: %v", err)
	}
}

// resetDemo menghapus seluruh data uji/demo (assignment dan insiden),
// mengembalikan semua kendaraan ke home_geom dengan status available, lalu
// memastikan baseline seed tetap 14 user / 36 kendaraan. User dan kendaraan
// seed tidak dihapus.
func resetDemo(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("mulai transaksi: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var userCount, vehicleCount int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&userCount); err != nil {
		return fmt.Errorf("hitung user sebelum reset: %w", err)
	}
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM vehicles`).Scan(&vehicleCount); err != nil {
		return fmt.Errorf("hitung kendaraan sebelum reset: %w", err)
	}
	if userCount != expectedUsers || vehicleCount != expectedVehicles {
		return fmt.Errorf(
			"baseline seed tidak sesuai: %d user / %d kendaraan (diharapkan %d / %d); jalankan go run ./cmd/seed dan bersihkan data non-seed terlebih dahulu",
			userCount, vehicleCount, expectedUsers, expectedVehicles,
		)
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM assignments`); err != nil {
		return fmt.Errorf("hapus assignment: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM incidents`); err != nil {
		return fmt.Errorf("hapus insiden: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE vehicles
		SET status = 'available',
		    pos_geom = home_geom,
		    pos_updated_at = now()`); err != nil {
		return fmt.Errorf("reset posisi/status kendaraan: %w", err)
	}

	var assignmentCount, incidentCount, activeVehicleCount int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM assignments`).Scan(&assignmentCount); err != nil {
		return fmt.Errorf("hitung assignment setelah reset: %w", err)
	}
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM incidents`).Scan(&incidentCount); err != nil {
		return fmt.Errorf("hitung insiden setelah reset: %w", err)
	}
	if err := tx.QueryRowContext(ctx,
		`SELECT count(*) FROM vehicles WHERE status <> 'available'`).Scan(&activeVehicleCount); err != nil {
		return fmt.Errorf("hitung kendaraan tidak available: %w", err)
	}
	if assignmentCount != 0 || incidentCount != 0 || activeVehicleCount != 0 {
		return fmt.Errorf(
			"reset tidak bersih: %d assignment, %d insiden, %d kendaraan tidak available",
			assignmentCount, incidentCount, activeVehicleCount,
		)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit reset: %w", err)
	}

	log.Printf("reset demo selesai: 0 insiden, 0 assignment, %d kendaraan available", vehicleCount)
	log.Printf("baseline seed: %d user, %d kendaraan", userCount, vehicleCount)
	return nil
}
