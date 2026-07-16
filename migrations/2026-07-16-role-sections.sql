-- Role → allowed admin sections.
-- Before this, the map lived in the frontend source, so changing what a role
-- could see required a code change + redeploy. Now a super_admin configures it
-- from Admin → Roles.
--
-- NULL means "use the app's built-in defaults for this role name", so existing
-- roles keep working untouched until someone customises them.
ALTER TABLE roles ADD COLUMN IF NOT EXISTS sections JSONB;
