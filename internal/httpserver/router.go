// Package httpserver contains HTTP server setup and routing.
package httpserver

import (
	"net/http"

	"github.com/kimcrent/kimspeak/internal/auth"
	"github.com/kimcrent/kimspeak/internal/channels"
	"github.com/kimcrent/kimspeak/internal/guilds"
	"github.com/kimcrent/kimspeak/internal/health"
	"github.com/kimcrent/kimspeak/internal/messages"
	"github.com/kimcrent/kimspeak/internal/users"
)

func (s *Server) NewRouter() http.Handler {
	mux := http.NewServeMux()

	healthHandler := health.NewHandler(s.db)

	usersRepository := users.NewRepository(s.db)
	authHandler := auth.NewHandler(usersRepository, s.cfg.JWTSecret)
	guildsRepository := guilds.NewRepository(s.db)
	guildsHandler := guilds.NewHandler(guildsRepository)
	channelsRepository := channels.NewRepository(s.db)
	channelsHandler := channels.NewHandler(channelsRepository, guildsRepository)
	messagesRepo := messages.NewRepository(s.db)
	messagesHandler := messages.NewHandler(messagesRepo)

	mux.HandleFunc("GET /health", healthHandler.Check)
	mux.HandleFunc("/auth/register", authHandler.Register)
	mux.HandleFunc("/auth/login", authHandler.Login)
	mux.Handle("/me", authHandler.AuthMiddleware(http.HandlerFunc(authHandler.Me)))
	mux.Handle("/guilds", authHandler.AuthMiddleware(http.HandlerFunc(guildsHandler.HandleGuilds)))
	mux.Handle("/channels", authHandler.AuthMiddleware(http.HandlerFunc(channelsHandler.HandleChannels)))
	mux.Handle("POST /channels/{channel_id}/messages", authHandler.AuthMiddleware(http.HandlerFunc(messagesHandler.Create)))
	mux.Handle("GET /channels/{channel_id}/messages", authHandler.AuthMiddleware(http.HandlerFunc(messagesHandler.ListByChannel)))

	return mux
}
