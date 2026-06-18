package main

import (
	"context"
	"log"

	"github.com/kimcrent/kimspeak/internal/config"
	"github.com/kimcrent/kimspeak/internal/db"
	"github.com/kimcrent/kimspeak/internal/httpserver"
	"github.com/kimcrent/kimspeak/internal/logger"
)

func main() {
	ctx := context.Background()

	logg := logger.New()

	cfg := config.Load()

	postgresPool, err := db.NewPostgresPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to connect to postgres: %v", err)
	}

	defer postgresPool.Close()

	server := httpserver.NewServer(cfg, logg, postgresPool)

	if err := server.Start(); err != nil {
		log.Fatalf("server stopped: %v", err)
	}
}
