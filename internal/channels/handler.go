// Handler for channels
package channels

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/kimcrent/kimspeak/internal/auth"
	"github.com/kimcrent/kimspeak/internal/guilds"
)

type Handler struct {
	channelsRepo *Repository
	guildsRepo   *guilds.Repository
}

func NewHandler(channelsRepo *Repository, guildsRepo *guilds.Repository) *Handler {
	return &Handler{
		channelsRepo: channelsRepo,
		guildsRepo:   guildsRepo,
	}
}

type createChannelRequest struct {
	GuildID string `json:"guild_id"`
	Name    string `json:"name"`
	Type    string `json:"type"`
}

type createChannelResponse struct {
	Channel Channel `json:"channel"`
}

type listChannelsResponse struct {
	Channels []Channel `json:"channels"`
}

func (h *Handler) HandleChannels(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		h.Create(w, r)
	case http.MethodGet:
		h.List(w, r)
	case http.MethodDelete:
		h.Delete(w, r)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{
			"error": "method not allowed",
		})
	}
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	var req createChannelRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid json",
		})
		return
	}

	req.GuildID = strings.TrimSpace(req.GuildID)
	req.Name = strings.TrimSpace(req.Name)
	req.Type = strings.TrimSpace(req.Type)

	if req.GuildID == "" || req.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "guild_id and name are required",
		})
		return
	}

	if req.Type == "" {
		req.Type = "text"
	}

	if req.Type != "text" && req.Type != "voice" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "channel type must be text or voice",
		})
		return
	}

	isOwner, err := h.guildsRepo.IsOwner(r.Context(), req.GuildID, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to check permissions",
		})
		return
	}

	if !isOwner {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"error": "only guild owner can create channels",
		})
		return
	}

	channel, err := h.channelsRepo.Create(r.Context(), req.GuildID, req.Name, req.Type)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "faild to create channel",
		})
		return
	}

	writeJSON(w, http.StatusCreated, createChannelResponse{
		Channel: channel,
	})
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	guildID := strings.TrimSpace(r.URL.Query().Get("guild_id"))
	if guildID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "guild_id is required",
		})
		return
	}

	isMember, err := h.guildsRepo.IsMember(r.Context(), guildID, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to check permissions",
		})
		return
	}

	if !isMember {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"error": "you are not a member of this guild",
		})
		return
	}

	channels, err := h.channelsRepo.FindByGuildID(r.Context(), guildID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "faild to get chennals",
		})
		return
	}

	writeJSON(w, http.StatusOK, listChannelsResponse{
		Channels: channels,
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	_ = json.NewEncoder(w).Encode(data)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	channelIDRaw := strings.TrimSpace(r.URL.Query().Get("id"))
	if channelIDRaw == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "channel id is required",
		})
		return
	}

	channelID, err := uuid.Parse(channelIDRaw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid channel id",
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

	err = h.channelsRepo.DeleteByAdmin(r.Context(), channelID, userID)
	if errors.Is(err, ErrChannelNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": "channel not found",
		})
		return
	}
	if errors.Is(err, ErrForbidden) {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"error": "only admin can delete channel",
		})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to delete channel",
		})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
