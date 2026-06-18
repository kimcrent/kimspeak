package httpserver

import (
	"net/http"

	"github.com/kimcrent/kimspeak/internal/auth"
	"github.com/kimcrent/kimspeak/internal/health"
	"github.com/kimcrent/kimspeak/internal/users"
)

func (s *Server) NewRouter() http.Handler {
	mux := http.NewServeMux()

	healthHandler := health.NewHandler(s.db)

	usersRepository := users.NewRepository(s.db)
	authHandler := auth.NewHandler(usersRepository, s.cfg.JWTSecret)

	mux.HandleFunc("GET /health", healthHandler.Check)
	mux.HandleFunc("/auth/register", authHandler.Register)
	mux.HandleFunc("/auth/login", authHandler.Login)
	mux.Handle("/me", authHandler.AuthMiddleware(http.HandlerFunc(authHandler.Me)))

	return mux
}
