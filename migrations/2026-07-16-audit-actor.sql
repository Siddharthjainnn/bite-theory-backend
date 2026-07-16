-- audit_logs.actor — the human-readable "who did this".
--
-- The column was referenced by raw SQL in the refund path and declared on the
-- entity, but NO migration ever created it: audit_logs predates this migration
-- folder. Because the refund path had never actually run in production, the
-- gap stayed invisible until Admin -> Refunds tried to SELECT a.actor and the
-- endpoint 500'd with: column a.actor does not exist.
--
-- admin_user_id stays as the FK-ish numeric reference; actor is the display
-- string ("Priya (kitchen_manager)", "system"), so a log line still reads
-- correctly years later even if that admin record is gone.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor VARCHAR(120);

-- Old rows have no actor. Label them rather than leaving NULLs that render as
-- blank in the admin UI.
UPDATE audit_logs SET actor = 'system' WHERE actor IS NULL;

CREATE INDEX IF NOT EXISTS audit_logs_action_created_idx
  ON audit_logs (action, created_at DESC);
