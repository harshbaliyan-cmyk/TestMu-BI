import dotenv from 'dotenv';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required to run migrations.');
  process.exit(1);
}

const { pool } = await import('../db/pool.js');
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '../db/migrations');
const files = (await readdir(migrationsDir)).filter(file => file.endsWith('.sql')).sort();

try {
  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    await pool.query(sql);
    console.log(`Applied ${file}`);
  }
  console.log('Database migrations completed.');
} finally {
  await pool.end();
}
