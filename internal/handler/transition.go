package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"dispatch/internal/httpx"
	"dispatch/internal/state"
)

// requireIncidentTransition memvalidasi transisi status insiden. Bila transisi
// ilegal, respons 409 ditulis dan false dikembalikan sehingga pemanggil wajib
// berhenti tanpa mengubah data.
func requireIncidentTransition(c *gin.Context, from, to state.IncidentStatus, code, message string) bool {
	if state.CanTransition(from, to) {
		return true
	}
	httpx.Error(c, http.StatusConflict, code, message)
	return false
}

// requireAssignmentTransition memvalidasi transisi status assignment. Bila
// transisi ilegal, respons 409 ditulis dan false dikembalikan.
func requireAssignmentTransition(c *gin.Context, from, to state.AssignmentStatus, code, message string) bool {
	if state.CanTransitionAssignment(from, to) {
		return true
	}
	httpx.Error(c, http.StatusConflict, code, message)
	return false
}
