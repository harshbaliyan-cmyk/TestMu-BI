import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

// Any constant works as long as every process agrees on it; this one is just
// "TestMuBI" as digits so a stray lock is recognisable in pg_locks.
const MIGRATION_LOCK_KEY = 848_632_401;

// Applying the schema was a manual step nobody was reminded to take: neither
// Render's build command nor the server ran migrations, so a deploy carrying a
// new column shipped code that queried a column the database did not have.
// Running them at boot makes a deploy self-contained however the host was set
// up — Blueprint, manual web service, or a local `node server.js`.
//
// Two properties make that safe to do on every start:
//
//   - a ledger. Each file is recorded once applied, so a warm database does a
//     single SELECT and no DDL. Without it, every cold start (and Render's free
//     plan produces a lot of those) would replay all of them.
//   - one transaction, holding a transaction-scoped advisory lock. Postgres DDL
//     is transactional, so a failure half way leaves the schema untouched
//     rather than half-migrated, and two instances booting together cannot race
//     on the same CREATE/ALTER. The lock is deliberately the _xact_ variant:
//     the connection string points at Neon's pooler, which multiplexes in
//     transaction mode and would not honour a session-level lock.
//
// The files stay individually idempotent (`IF NOT EXISTS`) regardless. That is
// what lets a database migrated before this ledger existed adopt it without a
// backfill: the first run replays statements that are all no-ops, then records
// them.
export async function runMigrations(pool) {
  const files = (await readdir(migrationsDir)).filter(file => file.endsWith('.sql')).sort();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations(
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const alreadyApplied = new Set(rows.map(row => row.filename));

    const applied = [];
    for (const file of files) {
      if (alreadyApplied.has(file)) continue;
      await client.query(await readFile(join(migrationsDir, file), 'utf8'));
      await client.query(
        'INSERT INTO schema_migrations(filename) VALUES($1) ON CONFLICT DO NOTHING', [file]);
      applied.push(file);
    }
    await client.query('COMMIT');
    return { applied, total: files.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
