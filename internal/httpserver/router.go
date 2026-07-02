// Package httpserver contains HTTP server setup and routing.
package httpserver

import (
	"net/http"

	"github.com/kimcrent/kimspeak/internal/auth"
	"github.com/kimcrent/kimspeak/internal/channels"
	"github.com/kimcrent/kimspeak/internal/friends"
	"github.com/kimcrent/kimspeak/internal/guildmembers"
	"github.com/kimcrent/kimspeak/internal/guilds"
	"github.com/kimcrent/kimspeak/internal/health"
	"github.com/kimcrent/kimspeak/internal/invitations"
	"github.com/kimcrent/kimspeak/internal/messages"
	"github.com/kimcrent/kimspeak/internal/users"
	"github.com/kimcrent/kimspeak/internal/voice"
)

func (s *Server) NewRouter() http.Handler {
	mux := http.NewServeMux()

	healthHandler := health.NewHandler(s.db)

	usersRepository := users.NewRepository(s.db)
	authHandler := auth.NewHandler(usersRepository, s.cfg.JWTSecret)

	friendRepository := friends.NewRepository(s.db)
	friendsHandler := friends.NewHandler(friendRepository)
	channelsRepository := channels.NewRepository(s.db)
	guildsRepository := guilds.NewRepository(s.db)
	guildMembersRepo := guildmembers.NewRepository(s.db)
	invitationsRepo := invitations.NewRepository(s.db)
	messagesRepo := messages.NewRepository(s.db)

	channelsHandler := channels.NewHandler(channelsRepository, guildsRepository, guildMembersRepo)
	guildsHandler := guilds.NewHandler(guildsRepository, guildMembersRepo, invitationsRepo, usersRepository)
	invitationsHandler := invitations.NewHandler(invitationsRepo)
	messagesHandler := messages.NewHandler(messagesRepo, guildMembersRepo)
	voiceHandler := voice.NewHandler(
		s.cfg.LiveKitURL,
		s.cfg.LiveKitAPIKey,
		s.cfg.LiveKitAPISecret,
		guildMembersRepo,
		usersRepository,
		s.logger,
	)

	mux.Handle("/voice/token", authHandler.AuthMiddleware(http.HandlerFunc(voiceHandler.CreateToken)))
	mux.HandleFunc("GET /health", healthHandler.Check)
	mux.HandleFunc("/auth/register", authHandler.Register)
	mux.HandleFunc("/auth/login", authHandler.Login)
	mux.Handle("/me", authHandler.AuthMiddleware(http.HandlerFunc(authHandler.Me)))
	mux.Handle("/guilds", authHandler.AuthMiddleware(http.HandlerFunc(guildsHandler.HandleGuilds)))
	mux.Handle("GET /guilds/{guild_id}/members", authHandler.AuthMiddleware(http.HandlerFunc(guildsHandler.ListMembers)))
	mux.Handle("POST /guilds/{guild_id}/members", authHandler.AuthMiddleware(http.HandlerFunc(guildsHandler.InviteMember)))
	mux.Handle("GET /guild-invitations", authHandler.AuthMiddleware(http.HandlerFunc(invitationsHandler.List)))
	mux.Handle("POST /guild-invitations/{invitation_id}/accept", authHandler.AuthMiddleware(http.HandlerFunc(invitationsHandler.Accept)))
	mux.Handle("POST /guild-invitations/{invitation_id}/decline", authHandler.AuthMiddleware(http.HandlerFunc(invitationsHandler.Decline)))
	mux.Handle("/channels", authHandler.AuthMiddleware(http.HandlerFunc(channelsHandler.HandleChannels)))
	mux.Handle("GET /channels/{channel_id}/members", authHandler.AuthMiddleware(http.HandlerFunc(channelsHandler.ListMembers)))
	mux.Handle("POST /channels/{channel_id}/messages", authHandler.AuthMiddleware(http.HandlerFunc(messagesHandler.Create)))
	mux.Handle("GET /channels/{channel_id}/messages", authHandler.AuthMiddleware(http.HandlerFunc(messagesHandler.ListByChannel)))
	mux.Handle("PATCH /me/profile", authHandler.AuthMiddleware(http.HandlerFunc(authHandler.UpdateMeProfile)))

	mux.Handle("GET /friends/search", authHandler.AuthMiddleware(http.HandlerFunc(friendsHandler.SearchUsers)))
	mux.Handle("GET /friends", authHandler.AuthMiddleware(http.HandlerFunc(friendsHandler.ListFriends)))
	mux.Handle("POST /friends/requests", authHandler.AuthMiddleware(http.HandlerFunc(friendsHandler.SendRequest)))
	mux.Handle("GET /friends/requests/incoming", authHandler.AuthMiddleware(http.HandlerFunc(friendsHandler.ListIncomingRequests)))
	mux.Handle("GET /friends/requests/outgoing", authHandler.AuthMiddleware(http.HandlerFunc(friendsHandler.ListOutgoingRequests)))
	mux.Handle("POST /friends/requests/{request_id}/accept", authHandler.AuthMiddleware(http.HandlerFunc(friendsHandler.AcceptRequest)))
	mux.Handle("POST /friends/requests/{request_id}/decline", authHandler.AuthMiddleware(http.HandlerFunc(friendsHandler.DeclineRequest)))
	mux.Handle("POST /friends/requests/{request_id}/cancel", authHandler.AuthMiddleware(http.HandlerFunc(friendsHandler.CancelOutgoingRequest)))
	mux.Handle("DELETE /friends/{friend_id}", authHandler.AuthMiddleware(http.HandlerFunc(friendsHandler.RemoveFriend)))

	return withCORS(mux)
}
