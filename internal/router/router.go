package router

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"

	"dispatch/internal/auth"
	"dispatch/internal/config"
	"dispatch/internal/handler"
	"dispatch/internal/httpx"
	"dispatch/internal/middleware"
	"dispatch/internal/osrm"
	"dispatch/internal/repository"
	"dispatch/internal/simulation"
	"dispatch/internal/ws"
)

func New(cfg config.Config, db *sql.DB, manager *auth.Manager) (*gin.Engine, *simulation.Simulator) {
	users := repository.NewUserRepository(db)
	vehicles := repository.NewVehicleRepository(db)
	incidents := repository.NewIncidentRepository(db)
	assignments := repository.NewAssignmentRepository(db)

	healthHandler := handler.NewHealthHandler(db)
	authHandler := handler.NewAuthHandler(users, manager)
	vehicleHandler := handler.NewVehicleHandler(vehicles)
	adminHandler := handler.NewAdminHandler(users, vehicles)

	// WebSocket hub
	wsHub := ws.NewHub(manager)
	go wsHub.Run()

	broadcast := func(eventType string, data any) {
		wsHub.Broadcast(ws.BroadcastEvent{Type: eventType, Data: data})
	}

	incidentHandler := handler.NewIncidentHandler(
		incidents,
		vehicles,
		osrm.NewClient(cfg.OSRMBaseURL),
		cfg.DispatchRadiusM,
		broadcast,
	)

	assignmentHandler := handler.NewAssignmentHandler(
		incidents,
		vehicles,
		assignments,
		osrm.NewClient(cfg.OSRMBaseURL),
		osrm.NewRouteClient(cfg.OSRMBaseURL),
		cfg.SimSpeedMultiplier,
		broadcast,
	)

	// Simulator
	simBroadcast := make(chan simulation.BroadcastEvent, 256)
	simulator := simulation.NewSimulator(
		assignments,
		vehicles,
		incidents,
		db,
		cfg.SimSpeedMultiplier,
		simBroadcast,
	)

	// Bridge simulator broadcast to WebSocket hub
	go func() {
		for event := range simBroadcast {
			wsHub.Broadcast(ws.BroadcastEvent{
				Type: event.Type,
				Data: event.Data,
			})
		}
	}()

	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery(), middleware.CORS(cfg.CORSOrigins))
	r.NoRoute(func(c *gin.Context) {
		httpx.Error(c, http.StatusNotFound, "not_found", "Endpoint tidak ditemukan.")
	})

	r.GET("/health", healthHandler.Check)
	r.POST("/auth/login", authHandler.Login)

	authed := r.Group("/")
	authed.Use(middleware.RequireAuth(manager))
	authed.GET("/vehicles", vehicleHandler.List)

	incidentRoutes := r.Group("/incidents")
	incidentRoutes.Use(middleware.RequireAuth(manager))
	// Admin punya hak penuh seperti dispatcher di Peta Operasi, termasuk
	// membuat dan membatalkan laporan.
	incidentRoutes.POST("", middleware.RequireRole("dispatcher", "admin"), incidentHandler.Create)
	incidentRoutes.POST("/:id/cancel", middleware.RequireRole("dispatcher", "admin"), incidentHandler.Cancel)
	incidentRoutes.GET("", middleware.RequireRole("dispatcher", "admin"), incidentHandler.List)
	incidentRoutes.GET("/:id/nearest", middleware.RequireRole("dispatcher", "admin"), incidentHandler.Nearest)
	incidentRoutes.GET("/:id", middleware.RequireRole("dispatcher", "admin"), incidentHandler.Get)

	// Assignment routes
	assignmentRoutes := r.Group("/assignments")
	assignmentRoutes.Use(middleware.RequireAuth(manager))
	assignmentRoutes.POST("/:id/start", middleware.RequireRole("driver"), assignmentHandler.Start)
	assignmentRoutes.POST("/:id/arrive", middleware.RequireRole("driver"), assignmentHandler.Arrive)
	assignmentRoutes.POST("/:id/complete", middleware.RequireRole("driver", "dispatcher", "admin"), assignmentHandler.Complete)
	assignmentRoutes.GET("/mine/active", middleware.RequireRole("driver"), assignmentHandler.GetMineActive)
	assignmentRoutes.GET("/mine/history", middleware.RequireRole("driver"), assignmentHandler.ListMineHistory)
	assignmentRoutes.GET("/:id", middleware.RequireRole("dispatcher", "admin", "driver"), assignmentHandler.GetByID)

	// Incident assign (dispatcher or admin)
	incidentRoutes.POST("/:id/assign", middleware.RequireRole("dispatcher", "admin"), assignmentHandler.Assign)

	admin := r.Group("/admin")
	admin.Use(middleware.RequireAuth(manager), middleware.RequireRole("admin"))
	admin.GET("/users", adminHandler.ListUsers)
	admin.POST("/users", adminHandler.CreateUser)
	admin.PUT("/users/:id", adminHandler.UpdateUser)
	admin.DELETE("/users/:id", adminHandler.DeleteUser)
	admin.GET("/vehicles", adminHandler.ListVehicles)
	admin.POST("/vehicles", adminHandler.CreateVehicle)
	admin.PUT("/vehicles/:id", adminHandler.UpdateVehicle)
	admin.DELETE("/vehicles/:id", adminHandler.DeleteVehicle)

	// WebSocket
	r.GET("/ws", wsHub.ServeWS)

	// Return engine and simulator for external lifecycle management
	return r, simulator
}
