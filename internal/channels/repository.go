package channels

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrChannelNotFound = errors.New("channel not found")
var ErrForbidden = errors.New("forbidden")

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{
		db: db,
	}
}

func (r *Repository) Create(ctx context.Context, guildID string, name string, channelType string) (Channel, error) {
	var channel Channel

	err := r.db.QueryRow(ctx, `
		INSERT INTO channels (guild_id, name, type)
		VALUES ($1, $2, $3)
		RETURNING id, guild_id, name, type, position, created_at, updated_at
	`, guildID, name, channelType).Scan(
		&channel.ID,
		&channel.GuildID,
		&channel.Name,
		&channel.Type,
		&channel.Position,
		&channel.CreatedAt,
		&channel.UpdatedAt,
	)
	if err != nil {
		return Channel{}, err
	}
	return channel, nil
}

func (r *Repository) FindByGuildID(ctx context.Context, guildID string) ([]Channel, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, guild_id, name, type, position, created_at, updated_at
		FROM channels
		WHERE guild_id = $1
		ORDER BY position ASC, created_at ASC
	`, guildID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	channels := make([]Channel, 0)

	for rows.Next() {
		var channel Channel

		err := rows.Scan(
			&channel.ID,
			&channel.GuildID,
			&channel.Name,
			&channel.Type,
			&channel.Position,
			&channel.CreatedAt,
			&channel.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		channels = append(channels, channel)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return channels, nil
}

func (r *Repository) DeleteByAdmin(ctx context.Context, channelID uuid.UUID, userID uuid.UUID) error {
	var guildID uuid.UUID

	err := r.db.QueryRow(ctx, `
		SELECT guild_id
		FROM channels
		WHERE id = $1
	`, channelID).Scan(&guildID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrChannelNotFound
	}
	if err != nil {
		return err
	}

	var canDelete bool

	err = r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM guild_members
			WHERE guild_id = $1
				AND user_id = $2
				AND role IN ('owner', 'admin')
		)
	`, guildID, userID).Scan(&canDelete)
	if err != nil {
		return err
	}

	if !canDelete {
		return ErrForbidden
	}

	commandTag, err := r.db.Exec(ctx, `
		DELETE FROM channels
		WHERE id = $1
	`, channelID)
	if err != nil {
		return err
	}

	if commandTag.RowsAffected() == 0 {
		return ErrChannelNotFound
	}
	return nil
}
