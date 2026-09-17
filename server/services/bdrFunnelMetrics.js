// BDR Funnel: a port of the Tableau "Dashboard : BDR Funnel" crosstab, one
// row per BDR. See docs in the spec this was built from (bdr-funnel-dashboard-
// spec.md): the source is a stacked union of three record types, so every
// row populates one column family and leaves the rest null.
//
// Two departures from the workbook are deliberate:
//   - Weeks Measured is computed to an explicit AS-OF date, never to "now".
//     The Tableau version uses TODAY(), so the whole board drifts every
//     midnight and no number can be regression-tested.
//   - The roster is applied by Salesforce User Id first, name second, and
//     lives in config rather than in a formula. The name-only filter in
//     Tableau has already broken twice on spelling ("Saksham Chandok",
//     "Gauri M.").

const DAY = 86_400_000;
const nz = value => (value === null || value === undefined || value === '' ? null : value);
const first = (...values) => { for (const value of values) { const v = nz(value); if (v !== null) return v; } return null; };

// A YYYY-MM-DD as a whole day number. Calendar arithmetic on day numbers is
// what makes DATEDIFF('day') exact across DST changes and time zones.
export function dayNumber(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const utc = Date.UTC(y, m - 1, d);
  return Number.isFinite(utc) ? Math.round(utc / DAY) : null;
}

export const localToday = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

// The as-of date the run is pinned to. Anything that is not a real calendar
// day falls back to today, and the value used is stamped on the output.
export function parseAsOf(value, now = new Date()) {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [y, m, d] = text.split('-').map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d) return text;
  }
  return localToday(now);
}

// ===== LAYER 1: one row shape out of three =====
// Record type is inferred, not stored: a Task carries T.Activity ID, a
// Meeting carries E.Activity ID, anything else is an Account row.
export function unifyBdrRow(row) {
  const recordType = nz(row.bdrTaskId) !== null ? 'Task' : nz(row.bdrEventId) !== null ? 'Meeting' : 'Account';
  const isTask = recordType === 'Task';
  const isMeeting = recordType === 'Meeting';
  const activityDate = isTask ? first(row.bdrTaskDueDate, row.bdrTaskCreatedDate)
    : isMeeting ? first(row.bdrEventStart, row.bdrEventDueDate)
    : nz(row.bdrAccountCreatedDate);
  const subtype = nz(row.bdrTaskSubtype);
  const rating = nz(row.bdrEventRating);
  return {
    recordType,
    userId: first(row.bdrTaskOwnerId, row.bdrEventOwnerId, row.bdrAccountOwnerId),
    name: first(row.bdrTaskOwnerName, row.bdrEventOwnerName, row.bdrAccountOwnerName),
    // Carried, not used: the alternative attribution model (whoever owns the
    // account rather than whoever logged the activity). Swapping the
    // aggregation key to this is a one-line change; rebuilding is not.
    accountOwnerId: first(row.bdrTaskLeadAccountOwnerId, row.bdrEventAccountOwnerId, row.bdrAccountOwnerId),
    activityDate: activityDate ? String(activityDate).slice(0, 10) : null,
    // Order matters: the stream's own account beats the fallback key.
    accountKey: first(row.bdrTaskLeadAccountId, row.bdrTaskAccountId, row.bdrEventAccountJoinId, row.bdrEventAccountId, row.bdrAccountId),
    leadKey: isTask ? nz(row.bdrLeadId) : isMeeting ? nz(row.bdrEventNameId) : null,
    eventId: isMeeting ? nz(row.bdrEventId) : null,
    subtype: isTask ? (subtype ?? 'Unspecified') : isMeeting ? 'Meeting' : 'Account',
    // A dial is a Task whose subtype is exactly "Call": SMS, email, LinkedIn
    // and cadence steps are Tasks too, and outcome is irrelevant.
    isCall: isTask && subtype === 'Call',
    isMeeting,
    // "To be Rated" is the not-yet-rated state, not a rating.
    isRated: isMeeting && rating !== null && rating !== 'To be Rated',
    // "Future Qualified" is deliberately NOT qualified. This is the single
    // decision point; six of the thirteen metrics follow it.
    isQualified: isMeeting && rating === 'Qualified',
  };
}

// ===== LAYERS 2 AND 3: per-BDR anchors and the thirteen measures =====
// A loop, not Math.min(...days): a busy BDR's call list is wider than the call stack allows.
const minDay = days => days.reduce((min, day) => (min === null || day < min ? day : min), null);
const isoOfDay = day => (day === null ? null : new Date(day * DAY).toISOString().slice(0, 10));

