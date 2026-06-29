package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PoolOptions struct {
	MaxConns          int32
	MinConns          int32
	MaxConnLifetime   time.Duration
	MaxConnIdleTime   time.Duration
	HealthCheckPeriod time.Duration
	PingTimeout       time.Duration
}

func NewPostgresPool(ctx context.Context, databaseURL string, options PoolOptions) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}

	if options.MaxConns > 0 {
		cfg.MaxConns = options.MaxConns
	}

	if options.MinConns > 0 {
		cfg.MinConns = options.MinConns
	}

	if cfg.MinConns > cfg.MaxConns {
		cfg.MinConns = cfg.MaxConns
	}

	if options.MaxConnLifetime > 0 {
		cfg.MaxConnLifetime = options.MaxConnLifetime
	}

	if options.MaxConnIdleTime > 0 {
		cfg.MaxConnIdleTime = options.MaxConnIdleTime
	}

	if options.HealthCheckPeriod > 0 {
		cfg.HealthCheckPeriod = options.HealthCheckPeriod
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}

	pingCtx := ctx
	cancel := func() {}
	if options.PingTimeout > 0 {
		pingCtx, cancel = context.WithTimeout(ctx, options.PingTimeout)
	}
	defer cancel()

	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, err
	}

	return pool, nil
}
