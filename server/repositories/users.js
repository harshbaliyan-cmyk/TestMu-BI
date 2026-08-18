import { databaseEnabled, query, transaction } from '../db/pool.js';

export async function upsertUser({ email, googleSubject = null, displayName, pictureUrl = null, role = 'user' }) {
  if (!databaseEnabled) return { id: null, email, displayName, pictureUrl, role, status: 'active' };
  const { rows } = await query(`
    INSERT INTO users (email, google_subject, display_name, picture_url, role, last_login_at)
    VALUES ($1, $2, $3, $4, $5, now())
    ON CONFLICT (email) DO UPDATE SET
      google_subject = COALESCE(EXCLUDED.google_subject, users.google_subject),
      display_name = EXCLUDED.display_name, picture_url = EXCLUDED.picture_url,
      last_login_at = now(), updated_at = now()
    RETURNING id, email, display_name AS "displayName", picture_url AS "pictureUrl", role, status
  `, [email, googleSubject, displayName, pictureUrl, role]);
  return rows[0];
}

export async function findUserByEmail(email) {
  if (!databaseEnabled) return null;
  const { rows } = await query(`SELECT id, email, google_subject AS "googleSubject",
    display_name AS "displayName", picture_url AS "pictureUrl", password_hash AS "passwordHash",
    auth_provider AS "authProvider", role, status,
    must_change_password AS "mustChangePassword" FROM users WHERE email=$1`, [email]);
  return rows[0] || null;
}

export async function createPasswordUser({ email, displayName, passwordHash }) {
  const { rows } = await query(`INSERT INTO users
    (email,display_name,password_hash,auth_provider,last_login_at)
    VALUES ($1,$2,$3,'password',now())
    RETURNING id,email,display_name AS "displayName",picture_url AS "pictureUrl",role,status`,
    [email, displayName, passwordHash]);
  return rows[0];
}

export async function markLogin(userId) {
  if (databaseEnabled && userId) await query('UPDATE users SET last_login_at=now(),updated_at=now() WHERE id=$1', [userId]);
}

// ===== PASSWORD AND USER ADMINISTRATION =====

const USER_COLUMNS = `id, email, display_name AS "displayName", role, status,
  auth_provider AS "authProvider", must_change_password AS "mustChangePassword",
  password_hash IS NOT NULL AS "hasPassword", created_at AS "createdAt",
  last_login_at AS "lastLoginAt", password_changed_at AS "passwordChangedAt"`;

export async function findUserById(userId) {
  if (!databaseEnabled || !userId) return null;
  const { rows } = await query(
    `SELECT ${USER_COLUMNS}, password_hash AS "passwordHash" FROM users WHERE id=$1`, [userId]);
  return rows[0] || null;
}

export async function listUsers() {
  if (!databaseEnabled) return [];
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at`);
  return rows;
}

export async function setPassword(userId, passwordHash, { mustChange = false } = {}) {
  const { rows } = await query(`UPDATE users SET password_hash=$2, auth_provider='password',
    must_change_password=$3, password_changed_at=now(), updated_at=now()
    WHERE id=$1 RETURNING ${USER_COLUMNS}`, [userId, passwordHash, mustChange]);
  return rows[0] || null;
}

export async function createInvitedUser({ email, displayName, passwordHash, role, invitedBy }) {
  const { rows } = await query(`INSERT INTO users
    (email,display_name,password_hash,auth_provider,role,must_change_password,password_changed_at,invited_by)
    VALUES ($1,$2,$3,'password',$4,true,now(),$5)
    RETURNING ${USER_COLUMNS}`, [email, displayName, passwordHash, role, invitedBy]);
  return rows[0];
}

export async function updateUserAccess(userId, { role, status }) {
  const { rows } = await query(`UPDATE users SET
    role = COALESCE($2, role), status = COALESCE($3, status), updated_at = now()
    WHERE id=$1 RETURNING ${USER_COLUMNS}`, [userId, role ?? null, status ?? null]);
  return rows[0] || null;
}

// Guard against locking everyone out of administration. Counting only ACTIVE
// admins matters: a disabled admin cannot sign in, so leaving one behind is
// the same as leaving none.
export async function countOtherActiveAdmins(excludingUserId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM users WHERE role='admin' AND status='active' AND id<>$1`,
    [excludingUserId]);
  return rows[0].n;
}