function summarizeBdr(bdr, asOfDay) {
  const rows = bdr.rows;
  const callDays = [], meetingDays = [], qualifiedDays = [];
  for (const row of rows) {
    const day = dayNumber(row.activityDate);
    if (day === null) continue;
    if (row.isCall) callDays.push(day);
    if (row.isMeeting) meetingDays.push(day);
    if (row.isQualified) qualifiedDays.push(day);
  }
  const floorDay = minDay(callDays);
  // INT() truncates toward zero, so an as-of date before the floor cannot
  // produce a week count that rounds the wrong way.
  const weeksMeasured = floorDay === null ? null : Math.trunc((asOfDay - floorDay) / 7) + 1;

  // Every measure is a DISTINCT count of a business key over qualifying rows
  // only. The task stream's account join can duplicate rows, and a raw row
  // count would be inflated by it.
  const distinct = (test, keyOf) => {
    const keys = new Set();
    for (const row of rows) { const key = test(row) ? keyOf(row) : null; if (key !== null && key !== undefined) keys.add(key); }
    return keys.size;
  };
  // Windows are cumulative from the floor date and offset 0 IS the floor
  // day, so day-60 contains day-30. The >= 0 bound excludes anything dated
  // before the first dial (a meeting logged two days before it, say).
  const within = (row, lastOffset) => {
    if (floorDay === null) return false;
    const offset = dayNumber(row.activityDate) - floorDay;
    return offset >= 0 && offset <= lastOffset;
  };
  const leadsBy = n => distinct(row => row.isCall && within(row, n - 1), row => row.leadKey);
  const qualifiedBy = n => distinct(row => row.isQualified && within(row, n - 1), row => row.eventId);
  const uniqueLeadsCalled = distinct(row => row.isCall, row => row.leadKey);

  return {
    userId: bdr.userId,
    name: bdr.name,
    floorHitDate: isoOfDay(floorDay),
    firstMeetingDate: isoOfDay(minDay(meetingDays)),
    firstQualifiedMeetingDate: isoOfDay(minDay(qualifiedDays)),
    weeksMeasured,
    accountsAssigned: distinct(row => row.recordType === 'Account', row => row.accountKey),
    uniqueLeadsCalled,
    meetingsGenerated: distinct(row => row.isMeeting, row => row.eventId),
    meetingsRated: distinct(row => row.isRated, row => row.eventId),
    qualifiedTotal: distinct(row => row.isQualified, row => row.eventId),
    // Division by null is null: a BDR who never dialled is "not measurable",
    // which is a different fact from "zero per week".
    avgLeadsPerWeek: weeksMeasured ? uniqueLeadsCalled / weeksMeasured : null,
    leadsByDay30: leadsBy(30), leadsByDay60: leadsBy(60), leadsByDay90: leadsBy(90),
    qualifiedByDay30: qualifiedBy(30), qualifiedByDay60: qualifiedBy(60), qualifiedByDay90: qualifiedBy(90),
    rowCount: rows.length,
  };
}

// Same rows, same as-of date, same answer: the board is read on every page
// load and the source is large, so the last result per row set is kept until
// the rows are replaced (every sync builds a new array).
const memo = new WeakMap();

// roster: { userIds: [...], names: [...] }. Ids are matched first; names are
// the fallback for the members whose ids are not yet in the config. An empty
// roster means "everyone", which is only useful while exploring a source.
export function buildBdrFunnelSnapshot(rows, { asOf, roster } = {}) {
  const asOfDate = parseAsOf(asOf);
  const rosterIds = new Set(roster?.userIds || []);
  const rosterNames = new Set(roster?.names || []);
  const rosterKey = `${[...rosterIds].join('|')}#${[...rosterNames].join('|')}`;
  const cacheKey = `${asOfDate}#${rosterKey}`;
  if (rows.length) {
    const hit = memo.get(rows)?.get(cacheKey);
    if (hit) return hit;
  }

  const asOfDay = dayNumber(asOfDate);
  const scoped = rosterIds.size > 0 || rosterNames.size > 0;
  const byBdr = new Map();
  const seenNames = new Set();
  for (const raw of rows) {
    const row = unifyBdrRow(raw);
    if (!row.userId) continue;
    const onRoster = rosterIds.has(row.userId) || (row.name !== null && rosterNames.has(row.name));
    if (scoped && !onRoster) continue;
    let bdr = byBdr.get(row.userId);
    if (!bdr) { bdr = { userId: row.userId, name: row.name, rows: [] }; byBdr.set(row.userId, bdr); }
    if (bdr.name === null && row.name !== null) bdr.name = row.name;
    if (row.name !== null) seenNames.add(row.name);
    bdr.rows.push(row);
  }

  const bdrs = [...byBdr.values()].map(bdr => summarizeBdr(bdr, asOfDay))
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'en') || String(a.userId).localeCompare(String(b.userId)));

  const snapshot = {
    asOf: asOfDate,
    rows: bdrs,
    summary: {
      rowsScanned: rows.length,
      bdrCount: bdrs.length,
      rosterSize: scoped ? Math.max(rosterIds.size, rosterNames.size) : null,
      // A rostered BDR with no task, meeting or account row cannot appear:
      // the dataset has nothing to produce them from. Named so the board can
      // say so instead of silently rendering one row fewer.
      unresolvedNames: [...rosterNames].filter(name => !seenNames.has(name)),
      totalUniqueLeadsCalled: bdrs.reduce((total, bdr) => total + bdr.uniqueLeadsCalled, 0),
    },
  };
  if (rows.length) {
    if (!memo.has(rows)) memo.set(rows, new Map());
    memo.get(rows).set(cacheKey, snapshot);
  }
  return snapshot;
}
