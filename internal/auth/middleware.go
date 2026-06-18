package auth

import (
	"net/http"
	"strings"
)

func (h *Handler) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")

		if authHeader == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]any{
				"error": "authorization header is required",
			})
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" || parts[1] == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]any{
				"error": "invalid authorization header",
			})
			return
		}

		userID, err := ParseAccessToken(parts[1], h.jwtSecret)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]any{
				"error": "invalid or expired token",
			})
			return
		}

		ctx := contextWithUserID(r.Context(), userID)

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
