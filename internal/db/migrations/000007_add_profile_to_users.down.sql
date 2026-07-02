DROP INDEX IF EXISTS users_username_lower_unique;

ALTER TABLE users
DROP COLUMN IF EXISTS avatar_url;
