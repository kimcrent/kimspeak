package friends

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUserNotFound         = errors.New("user not found")
	ErrSelfRequest          = errors.New("you can't add yourself")
	ErrAlreadyFriends       = errors.New("users are already exists")
	ErrRequestAlreadyExists = errors.New("friend request already exists")
	ErrRequestNotFound      = errors.New("friend request not found")
	ErrFriendshipNotFound   = errors.New("friendship not found")
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{
		db: db,
	}
}

func (r *Repository) getUserByID(ctx context.Context, userID uuid.UUID) (*UserPreview, error) {
	user := &UserPreview{}

	err := r.db.QueryRow(ctx, `
		SELECT id, username, email, avatar_url
		FROM users
		WHERE id = $1
	`, userID).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.AvatarURL,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}

	if err != nil {
		return nil, err
	}
	return user, nil
}

func (r *Repository) getUserByUsername(ctx context.Context, username string) (*UserPreview, error) {
	user := &UserPreview{}

	err := r.db.QueryRow(ctx, `
		SELECT id, username, email, avatar_url
		FROM users
		WHERE LOWER(username) = LOWER($1)
	`, username).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.AvatarURL,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}

	if err != nil {
		return nil, err
	}
	return user, nil
}

func (r *Repository) SearchUsers(ctx context.Context, currentUserID uuid.UUID, query string) ([]UserPreview, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, username, email, avatar_url
		FROM users
		WHERE id <> $1
			AND username ILIKE '%' || $2 || '%'
		ORDER BY username
		LIMIT 20
	`, currentUserID, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]UserPreview, 0)

	for rows.Next() {
		var user UserPreview

		err := rows.Scan(
			&user.ID,
			&user.Username,
			&user.Email,
			&user.AvatarURL,
		)
		if err != nil {
			return nil, err
		}
		result = append(result, user)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *Repository) hasPendingRequest(ctx context.Context, userID1 uuid.UUID, userID2 uuid.UUID) (bool, error) {
	var exists bool

	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM friend_requests
			WHERE status = 'pending'
				AND LEAST(from_user_id, to_user_id) = LEAST($1::uuid, $2::uuid)
				AND GREATEST(from_user_id, to_user_id) = GREATEST($1::uuid, $2::uuid)
		)
	`, userID1, userID2).Scan(&exists)

	if err != nil {
		return false, err
	}
	return exists, nil
}

