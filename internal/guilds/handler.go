package guilds

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/kimcrent/kimspeak/internal/auth"
)

type Handler struct {
	guildsRepo *Repository
}

func NewHandler(guildsRepo *Repository) *Handler {
	return &Handler{
		guildsRepo: guildsRepo,
	}
}

type createGuildRequest struct {
	Name string `json:"name"`
}

type createGuildResponse struct {
	Guild Guild `json:"guild"`
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{
			"error": "method not allowed",
		})
		return
	}

	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unautorized",
		})
		return
	}

	var req createGuildRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid json",
		})
		return
	}

	req.Name = strings.TrimSpace(req.Name)

	if req.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "name is required",
		})
		return
	}

	guild, err := h.guildsRepo.Create(r.Context(), req.Name, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "faild to create guild",
		})
		return
	}

	writeJSON(w, http.StatusCreated, createGuildResponse{
		Guild: guild,
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	_ = json.NewEncoder(w).Encode(data)
}
