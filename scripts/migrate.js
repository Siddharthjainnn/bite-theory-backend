#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Migration runner.
 *
 * THE PROBLEM THIS SOLVES
 * ----------------------
 * migrations/ held 13 .sql files and nothing ever ran them. They were applied
 * by hand, by memory, one console paste at a time. Nobody could answer the only
 * question that matters on launch day: "has this migration run on production?"
 * A missed migration doesn't fail loudly — it fails at dinner rush, when an
 * INSERT hits a column that isn't there.
 *
 * HOW IT WORKS
 * ------------
 *  - A `schema_migrations` table records every file that has been applied.
 *  - Files run in filename order (they're date-prefixed, so that's chronological).
 *  - Each file runs inside a TRANSACTION: it fully applies or fully rolls back.
 *    A half-applied migration is the worst possible state; this makes it
 *    impossible.
 *  - Already-applied files are skipped. Safe to run on every deploy.
 *  - A checksum is stored. If a file changes AFTER being applied, the runner
 *    stops and tells you — silent drift between environments is exactly how
 *    "works on staging, breaks in prod" happens.
 *
 * SAFE TO ADOPT ON AN EXISTING DATABASE
 * -------------------------------------
 * Every existing migration is idempotent (CREATE TABLE IF NOT EXISTS / ADD
 * COLUMN IF NOT EXISTS), so running them against a database where they were
 * already applied by hand is a no-op. Use `--baseline` to simply mark them all
 * as applied without executing, if you prefer.
 *
 * USAGE
 *   npm run migrate            apply anything pending
 *   npm run migrate:status     show what's applied vs pending (read-only)
 *   npm run migrate -- --baseline
 *                              mark all current files as applied WITHOUT
 *                              running them (for a DB already migrated by hand)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const DIR = path.join(__dirname, '..', 'migrations');
const args = process.argv.slice(2);
const STATUS_ONLY = args.includes('--status');
const BASELINE = args.includes('--baseline');

function sha(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function files() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✗ DATABASE_URL is not set.');
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    // Neon/Render require TLS; they use certs Node doesn't ship by default.
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      duration_ms INTEGER
    )`);

  const { rows } = await client.query(
    'SELECT filename, checksum FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.filename, r.checksum]));
  const all = files();

  if (all.length === 0) {
    console.log('No migration files found.');
    await client.end();
    return;
  }

  // ── drift check: an applied file that has since been edited ──
  let drift = false;
  for (const f of all) {
    if (!applied.has(f)) continue;
    const now = sha(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (applied.get(f) !== now) {
      console.error(`✗ DRIFT: ${f} was applied but its contents changed since.`);
      console.error('  Never edit an applied migration — add a NEW file instead.');
      drift = true;
    }
  }
  if (drift && !STATUS_ONLY) {
    await client.end();
    process.exit(1);
  }

  const pending = all.filter((f) => !applied.has(f));

  if (STATUS_ONLY) {
    console.log(`\n  applied: ${applied.size}   pending: ${pending.length}\n`);
    for (const f of all) {
      console.log(`  ${applied.has(f) ? '✓ applied' : '· PENDING'}  ${f}`);
    }
    console.log('');
    await client.end();
    return;
  }

  if (BASELINE) {
    for (const f of pending) {
      const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
      await client.query(
        `INSERT INTO schema_migrations (filename, checksum, duration_ms)
         VALUES ($1,$2,0) ON CONFLICT (filename) DO NOTHING`, [f, sha(sql)]);
      console.log(`  baselined (not executed): ${f}`);
    }
    console.log(`\n✓ Baselined ${pending.length} file(s). Nothing was executed.\n`);
    await client.end();
    return;
  }

  if (pending.length === 0) {
    console.log('✓ Database is up to date — nothing to apply.');
    await client.end();
    return;
  }

  console.log(`\nApplying ${pending.length} migration(s):\n`);
  for (const f of pending) {
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
    const started = Date.now();
    try {
      // all-or-nothing: a half-applied migration is the worst outcome
      await client.query('BEGIN');
      await client.query(sql);
      const ms = Date.now() - started;
      await client.query(
        `INSERT INTO schema_migrations (filename, checksum, duration_ms)
         VALUES ($1,$2,$3)`, [f, sha(sql), ms]);
      await client.query('COMMIT');
      console.log(`  ✓ ${f}  (${ms}ms)`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`\n  ✗ ${f} FAILED — rolled back, nothing was applied.`);
      console.error(`    ${e.message}\n`);
      await client.end();
      process.exit(1);
    }
  }
  console.log('\n✓ All migrations applied.\n');
  await client.end();
}

main().catch((e) => {
  console.error('✗ Migration runner error:', e.message);
  process.exit(1);
});
