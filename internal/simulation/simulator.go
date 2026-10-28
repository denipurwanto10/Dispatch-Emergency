package simulation

import (
	"context"
	"database/sql"
	"log"
	"sync"
	"time"

	"dispatch/internal/model"
	"dispatch/internal/repository"
	"dispatch/internal/state"
)

type Simulator struct {
	assignments *repository.AssignmentRepository
	vehicles    *repository.VehicleRepository
	incidents   *repository.IncidentRepository
	db          *sql.DB
	simSpeed    int
	ticker      *time.Ticker
	mu          sync.Mutex
	running     bool
	ctx         context.Context
	cancel      context.CancelFunc
	broadcast   chan BroadcastEvent
}

type BroadcastEvent struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

type VehiclePositionEvent struct {
	VehicleID        int64   `json:"vehicle_id"`
	AssignmentID     int64   `json:"assignment_id"`
	Lat              float64 `json:"lat"`
	Lng              float64 `json:"lng"`
	ProgressPct      float64 `json:"progress_pct"`
	ETARemainingSecs int     `json:"eta_remaining_seconds"`
}

type AssignmentStatusEvent struct {
	Assignment model.Assignment `json:"assignment"`
	Incident   model.Incident   `json:"incident"`
	Vehicle    model.Vehicle    `json:"vehicle"`
}

type SnapshotEvent struct {
	Vehicles    []model.Vehicle    `json:"vehicles"`
	Incidents   []model.Incident   `json:"incidents"`
	Assignments []model.Assignment `json:"assignments"`
}

func NewSimulator(
	assignments *repository.AssignmentRepository,
	vehicles *repository.VehicleRepository,
	incidents *repository.IncidentRepository,
	db *sql.DB,
	simSpeed int,
	broadcast chan BroadcastEvent,
) *Simulator {
	ctx, cancel := context.WithCancel(context.Background())
	return &Simulator{
		assignments: assignments,
		vehicles:    vehicles,
		incidents:   incidents,
		db:          db,
		simSpeed:    simSpeed,
		broadcast:   broadcast,
		ctx:         ctx,
		cancel:      cancel,
	}
}

func (s *Simulator) Start() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.mu.Unlock()

	s.ticker = time.NewTicker(1 * time.Second)
	go s.run()
	log.Printf("Simulasi dimulai (simSpeed=%dx)", s.simSpeed)
}

func (s *Simulator) Stop() {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return
	}
	s.running = false
	s.mu.Unlock()

	s.cancel()
	if s.ticker != nil {
		s.ticker.Stop()
	}
	log.Println("Simulasi dihentikan")
}

func (s *Simulator) run() {
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-s.ticker.C:
			s.tick()
		}
	}
}

