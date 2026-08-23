// server/datasources.js
// File upload (CSV/XLSX/JSON) + runtime Tableau connection.
// Supports published VIEWS (sheets in workbooks) and published DATA SOURCES (via VDS).
// Credentials live in memory only — never written to disk, never returned to the client.

import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import axios from 'axios';
import cron from 'node-cron';
import { createHash, randomUUID } from 'node:crypto';
import { encryptCredential, decryptCredential } from './services/credentialCipher.js';
import { quarterFromColumnName } from './services/aePerformanceMetrics.js';
import {
  saveTableauConnection, listTableauConnections, getRestorableTableauConnection,
  setTableauConnectionStatus,
} from './repositories/tableauConnections.js';
import {
  persistImportedSource, listUserSources, getRefreshableSource, listRefreshableSourceIds,
  startSyncRun, finishSyncRun, listSyncRuns, softDeleteSource,
  findWebhookSource, getSourceWebhookState, saveSourceWebhook, markWebhookEventReceived,
} from './repositories/dataSources.js';
import { query } from './db/pool.js';
import { logAudit, logSourceAccess } from './repositories/activityLogs.js';

// ============================================================
// STEP 1 — server/datasources.js
// Replace the entire existing OPP_SCHEMA block with everything
// down to and including UPSTREAM_FIELDS.
//
//   calculated: true  → derived in Tableau, arrives as a normal column
//   formula           → shown in the mapping page info panel
//   desc              → shown in the mapping page info panel
// ============================================================

