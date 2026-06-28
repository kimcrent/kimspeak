package guilds

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

func (r *Repository) Create(ctx context.Context, name string, ownerID uuid.UUID) (Guild, error) {
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
		ON CONFLICT (guild_id, user_id)
		DO UPDATE SET role = 'owner'
	`, guild.ID, ownerID, "owner")

	if err != nil {
		return Guild{}, err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO channels (guild_id, name, type, position)
		VALUES ($1, 'general', 'text', 0)
	`, guild.ID)

	if err != nil {
		return Guild{}, err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO channels (guild_id, name, type, position)
		VALUES ($1, 'Голосовой канал 1', 'voice', 1)
	`, guild.ID)

	if err != nil {
		return Guild{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Guild{}, err
	}

	return guild, nil
}

func (r *Repository) FindByUserID(ctx context.Context, userID uuid.UUID) ([]Guild, error) {
	rows, err := r.db.Query(ctx, `
		SELECT g.id, g.name, g.owner_id, g.created_at, g.updated_at
		FROM guilds g
		LEFT JOIN guild_members gm
			ON gm.guild_id = g.id
			AND gm.user_id = $1
		WHERE g.owner_id = $1
			OR gm.user_id = $1
		ORDER BY g.created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}

	defer rows.Close()

	guilds := make([]Guild, 0)

	for rows.Next() {
		var guild Guild

		err := rows.Scan(
			&guild.ID,
			&guild.Name,
			&guild.OwnerID,
			&guild.CreatedAt,
			&guild.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		guilds = append(guilds, guild)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	return guilds, nil
}

func (r *Repository) ListByUserID(ctx context.Context, userID uuid.UUID) ([]Guild, error) {
	query := `
		SELECT
			g.id,
			g.name,
			g.owner_id,
			g.created_at,
			g.updated_at
			FROM guilds g
			LEFT JOIN guild_members gm
				ON gm.guild_id = g.id
				AND gm.user_id = $1
			WHERE g.owner_id = $1
				OR gm.user_id = $1
			ORDER BY g.created_at DESC
		`

	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var guilds []Guild

	for rows.Next() {
		var guild Guild

		err := rows.Scan(
			&guild.ID,
			&guild.Name,
			&guild.OwnerID,
			&guild.CreatedAt,
			&guild.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		guilds = append(guilds, guild)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return guilds, nil
}

func (r *Repository) IsMember(ctx context.Context, guildID string, userID uuid.UUID) (bool, error) {
	var exists bool

	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM guilds g
			LEFT JOIN guild_members gm
				ON gm.guild_id = g.id
				AND gm.user_id = $2
			WHERE g.id = $1
				AND (
					g.owner_id = $2
					OR gm.user_id = $2
				)
		)
	`, guildID, userID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

func (r *Repository) IsOwner(ctx context.Context, guildID string, userID uuid.UUID) (bool, error) {
	var exists bool

	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
		SELECT 1
		FROM guilds
		WHERE id = $1 AND owner_id = $2
		)
	`, guildID, userID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}