func (s *Simulator) tick() {
	// Ambil semua assignment yang status en_route
	assignments, err := s.assignments.ListActiveEnRoute(s.ctx)
	if err != nil {
		log.Printf("simulasi: error mengambil assignment en_route: %v", err)
		return
	}
	if len(assignments) == 0 {
		return
	}

	now := time.Now()
	persistNeeded := false

	for _, assignment := range assignments {
		// Hitung progress delta per detik: distance_m / (eta_seconds / simSpeed)
		// artinya: per detik nyata, simulasi maju sebesar (distance_m / (eta_seconds / simSpeed))
		var deltaM float64
		if assignment.ETASecs > 0 {
			deltaM = assignment.DistanceM / (float64(assignment.ETASecs) / float64(s.simSpeed))
		} else {
			deltaM = assignment.DistanceM // fallback
		}

		newProgress := assignment.ProgressM + deltaM

		// Persist ke DB setiap 5 detik (kita gunakan counter sederhana)
		// Kita bisa track lewat assignment ID atau timestamp, tapi simpel: persist tiap tick yg kelipatan 5
		persistThisTick := int(now.Unix())%5 == 0

		if newProgress >= assignment.DistanceM {
			// Tiba di tujuan
			newProgress = assignment.DistanceM
			persistThisTick = true

			if !state.CanTransitionAssignment(state.AssignmentStatus(assignment.Status), state.AssignmentArrived) {
				log.Printf("simulasi: assignment %d status %q tidak bisa pindah ke arrived; dilewati",
					assignment.ID, assignment.Status)
				continue
			}

			// Update assignment status ke arrived
			arrivedAt := now
			updated, err := s.assignments.UpdateProgressAndStatus(s.ctx, assignment.ID, newProgress, state.AssignmentArrived, &arrivedAt)
			if err != nil {
				log.Printf("simulasi: error update assignment %d ke arrived: %v", assignment.ID, err)
				continue
			}
			assignment = updated

			// Update vehicle dan insiden hanya bila transisi insiden legal.
			incident, err := s.incidents.GetByID(s.ctx, assignment.IncidentID)
			if err != nil {
				log.Printf("simulasi: error mengambil insiden %d: %v", assignment.IncidentID, err)
			} else if !state.CanTransition(state.IncidentStatus(incident.Status), state.IncidentOnScene) {
				log.Printf("simulasi: insiden %d status %q tidak bisa pindah ke on_scene; update insiden dilewati",
					incident.ID, incident.Status)
			} else {
				if _, err := s.vehicles.DB().ExecContext(s.ctx, `
					UPDATE vehicles
					SET status = 'on_scene',
					    pos_geom = (SELECT geom FROM incidents WHERE id = $1),
					    pos_updated_at = now()
					WHERE id = $2`, assignment.IncidentID, assignment.VehicleID); err != nil {
					log.Printf("simulasi: error update vehicle on_scene: %v", err)
				}

				// Update incident status ke on_scene
				if _, err := s.incidents.DB().ExecContext(s.ctx, `
					UPDATE incidents SET status = $2 WHERE id = $1`, assignment.IncidentID, string(state.IncidentOnScene)); err != nil {
					log.Printf("simulasi: error update incident on_scene: %v", err)
				}
			}

			// Broadcast assignment status changed
			vehicle, _ := s.vehicles.GetByID(s.ctx, assignment.VehicleID)
			incident2, _ := s.incidents.GetByID(s.ctx, assignment.IncidentID)
			s.broadcastEvent(BroadcastEvent{
				Type: "assignment_status",
				Data: AssignmentStatusEvent{
					Assignment: assignment,
					Incident:   incident2,
					Vehicle:    vehicle,
				},
			})
		} else {
			// Update progress
			updated, err := s.assignments.UpdateProgress(s.ctx, assignment.ID, newProgress)
			if err != nil {
				log.Printf("simulasi: error update progress assignment %d: %v", assignment.ID, err)
				continue
			}
			assignment = updated
		}

		// Interpolasi posisi di route_geom
		lat, lng := s.interpolatePosition(assignment)
		if lat != 0 || lng != 0 {
			// Update vehicle position in memory (pos_geom akan dipersist berkala)
			if _, err := s.vehicles.DB().ExecContext(s.ctx, `
				UPDATE vehicles SET pos_geom = ST_SetSRID(ST_MakePoint($1, $2), 4326) WHERE id = $3`,
				lng, lat, assignment.VehicleID); err != nil {
				log.Printf("simulasi: error update vehicle position: %v", err)
			}

			// Hitung ETA remaining (waktu nyata, bukan simulasi)
			remainingDistance := assignment.DistanceM - assignment.ProgressM
			etaRemaining := 0
			if assignment.ETASecs > 0 && assignment.DistanceM > 0 {
				etaRemaining = int((remainingDistance / assignment.DistanceM) * float64(assignment.ETASecs) / float64(s.simSpeed))
			}
			if etaRemaining < 0 {
				etaRemaining = 0
			}

			progressPct := 0.0
			if assignment.DistanceM > 0 {
				progressPct = (assignment.ProgressM / assignment.DistanceM) * 100
			}

			s.broadcastEvent(BroadcastEvent{
				Type: "vehicle_position",
				Data: VehiclePositionEvent{
					VehicleID:        assignment.VehicleID,
					AssignmentID:     assignment.ID,
					Lat:              lat,
					Lng:              lng,
					ProgressPct:      progressPct,
					ETARemainingSecs: etaRemaining,
				},
			})
		}

		if persistThisTick {
			persistNeeded = true
		}
	}

	if persistNeeded {
		// Force persist positions for all en_route vehicles
		for _, assignment := range assignments {
			lat, lng := s.interpolatePosition(assignment)
			if lat != 0 || lng != 0 {
				if _, err := s.vehicles.DB().ExecContext(s.ctx, `
					UPDATE vehicles SET pos_geom = ST_SetSRID(ST_MakePoint($1, $2), 4326), pos_updated_at = now() WHERE id = $3`,
					lng, lat, assignment.VehicleID); err != nil {
					log.Printf("simulasi: error persist vehicle position: %v", err)
				}
				if _, err := s.assignments.DB().ExecContext(s.ctx, `
					UPDATE assignments SET progress_m = progress_m WHERE id = $1`, assignment.ID); err != nil {
					log.Printf("simulasi: error persist assignment progress: %v", err)
				}
			}
		}
	}
}

func (s *Simulator) interpolatePosition(assignment model.Assignment) (float64, float64) {
	// Parse GeoJSON LineString and find point at progress_m distance
	// assignment.RouteGeoJSON is a GeoJSON LineString string
	// We need to parse it and interpolate
	// Simple approach: parse coordinates array and find point at distance

	// For now, simple linear interpolation between start and end
	// TODO: proper interpolation along LineString
	// Get vehicle start position and incident position
	vehicle, err := s.vehicles.GetByID(s.ctx, assignment.VehicleID)
	if err != nil {
		return 0, 0
	}
	incident, err := s.incidents.GetByID(s.ctx, assignment.IncidentID)
	if err != nil {
		return 0, 0
	}

	// Rute berjarak nol (insiden tepat di posisi kendaraan) tidak boleh
	// menghasilkan 0/0. Kendaraan dianggap sudah berada di lokasi insiden.
	if assignment.DistanceM <= 0 {
		return incident.Lat, incident.Lng
	}

	// Simple linear interpolation
	progressRatio := assignment.ProgressM / assignment.DistanceM
	if progressRatio > 1 {
		progressRatio = 1
	}
	if progressRatio < 0 {
		progressRatio = 0
	}

	lat := vehicle.Lat + (incident.Lat-vehicle.Lat)*progressRatio
	lng := vehicle.Lng + (incident.Lng-vehicle.Lng)*progressRatio

	return lat, lng
}

func (s *Simulator) broadcastEvent(event BroadcastEvent) {
	select {
	case s.broadcast <- event:
	default:
		// Channel full, drop event to avoid blocking
		log.Printf("simulasi: broadcast channel full, dropping event %s", event.Type)
	}
}
