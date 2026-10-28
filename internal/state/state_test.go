package state

import (
	"errors"
	"strings"
	"testing"
)

var allIncidentStatuses = []IncidentStatus{
	IncidentOpen,
	IncidentAssigned,
	IncidentEnRoute,
	IncidentOnScene,
	IncidentResolved,
	IncidentCancelled,
}

var allAssignmentStatuses = []AssignmentStatus{
	AssignmentAssigned,
	AssignmentEnRoute,
	AssignmentArrived,
	AssignmentCompleted,
	AssignmentCancelled,
}

func TestIncidentLegalTransitions(t *testing.T) {
	legal := [][2]IncidentStatus{
		{IncidentOpen, IncidentAssigned},
		{IncidentOpen, IncidentCancelled},
		{IncidentAssigned, IncidentEnRoute},
		{IncidentEnRoute, IncidentOnScene},
		{IncidentOnScene, IncidentResolved},
	}

	for _, pair := range legal {
		from, to := pair[0], pair[1]
		if !CanTransition(from, to) {
			t.Errorf("CanTransition(%q, %q) = false, want true", from, to)
		}
		if err := ValidateTransition(from, to); err != nil {
			t.Errorf("ValidateTransition(%q, %q) = %v, want nil", from, to, err)
		}
	}
}

func TestIncidentIllegalTransitions(t *testing.T) {
	legal := map[[2]IncidentStatus]bool{
		{IncidentOpen, IncidentAssigned}:    true,
		{IncidentOpen, IncidentCancelled}:   true,
		{IncidentAssigned, IncidentEnRoute}: true,
		{IncidentEnRoute, IncidentOnScene}:  true,
		{IncidentOnScene, IncidentResolved}: true,
	}

	for _, from := range allIncidentStatuses {
		for _, to := range allIncidentStatuses {
			if legal[[2]IncidentStatus{from, to}] {
				continue
			}

			if CanTransition(from, to) {
				t.Errorf("CanTransition(%q, %q) = true, want false", from, to)
			}

			err := ValidateTransition(from, to)
			if err == nil {
				t.Errorf("ValidateTransition(%q, %q) = nil, want error", from, to)
				continue
			}
			if !errors.Is(err, ErrInvalidTransition) {
				t.Errorf("ValidateTransition(%q, %q) error = %v, want ErrInvalidTransition", from, to, err)
			}
		}
	}
}

func TestAssignmentLegalTransitions(t *testing.T) {
	legal := [][2]AssignmentStatus{
		{AssignmentAssigned, AssignmentEnRoute},
		{AssignmentAssigned, AssignmentCancelled},
		{AssignmentEnRoute, AssignmentArrived},
		{AssignmentEnRoute, AssignmentCancelled},
		{AssignmentArrived, AssignmentCompleted},
	}

	for _, pair := range legal {
		from, to := pair[0], pair[1]
		if !CanTransitionAssignment(from, to) {
			t.Errorf("CanTransitionAssignment(%q, %q) = false, want true", from, to)
		}
		if err := ValidateAssignmentTransition(from, to); err != nil {
			t.Errorf("ValidateAssignmentTransition(%q, %q) = %v, want nil", from, to, err)
		}
	}
}

func TestAssignmentIllegalTransitions(t *testing.T) {
	legal := map[[2]AssignmentStatus]bool{
		{AssignmentAssigned, AssignmentEnRoute}:   true,
		{AssignmentAssigned, AssignmentCancelled}: true,
		{AssignmentEnRoute, AssignmentArrived}:    true,
		{AssignmentEnRoute, AssignmentCancelled}:  true,
		{AssignmentArrived, AssignmentCompleted}:  true,
	}

	for _, from := range allAssignmentStatuses {
		for _, to := range allAssignmentStatuses {
			if legal[[2]AssignmentStatus{from, to}] {
				continue
			}

			if CanTransitionAssignment(from, to) {
				t.Errorf("CanTransitionAssignment(%q, %q) = true, want false", from, to)
			}

			err := ValidateAssignmentTransition(from, to)
			if err == nil {
				t.Errorf("ValidateAssignmentTransition(%q, %q) = nil, want error", from, to)
				continue
			}
			if !errors.Is(err, ErrInvalidTransition) {
				t.Errorf("ValidateAssignmentTransition(%q, %q) error = %v, want ErrInvalidTransition", from, to, err)
			}
		}
	}
}

