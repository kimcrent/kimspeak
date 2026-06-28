package invitations

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/kimcrent/kimspeak/internal/auth"
)

type Handler struct {
	invitationsRepo *Repository
}

func NewHandler(invitationsRepo *Repository) *Handler {
	return &Handler{
		invitationsRepo: invitationsRepo,
	}
}

type listInvitationsResponse struct {
	Invitations []Invitation `json:"invitations"`
}

type invitationResponse struct {
	Invitation Invitation `json:"invitation"`
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.UserIDFromContext(r.Context())
	if !ok || userID == uuid.Nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	invitations, err := h.invitationsRepo.ListPendingForUser(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to get invitations",
		})
		return
	}

	writeJSON(w, http.StatusOK, listInvitationsResponse{
		Invitations: invitations,
	})
}

func (h *Handler) Accept(w http.ResponseWriter, r *http.Request) {
	h.respondToInvitation(w, r, true)
}

func (h *Handler) Decline(w http.ResponseWriter, r *http.Request) {
	h.respondToInvitation(w, r, false)
}

func (h *Handler) respondToInvitation(w http.ResponseWriter, r *http.Request, accepted bool) {
	invitationIDRaw := strings.TrimSpace(r.PathValue("invitation_id"))
	if invitationIDRaw == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invitation_id is required",
		})
		return
	}

	invitationID, err := uuid.Parse(invitationIDRaw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid invitation id",
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

	var invitation Invitation
	if accepted {
		invitation, err = h.invitationsRepo.Accept(r.Context(), invitationID, userID)
	} else {
		invitation, err = h.invitationsRepo.Decline(r.Context(), invitationID, userID)
	}

	if errors.Is(err, ErrInvitationNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": "invitation not found",
		})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to update invitation",
		})
		return
	}

	writeJSON(w, http.StatusOK, invitationResponse{
		Invitation: invitation,
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	_ = json.NewEncoder(w).Encode(data)
}