export const OPP_SCHEMA = {
  // ---------- ESSENTIAL ----------
  name:             { type: 'string',  group: 'essential', label: 'Opportunity name', hint: 'Row labels in tables',
                      desc: 'The deal name shown in every table and the largest-opportunities list.',
                      aliases: ['name', 'opportunityname', 'dealname', 'opportunity', 'oppname'] },
  account:          { type: 'string',  group: 'essential', label: 'Account', hint: 'Account rollups, whitespace tab',
                      desc: 'Account name, resolved by joining the Account table on Account ID. Groups opportunities for the Accounts & Whitespace tab.',
                      aliases: ['account', 'accountname', 'company', 'domain', 'customer'] },
  accountId:        { type: 'string',  group: 'essential', label: 'Account ID', hint: 'Distinct account counts and account rollups',
                      desc: 'Stable unique account identifier. Account names are display labels only and are never used for distinct account counts.',
                      preferredHeaders: ['accountid'],
                      aliases: ['accountid', 'accountidentifier', 'acctid', 'salesforceaccountid'] },
  owner:            { type: 'string',  group: 'essential', label: 'Owner Name', hint: 'AE/AM rep performance tab, global filter',
                      desc: 'Owner NAME, not ID. Resolved by joining the User table on Owner = User ID and taking Full Name. Deals with no owner show as "⚠ Unassigned" and are flagged as a data-quality issue.',
                      formula: 'IFNULL([Owner Name], "⚠ Unassigned")',
                      preferredHeaders: ['ownername'],
                      aliases: ['owner', 'ownername', 'rep', 'salesrep', 'accountexecutive', 'opportunityowner'] },
  stage:            { type: 'string',  group: 'essential', label: 'Stage', hint: 'Funnel, and derives won/lost',
                      desc: 'Current pipeline stage. Also the fallback source for Is closed and Is won when those are left unmapped. Not a global filter — filtering to an open stage would remove every closed deal and make win rate undefined. Available as a local filter on the Pulse and Velocity tables instead.',
                      aliases: ['stage', 'stagename', 'salesstage', 'oppstage', 'opportunitystage', 'currentstage'] },
  amount:           { type: 'number',  group: 'essential', label: 'Amount', hint: 'Every value-based KPI',
                      desc: 'Deal value. Currency symbols and thousands separators are stripped on import; values in parentheses read as negative.',
                      aliases: ['amount', 'value', 'dealsize', 'dealvalue', 'totalamount', 'oppamount'] },
  closeDate:        { type: 'date',    group: 'essential', label: 'Close date', hint: 'Quarterly trends, date filter',
                      desc: 'Actual or expected close date. Normalised to YYYY-MM-DD.',
                      aliases: ['closedate', 'closedat', 'expectedclosedate', 'dateclosed', 'actualclosedate'] },
  createdDate:      { type: 'date',    group: 'essential', label: 'Created date', hint: 'Pipeline created chart, date filter',
                      desc: 'When the opportunity was created. Powers the pipeline-created-versus-closed chart and the created-date filter.',
                      preferredHeaders: ['opportunitycreateddate'],
                      aliases: ['createddate', 'created', 'createdat', 'datecreated'] },
  isClosed:         { type: 'boolean', group: 'essential', label: 'Is closed', hint: 'Open vs closed split', derivable: 'stage',
                      formula: 'stage contains "Closed" → true',
                      desc: 'Whether the deal is finished. Map a column directly, or leave unmapped and it is derived from Stage.',
                      aliases: ['isclosed', 'closed'] },
  isWon:            { type: 'boolean', group: 'essential', label: 'Is won', hint: 'Win rate', derivable: 'stage',
                      formula: 'stage contains "Closed Won" → true; "Closed Lost" → false',
                      desc: 'Whether the deal was won. Map a column directly, or leave unmapped and it is derived from Stage.',
                      aliases: ['iswon', 'won'] },

  // ---------- SEGMENTATION ----------
  orgType:          { type: 'string',  group: 'segmentation', label: 'Org type', hint: 'Global filter, heatmap, stale thresholds',
                      calculated: true,
                      formula: 'IF [Free Domain] THEN "SMB"\nELSEIF [Employees] >= 2000 THEN "Enterprise"\nELSEIF [Employees] >= 100 THEN "Mid-Market"\nELSE "SMB"\nEND',
                      desc: 'Company size band, calculated in Tableau from headcount — with one override: a free email domain forces SMB regardless of employee count, since that signals a self-serve evaluator rather than a corporate buyer. Values are Enterprise, Mid-Market, SMB (note the hyphen). Also sets the stale threshold and splits the sales-cycle analysis.',
                      aliases: ['orgtype', 'organisationtype', 'organizationtype', 'segment', 'customersegment', 'tier', 'accountsegment'] },
  region:           { type: 'string',  group: 'segmentation', label: 'Region', hint: 'Global filter, region table, heatmap',
                      calculated: true,
                      formula: 'IF STARTSWITH([Region Detail], "AMER") THEN "AMER"\nELSE [Region Detail]\nEND',
                      desc: 'Rolled-up sales region: AMER, EMEA, APAC. Derived from the owning rep\'s role, so this reflects which team owns the deal rather than where the customer sits — usually the same, but an EMEA rep closing a US account will show as EMEA. This replaces the previous Closure Region mapping, so region figures will shift on re-import and will not reconcile against historic numbers.',
                      aliases: ['region', 'geo', 'territory', 'salesregion'] },
  regionDetail:     { type: 'string',  group: 'segmentation', label: 'Region (detail)', hint: 'Heatmap drill-down only',
                      calculated: true,
                      formula: 'IF CONTAINS([Role Name], "AMER III") THEN "AMER III"\nELSEIF CONTAINS([Role Name], "AMER II") THEN "AMER II"\nELSEIF CONTAINS([Role Name], "AMER") THEN "AMER I"\nELSEIF CONTAINS([Role Name], "EMEA") THEN "EMEA"\nELSEIF CONTAINS([Role Name], "APAC") THEN "APAC"\nEND',
                      desc: 'Sub-region derived from the raw Role Name: AMER I, AMER II, AMER III, EMEA, APAC. Roles carrying a bare AMER with no numeral group into AMER I. Rolls up into Region. Used only to expand AMER in the win-rate heatmap — it is deliberately NOT a global filter, since one region filter is enough. Test order is load-bearing: "AMER III" contains "AMER II" as a substring and both contain "AMER", so testing AMER first would collapse everything into AMER I.',
                      aliases: ['regiondetail', 'subregion', 'regionsub', 'territorydetail'] },
  pod:              { type: 'string',  group: 'segmentation', label: 'POD', hint: 'Global filter, team performance',
                      calculated: true,
                      formula: 'IF STARTSWITH([Role Name], "AM ") OR [Role Name] = "Account Manager" THEN "AM"\nELSEIF [Role Name] = "Corp Account Executive"\n     OR (STARTSWITH([Role Name], "AE") AND CONTAINS(UPPER([Role Name]), "CORP")) THEN "AE Corp"\nELSEIF STARTSWITH([Role Name], "AE") OR [Role Name] = "Enterprise Account Executive" THEN "AE Enterprise"\nELSE "Others"\nEND',
                      desc: 'Sales team grouping derived from the raw Role Name — AE Corp, AE Enterprise, AM, or Others. Non-AE/AM roles (SDR and BDR variants, Renewal Specialists, Admin, VPs and similar) collect in Others rather than returning null, so POD totals tie to dashboard totals. Built by pattern matching rather than a Tableau group, since worksheet groups do not travel through the published data source. Branch order matters: AM is tested first so "AM AMER Corp" is not misread as AE Corp; UPPER() handles inconsistent casing between "AE AMER CORP" and "AM AMER Corp"; and the STARTSWITH("AE") guard on the Corp branch keeps "BDR US CORP-Manager" out. Three roles are named explicitly because they carry no AE/AM prefix: Account Manager, Corp Account Executive, Enterprise Account Executive.',
                      aliases: ['pod', 'team', 'salespod', 'podname'] },
  team:             { type: 'string', group: 'segmentation', label: 'Team Name', hint: 'Win Board contribution and AE/AM splits',
                      desc: 'The source Team Name field. Kept separate from derived POD and used to split team, AE, and AM Won ARR contribution.',
                      preferredHeaders: ['teamname'], aliases: ['teamname','salesteam','ownerteam'] },
  industry:         { type: 'string',  group: 'segmentation', label: 'Industry', hint: 'Global filter, industry scorecard',
                      desc: 'Account vertical. The scorecard only ranks industries with three or more closed deals.',
                      aliases: ['industry', 'vertical', 'sector'] },
  product:          { type: 'string',  group: 'segmentation', label: 'Product', hint: 'Global filter, product portfolio bubble',
                      desc: 'Product or SKU. Drives the portfolio bubble chart plotting closed value against win rate.',
                      aliases: ['product', 'productname', 'productline', 'sku', 'productfamily'] },
  source:           { type: 'string',  group: 'segmentation', label: 'Deal source', hint: 'Global filter, source effectiveness',
                      desc: 'Picklist of how the deal originated — Inbound, Outbound, Partner, Referral and similar. Also an input to the Sourced by attribution.',
                      aliases: ['source', 'leadsource', 'channel', 'opportunitysource', 'dealsource'] },
  type:             { type: 'string',  group: 'segmentation', label: 'Opportunity type', hint: 'Global filter, new vs renewal splits',
                      desc: 'New business, existing business, or renewal.',
                      aliases: ['type', 'opportunitytype', 'dealtype', 'opptype', 'businesstype'] },
  ownerRole:        { type: 'string',  group: 'segmentation', label: 'Owner role', hint: 'Win rate by role',
                      desc: 'Role NAME, resolved by joining User to Roles on Role ID. Must be a readable name — this becomes a chart axis label, so an ID here produces unreadable charts. Excluded from the global filter shelf by decision; POD covers the same ground more usefully.',
                      aliases: ['ownerrole', 'role', 'userrole', 'title', 'rolename'] },
  bdrName:          { type: 'string',  group: 'segmentation', label: 'BDR Owner Name', hint: 'BDR rep performance',
                      calculated: true,
                      formula: 'IF NOT ISNULL([BDR Owner]) THEN [Full Name] END',
                      desc: 'The BDR who sourced the opportunity, resolved from BDR Owner ID via the User join. Null where no BDR was involved — deliberately not a placeholder string, since BDR rep performance groups by this field and a label would appear as a rep with a large book of business. An opportunity with both an Owner and a BDR is credited in both rep-performance views: the BDR for sourcing a qualified lead, the AE for working it. The two views therefore do not sum to total pipeline.',
                      preferredHeaders: ['bdrownername'],
                      aliases: ['bdrname', 'bdr', 'bdrfullname', 'bdrowner', 'sourcedby', 'sourcedbyname'] },

  // ---------- METRICS ----------
  arr:              { type: 'number',  group: 'metrics', label: 'ARR', hint: 'ARR KPIs',
                      calculated: true,
                      formula: '([Amount] / [Subscription Duration]) * 12',
                      desc: 'Annual recurring revenue, normalised from the deal value and contract term. Subscription Duration is in months. Must be a row-level calculation in Tableau — aggregate functions will not import correctly through VizQL Data Service.',
                      aliases: ['arr', 'annualrecurringrevenue', 'annualvalue', 'opparr'] },
  ownerActive:      { type: 'boolean', group: 'segmentation', label: 'Rep is active', hint: 'Rep status filter on every board',
                      desc: 'Whether the opportunity owner still works here. Filters departed reps out of INDIVIDUAL rep rankings while their closed ARR still counts towards POD rankings and team totals, so a resignation never rewrites a past quarter. A blank value is treated as inactive, which is the strict reading: it means an explicitly unmatched rep is hidden rather than assumed present. Note the BDR variant of this flag exists on the opportunity source and is deliberately not mapped here, so the filter means one thing on every board: is the deal OWNER still here.',
                      aliases: ['active', 'isactive', 'useractive', 'repactive', 'owneractive', 'activeuser'] },
  quotaCurrent:     { type: 'number',  group: 'metrics', label: 'Current quarter quota', hint: 'AE Performance - % of quota achieved',
                      desc: 'The rep quota for the quarter the board is reporting on. Deliberately named by POSITION (current) rather than by quarter, so moving to a new quarter is a mapping change on this one field and nothing in the code moves. Arrives per opportunity row and is read with MIN() per rep, matching {FIXED [Full Name]: MIN([Quota])} - a quota is one number per rep, not something to sum across their deals. Source naming is inconsistent across quarters - some use a hyphen and a four-digit year, others an apostrophe and two digits - which is exactly why this is mapped by hand rather than auto-matched.',
                      // Deliberately no aliases: this field is manual-only.
                      // Auto-matching used to bind it to whichever quota column
                      // scored first, which silently produced a full board
                      // measured against the wrong quarter.
                      aliases: [] },
  quotaPrior:       { type: 'number',  group: 'metrics', label: 'Prior quarter quota', hint: 'AE Performance - quota comparison tile',
                      desc: 'The rep quota for the quarter immediately before the current one. Powers the comparison tile only. Same MIN()-per-rep semantics as the current quota. Leave unmapped and the comparison tile hides rather than showing a false movement.',
                      // Manual-only for the same reason as quotaCurrent.
                      aliases: [] },
  trialArr:         { type: 'number',  group: 'metrics', label: 'Trial ARR', hint: 'ARR at trial entry',
                      desc: 'ARR captured at the moment the deal moved into Trial stage, and retained thereafter — a historical snapshot rather than a filter on current stage. A Closed Won deal still carries the ARR it had at trial, which makes trial-to-close movement analysable. Comes from source; no calculation needed. Note this is trial, not trailing — the earlier field name trailArr was misleading and has been retired.',
                      aliases: ['trialarr', 'trailarr', 'trialannualrecurringrevenue'] },
  trialStageAt:     { type: 'date',    group: 'metrics', label: 'Trial stage at', hint: 'Loss Board — lost-after-trial rate',
                      desc: 'The date the opportunity entered Trial stage. Null for opportunities that never reached a trial. Powers the Loss Board\'s lost-after-trial rate: of the closed deals that reached a trial, what share were lost.',
                      aliases: ['trialstageat', 'trialstagedate', 'trialentrydate', 'trialstartdate', 'dateenteredtrial'] },
  subscriptionDuration: { type: 'number', group: 'metrics', label: 'Subscription duration', hint: 'ARR input, product term analysis',
                      desc: 'Contract term in months. Input to the ARR calculation, and analysable in its own right — which products carry the longest terms, and whether term length correlates with win rate.',
                      aliases: ['subscriptionduration', 'subscriptionmonths', 'contractterm', 'term', 'durationmonths'] },
  employees:        { type: 'number',  group: 'metrics', label: 'Employee count', hint: 'Org type input',
                      desc: 'Headcount at the account. Primary input to the Org type calculation: 2000+ is Enterprise, 100+ is Mid-Market, below that is SMB.',
                      aliases: ['employees', 'employeecount', 'headcount', 'numberofemployees', 'companysize'] },
  daysStuck:        { type: 'number',  group: 'metrics', label: 'Days in stage', hint: 'Aging, stale detection',
                      desc: 'Days since the last stage change, resetting to zero on each change. In Tableau this field is named "Days in Stage". Input to the Is stalled calculation. The former stageDuration field was confirmed identical to this and has been removed.',
                      aliases: ['daysstuck', 'daysinstage', 'stageduration', 'stuckdays', 'ageindays'] },
  cycleDays:        { type: 'number',  group: 'metrics', label: 'Cycle days', hint: 'Sales cycle charts',
                      calculated: true,
                      formula: 'IF [Closed] AND DATEDIFF(\'day\',[Created Date],[Close Date]) >= 0\nTHEN DATEDIFF(\'day\',[Created Date],[Close Date])\nEND',
                      desc: 'Days from creation to close. Null for open deals by design — an open deal has an age, not a cycle, and including them drags averages down as new pipeline is created. The >= 0 guard drops records where close date precedes creation, which happens in CRM exports and would otherwise produce negative cycles. Cycle length varies structurally by org type, so it is reported split by Org type using medians rather than means.',
                      aliases: ['cycledays', 'salescycle', 'cyclelength', 'daystoclose'] },
  staleThreshold:   { type: 'number',  group: 'metrics', label: 'Stale threshold', hint: 'Days before a deal counts as stale',
                      calculated: true,
                      formula: 'CASE [Org Type]\n  WHEN \'Enterprise\' THEN 90\n  WHEN \'Mid-Market\' THEN 30\n  WHEN \'SMB\' THEN 15\n  ELSE 30\nEND',
                      desc: 'Days-in-stage above which a deal is considered stale, varying by org type because deal rhythms differ — an SMB deal untouched for 20 days is a problem, an Enterprise deal at the same age is normal.',
                      aliases: ['stalethreshold', 'stalledthreshold', 'staledays'] },
  isStalled:        { type: 'boolean', group: 'metrics', label: 'Is stalled', hint: 'Stalled KPIs and tables',
                      calculated: true,
                      formula: 'NOT [Closed] AND [Days in Stage] >= [Stale Threshold]',
                      desc: 'Whether an open deal has exceeded its org-type stale threshold. The dashboard reads this flag rather than computing its own rule, so the definition stays in one place. This replaces the old flat 90-day test, which treated an SMB deal idle 20 days as healthy.',
                      aliases: ['isstalled', 'stalled', 'stalledflag'] },
  dealHealth:       { type: 'string',  group: 'metrics', label: 'Deal health', hint: 'At-risk and declining pipeline',
                      desc: 'Picklist with three states: Green is healthy, Amber signals declining health, Red is at risk. Red drives the intervention list; Amber is a watch list. These are distinct signals and are reported separately. Not a global filter — it only applies to open deals, so filtering globally would wipe out all won/lost analysis.',
                      aliases: ['dealhealth', 'health', 'healthstatus', 'riskstatus', 'healthcolour', 'healthcolor'] },

  // ---------- OTHER ----------
  id:               { type: 'string',  group: 'essential', label: 'Opportunity ID', hint: 'Distinct opportunity counts',
                      desc: 'Stable unique opportunity identifier. Opportunity names are display labels only and are never used for distinct counts.',
                      preferredHeaders: ['opportunityid'],
                      aliases: ['id', 'opportunityid', 'oppid', 'recordid', 'sfid'] },
  forecastCategory: { type: 'string',  group: 'other', label: 'Forecast category', hint: 'Weighted forecast buckets',
                      formula: 'Pipeline 25% · Best Case 50% · Commit 75% · Closed 100%  [weights under review]',
                      desc: 'Forecast bucket. The Pulse tab multiplies Amount by these weights to produce the weighted forecast. The percentages are currently hardcoded in the application and pending confirmation — once settled they should move into Tableau. Not a global filter, since filtering to Pipeline would zero every closed metric.',
                      aliases: ['forecastcategory', 'forecast', 'forecastcategoryname'] },
  expectedRevenue:  { type: 'number',  group: 'other', label: 'Expected revenue', hint: 'Not currently used',
                      desc: 'Under review. Mapped but read by no chart today — the Pulse tab computes its own weighted forecast from Amount and Forecast category instead. Pending a decision on whether to carry it as a per-row field (moving win probability into Tableau) and whether to build a forward-looking forecast view.',
                      aliases: ['expectedrevenue', 'expected', 'weightedamount', 'weighted', 'forecastamount'] },
  lossReason:       { type: 'string',  group: 'other', label: 'Loss reason', hint: 'Pareto on Diagnostics tab',
                      desc: 'Why a deal was lost. Drives the Pareto chart and the disengagement-losses KPI. Not a global filter — it is only populated on lost deals, so filtering globally would remove every won and open deal and silently zero the win rate, pipeline and funnel.',
                      aliases: ['lossreason', 'closedlostreason', 'reasonlost', 'lostreason'] },
};

