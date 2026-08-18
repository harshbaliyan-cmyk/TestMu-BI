import { randomUUID } from 'node:crypto';
import { databaseEnabled, transaction } from '../db/pool.js';
import { query } from '../db/pool.js';

// Two commits of the same underlying source are the SAME source to a user,
// even though each commit writes its own data_sources row. Tableau sources are
// identified by the datasource LUID on a given connection; uploaded files, which
// have no stable server-side identity, by filename. Re-uploading "q3.csv" to a
// dashboard means "replace what q3.csv put there", while adding "q4.csv" is a
// genuine second source and must not disturb the first.
const SAME_UNDERLYING_SOURCE = `
  old.owner_user_id = $3
  AND old.deleted_at IS NULL
  AND old.source_type = $4
  AND CASE WHEN $5::text IS NULL
        THEN old.external_id IS NULL AND old.source_name = $6
        ELSE old.external_id = $5 AND old.tableau_connection_id IS NOT DISTINCT FROM $7
      END`;

// Re-committing a source used to stack a second binding beside the old one
// rather than replacing it: the binding upsert keys on (dashboard, data_source),
// and every commit inserts a brand-new data_sources row, so the conflict never
// fired. Both bindings then fed rows into the dashboard, and because the read
// path unions them and de-duplicates by opportunity ID keeping the first seen,
// whichever source happened to be iterated first won — silently. A stale
// mapping could therefore shadow the mapping the user had just committed, with
// no error and nothing in the UI to show it was happening.
export async function persistImportedSource({ userId, source, dashboardKeys, mapping, rowCount }) {
  if (!databaseEnabled || !userId) return { sourceId: randomUUID(), bindings: dashboardKeys, superseded: [] };
  return transaction(async client => {
    const inserted = await client.query(`INSERT INTO data_sources
      (owner_user_id,tableau_connection_id,source_type,external_id,workbook_name,project_name,
       source_name,status,column_metadata,last_row_count,last_accessed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'loaded',$8,$9,now()) RETURNING id`, [
      userId, source.tableauConnectionId || null, source.sourceType, source.externalId || null,
      source.workbookName || null, source.projectName || null, source.filename,
      JSON.stringify(source.headers || []), rowCount,
    ]);
    const sourceId = inserted.rows[0].id;

    if (source.sourceType === 'file') {
      await client.query(`INSERT INTO uploaded_files
        (data_source_id,owner_user_id,original_filename,mime_type,byte_size,checksum,row_count,column_count,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'loaded')`, [sourceId, userId, source.filename,
        source.mimeType || null, source.byteSize || null, source.checksum || null,
        rowCount, source.headers?.length || 0]);
    }

    const bindings = [];
    const supersededKeys = new Map();
    for (const templateKey of dashboardKeys) {
      const dashboard = await client.query('SELECT id FROM dashboards WHERE template_key=$1', [templateKey]);
      if (!dashboard.rows[0]) throw new Error(`Unknown dashboard: ${templateKey}`);
      const dashboardId = dashboard.rows[0].id;

      // Retire this source's own earlier binding on this dashboard before
      // adding the new one. Scoped to the same underlying source, so a
      // dashboard deliberately fed by several different sources keeps them.
      const stale = await client.query(`UPDATE dashboard_source_bindings b
        SET enabled=false, updated_at=now() FROM data_sources old
        WHERE b.dashboard_id=$1 AND b.data_source_id=old.id AND b.enabled=true
          AND old.id<>$2 AND ${SAME_UNDERLYING_SOURCE}
        RETURNING old.id`,
        [dashboardId, sourceId, userId, source.sourceType, source.externalId || null,
          source.filename, source.tableauConnectionId || null]);
      for (const row of stale.rows) {
        if (!supersededKeys.has(row.id)) supersededKeys.set(row.id, new Set());
        supersededKeys.get(row.id).add(templateKey);
      }

      const versionResult = await client.query(`SELECT COALESCE(MAX(mapping_version),0)+1 AS version
        FROM field_mappings WHERE data_source_id=$1 AND dashboard_id=$2 AND schema_key='opportunity'`, [sourceId, dashboardId]);
      const mapped = await client.query(`INSERT INTO field_mappings
        (data_source_id,dashboard_id,schema_key,mapping,mapping_version,validation_status,created_by)
        VALUES ($1,$2,'opportunity',$3,$4,'valid',$5) RETURNING id`,
        [sourceId, dashboardId, JSON.stringify(mapping), versionResult.rows[0].version, userId]);
      await client.query(`INSERT INTO dashboard_source_bindings
        (dashboard_id,data_source_id,field_mapping_id,enabled,combination_mode,deduplication_key)
        VALUES ($1,$2,$3,true,'union','id')
        ON CONFLICT (dashboard_id,data_source_id) DO UPDATE SET
          field_mapping_id=EXCLUDED.field_mapping_id,enabled=true,updated_at=now()`,
        [dashboardId, sourceId, mapped.rows[0].id]);
      bindings.push(templateKey);
    }

    // A superseded source still bound to some OTHER dashboard stays alive for
    // that dashboard; one with nothing left pointing at it is dead weight in
    // the Data Sources list, so retire it rather than leave an orphan behind.
    for (const oldSourceId of supersededKeys.keys()) {
      await client.query(`UPDATE data_sources SET deleted_at=now(), updated_at=now()
        WHERE id=$1 AND NOT EXISTS (
          SELECT 1 FROM dashboard_source_bindings WHERE data_source_id=$1 AND enabled=true)`,
        [oldSourceId]);
    }

    return {
      sourceId,
      bindings,
      superseded: [...supersededKeys].map(([id, keys]) => ({ sourceId: id, dashboardKeys: [...keys] })),
    };
  });
}

