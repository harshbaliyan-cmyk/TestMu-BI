import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { runMigrations } from '../db/migrate.js';
import { createShareTokenStore } from '../repositories/shareTokens.js';

// Real PostgreSQL SQL in memory: never reads or writes the configured app DB.
const migrationDir = new URL('../db/migrations/', import.meta.url);
const removalFile = '017_remove_dashboard_builder.sql';
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const custom = '00000000-0000-4000-8000-000000000003';
const source = '00000000-0000-4000-8000-000000000004';
const hash = token => createHash('sha256').update(token).digest('hex');
const sql = file => readFile(new URL(file, migrationDir), 'utf8');

async function database(t) {
  const db = await PGlite.create({ extensions: { pgcrypto, citext } });
  t.after(() => db.close());
  // pg accepts whole migration files; PGlite uses exec for multiple statements.
  const client = {
    query: async (text, params) => params ? db.query(text, params) : (await db.exec(text)).at(-1),
    release() {},
  };
  return { db, pool: { connect: async () => client } };
}

async function previousSchema(db) {
  await db.exec('CREATE TABLE schema_migrations(filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = (await readdir(migrationDir)).filter(file => file.endsWith('.sql') && file < removalFile).sort();
  for (const file of files) {
    await db.exec(await sql(file));
    await db.query('INSERT INTO schema_migrations(filename) VALUES($1)', [file]);
  }
  await db.exec(`
    -- These two registry entries are normally seeded by server startup.
    INSERT INTO dashboards(template_key,name,is_system) VALUES
      ('product-view','Product View',true),('executive-dashboard','Executive Dashboard',true)
      ON CONFLICT(template_key) DO NOTHING;
    INSERT INTO users(id,email) VALUES('${owner}','owner@example.com'),('${other}','other@example.com');
    INSERT INTO data_sources(id,owner_user_id,source_type,source_name) VALUES('${source}','${owner}','file','Revenue');
    INSERT INTO saved_dashboard_states(user_id,dashboard_id,filters,presentation_settings)
      SELECT '${owner}',id,'{"region":["AMER"]}','{"view":"overview"}' FROM dashboards;
    INSERT INTO dashboard_source_bindings(dashboard_id,data_source_id) SELECT id,'${source}' FROM dashboards;
    INSERT INTO saved_views(user_id,dashboard_id,name,configuration)
      SELECT '${owner}',id,'Quarter review','{"region":"AMER"}' FROM dashboards;
    INSERT INTO custom_dashboards(id,owner_user_id,name) VALUES('${custom}','${owner}','event');
    INSERT INTO saved_charts(owner_user_id,data_source_id,name,chart_type,config)
      VALUES('${owner}','${source}','Revenue by region','bar','{}');
  `);
  await db.query(`INSERT INTO share_tokens(owner_user_id,dashboard_id,token_hash,label)
    SELECT $1,id,$2,'Existing TV' FROM dashboards WHERE template_key='win-board'`, [owner, hash('existing-template-link')]);
  await db.query(`INSERT INTO share_tokens(owner_user_id,custom_dashboard_id,token_hash)
    VALUES($1,$2,$3)`, [owner, custom, hash('retired-link')]);
}

async function retainedData(db) {
  const result = {};
  for (const table of ['users', 'dashboards', 'data_sources', 'saved_dashboard_states', 'dashboard_source_bindings', 'saved_views']) {
    result[table] = (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  }
  result.tokens = (await db.query(`SELECT id,owner_user_id,dashboard_id,token_hash,label,created_at,expires_at,revoked_at,last_used_at
    FROM share_tokens WHERE dashboard_id IS NOT NULL ORDER BY id`)).rows;
  return result;
}

async function assertRetired(db) {
  const { rows } = await db.query("SELECT to_regclass('saved_charts') AS charts, to_regclass('custom_dashboards') AS dashboards");
  assert.deepEqual(rows[0], { charts: null, dashboards: null });
  const columns = (await db.query("SELECT column_name,is_nullable FROM information_schema.columns WHERE table_name='share_tokens'")).rows;
  assert.equal(columns.some(column => column.column_name === 'custom_dashboard_id'), false);
  assert.equal(columns.find(column => column.column_name === 'dashboard_id').is_nullable, 'NO');
}

test('existing database retires only builder data and preserves dashboards, sources, saved views and TV links', async t => {
  const { db, pool } = await database(t);
  await previousSchema(db);
  const before = await retainedData(db);
  assert.equal(before.dashboards.length, 9);
  assert.ok(before.dashboards.some(board => board.template_key === 'event-analytics'));
  assert.deepEqual((await runMigrations(pool)).applied, [removalFile]);
  await assertRetired(db);
  assert.deepEqual(await retainedData(db), before);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM share_tokens')).rows[0].count, 1);
  assert.deepEqual((await runMigrations(pool)).applied, []);
  await db.exec(await sql(removalFile)); // Safe for manual migration replay too.
  assert.deepEqual(await retainedData(db), before);
});

test('fresh installation runs every migration and ends without builder tables', async t => {
  const { db, pool } = await database(t);
  const result = await runMigrations(pool);
  assert.equal(result.applied.length, result.total);
  await assertRetired(db);
  assert.deepEqual((await runMigrations(pool)).applied, []);
});

test('unexpected dependencies roll the entire removal back instead of cascading deletes', async t => {
  const { db, pool } = await database(t);
  await previousSchema(db);
  const before = await retainedData(db);
  await db.exec('CREATE VIEW external_chart_dependency AS SELECT id FROM saved_charts');
  await assert.rejects(runMigrations(pool), /depend/);
  assert.deepEqual(await retainedData(db), before);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM saved_charts')).rows[0].count, 1);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM custom_dashboards')).rows[0].count, 1);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM share_tokens WHERE custom_dashboard_id IS NOT NULL')).rows[0].count, 1);
  assert.equal((await db.query('SELECT filename FROM schema_migrations WHERE filename=$1', [removalFile])).rows.length, 0);
});