// A changed password must not leave older sessions usable — that is the whole
// point of changing it after a suspected compromise. connect-pg-simple stores
// the session payload as JSON in `session.sess`, so the user's other sessions
// are found by the userId inside it. The caller's current session is spared
// (and separately regenerated) so they are not signed out of the tab they are
// using.
export async function revokeOtherSessions(userId, keepSid) {
  if (!databaseEnabled || !userId) return 0;
  const result = await query(
    `DELETE FROM session WHERE sess ->> 'userId' = $1 AND sid <> COALESCE($2,'')`,
    [String(userId), keepSid || '']);
  return result.rowCount;
}

// Erasure. Rows that ARE the person (identity, credentials, preferences, their
// saved work) are deleted outright. Rows that merely reference them — the audit
// and access logs — are anonymised instead: those records exist to show that
// something happened, and deleting them would destroy the security history that
// makes an incident reconstructable. Anonymising keeps the event and drops the
// identity, which is the balance a security log is supposed to strike.
//
// A single transaction: a half-deleted account is worse than either outcome.
export async function deleteUserData(userId, { transferTo = null } = {}) {
  return transaction(async client => {
    const before = await client.query(
      `SELECT email, display_name FROM users WHERE id=$1`, [userId]);
    if (!before.rows[0]) return null;

    // Data sources hold business rows belonging to the workspace, not to the
    // person. Where a successor is named they move; otherwise they are removed
    // with the account so nothing is left orphaned and unreachable.
    const moved = { dataSources: 0, connections: 0 };
    if (transferTo) {
      moved.dataSources = (await client.query(
        `UPDATE data_sources SET owner_user_id=$2 WHERE owner_user_id=$1`, [userId, transferTo])).rowCount;
      moved.connections = (await client.query(
        `UPDATE tableau_connections SET owner_user_id=$2 WHERE owner_user_id=$1`, [userId, transferTo])).rowCount;
      await client.query(`UPDATE uploaded_files SET owner_user_id=$2 WHERE owner_user_id=$1`, [userId, transferTo]);
      await client.query(`UPDATE dashboards SET owner_user_id=$2 WHERE owner_user_id=$1`, [userId, transferTo]);
    } else {
      await client.query(`UPDATE data_sources SET deleted_at=now() WHERE owner_user_id=$1 AND deleted_at IS NULL`, [userId]);
      await client.query(`UPDATE tableau_connections SET deleted_at=now() WHERE owner_user_id=$1 AND deleted_at IS NULL`, [userId]);
      await client.query(`DELETE FROM uploaded_files WHERE owner_user_id=$1`, [userId]);
      await client.query(`UPDATE dashboards SET owner_user_id=NULL WHERE owner_user_id=$1`, [userId]);
    }

    // Personal content: no reason to keep any of it.
    for (const [table, column] of [
      ['saved_dashboard_states','user_id'], ['saved_views','user_id'],
      ['saved_reports','user_id'], ['user_preferences','user_id'],
      ['application_errors','user_id'],
    ]) {
      await client.query(`DELETE FROM ${table} WHERE ${column}=$1`, [userId]);
    }

    // Logs: keep the event, drop the person.
    //
    // Matched on BOTH the actor id and the email inside after_state. Sign-in
    // events are recorded with a NULL actor — a failed attempt has no user to
    // attribute it to — so an id-only sweep silently left every login and
    // signup record holding the address of an account that had just been
    // erased, which is precisely the data an erasure is meant to remove.
    const email = before.rows[0].email;
    await client.query(`UPDATE audit_logs SET actor_user_id=NULL, ip_address=NULL, user_agent=NULL,
      after_state = jsonb_strip_nulls(
        COALESCE(after_state,'{}'::jsonb) - 'email' || '{"subject":"deleted-user"}'::jsonb)
      WHERE actor_user_id=$1 OR after_state ->> 'email' = $2`, [userId, email]);
    await client.query(`UPDATE data_access_log SET user_id=NULL WHERE user_id=$1`, [userId]);
    await client.query(`UPDATE field_mappings SET created_by=NULL WHERE created_by=$1`, [userId]);
    await client.query(`UPDATE sync_runs SET initiated_by=NULL WHERE initiated_by=$1`, [userId]);
    await client.query(`UPDATE users SET invited_by=NULL WHERE invited_by=$1`, [userId]);

    // Every session, so deletion takes effect immediately rather than whenever
    // the browser next happens to ask.
    await client.query(`DELETE FROM session WHERE sess ->> 'userId' = $1`, [String(userId)]);
    await client.query(`DELETE FROM users WHERE id=$1`, [userId]);
    return { email: before.rows[0].email, moved };
  });
}
