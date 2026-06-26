package messages

import (
	"context"
	"strings"

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

func (r *Repository) Create(ctx context.Context, channelID string, authorID uuid.UUID, content string) (*Message, error) {
	content = strings.TrimSpace(content)

	query := `
		INSERT INTO messages (channel_id, author_id, content)
		VALUES ($1::uuid, $2::uuid, $3)
		RETURNING
			id::text,
			channel_id::text,
			author_id::text,
			content,
			created_at,
			updated_at;
	`

	var message Message

	err := r.db.QueryRow(ctx, query, channelID, authorID, content).Scan(
		&message.ID,
		&message.ChannelID,
		&message.AuthorID,
		&message.Content,
		&message.CreatedAt,
		&message.UpdatedAt,
	)

	if err != nil {
		return nil, err
	}

	return &message, nil
}

func (r *Repository) ListByChannel(ctx context.Context, chennalID string, limit int) ([]Message, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	query := `
		SELECT
			id::text,
			channel_id::text,
			author_id::text,
			content,
			created_at,
			updated_at
		FROM (
			SELECT *
			FROM messages
			WHERE channel_id = $1::uuid
			ORDER BY created_at DESC
			LIMIT $2
		) AS latest_messages
		ORDER BY created_at ASC;
	`

	rows, err := r.db.Query(ctx, query, chennalID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]Message, 0)

	for rows.Next() {
		var message Message

		err := rows.Scan(
			&message.ID,
			&message.ChannelID,
			&message.AuthorID,
			&message.Content,
			&message.CreatedAt,
			&message.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		result = append(result, message)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