export const OPP_COLUMNS = Object.keys(OPP_SCHEMA);

// Fields used inside Tableau calculations that never appear as mapped columns.
// Documented so the derivation chain is readable without opening the workbook.
export const UPSTREAM_FIELDS = [
  { name: 'Free Domain',  usedBy: ['orgType'],
    desc: 'Boolean. True forces SMB regardless of headcount — a free email domain signals a self-serve evaluator rather than a corporate buyer.' },
  { name: 'Role Name (raw)', usedBy: ['pod', 'regionDetail', 'region'],
    desc: 'The unmodified role string from the Roles table, e.g. "AE AMER II/Corp-Manager". POD and region are pattern-matched from it directly rather than from a Tableau group, since worksheet groups are not available to the data source API.' },
  { name: 'Owner ID',     usedBy: ['owner', 'ownerRole'],
    desc: 'Join key into the User table. Holds an ID, not a name.' },
  { name: 'BDR Owner',    usedBy: ['bdrName'],
    desc: 'Join key into the User table. Its presence is what puts an opportunity into BDR rep performance; its absence keeps the deal in the AE/AM view only.' },
  { name: 'User ID / Full Name / Role ID', usedBy: ['owner', 'ownerRole', 'bdrName'],
    desc: 'User table columns. Full Name supplies owner and sourcer names; Role ID joins on to the Roles table.' },
  { name: 'Role Name',    usedBy: ['ownerRole', 'pod', 'regionDetail', 'region'],
    desc: 'Roles table column, joined via Role ID.' },
];

// Global filter shelf — the confirmed set. Used by the generic server-side
// filter in step 9; listed here so schema and filtering stay in one place.
export const GLOBAL_FILTERS = [
  'region', 'orgType', 'pod', 'team', 'owner', 'product', 'industry', 'source', 'type',
];

// Rep status is deliberately NOT in GLOBAL_FILTERS. Those are generic row
// filters, and this one is not: it hides a rep from individual rankings while
// their ARR keeps counting towards POD rankings and team totals. Wiring it in
// as a row filter would delete that revenue from history.
export const REP_STATUS_FILTER = { key: 'repStatus', field: 'ownerActive', default: 'active' };

// Which schema fields each dashboard needs. Colocated with the schema they
// reference, and served to the client through /api/templates, so registering a
// dashboard is ONE edit here instead of four hand-kept lists that nothing
// checks against each other. Three separate bugs in this app traced back to a
// dashboard being present in some of those lists and absent from others.
export const DASHBOARD_FIELD_SETS = {
  opportunity: ['id','name','account','accountId','owner','stage','amount','arr','closeDate','createdDate','isClosed','isWon','orgType','region','pod','industry','product','source','type','daysStuck','cycleDays','staleThreshold','isStalled','dealHealth','forecastCategory','lossReason','trialStageAt','ownerActive'],
  winBoard:    ['id','stage','arr','createdDate','isClosed','isWon','region','orgType','industry','pod','team','type','ownerActive'],
  lossBoard:   ['id','stage','arr','createdDate','isClosed','isWon','region','orgType','pod','team','type','lossReason','trialStageAt','ownerActive'],
  // AE and AM map the identical set: same formulas, only the row scope differs.
  repQuota:    ['id','stage','owner','ownerRole','pod','arr','closeDate','createdDate','isClosed','isWon','region','orgType','type','ownerActive','quotaCurrent'],
};

export const FIELD_GROUPS = [
  { key: 'essential',    label: 'Essential',    note: 'The dashboard is mostly empty without these.' },
  { key: 'segmentation', label: 'Segmentation', note: 'Drives the breakdown tabs and filters.' },
  { key: 'metrics',      label: 'Metrics',      note: 'Velocity and value charts.' },
  { key: 'other',        label: 'Other',        note: 'Nice to have.' },
];

const normalize = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ===== TYPE COERCION =====
const TRUE_SET  = new Set(['true', 'yes', 'y', '1', 't', 'won', 'closed']);
const FALSE_SET = new Set(['false', 'no', 'n', '0', 'f', 'open', '']);

function toBoolean(v) {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (TRUE_SET.has(s)) return true;
  if (FALSE_SET.has(s)) return false;
  return false;
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, '').replace(/[^0-9.\-]/g, '');
  if (s === '' || s === '-') return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

function toDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, a, b, y] = m;
    const first = parseInt(a, 10), second = parseInt(b, 10);
    const [month, day] = first > 12 ? [second, first] : [first, second];
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function coerce(value, type) {
  switch (type) {
    case 'boolean': return toBoolean(value);
    case 'number':  return toNumber(value);
    case 'date':    return toDate(value);
    default:        return value === null || value === undefined ? '' : String(value).trim();
  }
}

// ===== MATCHING =====
function scoreHeader(header, def, field) {
  const n = normalize(header);
  if (!n) return 0;
  // BDR Owner belongs exclusively to bdrName. Never let the generic "owner"
  // alias pull it into the AE/AM scorecard's Owner Name field.
  if (field === 'owner' && (n.startsWith('bdr') || n.includes('bdrowner'))) return 0;
  if (field === 'ownerRole' && (n === 'owner' || n === 'ownername' || n.startsWith('bdrowner'))) return 0;
  if (def.preferredHeaders?.includes(n)) return 120;
  let best = 0;
  for (const alias of def.aliases) {
    if (n === alias) return 100;
    if (n.startsWith(alias) && n.length - alias.length <= 4) best = Math.max(best, 85);
    if (n.endsWith(alias) && n.length - alias.length <= 4) best = Math.max(best, 82);
    if (n.includes(alias) && alias.length >= 4) best = Math.max(best, 70);
    if (alias.includes(n) && n.length >= 4) best = Math.max(best, 60);
  }
  return best;
}

// Where Tableau will POST webhook events, derived from APP_BASE_URL.
//
// Validated rather than trusted, because every way this can be wrong fails
// SILENTLY: Tableau accepts the registration, the webhook sits there looking
// enabled in the UI, and no event ever arrives. The dashboard just quietly
// goes stale, and the only symptom is data that is up to 12 hours old — which
// reads as "the sync is slow", not "the callback address is unreachable".
//
// Rejected up front instead:
//   - a bare host or path ("testmu-bi-api.onrender.com") — not a URL Tableau
//     can post to, and the string concatenation would produce nonsense
//   - http:// — Tableau Cloud requires HTTPS for webhook destinations
//   - localhost and RFC1918 addresses — reachable from a dev machine, and from
//     nowhere on the internet. This is the one people actually hit, by copying
//     a working local .env into the hosting environment.
export function resolveWebhookBaseUrl(env = process.env) {
  const raw = String(env.APP_BASE_URL || '').trim();
  if (!raw) {
    return { error: 'APP_BASE_URL is not configured on the server — Tableau needs a publicly reachable URL to deliver webhook events to. Set it in the server environment and restart.' };
  }
  let url;
  try { url = new URL(raw); }
  catch {
    return { error: `APP_BASE_URL ("${raw}") is not an absolute URL. Use the full public address of this API, including the scheme — for example https://your-api.onrender.com` };
  }
  if (url.protocol !== 'https:') {
    return { error: `APP_BASE_URL uses ${url.protocol}// — Tableau Cloud only delivers webhooks over HTTPS. Use an https:// address.` };
  }
  const host = url.hostname.toLowerCase();
  const unroutable = host === 'localhost' || host === '::1' || host.endsWith('.local')
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (unroutable) {
    return { error: `APP_BASE_URL points at ${url.hostname}, which Tableau cannot reach from the internet. Set it to this API's public address, not a local one.` };
  }
  return { base: url.origin };
}

