package voice

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	appauth "github.com/kimcrent/kimspeak/internal/auth"
	"github.com/kimcrent/kimspeak/internal/guildmembers"
	"github.com/kimcrent/kimspeak/internal/users"
	lkauth "github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
)

const (
	clientApp    = "app"
	clientScreen = "screen"

	voiceTokenTTL  = time.Hour
	screenTokenTTL = 10 * time.Minute
)

type Handler struct {
	liveKitURL       string
	liveKitAPIKey    string
	liveKitAPISecret string
	guildMembersRepo *guildmembers.Repository
	usersRepo        *users.Repository
	logger           *slog.Logger
}

func NewHandler(
	liveKitURL,
	liveKitAPIKey,
	liveKitAPISecret string,
	guildMembersRepo *guildmembers.Repository,
	usersRepo *users.Repository,
	logger *slog.Logger,
) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{
		liveKitURL:       liveKitURL,
		liveKitAPIKey:    liveKitAPIKey,
		liveKitAPISecret: liveKitAPISecret,
		guildMembersRepo: guildMembersRepo,
		usersRepo:        usersRepo,
		logger:           logger,
	}
}

type createTokenRequest struct {
	GuildID   string `json:"guild_id"`
	ChannelID string `json:"channel_id"`
	Client    string `json:"client"`
}

type createTokenResponse struct {
	URL              string `json:"url"`
	Token            string `json:"token"`
	Room             string `json:"room"`
	Identity         string `json:"identity"`
	Name             string `json:"name"`
	Client           string `json:"client"`
	ExpiresInSeconds int    `json:"expires_in_seconds"`
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
	req.Client = strings.TrimSpace(req.Client)

	if req.Client == "" {
		req.Client = clientApp
	}

	if req.Client != clientApp && req.Client != clientScreen {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid client",
		})
		return
	}

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

	user, err := h.usersRepo.FindByID(r.Context(), userID)
	if err != nil {
		h.logger.Error("failed to find user for livekit token",
			slog.String("user_id", userID.String()),
			slog.String("guild_id", guildID.String()),
			slog.String("channel_id", channelID.String()),
			slog.String("client", req.Client),
			slog.String("error", err.Error()),
		)

		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to find user",
		})
		return
	}

	displayName := strings.TrimSpace(user.Username)
	if displayName == "" {
		displayName = userID.String()
	}

	roomName := fmt.Sprintf("guild_%s_channel_%s", guildID, channelID)

	grant := &lkauth.VideoGrant{
		RoomJoin: true,
		Room:     roomName,
	}

	grant.SetCanPublish(true)
	grant.SetCanSubscribe(true)
	grant.SetCanPublishData(true)

	identity := userID.String()
	tokenName := displayName
	ttl := voiceTokenTTL

	if req.Client == clientScreen {
		identity = userID.String() + ":screen"
		tokenName = displayName + " — экран"
		ttl = screenTokenTTL

		grant.SetCanPublish(true)
		grant.SetCanSubscribe(false)
		grant.SetCanPublishData(false)

		grant.SetCanPublishSources([]livekit.TrackSource{
			livekit.TrackSource_SCREEN_SHARE,
			livekit.TrackSource_SCREEN_SHARE_AUDIO,
		})
	}

	metadataBytes, err := json.Marshal(map[string]any{
		"user_id":    userID.String(),
		"username":   displayName,
		"guild_id":   guildID.String(),
		"channel_id": channelID.String(),
		"client":     req.Client,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to build token metadata",
		})
		return
	}

	token, err := lkauth.NewAccessToken(h.liveKitAPIKey, h.liveKitAPISecret).
		SetIdentity(identity).
		SetName(tokenName).
		SetMetadata(string(metadataBytes)).
		SetVideoGrant(grant).
		SetValidFor(ttl).
		ToJWT()

	if err != nil {
		h.logger.Error("failed to create livekit token",
			slog.String("user_id", userID.String()),
			slog.String("guild_id", guildID.String()),
			slog.String("channel_id", channelID.String()),
			slog.String("client", req.Client),
			slog.String("identity", identity),
			slog.String("error", err.Error()),
		)

		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to create livekit token",
		})
		return
	}

	h.logger.Info("livekit token issued",
		slog.String("user_id", userID.String()),
		slog.String("username", displayName),
		slog.String("guild_id", guildID.String()),
		slog.String("channel_id", channelID.String()),
		slog.String("client", req.Client),
		slog.String("identity", identity),
		slog.String("room", roomName),
		slog.Duration("ttl", ttl),
	)

	writeJSON(w, http.StatusCreated, createTokenResponse{
		URL:              h.liveKitURL,
		Token:            token,
		Room:             roomName,
		Identity:         identity,
		Name:             tokenName,
		Client:           req.Client,
		ExpiresInSeconds: int(ttl.Seconds()),
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
