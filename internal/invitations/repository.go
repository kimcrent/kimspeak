// Package invitations contains repository logic for guild invitations.
package invitations

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInvitationNotFound = errors.New("invitation not found")

type Invitation struct {
	ID              uuid.UUID `json:"id"`
	GuildID         uuid.UUID `json:"guild_id"`
	GuildName       string    `json:"guild_name"`
	InviterID       uuid.UUID `json:"inviter_id"`
	InviterUsername string    `json:"inviter_username"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"created_at"`
}

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{
		db: db,
	}
}

func (r *Repository) Create(ctx context.Context, guildID, inviterID, inviteeID uuid.UUID) (Invitation, error) {
	var invitation Invitation

	err := r.db.QueryRow(ctx, `
		WITH upserted AS (
			INSERT INTO guild_invitations (guild_id, inviter_id, invitee_id)
			VALUES ($1, $2, $3)
			ON CONFLICT (guild_id, invitee_id) WHERE status = 'pending'
			DO UPDATE SET
				inviter_id = EXCLUDED.inviter_id,
				updated_at = now()
			RETURNING id, guild_id, inviter_id, status, created_at
		)
		SELECT
			i.id,
			i.guild_id,
			g.name,
			i.inviter_id,
			u.username,
			i.status,
			i.created_at
		FROM upserted i
		JOIN guilds g ON g.id = i.guild_id
		JOIN users u ON u.id = i.inviter_id
	`, guildID, inviterID, inviteeID).Scan(
		&invitation.ID,
		&invitation.GuildID,
		&invitation.GuildName,
		&invitation.InviterID,
		&invitation.InviterUsername,
		&invitation.Status,
		&invitation.CreatedAt,
	)
	if err != nil {
		return Invitation{}, err
	}

	return invitation, nil
}

func (r *Repository) ListPendingForUser(ctx context.Context, userID uuid.UUID) ([]Invitation, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			i.id,
			i.guild_id,
			g.name,
			i.inviter_id,
			u.username,
			i.status,
			i.created_at
		FROM guild_invitations i
		JOIN guilds g ON g.id = i.guild_id
		JOIN users u ON u.id = i.inviter_id
		WHERE i.invitee_id = $1
			AND i.status = 'pending'
		ORDER BY i.created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	invitations := make([]Invitation, 0)

	for rows.Next() {
		var invitation Invitation

		err := rows.Scan(
			&invitation.ID,
			&invitation.GuildID,
			&invitation.GuildName,
			&invitation.InviterID,
			&invitation.InviterUsername,
			&invitation.Status,
			&invitation.CreatedAt,
		)
		if err != nil {
			return nil, err
		}

		invitations = append(invitations, invitation)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return invitations, nil
}

func (r *Repository) Accept(ctx context.Context, invitationID, inviteeID uuid.UUID) (Invitation, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return Invitation{}, err
	}
	defer tx.Rollback(ctx)

	var invitation Invitation

	err = tx.QueryRow(ctx, `
		WITH accepted AS (
			UPDATE guild_invitations
			SET status = 'accepted',
				responded_at = now(),
				updated_at = now()
			WHERE id = $1
				AND invitee_id = $2
				AND status = 'pending'
			RETURNING id, guild_id, inviter_id, status, created_at
		)
		SELECT
			i.id,
			i.guild_id,
			g.name,
			i.inviter_id,
			u.username,
			i.status,
			i.created_at
		FROM accepted i
		JOIN guilds g ON g.id = i.guild_id
		JOIN users u ON u.id = i.inviter_id
	`, invitationID, inviteeID).Scan(
		&invitation.ID,
		&invitation.GuildID,
		&invitation.GuildName,
		&invitation.InviterID,
		&invitation.InviterUsername,
		&invitation.Status,
		&invitation.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Invitation{}, ErrInvitationNotFound
	}
	if err != nil {
		return Invitation{}, err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO guild_members (guild_id, user_id, role)
		VALUES ($1, $2, 'member')
		ON CONFLICT (guild_id, user_id) DO NOTHING
	`, invitation.GuildID, inviteeID)
	if err != nil {
		return Invitation{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Invitation{}, err
	}

	return invitation, nil
}

func (r *Repository) Decline(ctx context.Context, invitationID, inviteeID uuid.UUID) (Invitation, error) {
	var invitation Invitation

	err := r.db.QueryRow(ctx, `
		WITH declined AS (
			UPDATE guild_invitations
			SET status = 'declined',
				responded_at = now(),
				updated_at = now()
			WHERE id = $1
				AND invitee_id = $2
				AND status = 'pending'
			RETURNING id, guild_id, inviter_id, status, created_at
		)
		SELECT
			i.id,
			i.guild_id,
			g.name,
			i.inviter_id,
			u.username,
			i.status,
			i.created_at
		FROM declined i
		JOIN guilds g ON g.id = i.guild_id
		JOIN users u ON u.id = i.inviter_id
	`, invitationID, inviteeID).Scan(
		&invitation.ID,
		&invitation.GuildID,
		&invitation.GuildName,
		&invitation.InviterID,
		&invitation.InviterUsername,
		&invitation.Status,
		&invitation.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Invitation{}, ErrInvitationNotFound
	}
	if err != nil {
		return Invitation{}, err
	}

	return invitation, nil
}
