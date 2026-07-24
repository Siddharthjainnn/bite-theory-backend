-- Bug #4: self-serve admin password reset.
-- forgot() stores a 6-digit code with a 15-minute expiry; reset() consumes it.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS reset_code varchar(12);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS reset_expires timestamptz;
