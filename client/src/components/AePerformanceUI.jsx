import { useEffect, useState } from 'react';
import { fmtPercent } from './charts';
import { PerformanceAvatar } from './PerformanceUI';
import { Hideable } from './Hideable';
import { KpiDelta } from '../pages/WinBoard';
import { getPodLeader } from '../lib/podLeaders';

const measured = value => typeof value === 'number' && Number.isFinite(value);
const percent = value => measured(value) ? fmtPercent(value) : '\u2014';
const band = value => !measured(value) ? 'unmeasured' : value >= 100 ? 'met' : value >= 75 ? 'near' : value >= 25 ? 'building' : 'early';

export function AeQuarterPanel({ role = 'AE', quota, teamAttainment, priorTeamAttainment, atOrAbove, measuredCount }) {
  return <section className="ae-quarter-panel" aria-label={`${role} quarter performance`}>
    <header><h2>Team attainment</h2><span>{quota?.currentQuarter || 'Current quarter'}</span></header>
    <div className="ae-quarter-number">{percent(teamAttainment)}</div>
    <p>of the quarter target achieved</p>
    <div className="ae-quarter-progress" aria-hidden="true"><span style={{ width: `${measured(teamAttainment) ? Math.max(0, Math.min(100, teamAttainment)) : 0}%` }}/></div>
    <div className="ae-quarter-scale"><span>{measured(teamAttainment) && teamAttainment >= 100 ? 'Target achieved' : 'Quarter progress'}</span><span>100% target</span></div>
    <dl>
      <div><dt>Reps at quota</dt><dd>{atOrAbove}<small> / {measuredCount}</small></dd></div>
      <div><dt>{quota?.previousQuarter || 'Prior quarter'}</dt><dd>{percent(priorTeamAttainment)}</dd>{!quota?.priorMapped && <small>Prior quarter quota not mapped</small>}</div>
    </dl>
    {measured(priorTeamAttainment) && measured(teamAttainment) && <div className="ae-quarter-change"><KpiDelta value={teamAttainment - priorTeamAttainment}/><span>vs. prior quarter</span></div>}
  </section>;
}

export function AeDistribution({ reps }) {
  const valid = reps.filter(rep => measured(rep.attainment));
  const groups = [
    { id: 'early', label: 'Below 25%', count: valid.filter(rep => rep.attainment < 25).length },
    { id: 'building', label: '25% to below 75%', count: valid.filter(rep => rep.attainment >= 25 && rep.attainment < 75).length },
    { id: 'near', label: '75% to below 100%', count: valid.filter(rep => rep.attainment >= 75 && rep.attainment < 100).length },
    { id: 'met', label: '100% and above', count: valid.filter(rep => rep.attainment >= 100).length },
  ];
  return <section className="ae-distribution" aria-label="Rep attainment distribution">
    <header><div><h2>Where the team stands</h2><p>Every rep with a target, grouped by quota attainment.</p></div><span className="ae-count-label"><strong>{valid.length}</strong> reps</span></header>
    <div className="ae-distribution-bar" aria-hidden="true">{groups.filter(group => group.count).map(group => <span key={group.id} className={`ae-band-${group.id}`} style={{ flex: group.count }}/>)}</div>
    <dl className="ae-distribution-groups">{groups.map(group => <div key={group.id} className={`ae-band-${group.id}`}><dt><i/>{group.label}</dt><dd>{group.count}<small> {group.count === 1 ? 'rep' : 'reps'}</small></dd></div>)}</dl>
    <footer><span>Full quarter. Independent of the close-date filter.</span><span>{reps.length - valid.length > 0 ? `${reps.length - valid.length} without a mapped target` : 'All reps have a mapped target'}</span></footer>
  </section>;
}

export function AeLeaderSpotlight({ title, item, pod = false, onDoubleClick }) {
  const leader = pod && item ? getPodLeader(item.label) : null;
  return <article className="ae-leader-spotlight" onDoubleClick={onDoubleClick}>
    <span className="ae-spotlight-label">{title}</span>
    <div className="ae-spotlight-person"><PerformanceAvatar name={leader?.name || item?.label || title} photo={leader?.photo} team={pod && !leader}/><div><strong>{item?.label || 'No measurable target'}</strong>{leader && <span>{leader.name}</span>}</div></div>
    {item && <div className="ae-spotlight-result"><strong>{percent(item.attainment)}</strong><span>of quota</span></div>}
  </article>;
}

// Keep a single scale across all pages: changing pages must not make a smaller
// percentage look like a larger result. Unlike a progress track, this chart
// shows overachievement in full, with a separate 100% target reference.
function chartMaximum(rows) {
  const largest = rows.reduce((max, row) => measured(row.attainment) ? Math.max(max, row.attainment) : max, 100);
  return Math.ceil(largest / 100) * 100;
}

