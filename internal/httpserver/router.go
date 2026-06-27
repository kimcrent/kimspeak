// Package httpserver contains HTTP server setup and routing.
package httpserver

import (
	"net/http"

	"github.com/kimcrent/kimspeak/internal/auth"
	"github.com/kimcrent/kimspeak/internal/channels"
	"github.com/kimcrent/kimspeak/internal/guildmembers"
	"github.com/kimcrent/kimspeak/internal/guilds"
	"github.com/kimcrent/kimspeak/internal/health"
	"github.com/kimcrent/kimspeak/internal/messages"
	"github.com/kimcrent/kimspeak/internal/users"
	"github.com/kimcrent/kimspeak/internal/voice"
)

func (s *Server) NewRouter() http.Handler {
	mux := http.NewServeMux()

	healthHandler := health.NewHandler(s.db)

	voiceHandler := voice.NewHandler(s.logger)

	usersRepository := users.NewRepository(s.db)
	authHandler := auth.NewHandler(usersRepository, s.cfg.JWTSecret)

	channelsRepository := channels.NewRepository(s.db)
	guildsRepository := guilds.NewRepository(s.db)
	guildMembersRepo := guildmembers.NewRepository(s.db)
	messagesRepo := messages.NewRepository(s.db)

	channelsHandler := channels.NewHandler(channelsRepository, guildsRepository)
	guildsHandler := guilds.NewHandler(guildsRepository, guildMembersRepo)
	messagesHandler := messages.NewHandler(messagesRepo, guildMembersRepo)

	mux.HandleFunc("/voice/ws", voiceHandler.ServeWS)
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