func (r *Repository) areFriends(ctx context.Context, userID1 uuid.UUID, userID2 uuid.UUID) (bool, error) {
	var exists bool

	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM friendships
			WHERE user_id_1 = LEAST($1::uuid, $2::uuid)
				AND user_id_2 = GREATEST($1::uuid, $2::uuid)
		)
	`, userID1, userID2).Scan(&exists)

	if err != nil {
		return false, err
	}

	return exists, nil
}

func (r *Repository) SendRequest(ctx context.Context, fromUserID uuid.UUID, toUsername string) (*FriendRequest, error) {
	fromUser, err := r.getUserByID(ctx, fromUserID)
	if err != nil {
		return nil, err
	}

	toUser, err := r.getUserByUsername(ctx, toUsername)
	if err != nil {
		return nil, err
	}

	if fromUser.ID == toUser.ID {
		return nil, ErrSelfRequest
	}

	alreadyFriends, err := r.areFriends(ctx, fromUser.ID, toUser.ID)
	if err != nil {
		return nil, err
	}

	if alreadyFriends {
		return nil, ErrAlreadyFriends
	}

	hasPending, err := r.hasPendingRequest(ctx, fromUser.ID, toUser.ID)
	if err != nil {
		return nil, err
	}

	if hasPending {
		return nil, ErrRequestAlreadyExists
	}

	request := &FriendRequest{
		FromUser: *fromUser,
		ToUser:   *toUser,
	}

	err = r.db.QueryRow(ctx, `
		INSERT INTO friend_request (from_user_id, to_user_id)
		VALUES ($1, $2)
		RETURNING id, status, created_at, updated_at
	`, fromUser.ID, toUser.ID).Scan(
		&request.ID,
		&request.Status,
		&request.CreatedAt,
		&request.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return request, nil
}

func (r *Repository) ListFriends(ctx context.Context, userID uuid.UUID) ([]Friend, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			f.id,

			CASE
				WHEN f.user_id_1 = $1 THEN u2.id
				ELSE u1.id
			END AS friend_id,

			CASE
				WHEN f.user_id_1 = $1 THEN u2.username
				ELSE u1.username
			END AS friend_username,

			CASE
				WHEN f.user_id_1 = $1 THEN u2.email
				ELSE u1.email
			END AS friend_email,

			CASE
				WHEN f.user_id_1 = $1 THEN u2.avatar_url
				ELSE u1.avatar_url
			END AS friend_avatar_url,

			f.created_at
		FROM friendships f
		JOIN users u1 ON u1.id = f.user_id_1
		JOIN users u2 ON u2.id = f.user_id_2
		WHERE f.user_id_1 = $1 OR f.user_id_2 = $1
		ORDER BY f.created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]Friend, 0)

	for rows.Next() {
		var friend Friend

		err := rows.Scan(
			&friend.FriendshipID,
			&friend.ID,
			&friend.Username,
			&friend.Email,
			&friend.AvatarURL,
			&friend.FriendsSince,
		)
		if err != nil {
			return nil, err
		}
		result = append(result, friend)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *Repository) ListIncomingRequests(ctx context.Context, userID uuid.UUID) ([]FriendRequest, error) {
	return r.listRequests(ctx, `
		WHERE fr.to_user_id = $1
			AND fr.status = 'pending'
	`, userID)
}

func (r *Repository) ListOutgoingRequests(ctx context.Context, userID uuid.UUID) ([]FriendRequest, error) {
	return r.listRequests(ctx, `
		WHERE fr.from_user_id = $1
			AND fr.status = 'pending'
	`, userID)
}

func (r *Repository) listRequests(ctx context.Context, whereSQL string, userID uuid.UUID) ([]FriendRequest, error) {
	query := `
		SELECT
			fr.id,

			from_u.id,
			from_u.username,
			from_u.email,
			from_u.avatar_url,

			to_u.id,
			to_u.username,
			to_u.email,
			to_u.avatar_url,

			fr.status,
			fr.created_at,
			fr.updated_at
		FROM friend_requests fr
		JOIN users from_u ON from_u.id = fr.from_user_id
		JOIN users to_u ON to_u.id = fr.to_user_id
	` + whereSQL + `
		ORDER BY fr.created_at DESC
	`

	rows, err := r.db.Query(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]FriendRequest, 0)

	for rows.Next() {
		var request FriendRequest

		err := rows.Scan(
			&request.ID,

			&request.FromUser.ID,
			&request.FromUser.Username,
			&request.FromUser.Email,
			&request.FromUser.AvatarURL,

			&request.ToUser.ID,
			&request.ToUser.Username,
			&request.ToUser.Email,
			&request.ToUser.AvatarURL,

			&request.Status,
			&request.CreatedAt,
			&request.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		result = append(result, request)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *Repository) AcceptRequest(ctx context.Context, currentUSerID uuid.UUID, requestID uuid.UUID) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var fromUserID uuid.UUID

	err = tx.QueryRow(ctx, `
		SELECT from_user_id
		FROM friend_requests
		WHERE id = $1
			AND to_user_id = $2
			AND status = 'pending'
		FOR UPDATE
	`, requestID, currentUSerID).Scan(&fromUserID)

	if errors.Is(err, pgx.ErrNoRows) {
		return ErrRequestNotFound
	}

	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO friendships (user_id_1, user_id_2)
		VALUES (
			LEAST($1::uuid, $2::uuid),
			GREATEST($1::uuid, $2::uuid)
		)
		ON CONFLICT DO NOTHING
	`, fromUserID, currentUSerID)

	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		UPDATE friend_requests
		SET status = 'accepted',
			updated_at = NOW()
		WHERE id = $1
	`, requestID)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (r *Repository) DeclineRequest(ctx context.Context, currentUserID uuid.UUID, requestID uuid.UUID) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE friend_requests
		SET status = 'declined',
			updated_at = NOW()
		WHERE id = $1
			AND to_user_id = $2
			AND status = 'pending'
	`, requestID, currentUserID)
	if err != nil {
		return err
	}

	if tag.RowsAffected() == 0 {
		return ErrRequestNotFound
	}
	return nil
}

func (r *Repository) CancelOutgoingRequest(ctx context.Context, currentUserID uuid.UUID, requestID uuid.UUID) error {
	tag, err := r.db.Exec(ctx, `
		UPDATE friend_requests
		SET status = ''cancelled'
			updated_at = NOW()
		WHERE id = $1
			AND from_user_id = $2
			AND status = 'pending'
	`, requestID, currentUserID)
	if err != nil {
		return err
	}

	if tag.RowsAffected() == 0 {
		return ErrRequestNotFound
	}

	return nil
}

func (r *Repository) RemoveFriend(ctx context.Context, currentUserID uuid.UUID, friendID uuid.UUID) error {
	tag, err := r.db.Exec(ctx, `
		DELETE FROM friendships
		WHERE user_id_1 = LEAST($1::uuid, $2::uuid)
			AND user_id_2 = GREATEST($1::uuid, $2::uuid)
	`, currentUserID, friendID)
	if err != nil {
		return err
	}

	if tag.RowsAffected() == 0 {
		return ErrFriendshipNotFound
	}
	return nil
}
