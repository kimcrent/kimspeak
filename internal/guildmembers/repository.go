// Package guildmembers contains repository logic for guild membership.
package guildmembers

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ChannelMember struct {
	ID       uuid.UUID `json:"id"`
	Username string    `json:"username"`
	Role     string    `json:"role"`
}

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

func (r *Repository) CanManageGuild(ctx context.Context, guildID uuid.UUID, userID uuid.UUID) (bool, error) {
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
					OR gm.role IN ('owner', 'admin')
				)
		)
	`, guildID, userID).Scan(&exists)
	if err != nil {
		return false, err
	}

	return exists, nil
}

func (r *Repository) FindByGuildAndUser(ctx context.Context, guildID uuid.UUID, userID uuid.UUID) (ChannelMember, error) {
	var member ChannelMember

	err := r.db.QueryRow(ctx, `
		SELECT
			u.id,
			u.username,
			gm.role
		FROM guild_members gm
		JOIN users u ON u.id = gm.user_id
		WHERE gm.guild_id = $1
			AND gm.user_id = $2
	`, guildID, userID).Scan(
		&member.ID,
		&member.Username,
		&member.Role,
	)
	if err != nil {
		return ChannelMember{}, err
	}

	return member, nil
}

func (r *Repository) ListByGuild(ctx context.Context, guildID uuid.UUID) ([]ChannelMember, error) {
	query := `
		WITH raw_members AS (
			SELECT
				u.id,
				u.username,
				gm.role
			FROM guild_members gm
			JOIN users u ON u.id = gm.user_id
			WHERE gm.guild_id = $1

			UNION ALL

			SELECT
				u.id,
				u.username,
				'owner' AS role
			FROM guilds g
			JOIN users u ON u.id = g.owner_id
			WHERE g.id = $1
		),
		ranked_members AS (
			SELECT
				id,
				username,
				MIN(
					CASE role
						WHEN 'owner' THEN 0
						WHEN 'admin' THEN 1
						ELSE 2
					END
				) AS role_rank
			FROM raw_members
			GROUP BY id, username
		)
		SELECT
			id,
			username,
			CASE role_rank
				WHEN 0 THEN 'owner'
				WHEN 1 THEN 'admin'
				ELSE 'member'
			END AS role
		FROM ranked_members
		ORDER BY role_rank, lower(username)
	`

	rows, err := r.db.Query(ctx, query, guildID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := make([]ChannelMember, 0)

	for rows.Next() {
		var member ChannelMember

		err := rows.Scan(
			&member.ID,
			&member.Username,
			&member.Role,
		)
		if err != nil {
			return nil, err
		}

		members = append(members, member)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return members, nil
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
			JOIN guilds g ON g.id = c.guild_id
			LEFT JOIN guild_members gm
				ON gm.guild_id = c.guild_id
				AND gm.user_id = $2
			WHERE c.id = $1
				AND (
					g.owner_id = $2
					OR gm.user_id = $2
				)
		);
	`

	var exists bool

	err := r.db.QueryRow(ctx, query, channelID, userID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

func (r *Repository) CanAccessVoiceChannel(
	ctx context.Context,
	guildID uuid.UUID,
	channelID uuid.UUID,
	userID uuid.UUID,
) (bool, error) {
	query := `
		SELECT EXISTS (
			SELECT 1
			FROM channels c
			JOIN guilds g ON g.id = c.guild_id
			LEFT JOIN guild_members gm
				ON gm.guild_id = c.guild_id
				AND gm.user_id = $3
			WHERE c.id = $2
				AND c.guild_id = $1
				AND c.type = 'voice'
				AND (
					g.owner_id = $3
					OR gm.user_id = $3
				)
		);
	`

	var exists bool

	err := r.db.QueryRow(ctx, query, guildID, channelID, userID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

func (r *Repository) ListByChannel(ctx context.Context, channelID uuid.UUID) ([]ChannelMember, error) {
	query := `
		WITH channel_guild AS (
			SELECT guild_id
			FROM channels
			WHERE id = $1
		),
		raw_members AS (
			SELECT
				u.id,
				u.username,
				gm.role
			FROM channel_guild cg
			JOIN guild_members gm ON gm.guild_id = cg.guild_id
			JOIN users u ON u.id = gm.user_id

			UNION ALL

			SELECT
				u.id,
				u.username,
				'owner' AS role
			FROM channel_guild cg
			JOIN guilds g ON g.id = cg.guild_id
			JOIN users u ON u.id = g.owner_id
		),
		ranked_members AS (
			SELECT
				id,
				username,
				MIN(
					CASE role
						WHEN 'owner' THEN 0
						WHEN 'admin' THEN 1
						ELSE 2
					END
				) AS role_rank
			FROM raw_members
			GROUP BY id, username
		)
		SELECT
			id,
			username,
			CASE role_rank
				WHEN 0 THEN 'owner'
				WHEN 1 THEN 'admin'
				ELSE 'member'
			END AS role
		FROM ranked_members
		ORDER BY role_rank, lower(username)
	`

	rows, err := r.db.Query(ctx, query, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := make([]ChannelMember, 0)

	for rows.Next() {
		var member ChannelMember

		err := rows.Scan(
			&member.ID,
			&member.Username,
			&member.Role,
		)
		if err != nil {
			return nil, err
		}

		members = append(members, member)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return members, nil
}