export async function listUserSources(clientQuery, userId) {
  const { rows } = await clientQuery(`SELECT ds.id,ds.source_type AS "sourceType",ds.source_name AS name,
    ds.status,ds.last_row_count AS "rowCount",ds.last_successful_sync_at AS "lastSync",
    ds.webhook_enabled AS "webhookEnabled",ds.last_webhook_event_at AS "lastWebhookEventAt",
    ds.created_at AS "createdAt",COALESCE(json_agg(d.template_key) FILTER (WHERE d.id IS NOT NULL),'[]') AS dashboards
    FROM data_sources ds
    LEFT JOIN dashboard_source_bindings b ON b.data_source_id=ds.id AND b.enabled=true
    LEFT JOIN dashboards d ON d.id=b.dashboard_id
    WHERE ds.owner_user_id=$1 AND ds.deleted_at IS NULL
    GROUP BY ds.id ORDER BY ds.updated_at DESC`, [userId]);
  return rows;
}

export async function getRefreshableSource(userId, sourceId) {
  const { rows } = await query(`SELECT ds.id,ds.source_type AS "sourceType",ds.external_id AS "externalId",
    ds.source_name AS "sourceName",ds.tableau_connection_id AS "connectionId",
    tc.server_url AS server,tc.site_id AS "siteId",tc.pat_name AS "patName",
    tc.encrypted_pat_secret AS "encryptedPatSecret",fm.mapping,
    array_agg(d.template_key) AS dashboards
    FROM data_sources ds JOIN tableau_connections tc ON tc.id=ds.tableau_connection_id
    JOIN dashboard_source_bindings b ON b.data_source_id=ds.id AND b.enabled=true
    JOIN dashboards d ON d.id=b.dashboard_id
    JOIN field_mappings fm ON fm.id=b.field_mapping_id
    WHERE ds.owner_user_id=$1 AND ds.id=$2 AND ds.deleted_at IS NULL
    GROUP BY ds.id,tc.id,fm.id`,[userId,sourceId]);
  return rows[0]||null;
}

export async function listRefreshableSourceIds() {
  const {rows}=await query(`SELECT id,owner_user_id AS "userId" FROM data_sources
    WHERE source_type IN ('tableau_view','tableau_datasource') AND deleted_at IS NULL`);
  return rows;
}

