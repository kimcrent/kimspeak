CREATE TABLE IF NOT EXISTS messages (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

	channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
	author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

	content TEXT NOT NULL CHECK (length(trim(content)) > 0),

	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_id_created_at
ON messages(channel_id, created_at);
