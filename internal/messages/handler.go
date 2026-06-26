package messages

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/kimcrent/kimspeak/internal/auth"
)

type Handler struct {
	repo *Repository
}

func NewHandler(repo *Repository) *Handler {
	return &Handler{
		repo: repo,
	}
}

type createMessageRequest struct {
	Content string `json:"content"`
}

type messagesResponse struct {
	Messages []Message `json:"messages"`
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	channelID := r.PathValue("channel_id")
	if channelID == "" {
		http.Error(w, "channel_id is requered", http.StatusBadRequest)
		return
	}

	authorID, ok := auth.UserIDFromContext(r.Context())
	if !ok || authorID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req createMessageRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	req.Content = strings.TrimSpace(req.Content)

	if req.Content == "" {
		http.Error(w, "content is requered", http.StatusBadRequest)
		return
	}

	if len(req.Content) > 4000 {
		http.Error(w, "content is too long", http.StatusBadRequest)
		return
	}

	message, err := h.repo.Create(r.Context(), channelID, authorID, req.Content)
	if err != nil {
		http.Error(w, "failed to create message", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, message)
}

func (h *Handler) ListByChannel(w http.ResponseWriter, r *http.Request) {
	channelID := r.PathValue("channel_id")
	if channelID == "" {
		http.Error(w, "channel_id is requered", http.StatusBadRequest)
		return
	}

	limit := 50

	if rawLimit := r.URL.Query().Get("limit"); rawLimit != "" {
		parsedLimit, err := strconv.Atoi(rawLimit)
		if err == nil {
			limit = parsedLimit
		}
	}

	messages, err := h.repo.ListByChannel(r.Context(), channelID, limit)
	if err != nil {
		http.Error(w, "failed to get messages", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, messagesResponse{
		Messages: messages,
	})
}

func writeJSON(w http.ResponseWriter, statusCode int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	_ = json.NewEncoder(w).Encode(data)
}
