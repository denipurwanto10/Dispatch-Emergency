// Package state mendefinisikan status dan transisi legal untuk siklus hidup
// insiden dan assignment Dispatch.
//
// Nilai string di sini harus sama dengan CHECK constraint di
// migrations/002_core_schema.sql. Jangan menambah status baru tanpa migrasi
// baru dan pembaruan dokumentasi.
package state

import (
	"errors"
	"fmt"
	"strings"
)

// IncidentStatus adalah status legal untuk tabel incidents.
type IncidentStatus string

const (
	IncidentOpen      IncidentStatus = "open"
	IncidentAssigned  IncidentStatus = "assigned"
	IncidentEnRoute   IncidentStatus = "en_route"
	IncidentOnScene   IncidentStatus = "on_scene"
	IncidentResolved  IncidentStatus = "resolved"
	IncidentCancelled IncidentStatus = "cancelled"
)

// AssignmentStatus adalah status legal untuk tabel assignments.
type AssignmentStatus string

const (
	AssignmentAssigned  AssignmentStatus = "assigned"
	AssignmentEnRoute   AssignmentStatus = "en_route"
	AssignmentArrived   AssignmentStatus = "arrived"
	AssignmentCompleted AssignmentStatus = "completed"
	AssignmentCancelled AssignmentStatus = "cancelled"
)

// IncidentTransitions adalah tabel transisi legal insiden.
//
// Status terminal (resolved, cancelled) sengaja tetap ada sebagai key dengan
// daftar tujuan kosong agar status tersebut dianggap valid. Map ini hanya untuk
// dibaca; jangan dimutasi saat runtime.
var IncidentTransitions = map[IncidentStatus][]IncidentStatus{
	IncidentOpen:      {IncidentAssigned, IncidentCancelled},
	IncidentAssigned:  {IncidentEnRoute},
	IncidentEnRoute:   {IncidentOnScene},
	IncidentOnScene:   {IncidentResolved},
	IncidentResolved:  {},
	IncidentCancelled: {},
}

// AssignmentTransitions adalah tabel transisi legal assignment.
//
// AssignmentCancelled dipertahankan sebagai transisi legal untuk penolakan atau
// pembatalan driver. Endpoint penolakan/pembatalan assignment belum ada di MVP;
// jangan menambah endpoint tanpa fase dan keputusan tersendiri. Map ini hanya
// untuk dibaca; jangan dimutasi saat runtime.
var AssignmentTransitions = map[AssignmentStatus][]AssignmentStatus{
	AssignmentAssigned:  {AssignmentEnRoute, AssignmentCancelled},
	AssignmentEnRoute:   {AssignmentArrived, AssignmentCancelled},
	AssignmentArrived:   {AssignmentCompleted},
	AssignmentCompleted: {},
	AssignmentCancelled: {},
}

// ErrInvalidTransition adalah error dasar untuk semua transisi ilegal.
var ErrInvalidTransition = errors.New("transisi status tidak valid")

// TransitionError menjelaskan transisi yang ditolak beserta tujuan yang
// diizinkan dari status asal.
type TransitionError struct {
	Entity  string
	From    string
	To      string
	Allowed []string
}

func (e *TransitionError) Error() string {
	if len(e.Allowed) == 0 {
		return fmt.Sprintf(
			"transisi %s tidak valid: %s -> %s (status asal tidak punya transisi keluar)",
			e.Entity, e.From, e.To,
		)
	}
	return fmt.Sprintf(
		"transisi %s tidak valid: %s -> %s (diizinkan: %s)",
		e.Entity, e.From, e.To, strings.Join(e.Allowed, ", "),
	)
}

// Unwrap membuat errors.Is(err, ErrInvalidTransition) bekerja.
func (e *TransitionError) Unwrap() error {
	return ErrInvalidTransition
}

// CanTransition memeriksa transisi insiden from -> to.
func CanTransition(from, to IncidentStatus) bool {
	for _, candidate := range IncidentTransitions[from] {
		if candidate == to {
			return true
		}
	}
	return false
}

// CanTransitionAssignment memeriksa transisi assignment from -> to.
func CanTransitionAssignment(from, to AssignmentStatus) bool {
	for _, candidate := range AssignmentTransitions[from] {
		if candidate == to {
			return true
		}
	}
	return false
}

// ValidateTransition mengembalikan nil bila transisi insiden legal, atau
// *TransitionError yang menjelaskan transisi ilegal.
func ValidateTransition(from, to IncidentStatus) error {
	if CanTransition(from, to) {
		return nil
	}
	return &TransitionError{
		Entity:  "insiden",
		From:    string(from),
		To:      string(to),
		Allowed: allowedIncidentTargets(from),
	}
}

// ValidateAssignmentTransition mengembalikan nil bila transisi assignment
// legal, atau *TransitionError yang menjelaskan transisi ilegal.
func ValidateAssignmentTransition(from, to AssignmentStatus) error {
	if CanTransitionAssignment(from, to) {
		return nil
	}
	return &TransitionError{
		Entity:  "assignment",
		From:    string(from),
		To:      string(to),
		Allowed: allowedAssignmentTargets(from),
	}
}

// IsIncidentStatus melaporkan apakah status dikenal oleh state machine.
func IsIncidentStatus(status IncidentStatus) bool {
	_, ok := IncidentTransitions[status]
	return ok
}

// IsAssignmentStatus melaporkan apakah status dikenal oleh state machine.
func IsAssignmentStatus(status AssignmentStatus) bool {
	_, ok := AssignmentTransitions[status]
	return ok
}

// IsInitialIncidentStatus adalah satu-satunya status awal insiden yang sah.
func IsInitialIncidentStatus(status IncidentStatus) bool {
	return status == IncidentOpen
}

// IsInitialAssignmentStatus adalah satu-satunya status awal assignment yang sah.
func IsInitialAssignmentStatus(status AssignmentStatus) bool {
	return status == AssignmentAssigned
}

func allowedIncidentTargets(from IncidentStatus) []string {
	targets := IncidentTransitions[from]
	allowed := make([]string, 0, len(targets))
	for _, target := range targets {
		allowed = append(allowed, string(target))
	}
	return allowed
}

func allowedAssignmentTargets(from AssignmentStatus) []string {
	targets := AssignmentTransitions[from]
	allowed := make([]string, 0, len(targets))
	for _, target := range targets {
		allowed = append(allowed, string(target))
	}
	return allowed
}
