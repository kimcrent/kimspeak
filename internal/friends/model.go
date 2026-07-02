package friends

import (
	"time"

	"github.com/google/uuid"
)

type UserPreview struct {
	ID        uuid.UUID `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	AvatarURL *string   `json:"avatar_url"`
}

type Friend struct {
	FriendshipID uuid.UUID `json:"friendship_id"`
	ID           uuid.UUID `json:"id"`
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	AvatarURL    *string   `json:"avatar_url"`
	FriendsSince time.Time `json:"friends_since"`
}

type FriendRequest struct {
	ID        uuid.UUID   `json:"id"`
	FromUser  UserPreview `json:"from_user"`
	ToUser    UserPreview `json:"to_user"`
	Status    string      `json:"status"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
}
