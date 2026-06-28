package httpserver

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWithCORSHandlesPreflight(t *testing.T) {
	handler := withCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("preflight should not reach the next handler")
	}))

	req := httptest.NewRequest(http.MethodOptions, "/auth/login", nil)
	req.Header.Set("Origin", "tauri://localhost")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "content-type,authorization")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected status %d, got %d", http.StatusNoContent, rec.Code)
	}

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "tauri://localhost" {
		t.Fatalf("unexpected allow origin: %q", got)
	}

	if got := rec.Header().Get("Access-Control-Allow-Headers"); got != "Authorization, Content-Type" {
		t.Fatalf("unexpected allow headers: %q", got)
	}
}

func TestWithCORSAddsHeadersToResponse(t *testing.T) {
	handler := withCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.Header.Set("Origin", "http://tauri.localhost")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, rec.Code)
	}

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://tauri.localhost" {
		t.Fatalf("unexpected allow origin: %q", got)
	}
}
