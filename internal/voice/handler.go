package voice

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	appauth "github.com/kimcrent/kimspeak/internal/auth"
	"github.com/kimcrent/kimspeak/internal/guildmembers"
	lkauth "github.com/livekit/protocol/auth"
)

type Handler struct {
	liveKitURL       string
	liveKitAPIKey    string
	liveKitAPISecret string
	guildMembersRepo *guildmembers.Repository
}

func NewHandler(
	liveKitURL,
	liveKitAPIKey,
	liveKitAPISecret string,
	guildMembersRepo *guildmembers.Repository,
) *Handler {
	return &Handler{
		liveKitURL:       liveKitURL,
		liveKitAPIKey:    liveKitAPIKey,
		liveKitAPISecret: liveKitAPISecret,
		guildMembersRepo: guildMembersRepo,
	}
}

type createTokenRequest struct {
	GuildID   string `json:"guild_id"`
	ChannelID string `json:"channel_id"`
}

type createTokenResponse struct {
	URL   string `json:"url"`
	Token string `json:"token"`
	Room  string `json:"room"`
}

func (h *Handler) CreateToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{
			"error": "method not allowed",
		})
		return
	}

	userID, ok := appauth.UserIDFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	var req createTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid json",
		})
		return
	}

	req.GuildID = strings.TrimSpace(req.GuildID)
	req.ChannelID = strings.TrimSpace(req.ChannelID)

	if req.GuildID == "" || req.ChannelID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "guild_id and channel_id are required",
		})
		return
	}

	guildID, err := uuid.Parse(req.GuildID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid guild_id",
		})
		return
	}

	channelID, err := uuid.Parse(req.ChannelID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid channel_id",
		})
		return
	}

	canAccess, err := h.guildMembersRepo.CanAccessVoiceChannel(
		r.Context(),
		guildID,
		channelID,
		userID,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to check voice permissions",
		})
		return
	}

	if !canAccess {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"error": "you cannot access this voice channel",
		})
		return
	}

	roomName := fmt.Sprintf("guild_%s_channel_%s", guildID, channelID)

	grant := &lkauth.VideoGrant{
		RoomJoin: true,
		Room:     roomName,
	}

	grant.SetCanPublish(true)
	grant.SetCanSubscribe(true)
	grant.SetCanPublishData(true)

	token, err := lkauth.NewAccessToken(h.liveKitAPIKey, h.liveKitAPISecret).
		SetIdentity(userID.String()).
		SetVideoGrant(grant).
		SetValidFor(30 * time.Minute).
		ToJWT()

	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to create livekit token",
		})
		return
	}

	writeJSON(w, http.StatusCreated, createTokenResponse{
		URL:   h.liveKitURL,
		Token: token,
		Room:  roomName,
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
