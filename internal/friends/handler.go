package friends

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/kimcrent/kimspeak/internal/auth"
)

type Handler struct {
	repository *Repository
}

func NewHandler(repository *Repository) *Handler {
	return &Handler{
		repository: repository,
	}
}

type sendFriendRequestRequest struct {
	Username string `json:"username"`
}

func writeJSON(w http.ResponseWriter, statusCode int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	if err := json.NewEncoder(w).Encode(value); err != nil {
		return
	}
}

func currentUserIDFromRequest(r *http.Request) (uuid.UUID, bool) {
	return auth.UserIDFromContext(r.Context())
}

func (h *Handler) SearchUsers(w http.ResponseWriter, r *http.Request) {
	currentUserID, ok := currentUserIDFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"users": []UserPreview{},
		})
		return
	}

	users, err := h.repository.SearchUsers(r.Context(), currentUserID, query)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to search users",
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"users": users,
	})
}

func (h *Handler) SendRequest(w http.ResponseWriter, r *http.Request) {
	currentUserID, ok := currentUserIDFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	var req sendFriendRequestRequest

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

	friendRequest, err := h.repository.SendRequest(r.Context(), currentUserID, req.Username)
	if err != nil {
		h.writeFriendError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"request": friendRequest,
	})
}

func (h *Handler) ListFriends(w http.ResponseWriter, r *http.Request) {
	currentUserID, ok := currentUserIDFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	friends, err := h.repository.ListFriends(r.Context(), currentUserID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to load friends",
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"friends": friends,
	})
}

func (h *Handler) ListIncomingRequests(w http.ResponseWriter, r *http.Request) {
	currentUserID, ok := currentUserIDFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	requests, err := h.repository.ListIncomingRequests(r.Context(), currentUserID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to load incoming requests",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"requests": requests,
	})
}

func (h *Handler) ListOutgoingRequests(w http.ResponseWriter, r *http.Request) {
	currentUserID, ok := currentUserIDFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	requests, err := h.repository.ListOutgoingRequests(r.Context(), currentUserID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to load outgoing requests",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"requests": requests,
	})
}

func (h *Handler) AcceptRequest(w http.ResponseWriter, r *http.Request) {
	currentUserID, ok := currentUserIDFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	requestID, ok := h.requestIDFromPath(w, r)
	if !ok {
		return
	}

	err := h.repository.AcceptRequest(r.Context(), currentUserID, requestID)
	if err != nil {
		h.writeFriendError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status": "accepted",
	})
}

func (h *Handler) DeclineRequest(w http.ResponseWriter, r *http.Request) {
	currentUserID, ok := currentUserIDFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	requestID, ok := h.requestIDFromPath(w, r)
	if !ok {
		return
	}

	err := h.repository.DeclineRequest(r.Context(), currentUserID, requestID)
	if err != nil {
		h.writeFriendError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status": "declined",
	})
}

func (h *Handler) CancelOutgoingRequest(w http.ResponseWriter, r *http.Request) {
	currentUserID, ok := currentUserIDFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	requestID, ok := h.requestIDFromPath(w, r)
	if !ok {
		return
	}

	err := h.repository.CancelOutgoingRequest(r.Context(), currentUserID, requestID)
	if err != nil {
		h.writeFriendError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status": "cancelled",
	})
}

func (h *Handler) RemoveFriend(w http.ResponseWriter, r *http.Request) {
	currentUserID, ok := currentUserIDFromRequest(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	friendIDRaw := r.PathValue("friend_id")

	friendID, err := uuid.Parse(friendIDRaw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid friend id",
		})
		return
	}

	err = h.repository.RemoveFriend(r.Context(), currentUserID, friendID)
	if err != nil {
		h.writeFriendError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status": "removed",
	})
}

func (h *Handler) requestIDFromPath(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	requestIDRaw := r.PathValue("request_id")

	requestID, err := uuid.Parse(requestIDRaw)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid request id",
		})
		return uuid.Nil, false
	}
	return requestID, true
}

func (h *Handler) writeFriendError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrUserNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": "user not found",
		})
	case errors.Is(err, ErrSelfRequest):
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "you can't add, yourself",
		})
	case errors.Is(err, ErrAlreadyFriends):
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": "users are already friends",
		})
	case errors.Is(err, ErrRequestAlreadyExists):
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": "friend request already exists",
		})
	case errors.Is(err, ErrRequestNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": "friend request not found",
		})
	case errors.Is(err, ErrFriendshipNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": "friendship not found",
		})

	default:
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "internal server error",
		})
	}
}