function ChartAxis({ maximum }) {
  return <div className="ae-chart-axis" aria-hidden="true"><span>Rep</span><div><span>0</span><b style={{ left: `${100 / maximum * 100}%` }}>100% target</b>{maximum > 100 && <span>{maximum}%</span>}</div><span>Attainment</span></div>;
}

function RankingRows({ rows, pod, rankOffset, maximum }) {
  if (!rows.length) return <p className="ae-ranking-empty">No {pod ? 'PODs' : 'reps'} in the selected scope.</p>;
  return <ol className={`ae-rank-list${pod ? ' ae-pod-list' : ' ae-rep-list'}`} style={pod ? { '--pod-columns': Math.min(rows.length, 5) } : undefined} start={rankOffset + 1} aria-label={pod ? 'POD ranking' : 'Rep ranking'}>
    {rows.map((rep, index) => {
      const leader = pod ? getPodLeader(rep.label) : null;
      const rank = rankOffset + index + 1;
      const hasQuota = measured(rep.attainment);
      const formatted = hasQuota ? fmtPercent(rep.attainment) : 'No quota';
      const delta = hasQuota && measured(rep.priorAttainment) ? rep.attainment - rep.priorAttainment : null;
      return <li key={rep.label} className={`ae-chart-row ae-leaderboard-row ae-band-${band(rep.attainment)}`} data-rank={rank}>
        <span className="ae-chart-rank" aria-label={`Rank ${rank}`}>{rank}</span>
        <PerformanceAvatar name={leader?.name || rep.label} photo={leader?.photo} team={pod && !leader}/>
        <div className="ae-chart-identity"><strong>{rep.label}</strong>{pod && <span>{leader?.name || 'Leader not assigned'}</span>}</div>
        <div className="ae-chart-bar" aria-hidden="true"><span style={{ width: `${hasQuota ? Math.max(0, rep.attainment / maximum * 100) : 0}%` }}/><i style={{ left: `${100 / maximum * 100}%` }}/></div>
        <div className="ae-chart-value"><strong>{hasQuota && !pod ? <><span>{formatted.slice(0, -1)}</span><span className="ae-percent-unit">%</span></> : formatted}</strong>{delta !== null && <KpiDelta value={delta}/>}</div>
      </li>;
    })}
  </ol>;
}

export function AeRankingPanel({ role = 'AE', reps, topN, onTopNChange, pod = false, presentation = false, share = false }) {
  const [page, setPage] = useState(0);
  const rows = topN > 0 ? reps.slice(0, topN) : reps;
  const pageCount = presentation ? Math.max(1, Math.ceil(rows.length / 5)) : 1;
  const current = Math.min(page, pageCount - 1);
  const offset = presentation ? current * 5 : 0;
  const visible = presentation ? rows.slice(offset, offset + 5) : rows;
  const maximum = chartMaximum(rows);
  const title = `${role}${pod ? ' POD' : ''} Quota Attainment`;
  useEffect(() => { setPage(0); }, [topN]);
  useEffect(() => {
    if (!share || pageCount <= 1) return undefined;
    const timer = setInterval(() => setPage(value => (value + 1) % pageCount), 15000);
    return () => clearInterval(timer);
  }, [share, pageCount]);
  const panel = <section className={`ae-ranking-panel card${pod ? ' ae-ranking-pods' : ' ae-ranking-reps'}`} aria-label={title}>
    <header><div><h2>{title}</h2><p>{pod ? 'Team results, led by your POD leaders.' : 'Won ARR as a percentage of each rep\u2019s quarter target.'}</p></div>{!presentation && <select className="table-top-select" aria-label={`Number of ${pod ? 'PODs' : 'reps'} to display`} value={topN} onChange={event => onTopNChange(Number(event.target.value))}><option value="5">Top 5</option><option value="10">Top 10</option><option value="20">Top 20</option><option value="0">All</option></select>}{presentation && <span className="ae-panel-count">{rows.length} {pod ? 'PODs' : 'reps'}</span>}</header>
    {!pod && <ChartAxis maximum={maximum}/>}
    <RankingRows rows={visible} pod={pod} rankOffset={offset} maximum={maximum}/>
    <footer><span>{rows.length ? `${offset + 1}\u2013${offset + visible.length} of ${rows.length} ${pod ? 'PODs' : 'reps'}` : 'No ranking available'}</span><span className="ae-target-key"><i/>100% quota</span>{pageCount > 1 && <div className="ae-page-controls" onDoubleClick={event => event.stopPropagation()}><button type="button" aria-label={`Previous ${pod ? 'PODs' : 'reps'}`} onClick={() => setPage((current + pageCount - 1) % pageCount)}>&lsaquo;</button><span>{current + 1} / {pageCount}</span><button type="button" aria-label={`Next ${pod ? 'PODs' : 'reps'}`} onClick={() => setPage((current + 1) % pageCount)}>&rsaquo;</button></div>}</footer>
  </section>;
  return presentation ? <Hideable k={`card:${pod ? 'pod' : 'rep'}-leaderboard`} label={title}>{panel}</Hideable> : panel;
}
