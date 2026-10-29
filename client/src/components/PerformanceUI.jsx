import { useEffect, useState } from 'react';
import { fmtPercent } from './charts';
import { Hideable } from './Hideable';
import { KpiDelta } from '../pages/WinBoard';
import { getPodLeader } from '../lib/podLeaders';

const hasValue = value => value !== null && value !== undefined && Number.isFinite(value);
const initials = name => {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return words.length > 1 ? (words[0][0] + words.at(-1)[0]).toUpperCase() : (words[0] || '?').slice(0, 2).toUpperCase();
};
const COLORS = ['#4b6451', '#536d8c', '#76588a', '#90623e', '#8c4f5e'];
const avatarColor = name => COLORS[Array.from(String(name)).reduce((hash, letter) => (hash * 31 + letter.charCodeAt(0)) >>> 0, 0) % COLORS.length];

export function PerformanceAvatar({ name, photo, team = false }) {
  const [failedPhoto, setFailedPhoto] = useState(null);
  if (photo && failedPhoto !== photo) return <img className="perf-avatar" src={photo} alt={name} width="56" height="56" loading="eager" onError={() => setFailedPhoto(photo)} />;
  return <span className={`perf-avatar perf-avatar-fallback${team ? ' perf-avatar-team' : ''}`} style={{ '--avatar-color': avatarColor(name) }} role="img" aria-label={team ? `${name}: no leader assigned` : name}>
    {team ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 4v2"/></svg> : initials(name)}
  </span>;
}

export function AttainmentTrack({ value, labeled = false }) {
  return <div className={`perf-progress${hasValue(value) && value >= 100 ? ' is-met' : ''}`}>
    <div className="perf-track" aria-hidden="true"><span style={{ width: `${hasValue(value) ? Math.max(0, Math.min(100, value)) : 0}%` }}/><i/></div>
    {labeled && <div className="perf-track-label"><span>{hasValue(value) && value >= 100 ? 'Quota achieved' : 'Quarter progress'}</span><span>100% target</span></div>}
  </div>;
}

export function TopPerformer({ title, item, pod = false, onDoubleClick }) {
  const leader = pod && item ? getPodLeader(item.label) : null;
  return <article className="perf-spotlight" onDoubleClick={onDoubleClick}>
    <PerformanceAvatar name={leader?.name || item?.label || title} photo={leader?.photo} team={pod && !leader}/>
    <div className="perf-spotlight-identity"><span className="perf-label">{title}</span><strong>{item?.label || 'No measurable target'}</strong>{leader && <small>{leader.name}</small>}</div>
    {item && <div className="perf-spotlight-value"><strong>{fmtPercent(item.attainment)}</strong><span>of quota</span></div>}
  </article>;
}

export function QuotaSummary({ role, quota, teamAttainment, priorTeamAttainment, atOrAbove, measuredCount, topRep, topPod }) {
  return <section className="perf-summary" aria-label={`${role} quarter performance`}>
    <header className="perf-summary-heading"><h2>Quarter performance</h2><span>{quota.currentQuarter}<span className="perf-scope-note">Full quarter · independent of close-date filter</span></span></header>
    <div className="perf-summary-grid">
      <div className="perf-team"><span className="perf-label">Team attainment</span><div className="perf-team-value"><strong>{hasValue(teamAttainment) ? fmtPercent(teamAttainment) : '—'}</strong>{hasValue(priorTeamAttainment) && hasValue(teamAttainment) && <KpiDelta value={teamAttainment - priorTeamAttainment}/>}</div><AttainmentTrack value={teamAttainment} labeled/></div>
      <dl className="perf-context"><div><dt>Reps at or above quota</dt><dd>{atOrAbove}<small> / {measuredCount}</small></dd></div><div><dt>{quota.previousQuarter} attainment</dt><dd>{hasValue(priorTeamAttainment) ? fmtPercent(priorTeamAttainment) : '—'}</dd>{!quota.priorMapped && <small>Prior quarter quota not mapped</small>}</div></dl>
      <div className="perf-spotlights"><TopPerformer title={`Top ${role} performer`} item={topRep}/><TopPerformer title="Top POD" item={topPod} pod/></div>
    </div>
  </section>;
}

// Preserve the supplied rank order and true percentages. The bar has a shared
// 100% baseline; over-target numbers stay exact and missing quota stays missing.
export function RepLeaderboard({ reps = [], topN = 5, pod = false, rankOffset = 0, emptyLabel = 'No reps in the selected scope.' }) {
  const rows = topN > 0 ? reps.slice(0, topN) : reps;
  if (!rows.length) return <div className="perf-ranking-empty">{emptyLabel}</div>;
  return <ol className={`perf-ranking${pod ? ' perf-ranking-pods' : ''}`} start={rankOffset + 1} aria-label={pod ? 'POD ranking' : 'Rep ranking'}>
    {rows.map((rep, index) => {
      const rank = rankOffset + index + 1;
      const leader = pod ? getPodLeader(rep.label) : null;
      const measurable = hasValue(rep.attainment);
      const delta = measurable && hasValue(rep.priorAttainment) ? rep.attainment - rep.priorAttainment : null;
      return <li key={rep.label} className={`perf-rank-row ae-leaderboard-row${rank === 1 ? ' is-first' : ''}${!measurable ? ' is-unmeasured' : ''}`} data-rank={rank}>
        <span className={`perf-rank${rank < 4 ? ` perf-rank-${rank}` : ''}`} aria-label={`Rank ${rank}`}>{String(rank).padStart(2, '0')}</span>
        <PerformanceAvatar name={leader?.name || rep.label} photo={leader?.photo} team={pod && !leader}/>
        <div className="perf-identity"><strong title={rep.label}>{rep.label}</strong><span>{pod ? leader?.name || 'Leader not assigned' : measurable ? rep.attainment >= 100 ? 'Quota achieved' : 'Quarter attainment' : 'Target unavailable'}</span></div>
        <div className="perf-value"><strong>{measurable ? fmtPercent(rep.attainment) : 'No quota'}</strong>{delta !== null && <KpiDelta value={delta}/>}</div>
        <AttainmentTrack value={rep.attainment}/>
      </li>;
    })}
  </ol>;
}

export function PresentationRanking({ role, reps, topN, pod = false, quarterLabel, share }) {
  const [page, setPage] = useState(0);
  const rows = topN > 0 ? reps.slice(0, topN) : reps;
  const pageCount = Math.max(1, Math.ceil(rows.length / 5));
  const current = Math.min(page, pageCount - 1);
  const offset = current * 5;
  const title = `${role}${pod ? ' POD' : ''} Quota Attainment`;
  useEffect(() => { setPage(0); }, [topN]);
  useEffect(() => {
    if (!share || pageCount <= 1) return undefined;
    const timer = setInterval(() => setPage(value => (value + 1) % pageCount), 15000);
    return () => clearInterval(timer);
  }, [share, pageCount]);
  return <Hideable k={`card:${pod ? 'pod' : 'rep'}-leaderboard`} label={title}>
    <section className={`perf-present-card${pod ? ' perf-present-pods' : ''}`} aria-label={title}>
      <header><div><h2>{title}</h2><p>{pod ? 'Combined rep targets, including reps with no wins.' : 'Won ARR divided by each rep’s quarter target.'}</p></div><span className="perf-quarter-chip">{quarterLabel}</span></header>
      <RepLeaderboard reps={rows.slice(offset, offset + 5)} topN={0} pod={pod} rankOffset={offset}/>
      <footer><span>{rows.length ? `${offset + 1}–${Math.min(offset + 5, rows.length)} of ${rows.length} ${pod ? 'PODs' : 'reps'}` : 'No ranking available'}</span><span className="perf-target-key"><i/>100% quota</span>{pageCount > 1 && <div className="perf-page-controls" onDoubleClick={event => event.stopPropagation()}><button aria-label={`Previous ${pod ? 'PODs' : 'reps'}`} onClick={() => setPage((current + pageCount - 1) % pageCount)}>‹</button><span>{current + 1} / {pageCount}</span><button aria-label={`Next ${pod ? 'PODs' : 'reps'}`} onClick={() => setPage((current + 1) % pageCount)}>›</button></div>}</footer>
    </section>
  </Hideable>;
}
