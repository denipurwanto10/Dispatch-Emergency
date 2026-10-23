package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"

	"dispatch/internal/config"
	"dispatch/internal/database"
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

	if err := run(ctx, db, cfg.MigrationsDir); err != nil {
		log.Fatalf("migrasi gagal: %v", err)
	}
}

func run(ctx context.Context, db *sql.DB, dir string) error {
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("buat tabel schema_migrations: %w", err)
	}

	files, err := filepath.Glob(filepath.Join(dir, "*.sql"))
	if err != nil {
		return fmt.Errorf("baca folder migrasi: %w", err)
	}
	if len(files) == 0 {
		return fmt.Errorf("tidak ada file .sql di %s", dir)
	}
	sort.Strings(files)

	applied := 0
	for _, file := range files {
		version := filepath.Base(file)

		var exists bool
		if err := db.QueryRowContext(ctx,
			`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, version,
		).Scan(&exists); err != nil {
			return fmt.Errorf("cek status migrasi %s: %w", version, err)
		}
		if exists {
			log.Printf("[skip]    %s (sudah diterapkan)", version)
			continue
		}

		content, err := os.ReadFile(file)
		if err != nil {
			return fmt.Errorf("baca %s: %w", version, err)
		}

		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("mulai transaksi %s: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx, string(content)); err != nil {
			tx.Rollback()
			return fmt.Errorf("jalankan %s: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO schema_migrations (version) VALUES ($1)`, version,
		); err != nil {
			tx.Rollback()
			return fmt.Errorf("catat migrasi %s: %w", version, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migrasi %s: %w", version, err)
		}

		log.Printf("[applied] %s", version)
		applied++
	}

	log.Printf("migrasi selesai: %d baru diterapkan, %d total file", applied, len(files))
	return nil
}
