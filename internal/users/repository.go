package users

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

type UpdateProfileParams struct {
	ID        uuid.UUID
	Username  string
	AvatarURL *string
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{
		db: db,
	}
}

func (r *Repository) Create(ctx context.Context, username string, email string, passwordHash string) (User, error) {
	var user User

	err := r.db.QueryRow(ctx, `
		INSERT INTO users (username, email, password_hash)
		VALUES ($1, $2, $3)
		RETURNING id, username, email, password_hash, avatar_url, created_at, updated_at
	`, username, email, passwordHash).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.PasswordHash,
		&user.AvatarURL,
		&user.CreatedAt,
		&user.UpdatedAt,
	)

	if err != nil {
		return User{}, err
	}
	return user, nil
}

func (r *Repository) FindByEmail(ctx context.Context, email string) (User, error) {
	var user User

	err := r.db.QueryRow(ctx, `
	SELECT id, username, email, password_hash, avatar_url, created_at, updated_at
	FROM users
	WHERE email = $1
	`, email).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.PasswordHash,
		&user.AvatarURL,
		&user.CreatedAt,
		&user.UpdatedAt,
	)

	if err != nil {
		return User{}, err
	}
	return user, nil
}

func (r *Repository) FindByUsername(ctx context.Context, username string) (User, error) {
	var user User

	err := r.db.QueryRow(ctx, `
		SELECT id, username, email, password_hash, avatar_url, created_at, updated_at
		FROM users
		WHERE lower(username) = lower($1)
		LIMIT 1
	`, username).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.PasswordHash,
		&user.AvatarURL,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		return User{}, err
	}

	return user, nil
}

func (r *Repository) FindByID(ctx context.Context, id uuid.UUID) (*User, error) {
	var user User

	err := r.db.QueryRow(ctx, `
	SELECT id, username, email, password_hash, avatar_url, created_at, updated_at
	FROM users
	WHERE id = $1
	`, id).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.PasswordHash,
		&user.AvatarURL,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &user, nil

}

func (r *Repository) IsUsernameTakenByOtherUser(ctx context.Context, userID uuid.UUID, username string) (bool, error) {
	var exists bool

	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM users
			WHERE LOWER(username) = LOWER($1)
				AND id <> $2
			)
	`, username, userID).Scan(&exists)

	if err != nil {
		return false, err
	}

	return exists, nil
}

func (r *Repository) UpdateProfile(ctx context.Context, params UpdateProfileParams) (*User, error) {
	user := &User{}

	err := r.db.QueryRow(ctx, `
		UPDATE users
		SET username = $2,
			avatar_url = $3,
			updated_at = NOW()
		WHERE id = $1
		RETURNING id, username, email, password_hash, avatar_url, created_at, updated_at
	`, params.ID, params.Username, params.AvatarURL).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.PasswordHash,
		&user.AvatarURL,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return user, nil
}

func (r *Repository) IsUsernameTaken(ctx context.Context, username string) (bool, error) {
	var exists bool

	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM users
			WHERE LOWER(username) = LOWER($1)
		)
	`, username).Scan(&exists)

	if err != nil {
		return false, err
	}
	return exists, nil
}