// Tableau's webhook delivery carries no signature — the callback URL itself
// (data source id + a random secret, neither guessable) is what stands in
// for auth. This looks the source up by both together, the same way a
// session cookie stands in for auth on every other route.
export async function findWebhookSource(sourceId, secret) {
  const {rows}=await query(`SELECT id,owner_user_id AS "userId",external_id AS "externalId",
    source_type AS "sourceType",webhook_enabled AS "webhookEnabled"
    FROM data_sources WHERE id=$1 AND webhook_secret=$2 AND deleted_at IS NULL`,[sourceId,secret]);
  return rows[0]||null;
}

export async function getSourceWebhookState(userId,sourceId) {
  const {rows}=await query(`SELECT id,external_id AS "externalId",source_type AS "sourceType",
    webhook_id AS "webhookId",webhook_secret AS "webhookSecret",webhook_event AS "webhookEvent",
    webhook_enabled AS "webhookEnabled",tableau_connection_id AS "connectionId"
    FROM data_sources WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL`,[sourceId,userId]);
  return rows[0]||null;
}

export async function saveSourceWebhook(sourceId,{webhookId,webhookSecret,webhookEvent,enabled}) {
  await query(`UPDATE data_sources SET webhook_id=$2,webhook_secret=$3,webhook_event=$4,
    webhook_enabled=$5,updated_at=now() WHERE id=$1`,
    [sourceId,webhookId,webhookSecret,webhookEvent,enabled]);
}

export async function markWebhookEventReceived(sourceId) {
  await query(`UPDATE data_sources SET last_webhook_event_at=now() WHERE id=$1`,[sourceId]);
}

export async function startSyncRun(sourceId,userId,triggerType='manual') {
  const {rows}=await query(`INSERT INTO sync_runs(data_source_id,initiated_by,trigger_type,status)
    VALUES($1,$2,$3,'running') RETURNING id`,[sourceId,userId,triggerType]);
  await query(`UPDATE data_sources SET status='syncing',updated_at=now() WHERE id=$1`,[sourceId]);
  return rows[0].id;
}

export async function finishSyncRun(runId,sourceId,{status,rowCount=0,error=null}) {
  await query(`UPDATE sync_runs SET status=$2,finished_at=now(),rows_read=$3,rows_accepted=$3,
    rows_rejected=0,error_message=$4 WHERE id=$1`,[runId,status,rowCount,error]);
  await query(`UPDATE data_sources SET status=$2,last_row_count=$3,last_sync_attempt_at=now(),
    last_successful_sync_at=CASE WHEN $2='succeeded' THEN now() ELSE last_successful_sync_at END,updated_at=now()
    WHERE id=$1`,[sourceId,status==='succeeded'?'loaded':'error',rowCount]);
}

export async function softDeleteSource(userId, sourceId) {
  if (!databaseEnabled || !userId) return { dashboardKeys: [] };
  return transaction(async client => {
    const bound = await client.query(`SELECT d.template_key FROM dashboard_source_bindings b
      JOIN dashboards d ON d.id=b.dashboard_id
      WHERE b.data_source_id=$1 AND b.enabled=true`, [sourceId]);
    const result = await client.query(`UPDATE data_sources SET deleted_at=now(), updated_at=now()
      WHERE id=$1 AND owner_user_id=$2 AND deleted_at IS NULL RETURNING id`, [sourceId, userId]);
    if (!result.rows[0]) throw Object.assign(new Error('Data source not found'), { status: 404 });
    await client.query(`UPDATE dashboard_source_bindings SET enabled=false, updated_at=now() WHERE data_source_id=$1`, [sourceId]);
    return { dashboardKeys: bound.rows.map(r => r.template_key) };
  });
}

export async function listSyncRuns(userId,sourceId=null) {
  const params=[userId]; let condition='';
  if(sourceId){params.push(sourceId);condition='AND s.data_source_id=$2';}
  const {rows}=await query(`SELECT s.id,s.data_source_id AS "sourceId",d.source_name AS "sourceName",
    s.trigger_type AS "triggerType",s.status,s.started_at AS "startedAt",s.finished_at AS "finishedAt",
    s.rows_read AS "rowsRead",s.error_message AS error FROM sync_runs s JOIN data_sources d ON d.id=s.data_source_id
    WHERE d.owner_user_id=$1 ${condition} ORDER BY s.started_at DESC LIMIT 100`,params); return rows;
}