export function autoMap(headers) {
  const candidates = [];
  for (const field of OPP_COLUMNS) {
    for (const header of headers) {
      const score = scoreHeader(header, OPP_SCHEMA[field], field);
      if (score >= 60) candidates.push({ field, header, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const fieldMapping = {};
  const confidence = {};
  const takenFields = new Set();
  const takenHeaders = new Set();

  for (const c of candidates) {
    if (takenFields.has(c.field) || takenHeaders.has(c.header)) continue;
    fieldMapping[c.field] = c.header;
    confidence[c.field] = c.score >= 100 ? 'exact' : 'fuzzy';
    takenFields.add(c.field);
    takenHeaders.add(c.header);
  }
  for (const field of OPP_COLUMNS) {
    if (!(field in fieldMapping)) fieldMapping[field] = null;
  }
  return { fieldMapping, confidence };
}

// CASE [Org Type] WHEN 'Enterprise' THEN 90 WHEN 'Mid-Market' THEN 30
// WHEN 'SMB' THEN 15 ELSE 30 END — kept beside applyMapping so the fallback
// and the OPP_SCHEMA formula that documents it stay in one file.
const STALE_THRESHOLD_BY_ORG_TYPE = { Enterprise: 90, 'Mid-Market': 30, SMB: 15 };
const STALE_THRESHOLD_DEFAULT = 30;

// Prior-quarter quota is DERIVED, never mapped by hand.
//
// The comparison tile needs {FIXED [Full Name]: MIN([<prior quarter> Quota])},
// but a second mapped field is a second thing that can drift out of step, and
// a wrong pairing produces a plausible board rather than an obvious error.
// Instead the prior column is resolved from the current one: read the quarter
// the mapped current column names, step back one quarter, find the source
// column naming THAT quarter.
//
// Matching is on the parsed quarter rather than the string, because the source
// names quarters two ways ("Q3-2026 Quota" and "Q2'26 Quota"). If nothing
// matches, or several do, nothing is mapped and the comparison tile hides -
// no figure is better than a figure built on a guess.
export function deriveQuotaPriorMapping(fieldMapping, headers) {
  const current = fieldMapping?.quotaCurrent;
  if (!current) return { column: null, reason: 'current quarter quota is not mapped' };
  const claimed = quarterFromColumnName(current);
  if (!claimed) return { column: null, reason: 'cannot read a quarter from the mapped column name' };

  const targetQuarter = claimed.quarter === 1 ? 4 : claimed.quarter - 1;
  const targetYear = claimed.quarter === 1 ? claimed.year - 1 : claimed.year;
  const wanted = 'Q' + targetQuarter + '-' + targetYear;

  const matches = (headers || []).filter(header => {
    if (header === current) return false;
    if (!/quota/i.test(header)) return false;
    const parsed = quarterFromColumnName(header);
    return parsed && parsed.label === wanted;
  });
  if (!matches.length) return { column: null, reason: 'no source column names ' + wanted, wanted };
  if (matches.length > 1) return { column: null, reason: matches.length + ' columns name ' + wanted, wanted, ambiguous: matches };
  return { column: matches[0], wanted };
}

export function applyMapping(rawRows, fieldMapping) {
  // Resolved here rather than at each call site so every path that builds rows
  // - upload, Tableau refresh, preview - gets the same derived prior quarter.
  // An explicit mapping, if one ever exists, always wins over the derivation.
  if (fieldMapping && fieldMapping.quotaCurrent && !fieldMapping.quotaPrior && rawRows.length) {
    const derived = deriveQuotaPriorMapping(fieldMapping, Object.keys(rawRows[0]));
    if (derived.column) fieldMapping = { ...fieldMapping, quotaPrior: derived.column };
  }
  return rawRows.map((raw, i) => {
    const row = {};
    for (const field of OPP_COLUMNS) {
      const header = fieldMapping[field];
      row[field] = header
        ? coerce(raw[header], OPP_SCHEMA[field].type)
        : coerce(undefined, OPP_SCHEMA[field].type);
    }
    if (!fieldMapping.isClosed || !fieldMapping.isWon) {
      const stage = String(row.stage || '').toLowerCase();
      const won = stage.includes('closed') && stage.includes('won');
      const lost = stage.includes('closed') && stage.includes('lost');
      if (won) {
        if (!fieldMapping.isClosed) row.isClosed = true;
        if (!fieldMapping.isWon) row.isWon = true;
      } else if (lost) {
        if (!fieldMapping.isClosed) row.isClosed = true;
        if (!fieldMapping.isWon) row.isWon = false;
      }
    }
    // A blank Industry is invisible to a multi-select filter's "select all"
    // (it can only capture the named options it saw at the time), so those
    // rows silently drop out of every KPI once a filter is fully selected.
    // Giving blanks an explicit category fixes that at the source: it
    // becomes a real, selectable option everywhere industry is used.
    if (!row.industry) row.industry = 'No Industry';

    // Cycle days / Stale threshold / Is stalled are calculated in Tableau at
    // WORKSHEET level, and worksheet calcs are not exposed to the data source
    // API — the same limitation already documented for groups in
    // UPSTREAM_FIELDS. A published data source therefore arrives with no such
    // columns and these three stayed permanently null, silently emptying the
    // aging, stale and sales-cycle charts. Each is recomputed here from
    // columns that DO arrive, using the exact formulas recorded in
    // OPP_SCHEMA. A real mapped column always wins; this only fills the gap.
    if (!fieldMapping.cycleDays && row.isClosed && row.createdDate && row.closeDate) {
      const days = Math.round(
        (Date.parse(`${row.closeDate}T00:00:00Z`) - Date.parse(`${row.createdDate}T00:00:00Z`)) / 86_400_000
      );
      // The >= 0 guard drops CRM exports where close precedes creation, which
      // would otherwise produce negative cycles.
      if (Number.isFinite(days) && days >= 0) row.cycleDays = days;
    }
    if (!fieldMapping.staleThreshold) {
      row.staleThreshold = STALE_THRESHOLD_BY_ORG_TYPE[row.orgType] ?? STALE_THRESHOLD_DEFAULT;
    }
    if (!fieldMapping.isStalled) {
      row.isStalled = !row.isClosed
        && Number.isFinite(row.daysStuck)
        && Number.isFinite(row.staleThreshold)
        && row.daysStuck >= row.staleThreshold;
    }
    return row;
  });
}

function collectSamples(rows, headers, limit = 3) {
  const samples = {};
  for (const h of headers) {
    const seen = [];
    for (const r of rows) {
      const v = r[h];
      if (v === null || v === undefined || v === '') continue;
      const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
      if (!seen.includes(s)) seen.push(s);
      if (seen.length >= limit) break;
    }
    samples[h] = seen;
  }
  return samples;
}

// How much of each mapped field is actually populated — catches a wrong
// mapping that happens to parse (e.g. a text column mapped to a number field).
function fillRates(rows, fieldMapping) {
  const out = {};
  const n = rows.length || 1;
  const coerced = applyMapping(rows, fieldMapping);
  for (const field of OPP_COLUMNS) {
    if (!fieldMapping[field]) continue;
    const type = OPP_SCHEMA[field].type;
    let filled = 0;
    for (const r of coerced) {
      const v = r[field];
      if (type === 'boolean') { filled++; continue; }
      if (v !== null && v !== undefined && v !== '') filled++;
    }
    out[field] = Math.round((filled / n) * 100);
  }
  return out;
}

// ===== FILE PARSING =====
function parseBuffer(buffer, filename) {
  const ext = filename.split('.').pop().toLowerCase();

  if (ext === 'json') {
    const parsed = JSON.parse(buffer.toString('utf8'));
    const rows = Array.isArray(parsed) ? parsed : (parsed.data ?? parsed.rows ?? parsed.records);
    if (!Array.isArray(rows)) {
      throw new Error('JSON must be an array of objects, or an object with a data/rows/records array');
    }
    const headers = [...new Set(rows.flatMap(r => Object.keys(r ?? {})))];
    return { headers, rows };
  }

  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Workbook contains no sheets');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
  if (!rows.length) throw new Error(`Sheet "${sheetName}" is empty`);
  const headers = [...new Set(rows.flatMap(r => Object.keys(r)))];
  return { headers, rows, sheetNames: wb.SheetNames, activeSheet: sheetName };
}

function buildPreview({ headers, rows }) {
  const { fieldMapping, confidence } = autoMap(headers);
  return {
    rowCount: rows.length,
    headers,
    previewRows: rows.slice(0, 20),
    fieldMapping,
    confidence,
    samples: collectSamples(rows, headers),
    fields: OPP_COLUMNS.map(f => ({
      key: f,
      label: OPP_SCHEMA[f].label,
      hint: OPP_SCHEMA[f].hint,
      desc: OPP_SCHEMA[f].desc ?? null,                
      formula: OPP_SCHEMA[f].formula ?? null,          
      calculated: OPP_SCHEMA[f].calculated ?? false,
      type: OPP_SCHEMA[f].type,
      group: OPP_SCHEMA[f].group,
      derivable: OPP_SCHEMA[f].derivable ?? null,
    })),
    groups: FIELD_GROUPS,
    upstream: UPSTREAM_FIELDS,
  };
}

// ===== TABLEAU =====
// Exported so verification scripts can read the same rows the server reads,
// through the same code path, rather than reimplementing the query.
export class TableauSession {
  constructor({ server, siteId, patName, patSecret }) {
    this.server = server.replace(/\/+$/, '').replace(/\/#.*$/, '');
    this.siteId = siteId;
    this.patName = patName;
    this.patSecret = patSecret;
    this.token = null;
    this.apiSiteId = null;
    this.expiresAt = 0;
    this.http = axios.create({ baseURL: `${this.server}/api/3.19`, timeout: 60000 });
    this.vds = axios.create({ baseURL: `${this.server}/api/v1/vizql-data-service`, timeout: 120000 });
  }

  async signin() {
    const { data } = await this.http.post('/auth/signin', {
      credentials: {
        personalAccessTokenName: this.patName,
        personalAccessTokenSecret: this.patSecret,
        site: { contentUrl: this.siteId },
      },
    }, { headers: { Accept: 'application/json' } });

    this.token = data.credentials.token;
    this.apiSiteId = data.credentials.site?.id;
    this.expiresAt = Date.now() + 100 * 60 * 1000;
    if (!this.apiSiteId) {
      // Without a real site id, later REST calls build a URL like
      // /sites/null/views — Tableau's own 404 for that literally reads
      // "Site 'null' could not be found", which is confusing to debug.
      // Fail clearly here instead, at the point the real problem occurred.
      throw new Error('Tableau sign-in succeeded but returned no site id. Check that the Site ID field matches your Tableau Cloud site exactly.');
    }

    for (const client of [this.http, this.vds]) {
      client.defaults.headers.common['X-Tableau-Auth'] = this.token;
      client.defaults.headers.common['Accept'] = 'application/json';
      client.defaults.headers.common['Content-Type'] = 'application/json';
    }
    return { siteName: data.credentials.site.contentUrl };
  }

  async ensure() {
    if (!this.token || Date.now() > this.expiresAt) await this.signin();
  }

  async fetchAllPages(path, extract) {
    await this.ensure();
    const pageSize = 1000;
    let pageNumber = 1;
    let total = Infinity;
    const out = [];

    while (out.length < total && pageNumber <= 50) {
      const sep = path.includes('?') ? '&' : '?';
      const { data } = await this.http.get(`${path}${sep}pageSize=${pageSize}&pageNumber=${pageNumber}`);
      const batch = extract(data);
      out.push(...batch);
      total = parseInt(data.pagination?.totalAvailable ?? out.length, 10);
      if (!batch.length) break;
      pageNumber++;
    }
    return out;
  }

  // ensure() before the path is built, not just before the request. The
  // template literal below is evaluated when fetchAllPages is CALLED, so on a
  // session that has not signed in yet apiSiteId is still null and the URL is
  // baked as /sites/null/views — fetchAllPages' own ensure() then signs in too
  // late to matter. Tableau answers "Site 'null' could not be found", which
  // sends you looking for a bad Site ID that is in fact correct.
  //
  // restoreSession builds exactly such a session: it caches the credentials
  // without signing in, so the first browse after any server restart hit this.
  async listViews() {
    await this.ensure();
    const views = await this.fetchAllPages(
      `/sites/${this.apiSiteId}/views`,
      d => d.views?.view ?? d.view ?? []
    );
    return views.map(v => ({ id: v.id, name: v.name, workbook: v.workbook?.name ?? '', updatedAt: v.updatedAt }));
  }

  async listDatasources() {
    await this.ensure();
    const sources = await this.fetchAllPages(
      `/sites/${this.apiSiteId}/datasources`,
      d => d.datasources?.datasource ?? d.datasource ?? []
    );
    return sources.map(d => ({ id: d.id, name: d.name, project: d.project?.name ?? '', updatedAt: d.updatedAt }));
  }

  async getViewCsv(viewId) {
    await this.ensure();
    const { data } = await this.http.get(
      `/sites/${this.apiSiteId}/views/${viewId}/data`,
      { responseType: 'text', headers: { Accept: 'text/csv' } }
    );
    return data;
  }

  async readDatasourceMetadata(datasourceLuid) {
    await this.ensure();
    const { data } = await this.vds.post('/read-metadata', { datasource: { datasourceLuid } });
    return data.data ?? [];
  }

  async queryDatasource(datasourceLuid, fields) {
    await this.ensure();
    const { data } = await this.vds.post('/query-datasource', {
      datasource: { datasourceLuid }, query: { fields },
    });
    return data.data ?? [];
  }

  // A view has no refresh event of its own in Tableau's model — only its
  // parent workbook's extract does — so watching a tableau_view source for
  // changes means resolving the view to the workbook that owns it first.
  async getView(viewId) {
    await this.ensure();
    const { data } = await this.http.get(`/sites/${this.apiSiteId}/views/${viewId}`);
    return data.view;
  }

  async createWebhook(name, event, url) {
    await this.ensure();
    const { data } = await this.http.post(`/sites/${this.apiSiteId}/webhooks`, {
      webhook: {
        name,
        'webhook-source': { [event]: {} },
        'webhook-destination': { 'webhook-destination-http': { method: 'POST', url } },
      },
    });
    return data.webhook;
  }

  async deleteWebhook(webhookId) {
    await this.ensure();
    await this.http.delete(`/sites/${this.apiSiteId}/webhooks/${webhookId}`);
  }
}

// Tableau has no "a view's data changed" event — refresh events fire at the
// datasource or workbook level. A published datasource source watches its
// own extract refresh directly; a view source watches the workbook that
// contains it (resolved via TableauSession.getView at registration time).
// Tableau's event names end in -succeeded, not -success, and the create
// payload takes NO resource filter — including one is rejected outright with
// "Payload is either malformed or incomplete", which is exactly what the
// Enable auto-refresh button reported. A webhook is therefore registered per
// event type for the whole SITE, and narrowing it to the source we actually
// care about happens in the callback, against the LUID in the event body.
export const WEBHOOK_EVENTS = {
  tableau_datasource: 'webhook-source-event-datasource-refresh-succeeded',
  tableau_view: 'webhook-source-event-workbook-refresh-succeeded',
};

// Tableau names this field "resource-luid" today; the alternatives cost
// nothing to accept and keep a rename from silently disabling the filter.
export const webhookEventResourceLuid = body => {
  const value = body?.['resource-luid'] ?? body?.resourceLuid ?? body?.resource_luid;
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
};

const tableauSessions = new Map();

function tableauError(err) {
  const detail = err.response?.data?.error?.detail
    ?? err.response?.data?.message ?? err.response?.data?.errorCode;
  const code = err.response?.data?.error?.code;
  const status = err.response?.status;

  if (code === '401001' || status === 401 || /authentication token failed to authenticate/i.test(detail || '')) {
    return 'Tableau rejected the saved token — it has likely expired or been revoked. Disconnect and reconnect with a fresh Personal Access Token (the secret is only shown once at creation).';
  }
  if (status === 403) {
    return 'Tableau accepted the token but refused this request. For published data sources, the "API Access" permission must be granted on the data source. ' + (detail || '');
  }
  if (status === 404) {
    return 'Endpoint not found. If this was a data source query, VizQL Data Service may not be available on this site. ' + (detail || '');
  }
  if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
    return `Could not reach ${err.config?.baseURL ?? 'the Tableau server'}. Check the URL and your network.`;
  }
  return detail || err.message || 'Unknown Tableau error';
}

// ===== ROUTER =====
export function createDataSourceRouter({ store, requireAuth }) {
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ok = /\.(csv|tsv|xlsx|xls|json)$/i.test(file.originalname);
      cb(ok ? null : new Error('Only .csv, .tsv, .xlsx, .xls and .json files are accepted'), ok);
    },
  });

  // Staged source data, kept AFTER commit so the mapping can be revised
  // without re-uploading. Replaced on the next import; dropped on restart.
  const staged = new Map();
  const latestStageByUser = new Map();

  // A Tableau Personal Access Token holds ONE active session at a time: signing
  // in again invalidates the token the previous signin handed out. Every source
  // refresh opens its own session, so several sources sharing one PAT — the
  // normal setup — knock each other over whenever two refreshes overlap (the
  // startup sweep racing a manual refresh, or a webhook firing mid-sweep). The
  // symptom is a 401 on a credential that is perfectly valid, reported as
  // "Tableau rejected the saved token", which sends you off rotating a token
  // that was never the problem.
  //
  // One retry with a fresh signin resolves that race, and also covers a session
  // that simply aged out during a long extract read. A second 401 is treated as
  // real: at that point the credential genuinely is not working.
  async function fetchSourceData(spec) {
    const openSession = () => new TableauSession({
      server: spec.server, siteId: spec.siteId || '', patName: spec.patName,
      patSecret: decryptCredential(spec.encryptedPatSecret),
    });
    const read = async tableau => {
      if (spec.sourceType === 'tableau_view') {
        const csv = await tableau.getViewCsv(spec.externalId);
        return parseBuffer(Buffer.from(csv, 'utf8'), 'view.csv');
      }
      const meta = await tableau.readDatasourceMetadata(spec.externalId);
      const fields = meta.map(f => ['REAL','INTEGER'].includes(f.dataType) && f.defaultAggregation && f.defaultAggregation !== 'NONE'
        ? { fieldCaption: f.fieldCaption, function: 'SUM' } : { fieldCaption: f.fieldCaption });
      const rows = await tableau.queryDatasource(spec.externalId, fields);
      return { headers: [...new Set(rows.flatMap(row => Object.keys(row)))], rows };
    };
    try {
      return await read(openSession());
    } catch (error) {
      if (error.response?.status !== 401) throw error;
      console.warn(`[Tableau sync] session for "${spec.sourceName || spec.id}" was invalidated mid-refresh; signing in again`);
      return read(openSession());
    }
  }

  async function refreshSource(spec,userId,triggerType='manual') {
    const runId=await startSyncRun(spec.id,userId,triggerType);
    try {
      const parsed=await fetchSourceData(spec);
      const rows=applyMapping(parsed.rows,spec.mapping); store.setSourceRows(spec.id,spec.dashboards,rows,userId);
      await finishSyncRun(runId,spec.id,{status:'succeeded',rowCount:rows.length});
      return {ok:true,runId,rowCount:rows.length,refreshedAt:new Date().toISOString()};
    } catch(error) {
      await finishSyncRun(runId,spec.id,{status:'failed',error:tableauError(error)}); throw Object.assign(error,{runId});
    }
  }

  function stageForUser(email, pending) {
    const stagingId = randomUUID();
    staged.set(`${email}:${stagingId}`, pending);
    latestStageByUser.set(email, stagingId);
    return stagingId;
  }

  function stagedOr400(req, res) {
    const stagingId = req.body?.stagingId || req.query?.stagingId || latestStageByUser.get(req.session.email);
    const pending = stagingId ? staged.get(`${req.session.email}:${stagingId}`) : null;
    if (!pending) {
      res.status(400).json({ error: 'Nothing staged. Upload or import a source first.' });
      return null;
    }
    return { pending, stagingId };
  }

  // ---- File upload ----
  router.post('/upload/preview', requireAuth, upload.single('file'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file received' });
      const parsed = parseBuffer(req.file.buffer, req.file.originalname);
      const stagingId = stageForUser(req.session.email, { ...parsed, filename: req.file.originalname,
        sourceType: 'file', mimeType: req.file.mimetype, byteSize: req.file.size,
        checksum: createHash('sha256').update(req.file.buffer).digest('hex') });
      res.json({ stagingId, source: 'file', filename: req.file.originalname, ...buildPreview(parsed) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/upload/batch-preview', requireAuth, upload.array('files', 10), (req, res) => {
    try {
      if (!req.files?.length) return res.status(400).json({ error: 'No files received' });
      const items = req.files.map(file => {
        const parsed = parseBuffer(file.buffer, file.originalname);
        const stagingId = stageForUser(req.session.email, { ...parsed, filename: file.originalname,
          sourceType: 'file', mimeType: file.mimetype, byteSize: file.size,
          checksum: createHash('sha256').update(file.buffer).digest('hex') });
        return { stagingId, source: 'file', filename: file.originalname, ...buildPreview(parsed) };
      });
      res.json({ items });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---- Live preview of coerced rows for the current mapping ----
  router.post('/preview/rows', requireAuth, (req, res) => {
    const stagedItem = stagedOr400(req, res);
    if (!stagedItem) return;
    const { pending } = stagedItem;

    const { fieldMapping, limit = 25 } = req.body ?? {};
    const mapping = fieldMapping && Object.keys(fieldMapping).length
      ? fieldMapping
      : autoMap(pending.headers).fieldMapping;
    pending.mapping = mapping;   

    try {
      const slice = pending.rows.slice(0, Math.min(limit, 100));
      // Fill rates over a wider sample than the visible rows.
      const statsSample = pending.rows.slice(0, Math.min(500, pending.rows.length));
      res.json({
        rows: applyMapping(slice, mapping),
        fillRates: fillRates(statsSample, mapping),
        sampledFrom: statsSample.length,
        totalRows: pending.rows.length,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---- Commit (staged data is retained) ----
  router.post('/upload/commit', requireAuth, async (req, res) => {
    const { templateId, templateIds, fieldMapping } = req.body ?? {};
    const dashboardKeys = [...new Set((Array.isArray(templateIds) ? templateIds : [templateId]).filter(Boolean))];
    if (!dashboardKeys.length) return res.status(400).json({ error: 'At least one dashboard is required' });

    const stagedItem = stagedOr400(req, res);
    if (!stagedItem) return;
    const { pending, stagingId } = stagedItem;

    try {
      const finalMapping = fieldMapping && Object.keys(fieldMapping).length
        ? fieldMapping
        : autoMap(pending.headers).fieldMapping;
      pending.mapping = finalMapping;

      const rows = applyMapping(pending.rows, finalMapping);
      const persisted = await persistImportedSource({
        userId: req.session.userId, source: pending, dashboardKeys,
        mapping: finalMapping, rowCount: rows.length,
      });
      // Drop the superseded source's rows first: the runtime cache unions every
      // bound source, so leaving them in place would keep the old mapping's
      // rows competing with the new ones until the next restart.
      for (const stale of persisted.superseded || []) {
        store.removeSourceRows(stale.sourceId, stale.dashboardKeys, req.session.userId);
      }
      store.setSourceRows(persisted.sourceId, dashboardKeys, rows, req.session.userId);
      await logAudit({ userId: req.session.userId, action: 'data_source.committed',
        entityType: 'data_source', entityId: persisted.sourceId,
        afterState: { filename: pending.filename, rowCount: rows.length, dashboards: dashboardKeys } });
      await logSourceAccess({ userId: req.session.userId, sourceId: persisted.sourceId,
        action: 'upload.commit', rowCount: rows.length, details: { dashboards: dashboardKeys } });

      res.json({
        ok: true, templateId: dashboardKeys[0], templateIds: dashboardKeys,
        sourceId: persisted.sourceId, rowCount: rows.length,
        stagingId, source: pending.filename, loadedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---- Is anything staged? (lets the UI offer "adjust mapping" after reload) ----
  router.get('/staged', requireAuth, (req, res) => {
    const stagingId = latestStageByUser.get(req.session.email);
    const pending = stagingId ? staged.get(`${req.session.email}:${stagingId}`) : null;
    if (!pending) return res.json({ staged: false });

    const preview = buildPreview(pending);
    // Prefer the mapping actually in use, while allowing newly introduced
    // dashboard fields to inherit a valid automatic match from the staged
    // headers. Explicit saved choices (including null) still win.
    if (pending.mapping) preview.fieldMapping = {
      ...preview.fieldMapping,
      ...pending.mapping,
    };

    res.json({
      staged: true, stagingId,
      filename: pending.filename,
      ...preview,
    });
  });

  router.get('/', requireAuth, async (req, res) => {
    try { res.json({ sources: await listUserSources(query, req.session.userId) }); }
    catch (err) { res.status(500).json({ error: 'Could not load data sources' }); }
  });

  router.get('/sync-history', requireAuth, async (req,res) => {
    try { res.json({runs:await listSyncRuns(req.session.userId,req.query.sourceId||null)}); }
    catch { res.status(500).json({error:'Could not load sync history'}); }
  });

  router.delete('/:sourceId', requireAuth, async (req,res) => {
    try {
      const { dashboardKeys } = await softDeleteSource(req.session.userId, req.params.sourceId);
      store.removeSourceRows(req.params.sourceId, dashboardKeys, req.session.userId);
      await logAudit({ userId: req.session.userId, action: 'data_source.deleted',
        entityType: 'data_source', entityId: req.params.sourceId, afterState: { dashboardKeys } });
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not delete data source' });
    }
  });

  router.post('/:sourceId/refresh', requireAuth, async (req,res) => {
    const spec=await getRefreshableSource(req.session.userId,req.params.sourceId);
    if(!spec) return res.status(404).json({error:'Tableau source not found'});
    try {
      res.json(await refreshSource(spec,req.session.userId,'manual'));
    } catch(error) {
      res.status(502).json({error:tableauError(error),runId:error.runId});
    }
  });

  // Registers a Tableau webhook (Tableau's push notification, not a poll)
  // that fires when the source's underlying extract refreshes, so this app
  // re-pulls the data within moments instead of waiting for the next
  // 12-hour scheduled sync. Requires APP_BASE_URL — Tableau Cloud delivers
  // the event by POSTing to this app from the outside, which a bare
  // localhost address can never receive.
  router.post('/:sourceId/webhook/enable', requireAuth, async (req,res) => {
    const callbackBase=resolveWebhookBaseUrl();
    if(callbackBase.error) return res.status(400).json({error:callbackBase.error});
    const state=await getSourceWebhookState(req.session.userId,req.params.sourceId);
    if(!state) return res.status(404).json({error:'Data source not found'});
    const webhookEvent=WEBHOOK_EVENTS[state.sourceType];
    if(!webhookEvent) return res.status(400).json({error:'Auto-refresh via webhook is only available for Tableau view and data source connections.'});
    const spec=await getRefreshableSource(req.session.userId,req.params.sourceId);
    if(!spec) return res.status(404).json({error:'Tableau source not found'});

    try {
      const session=new TableauSession({server:spec.server,siteId:spec.siteId||'',patName:spec.patName,
        patSecret:decryptCredential(spec.encryptedPatSecret)});
      const resourceId = state.sourceType==='tableau_view'
        ? (await session.getView(state.externalId))?.workbook?.id
        : state.externalId;
      if(!resourceId) return res.status(502).json({error:"Could not resolve this view's parent workbook in Tableau."});

      // A stale webhook from a previous enable (e.g. left registered after
      // a failed save) would otherwise keep double-delivering every event.
      if(state.webhookId) await session.deleteWebhook(state.webhookId).catch(()=>{});

      const webhookSecret=randomUUID();
      const callbackUrl=`${callbackBase.base}/api/datasources/webhook/${req.params.sourceId}/${webhookSecret}`;
      const webhook=await session.createWebhook(`TestMu BI — ${state.sourceType==='tableau_view'?'workbook':'datasource'} refresh`,webhookEvent,callbackUrl);
      // resourceId is stored rather than sent: Tableau will not scope the
      // subscription, so the callback is where events for other resources
      // get filtered out.
      await saveSourceWebhook(req.params.sourceId,{webhookId:webhook.id,webhookSecret,webhookEvent,resourceLuid:resourceId,enabled:true});
      res.json({ok:true});
    } catch(error) {
      res.status(502).json({error:tableauError(error)});
    }
  });

  router.post('/:sourceId/webhook/disable', requireAuth, async (req,res) => {
    const state=await getSourceWebhookState(req.session.userId,req.params.sourceId);
    if(!state) return res.status(404).json({error:'Data source not found'});
    if(state.webhookId) {
      try {
        const spec=await getRefreshableSource(req.session.userId,req.params.sourceId);
        if(spec){
          const session=new TableauSession({server:spec.server,siteId:spec.siteId||'',patName:spec.patName,
            patSecret:decryptCredential(spec.encryptedPatSecret)});
          await session.deleteWebhook(state.webhookId);
        }
      } catch(error) {
        // The webhook may already be gone on Tableau's side (e.g. deleted
        // manually) — that's fine, still clear our own record below so the
        // UI doesn't get stuck showing it as enabled.
        console.error(`[Tableau webhook] could not delete ${state.webhookId}:`,tableauError(error));
      }
    }
    await saveSourceWebhook(req.params.sourceId,{webhookId:null,webhookSecret:null,webhookEvent:null,resourceLuid:null,enabled:false});
    res.json({ok:true});
  });

  // Public — Tableau calls this directly, with no session. The source id +
  // random secret pair in the URL (neither guessable) stands in for auth,
  // the same role a session cookie plays on every other route here.
  router.post('/webhook/:sourceId/:secret', async (req,res) => {
    const source=await findWebhookSource(req.params.sourceId,req.params.secret).catch(()=>null);
    if(!source || !source.webhookEnabled) return res.status(404).end();
    // Acknowledge immediately — Tableau expects a fast response and the
    // actual re-pull (a live VizQL Data Service query) can take longer than
    // its delivery timeout allows.
    res.status(200).json({ok:true});
    // The subscription covers the whole site, so most deliveries are about
    // somebody else's extract. Without this every unrelated refresh on the
    // site would re-pull this source in full.
    //
    // Deliberately fails OPEN: only a LUID we can read AND that disagrees is
    // grounds to skip. An unfamiliar payload shape still refreshes, because
    // guessing wrong in the other direction produces a webhook that silently
    // never fires — the exact failure this feature is meant to avoid.
    const eventLuid=webhookEventResourceLuid(req.body);
    if(source.webhookResourceLuid&&eventLuid&&eventLuid!==String(source.webhookResourceLuid).toLowerCase())return;
    markWebhookEventReceived(source.id).catch(()=>{});
    const spec=await getRefreshableSource(source.userId,source.id).catch(()=>null);
    if(spec) refreshSource(spec,source.userId,'webhook').catch(error=>
      console.error(`[Tableau webhook] refresh failed for ${source.id}:`,tableauError(error)));
  });

  const refreshAllTableauSources = async triggerType => {
    // Both DB reads below can reject on a credential, DNS or timeout failure.
    // They used to be unguarded, so a database that refused the connection
    // took the whole process down at boot through an unhandled rejection -
    // a crash loop instead of a server that stays up and reports 503.
    let items;
    try { items = await listRefreshableSourceIds(); }
    catch(error){ console.error('[Tableau sync] could not list sources:',error?.message||error); return; }
    for(const item of items){
      let spec;
      try { spec = await getRefreshableSource(item.userId,item.id); }
      catch(error){ console.error(`[Tableau sync] could not load ${item.id}:`,error?.message||error); continue; }
      if(spec) try{await refreshSource(spec,item.userId,triggerType);}catch(error){console.error(`[Tableau sync] ${item.id}:`,tableauError(error));}
    }
  };

  if(process.env.DATABASE_URL) {
    // Business rows intentionally remain outside PostgreSQL. Rehydrate every
    // saved Tableau binding after a server restart so dashboards do not come
    // back empty between scheduled syncs.
    const runRefresh = trigger => refreshAllTableauSources(trigger)
      .catch(error=>console.error(`[Tableau sync] ${trigger} refresh failed:`,error?.message||error));
    setTimeout(()=>runRefresh('startup'),0);
    cron.schedule(process.env.TABLEAU_SOURCE_SYNC_CRON||'0 */12 * * *',
      ()=>runRefresh('scheduled'),
      {timezone:process.env.CRON_TZ_OFFSET||'UTC'});
  }

  router.post('/staged/clear', requireAuth, (req, res) => {
    const stagingId = req.body?.stagingId || latestStageByUser.get(req.session.email);
    if (stagingId) staged.delete(`${req.session.email}:${stagingId}`);
    if (latestStageByUser.get(req.session.email) === stagingId) latestStageByUser.delete(req.session.email);
    res.json({ ok: true });
  });

  // ---- Tableau connection ----
  router.post('/tableau/connect', requireAuth, async (req, res) => {
    const { server, siteId, patName, patSecret, name } = req.body ?? {};
    if (!server || !patName || !patSecret) {
      return res.status(400).json({ error: 'server, patName and patSecret are required' });
    }
    const session = new TableauSession({ server, siteId: siteId ?? '', patName, patSecret });
    try {
      const info = await session.signin();
      const saved = await saveTableauConnection({
        userId: req.session.userId,
        name: name || info.siteName || 'Tableau Cloud',
        server: session.server, siteId: siteId ?? '', patName,
        encryptedPatSecret: encryptCredential(patSecret),
      });
      session.connectionId = saved?.id || null;
      tableauSessions.set(req.session.email, session);
      await logAudit({ userId: req.session.userId, action: 'tableau.connected',
        entityType: 'tableau_connection', entityId: saved?.id || null,
        afterState: { server: session.server, siteId: siteId ?? '' } });
      res.json({ ok: true, connected: true, connectionId: saved?.id || null, site: info.siteName, server: session.server });
    } catch (err) {
      res.status(401).json({ error: tableauError(err) });
    }
  });

  router.post('/tableau/disconnect', requireAuth, async (req, res) => {
    const current = tableauSessions.get(req.session.email);
    await setTableauConnectionStatus(req.session.userId, current?.connectionId || req.body?.connectionId, 'disconnected');
    tableauSessions.delete(req.session.email);
    res.json({ ok: true, connected: false });
  });

  router.get('/tableau/connections', requireAuth, async (req, res) => {
    res.json({ connections: await listTableauConnections(req.session.userId) });
  });

  async function restoreSession(req, connectionId = null) {
    const saved = await getRestorableTableauConnection(req.session.userId, connectionId);
    if (!saved) return null;
    const session = new TableauSession({
      server: saved.server, siteId: saved.siteId || '', patName: saved.patName,
      patSecret: decryptCredential(saved.encryptedPatSecret),
    });
    session.connectionId = saved.id;
    tableauSessions.set(req.session.email, session);
    return session;
  }

  router.post('/tableau/restore', requireAuth, async (req, res) => {
    try {
      const session = await restoreSession(req, req.body?.connectionId);
      if (!session) return res.status(404).json({ error: 'Saved Tableau connection not found' });
      const info = await session.signin();
      await setTableauConnectionStatus(req.session.userId, session.connectionId, 'connected');
      res.json({ connected: true, connectionId: session.connectionId, server: session.server, site: info.siteName });
    } catch (err) { res.status(401).json({ error: tableauError(err) }); }
  });

  router.get('/tableau/status', requireAuth, async (req, res) => {
    let session = tableauSessions.get(req.session.email);
    if (!session) {
      try { session = await restoreSession(req); } catch { /* explicit reconnect can repair credentials */ }
    }
    res.json({
      connected: Boolean(session),
      connectionId: session?.connectionId ?? null,
      server: session?.server ?? null,
      site: session?.siteId ?? null,
    });
  });

  async function sessionOr409(req, res) {
    let session = tableauSessions.get(req.session.email);
    if (!session) {
      try { session = await restoreSession(req, req.body?.connectionId || req.query?.connectionId); }
      catch (err) { res.status(409).json({ error: tableauError(err) }); return null; }
    }
    if (!session) { res.status(409).json({ error: 'Not connected to Tableau' }); return null; }
    return session;
  }

  router.get('/tableau/views', requireAuth, async (req, res) => {
    const session = await sessionOr409(req, res);
    if (!session) return;
    try { res.json({ views: await session.listViews() }); }
    catch (err) { res.status(502).json({ error: tableauError(err) }); }
  });

  router.post('/tableau/preview', requireAuth, async (req, res) => {
    const { viewId, viewName } = req.body ?? {};
    const session = await sessionOr409(req, res);
    if (!session) return;
    if (!viewId) return res.status(400).json({ error: 'viewId is required' });

    try {
      const csv = await session.getViewCsv(viewId);
      const parsed = parseBuffer(Buffer.from(csv, 'utf8'), 'view.csv');
      const label = viewName || `Tableau view ${viewId}`;
      const stagingId = stageForUser(req.session.email, { ...parsed, filename: label,
        sourceType: 'tableau_view', externalId: viewId, workbookName: req.body?.workbookName || null,
        tableauConnectionId: session.connectionId });
      res.json({ stagingId, source: 'tableau-view', filename: label, ...buildPreview(parsed) });
    } catch (err) {
      res.status(502).json({ error: tableauError(err) });
    }
  });

  router.get('/tableau/datasources', requireAuth, async (req, res) => {
    const session = await sessionOr409(req, res);
    if (!session) return;
    try { res.json({ datasources: await session.listDatasources() }); }
    catch (err) { res.status(502).json({ error: tableauError(err) }); }
  });

  router.post('/tableau/datasource-preview', requireAuth, async (req, res) => {
    const { datasourceId, datasourceName } = req.body ?? {};
    const session = await sessionOr409(req, res);
    if (!session) return;
    if (!datasourceId) return res.status(400).json({ error: 'datasourceId is required' });

    try {
      const meta = await session.readDatasourceMetadata(datasourceId);
      if (!meta.length) return res.status(502).json({ error: 'Tableau returned no fields for this data source.' });

      const fields = meta.map(f => {
        const isMeasure = ['REAL', 'INTEGER'].includes(f.dataType)
          && f.defaultAggregation && f.defaultAggregation !== 'NONE';
        return isMeasure
          ? { fieldCaption: f.fieldCaption, function: 'SUM' }
          : { fieldCaption: f.fieldCaption };
      });

      const rows = await session.queryDatasource(datasourceId, fields);
      if (!rows.length) return res.status(502).json({ error: 'Query succeeded but returned no rows.' });

      const headers = [...new Set(rows.flatMap(r => Object.keys(r)))];
      const label = datasourceName || `Tableau data source ${datasourceId}`;
      const stagingId = stageForUser(req.session.email, { headers, rows, filename: label,
        sourceType: 'tableau_datasource', externalId: datasourceId,
        projectName: req.body?.projectName || null, tableauConnectionId: session.connectionId });
      res.json({ stagingId, source: 'tableau-datasource', filename: label, ...buildPreview({ headers, rows }) });
    } catch (err) {
      res.status(502).json({ error: tableauError(err) });
    }
  });

  router.use((err, req, res, next) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });

  return router;
}
