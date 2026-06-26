CREATE TABLE IF NOT EXISTS guild_members (
	guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

	role TEXT NOT NULL DEFAULT 'member'
		CHECK (role IN ('owner', 'admin', 'member')),

	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

	PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_guild_members_user_id
ON guild_members(user_id);

INSERT INTO guild_members (guild_id, user_id, role)
SELECT id, owner_id, 'owner'
FROM guilds
WHERE owner_id IS NOT NULL
ON CONFLICT (guild_id, user_id) DO NOTHING;
