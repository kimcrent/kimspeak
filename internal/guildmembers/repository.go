// Package guildmembers contains repository logic for guild membership.
package guildmembers

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{
		db: db,
	}
}

func (r *Repository) AddMember(ctx context.Context, guildID, userID uuid.UUID, role string) error {
	query := `
		INSERT INTO guild_members (guild_id, user_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (guild_id, user_id) DO NOTHING
	`

	_, err := r.db.Exec(ctx, query, guildID, userID, role)
	return err
}

func (r *Repository) AddOwner(ctx context.Context, guildID string, userID uuid.UUID) error {
	query := `
		INSERT INTO guild_members (guild_id, user_id, role)
		VALUES ($1, $2, 'owner')
		ON CONFLICT (guild_id, user_id)
		DO UPDATE SET role = 'owner';
	`

	_, err := r.db.Exec(ctx, query, guildID, userID)
	return err
}

func (r *Repository) IsMember(ctx context.Context, guildID string, userID uuid.UUID) (bool, error) {
	query := `
		SELECT EXISTS (
			SELECT 1
			FROM guild_members
			WHERE guild_id = $1
				AND user_id = $2
		);
	`

	var exists bool

	err := r.db.QueryRow(ctx, query, guildID, userID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

func (r *Repository) RemoveMember(ctx context.Context, guildID, userID uuid.UUID) error {
	query := `
		DELETE FROM guild_members
		WHERE guild_id = $1 AND user_id = $2
	`

	_, err := r.db.Exec(ctx, query, guildID, userID)
	return err
}

func (r *Repository) CanAccessChannel(ctx context.Context, channelID string, userID uuid.UUID) (bool, error) {
	query := `
		SELECT EXISTS (
			SELECT 1
			FROM channels c
			JOIN guild_members gm ON gm.guild_id = c.guild_id
			WHERE c.id = $1
				AND gm.user_id = $2
		);
	`

	var exists bool

	err := r.db.QueryRow(ctx, query, channelID, userID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}
