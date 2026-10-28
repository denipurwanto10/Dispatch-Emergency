package auth

import (
	"testing"
	"time"

	"dispatch/internal/model"
)

const testSecret = "test-secret-yang-cukup-panjang-untuk-hs256"

func TestManagerGenerateParseRoundTrip(t *testing.T) {
	manager := NewManager(testSecret, time.Hour)
	user := model.User{
		ID:    42,
		Email: "dispatcher@example.test",
		Role:  "dispatcher",
		Name:  "Dewi",
	}

	raw, err := manager.Generate(user)
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if raw == "" {
		t.Fatal("Generate() mengembalikan token kosong")
	}

	claims, err := manager.Parse(raw)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if claims.UserID != user.ID {
		t.Errorf("UserID = %d, want %d", claims.UserID, user.ID)
	}
	if claims.Role != user.Role {
		t.Errorf("Role = %q, want %q", claims.Role, user.Role)
	}
	if claims.Email != user.Email {
		t.Errorf("Email = %q, want %q", claims.Email, user.Email)
	}
	if claims.Name != user.Name {
		t.Errorf("Name = %q, want %q", claims.Name, user.Name)
	}
	if claims.Issuer != "dispatch" {
		t.Errorf("Issuer = %q, want %q", claims.Issuer, "dispatch")
	}
}

func TestManagerRejectsWrongSecret(t *testing.T) {
	issuer := NewManager(testSecret, time.Hour)
	raw, err := issuer.Generate(model.User{ID: 1, Role: "admin", Email: "admin@example.test"})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	other := NewManager("secret-lain-yang-juga-panjang", time.Hour)
	if _, err := other.Parse(raw); err == nil {
		t.Fatal("Parse() menerima token yang ditandatangani dengan secret berbeda")
	}
}

func TestManagerRejectsExpiredToken(t *testing.T) {
	manager := NewManager(testSecret, -time.Minute)
	raw, err := manager.Generate(model.User{ID: 1, Role: "driver", Email: "driver@example.test"})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if _, err := manager.Parse(raw); err == nil {
		t.Fatal("Parse() menerima token yang sudah kedaluwarsa")
	}
}

func TestManagerRejectsTamperedToken(t *testing.T) {
	manager := NewManager(testSecret, time.Hour)
	raw, err := manager.Generate(model.User{ID: 1, Role: "driver", Email: "driver@example.test"})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}

	if _, err := manager.Parse(raw + "tampered"); err == nil {
		t.Fatal("Parse() menerima token yang dimodifikasi")
	}
	if _, err := manager.Parse(""); err == nil {
		t.Fatal("Parse() menerima token kosong")
	}
}
