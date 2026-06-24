package guilds

import (
	"context"

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

func (r *Repository) Create(ctx context.Context, name string, ownerID string) (Guild, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return Guild{}, err
	}

	defer tx.Rollback(ctx)

	var guild Guild

	err = tx.QueryRow(ctx, `
		INSERT INTO guilds (name, owner_id)
		VALUES ($1, $2)
		RETURNING id, name, owner_id, created_at, updated_at
	`, name, ownerID).Scan(
		&guild.ID,
		&guild.Name,
		&guild.OwnerID,
		&guild.CreatedAt,
		&guild.UpdatedAt,
	)

	if err != nil {
		return Guild{}, err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO guild_members (guild_id, user_id, role)
		VALUES ($1, $2, $3)
	`, guild.ID, ownerID, "owner")

	if err != nil {
		return Guild{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Guild{}, err
	}

	return guild, nil
}
