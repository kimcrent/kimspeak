package guilds

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/kimcrent/kimspeak/internal/auth"
	"github.com/kimcrent/kimspeak/internal/guildmembers"
)

type Handler struct {
	guildsRepo       *Repository
	guildMembersRepo *guildmembers.Repository
}

func NewHandler(guildsRepo *Repository, guildMembersRepo *guildmembers.Repository) *Handler {
	return &Handler{
		guildsRepo:       guildsRepo,
		guildMembersRepo: guildMembersRepo,
	}
}

type createGuildRequest struct {
	Name string `json:"name"`
}

type createGuildResponse struct {
	Guild Guild `json:"guilds"`
}

type listGuildsResponse struct {
	Guilds []Guild `json:"guilds"`
}

func (h *Handler) HandleGuilds(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		h.Create(w, r)
	case http.MethodGet:
		h.List(w, r)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{
			"error": "method not allowed",
		})
	}
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
		http.Error(w, "failed to create guild", http.StatusInternalServerError)
		return
	}

	if err := h.guildMembersRepo.AddOwner(r.Context(), guild.ID, userID); err != nil {
		http.Error(w, "failed to add owner to guild members", http.StatusInternalServerError)
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

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{
			"error": "method not allowed",
		})
		return
	}
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}
	guilds, err := h.guildsRepo.FindByUserID(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "faild to get guilds",
		})
		return
	}
	writeJSON(w, http.StatusOK, listGuildsResponse{
		Guilds: guilds,
	})
}