test('template TV tokens retain creation, owner-scoped management, expiry and revocation after migration', async t => {
  const { db, pool } = await database(t);
  await previousSchema(db);
  await runMigrations(pool);
  const store = createShareTokenStore((text, params) => db.query(text, params));
  assert.deepEqual(await store.resolveShareToken('existing-template-link'), { userId: owner, templateKey: 'win-board' });
  assert.equal(await store.resolveShareToken('retired-link'), null);
  assert.equal(await store.resolveShareToken(null), null);
  assert.equal(await store.resolveShareToken('x'.repeat(129)), null);
  await assert.rejects(store.createShareToken({ userId: owner }), { status: 400 });
  await assert.rejects(store.createShareToken({ userId: owner, templateKey: 'nonexistent' }), { status: 400 });
  const link = await store.createShareToken({ userId: owner, templateKey: 'event-analytics', label: 'Event TV' });
  assert.deepEqual(await store.resolveShareToken(link.token), { userId: owner, templateKey: 'event-analytics' });
  assert.equal((await db.query('SELECT token_hash FROM share_tokens WHERE id=$1', [link.id])).rows[0].token_hash, hash(link.token));
  assert.deepEqual(await store.listShareTokens(other), []);
  const listed = (await store.listShareTokens(owner)).find(token => token.id === link.id);
  assert.equal(listed.templateKey, 'event-analytics');
  assert.equal(listed.label, 'Event TV');
  assert.equal('token' in listed, false);
  assert.ok(listed.lastUsedAt);
  assert.equal(await store.revokeShareToken(other, link.id), false);
  assert.ok(await store.resolveShareToken(link.token));
  assert.equal(await store.revokeShareToken(owner, link.id), true);
  assert.equal(await store.resolveShareToken(link.token), null);
  assert.equal(await store.revokeShareToken(owner, link.id), false);
  const expired = await store.createShareToken({ userId: owner, templateKey: 'win-board', expiresAt: '2000-01-01T00:00:00Z' });
  assert.equal(await store.resolveShareToken(expired.token), null);
});
