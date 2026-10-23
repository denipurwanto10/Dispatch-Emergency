package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"dispatch/internal/auth"
	"dispatch/internal/config"
	"dispatch/internal/database"
	"dispatch/internal/router"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("konfigurasi: %v", err)
	}

	port, err := cfg.PortNumber()
	if err != nil {
		log.Fatalf("konfigurasi: %v", err)
	}

	if len(cfg.JWTSecret) < 16 {
		log.Fatal("konfigurasi: JWT_SECRET wajib diisi minimal 16 karakter")
	}

	ctx := context.Background()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()

	manager := auth.NewManager(cfg.JWTSecret, cfg.JWTTTL)
	engine, simulator := router.New(cfg, db, manager)
	simulator.Start()
	defer simulator.Stop()

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", port),
		Handler:           engine,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Channel to wait for shutdown signal
	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("Dispatch backend berjalan di http://localhost:%d", port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http server: %v", err)
		}
	}()

	// Wait for shutdown signal
	<-shutdown
	log.Println("menghentikan server...")
	signal.Stop(shutdown)

	graceCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(graceCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}
