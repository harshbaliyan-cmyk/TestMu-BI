import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to run migrations.');
  process.exit(1);
}

// The server applies migrations at boot too, through this same runner. This
// script stays for the operator path: running them deliberately, against a
// database named on the command line, with a non-zero exit when one fails —
// where boot deliberately keeps serving instead.
const { pool } = await import('../db/pool.js');
const { runMigrations } = await import('../db/migrate.js');

try {
  const { applied, total } = await runMigrations(pool);
  for (const file of applied) console.log(`Applied ${file}`);
  console.log(applied.length
    ? `Database migrations completed (${applied.length} of ${total} were new).`
    : `Database already up to date (${total} migrations).`);
} catch (error) {
  console.error('Migration failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
