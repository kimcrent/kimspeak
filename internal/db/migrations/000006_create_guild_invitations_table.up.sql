CREATE TABLE IF NOT EXISTS guild_invitations (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
	inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	invitee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	status TEXT NOT NULL DEFAULT 'pending'
		CHECK (status IN ('pending', 'accepted', 'declined')),
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	responded_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_guild_invitations_pending
ON guild_invitations(guild_id, invitee_id)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_guild_invitations_invitee_id
ON guild_invitations(invitee_id);
