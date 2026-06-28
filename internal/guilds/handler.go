package guilds

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/kimcrent/kimspeak/internal/auth"
	"github.com/kimcrent/kimspeak/internal/guildmembers"
	"github.com/kimcrent/kimspeak/internal/users"
)

type Handler struct {
	guildsRepo       *Repository
	guildMembersRepo *guildmembers.Repository
	usersRepo        *users.Repository
}

func NewHandler(
	guildsRepo *Repository,
	guildMembersRepo *guildmembers.Repository,
	usersRepo *users.Repository,
) *Handler {
	return &Handler{
		guildsRepo:       guildsRepo,
		guildMembersRepo: guildMembersRepo,
		usersRepo:        usersRepo,
	}
}

type createGuildRequest struct {
	Name string `json:"name"`
}

type createGuildResponse struct {
	Guild Guild `json:"guild"`
}

type listGuildsResponse struct {
	Guilds []Guild `json:"guilds"`
}

type listGuildMembersResponse struct {
	Members []guildmembers.ChannelMember `json:"members"`
}

type inviteGuildMemberRequest struct {
	Username string `json:"username"`
}

type inviteGuildMemberResponse struct {
	Member guildmembers.ChannelMember `json:"member"`
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
		fmt.Println("failed to create guild", err)
		http.Error(w, "failed to create guild", http.StatusInternalServerError)
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

func (h *Handler) ListMembers(w http.ResponseWriter, r *http.Request) {
	guildIDRaw := strings.TrimSpace(r.PathValue("guild_id"))
	if guildIDRaw == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "guild_id is required",
		})
		return
	}

	guildID, err := uuid.Parse(guildIDRaw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid guild id",
		})
		return
	}

	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok || userID == uuid.Nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	isMember, err := h.guildsRepo.IsMember(r.Context(), guildID.String(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to check permissions",
		})
		return
	}

	if !isMember {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"error": "forbidden",
		})
		return
	}

	members, err := h.guildMembersRepo.ListByGuild(r.Context(), guildID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to get guild members",
		})
		return
	}

	writeJSON(w, http.StatusOK, listGuildMembersResponse{
		Members: members,
	})
}

func (h *Handler) InviteMember(w http.ResponseWriter, r *http.Request) {
	guildIDRaw := strings.TrimSpace(r.PathValue("guild_id"))
	if guildIDRaw == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "guild_id is required",
		})
		return
	}

	guildID, err := uuid.Parse(guildIDRaw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid guild id",
		})
		return
	}

	inviterID, ok := auth.UserIDFromContext(r.Context())
	if !ok || inviterID == uuid.Nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	canInvite, err := h.guildMembersRepo.CanManageGuild(r.Context(), guildID, inviterID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to check permissions",
		})
		return
	}

	if !canInvite {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"error": "only admin can invite users",
		})
		return
	}

	var req inviteGuildMemberRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid json",
		})
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "username is required",
		})
		return
	}

	invitee, err := h.usersRepo.FindByUsername(r.Context(), req.Username)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": "user not found",
		})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to find user",
		})
		return
	}

	if err := h.guildMembersRepo.AddMember(r.Context(), guildID, invitee.ID, "member"); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to invite user",
		})
		return
	}

	member, err := h.guildMembersRepo.FindByGuildAndUser(r.Context(), guildID, invitee.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to get invited user",
		})
		return
	}

	writeJSON(w, http.StatusCreated, inviteGuildMemberResponse{
		Member: member,
	})
}
