package httpserver

import (
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kimcrent/kimspeak/internal/config"
)

type Server struct {
	cfg    config.Config
	logger *slog.Logger
	db     *pgxpool.Pool
}

func NewServer(cfg config.Config, logger *slog.Logger, db *pgxpool.Pool) *Server {
	return &Server{
		cfg:    cfg,
		logger: logger,
		db:     db,
	}

}

func (s *Server) Start() error {
	router := s.NewRouter()

	s.logger.Info("Starting http server", "addr", s.cfg.HTTPAddr)
	return http.ListenAndServe(s.cfg.HTTPAddr, router)
}
