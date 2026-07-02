CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS friend_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    status TEXT NOT NULL DEFAULT 'pending',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT friend_requests_not_self_check
        CHECK (from_user_id <> to_user_id),

    CONSTRAINT friend_requests_status_check
        CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_pair_unique
ON friend_requests (
    LEAST(from_user_id, to_user_id),
    GREATEST(from_user_id, to_user_id)
)
WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id_1 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id_2 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT friendships_not_self_check
        CHECK (user_id_1 <> user_id_2)
);

CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_unique
ON friendships (
    LEAST(user_id_1, user_id_2),
    GREATEST(user_id_1, user_id_2)
);