func TestTerminalStatusesHaveNoOutgoingTransition(t *testing.T) {
	for _, status := range []IncidentStatus{IncidentResolved, IncidentCancelled} {
		if len(IncidentTransitions[status]) != 0 {
			t.Errorf("IncidentTransitions[%q] = %v, want empty", status, IncidentTransitions[status])
		}
	}
	for _, status := range []AssignmentStatus{AssignmentCompleted, AssignmentCancelled} {
		if len(AssignmentTransitions[status]) != 0 {
			t.Errorf("AssignmentTransitions[%q] = %v, want empty", status, AssignmentTransitions[status])
		}
	}
}

func TestUnknownStatusesAreRejected(t *testing.T) {
	unknownIncident := IncidentStatus("bogus")
	if IsIncidentStatus(unknownIncident) {
		t.Errorf("IsIncidentStatus(%q) = true, want false", unknownIncident)
	}
	if CanTransition(unknownIncident, IncidentAssigned) {
		t.Error("transisi dari status insiden tidak dikenal seharusnya ilegal")
	}

	err := ValidateTransition(unknownIncident, IncidentAssigned)
	var transitionErr *TransitionError
	if !errors.As(err, &transitionErr) {
		t.Fatalf("ValidateTransition error = %v, want *TransitionError", err)
	}
	if transitionErr.From != "bogus" || transitionErr.To != string(IncidentAssigned) {
		t.Errorf("TransitionError = %+v, want From bogus To assigned", transitionErr)
	}
	if len(transitionErr.Allowed) != 0 {
		t.Errorf("Allowed = %v, want empty", transitionErr.Allowed)
	}

	unknownAssignment := AssignmentStatus("bogus")
	if IsAssignmentStatus(unknownAssignment) {
		t.Errorf("IsAssignmentStatus(%q) = true, want false", unknownAssignment)
	}
	if CanTransitionAssignment(unknownAssignment, AssignmentEnRoute) {
		t.Error("transisi dari status assignment tidak dikenal seharusnya ilegal")
	}
}

func TestKnownStatuses(t *testing.T) {
	for _, status := range allIncidentStatuses {
		if !IsIncidentStatus(status) {
			t.Errorf("IsIncidentStatus(%q) = false, want true", status)
		}
	}
	for _, status := range allAssignmentStatuses {
		if !IsAssignmentStatus(status) {
			t.Errorf("IsAssignmentStatus(%q) = false, want true", status)
		}
	}
}

func TestInitialStatuses(t *testing.T) {
	if !IsInitialIncidentStatus(IncidentOpen) {
		t.Error("status awal insiden seharusnya open")
	}
	for _, status := range allIncidentStatuses {
		if status == IncidentOpen {
			continue
		}
		if IsInitialIncidentStatus(status) {
			t.Errorf("IsInitialIncidentStatus(%q) = true, want false", status)
		}
	}

	if !IsInitialAssignmentStatus(AssignmentAssigned) {
		t.Error("status awal assignment seharusnya assigned")
	}
	for _, status := range allAssignmentStatuses {
		if status == AssignmentAssigned {
			continue
		}
		if IsInitialAssignmentStatus(status) {
			t.Errorf("IsInitialAssignmentStatus(%q) = true, want false", status)
		}
	}
}

func TestTransitionErrorMessage(t *testing.T) {
	err := ValidateTransition(IncidentOnScene, IncidentOpen)
	if err == nil {
		t.Fatal("ValidateTransition mengembalikan nil, want error")
	}

	message := err.Error()
	for _, fragment := range []string{"insiden", "on_scene", "open", "resolved"} {
		if !strings.Contains(message, fragment) {
			t.Errorf("pesan error %q tidak memuat %q", message, fragment)
		}
	}

	err = ValidateTransition(IncidentResolved, IncidentOpen)
	if err == nil {
		t.Fatal("ValidateTransition mengembalikan nil, want error")
	}
	if !strings.Contains(err.Error(), "tidak punya transisi keluar") {
		t.Errorf("pesan error status terminal = %q, want memuat 'tidak punya transisi keluar'", err.Error())
	}

	err = ValidateAssignmentTransition(AssignmentCompleted, AssignmentEnRoute)
	if err == nil {
		t.Fatal("ValidateAssignmentTransition mengembalikan nil, want error")
	}
	message = err.Error()
	for _, fragment := range []string{"assignment", "completed", "en_route", "tidak punya transisi keluar"} {
		if !strings.Contains(message, fragment) {
			t.Errorf("pesan error %q tidak memuat %q", message, fragment)
		}
	}
}
