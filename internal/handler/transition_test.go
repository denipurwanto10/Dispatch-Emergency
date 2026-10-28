package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"dispatch/internal/state"
)

type errorPayload struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func newTestContext() (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/test", nil)
	return context, recorder
}

func TestRequireIncidentTransitionRejectsIllegal(t *testing.T) {
	cases := []struct {
		name string
		from state.IncidentStatus
		to   state.IncidentStatus
	}{
		{"resolved_to_assigned", state.IncidentResolved, state.IncidentAssigned},
		{"on_scene_to_assigned", state.IncidentOnScene, state.IncidentAssigned},
		{"assigned_to_on_scene", state.IncidentAssigned, state.IncidentOnScene},
		{"open_to_on_scene", state.IncidentOpen, state.IncidentOnScene},
		{"cancelled_to_resolved", state.IncidentCancelled, state.IncidentResolved},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			context, recorder := newTestContext()

			allowed := requireIncidentTransition(
				context, tc.from, tc.to,
				"incident_not_open", "Insiden hanya bisa di-assign saat status open.",
			)
			if allowed {
				t.Fatal("requireIncidentTransition = true, want false")
			}
			if recorder.Code != http.StatusConflict {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusConflict)
			}

			var payload errorPayload
			if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if payload.Error.Code != "incident_not_open" {
				t.Errorf("error.code = %q, want incident_not_open", payload.Error.Code)
			}
			if payload.Error.Message == "" {
				t.Error("error.message kosong, want pesan yang jelas")
			}
		})
	}
}

func TestRequireIncidentTransitionAllowsLegal(t *testing.T) {
	context, recorder := newTestContext()

	allowed := requireIncidentTransition(
		context, state.IncidentOpen, state.IncidentAssigned,
		"incident_not_open", "Insiden hanya bisa di-assign saat status open.",
	)
	if !allowed {
		t.Fatal("requireIncidentTransition = false, want true")
	}
	if recorder.Code != http.StatusOK {
		t.Errorf("status = %d, want %d (belum ada respons)", recorder.Code, http.StatusOK)
	}
	if recorder.Body.Len() != 0 {
		t.Errorf("body = %q, want kosong", recorder.Body.String())
	}
}

func TestRequireAssignmentTransitionRejectsIllegal(t *testing.T) {
	cases := []struct {
		name string
		from state.AssignmentStatus
		to   state.AssignmentStatus
	}{
		{"completed_to_en_route", state.AssignmentCompleted, state.AssignmentEnRoute},
		{"cancelled_to_arrived", state.AssignmentCancelled, state.AssignmentArrived},
		{"arrived_to_en_route", state.AssignmentArrived, state.AssignmentEnRoute},
		{"assigned_to_arrived", state.AssignmentAssigned, state.AssignmentArrived},
		{"en_route_to_completed", state.AssignmentEnRoute, state.AssignmentCompleted},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			context, recorder := newTestContext()

			allowed := requireAssignmentTransition(
				context, tc.from, tc.to,
				"assignment_not_completable", "Assignment hanya bisa diselesaikan dari status arrived (ON SCENE).",
			)
			if allowed {
				t.Fatal("requireAssignmentTransition = true, want false")
			}
			if recorder.Code != http.StatusConflict {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusConflict)
			}

			var payload errorPayload
			if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if payload.Error.Code != "assignment_not_completable" {
				t.Errorf("error.code = %q, want assignment_not_completable", payload.Error.Code)
			}
			if payload.Error.Message == "" {
				t.Error("error.message kosong, want pesan yang jelas")
			}
		})
	}
}

func TestRequireAssignmentTransitionAllowsLegal(t *testing.T) {
	context, recorder := newTestContext()

	allowed := requireAssignmentTransition(
		context, state.AssignmentArrived, state.AssignmentCompleted,
		"assignment_not_completable", "Assignment hanya bisa diselesaikan dari status arrived (ON SCENE).",
	)
	if !allowed {
		t.Fatal("requireAssignmentTransition = false, want true")
	}
	if recorder.Code != http.StatusOK {
		t.Errorf("status = %d, want %d (belum ada respons)", recorder.Code, http.StatusOK)
	}
	if recorder.Body.Len() != 0 {
		t.Errorf("body = %q, want kosong", recorder.Body.String())
	}
}
