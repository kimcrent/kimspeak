package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/kimcrent/kimspeak/internal/users"
	"golang.org/x/crypto/bcrypt"
)

type Handler struct {
	usersRepo *users.Repository
	jwtSecret string
}

func NewHandler(usersRepo *users.Repository, jwtSecret string) *Handler {
	return &Handler{
		usersRepo: usersRepo,
		jwtSecret: jwtSecret,
	}
}

type registerRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type registerResponse struct {
	User users.User `json:"user"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginResponse struct {
	User        users.User `json:"user"`
	AccessToken string     `json:"access_token"`
}

type meResponse struct {
	User users.User `json:"user"`
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{
			"error": "method not allowed",
		})
		return
	}

	var req registerRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid json",
		})
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	req.Email = strings.TrimSpace(req.Email)
	req.Password = strings.TrimSpace(req.Password)

	if req.Username == "" || req.Email == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "username, email and password are required",
		})
		return
	}

	passwordHashBytes, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to hash password",
		})
		return
	}

	user, err := h.usersRepo.Create(r.Context(), req.Username, req.Email, string(passwordHashBytes))
	if err != nil {
		var pgErr *pgconn.PgError

		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]any{
				"error": "email already exists",
			})
			return
		}

		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to create user",
		})
		return
	}

	writeJSON(w, http.StatusCreated, registerResponse{
		User: user,
	})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{
			"error": "method not allowed",
		})
		return
	}

	var req loginRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid json",
		})
		return
	}

	req.Email = strings.TrimSpace(req.Email)
	req.Password = strings.TrimSpace(req.Password)

	if req.Email == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "email and password are required",
		})
		return
	}

	user, err := h.usersRepo.FindByEmail(r.Context(), req.Email)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "invalid email or password",
		})
		return
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password))
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "invalid email or password",
		})
		return
	}

	accessToken, err := GenerateAccessToken(user.ID, h.jwtSecret)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "failed to generate token",
		})
		return
	}

	writeJSON(w, http.StatusOK, loginResponse{
		User:        user,
		AccessToken: accessToken,
	})
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{
			"error": "method not allowed",
		})
		return
	}

	userID, ok := UserIDFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "unauthorized",
		})
		return
	}

	user, err := h.usersRepo.FindByID(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "user not found",
		})
		return
	}

	writeJSON(w, http.StatusOK, meResponse{
		User: user,
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	_ = json.NewEncoder(w).Encode(data)
}
