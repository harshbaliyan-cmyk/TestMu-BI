import {useEffect,useId,useMemo,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {getLossBoardSnapshot,getOptions,getDashboardState,saveDashboardState} from '../lib/api';
import {MultiSelect,ChartCard,fmtNumber,fmtPercent,ComparisonProvider} from '../components/charts';
import ThemeToggle from '../components/ThemeToggle';
import DashboardSwitcher from '../components/DashboardSwitcher';
import { Hideable } from '../components/Hideable';
import AppLoader from '../components/AppLoader';
import AdvancedDateRange, {rangeFor,isoDate} from '../components/AdvancedDateRange';
import {useAuth} from '../hooks/useAuth';
import {
  PERCENTAGE_VIEWS, percentageView, sortMetricRows, KpiDelta, shortDate,
  TrendChart, RankFunnel, PercentChart, OrgTypeFillBars, PodRadialScorecards,
} from './WinBoard';

const TEMPLATE='loss-board';
const [DEFAULT_QUARTER_START,DEFAULT_QUARTER_TODAY]=rangeFor('currentQuarter');
const EMPTY={region:[],orgType:[],industry:[],type:[],
  createdFrom:isoDate(DEFAULT_QUARTER_START),createdTo:isoDate(DEFAULT_QUARTER_TODAY),
  datePreset:'currentQuarter',dateCount:4,dateUnit:'quarter'};
const FILTER_KEYS=Object.keys(EMPTY);
export const DEFAULT_PERCENTAGE_VIEW='lossContribution';
// The three Loss Board views, in display order — a subset of the shared
// PERCENTAGE_VIEWS map in WinBoard.jsx (which also holds Win Board's three).
export const LOSS_VIEW_KEYS=['lossOppRate','arrLostRate','lossContribution'];
const EMPTY_METRICS={
  overall:{opportunities:0,open:0,lostArr:0,closedArr:0,totalArr:0,openArr:0,closed:0,wins:0,losses:0,
    arrLostRate:0,lossOppRate:0,lossOppRateOfAll:0,openArrPct:0,openOppRate:0,lossContribution:0,
    lostAfterTrial:{count:0,trialClosedCount:0,rate:0}},
  trend:{monthly:[],quarterly:[]},trendYear:null,pods:[],orgTypes:[],lossReasons:[],
};

function LossPercentageViewSelect({value,onChange}){
  const selected=percentageView(value);
  const id=useId();
  return <div className="fg percentage-view-field">
    <label htmlFor={id}>Display charts by</label>
    <select id={id} value={value} onChange={event=>onChange(event.target.value)} title={selected.formula}>
      {LOSS_VIEW_KEYS.map(key=><option value={key} key={key}>{PERCENTAGE_VIEWS[key].label}</option>)}
    </select>
  </div>;
}

// Genuinely new — no Win Board equivalent. COUNTD(IF NOT ISNULL([Trial Stage
// At]) AND [Opp Stage] = "Closed Lost" THEN [Opp Id] END), and its rate
// against every closed opportunity that also reached a trial (not against
// all lost deals — a deal that never trialed can't be "lost after trial").
export function LostAfterTrialCard({stat,changePoints}){
  const rate=Math.max(0,Math.min(100,Number(stat?.rate)||0));
  return <div className="lost-after-trial-card">
    <div className="lost-after-trial-ring" style={{'--trial-value':`${rate*3.6}deg`}}>
      <div className="lost-after-trial-center"><strong>{fmtPercent(rate)}</strong><span>Lost after trial</span></div>
    </div>
    <div className="lost-after-trial-detail">
      <div className="lost-after-trial-stat"><b>{fmtNumber(stat?.count)}</b><span>Opportunities lost after reaching a trial</span></div>
      <div className="lost-after-trial-stat"><b>{fmtNumber(stat?.trialClosedCount)}</b><span>Closed opportunities that reached a trial</span></div>
      <KpiDelta value={changePoints} lowerIsBetter/>
    </div>
  </div>;
}

// Extracted so the presentation layer can show the exact same KPI strip
// (all five tiles) rather than a separate, simplified subset.
export function LossRateSummary({overall,comparison}){
  return <section className="win-rate-summary" aria-labelledby="loss-rate-summary-title">
    <div className="win-rate-summary-head"><span id="loss-rate-summary-title">Loss-rate summary</span><small>Selected opportunity scope</small></div>
    {comparison.available&&comparison.period&&<div className="win-rate-summary-period">
      Comparing <b>{shortDate(comparison.period.currentFrom)} – {shortDate(comparison.period.currentTo)}</b> against the previous period <b>{shortDate(comparison.period.previousFrom)} – {shortDate(comparison.period.previousTo)}</b>
    </div>}
    <div className="win-rate-summary-metrics">
      <Hideable k="kpi:arr-lost-rate" label="ARR lost rate"><div className="win-rate-summary-metric arr-rate"><span>ARR lost rate</span><strong>{fmtPercent(overall.arrLostRate)}</strong><small>Lost ARR ÷ Closed ARR</small><KpiDelta value={comparison.arrLostRatePointChange} lowerIsBetter/></div></Hideable>
      <Hideable k="kpi:opportunity-loss-rate" label="Opportunity loss rate"><div className="win-rate-summary-metric deal-rate"><span>Opportunity loss rate</span><strong>{fmtPercent(overall.lossOppRateOfAll)}</strong><small>Lost ÷ all opportunities, open + closed</small><KpiDelta value={comparison.lossOppRateOfAllPointChange} lowerIsBetter/></div></Hideable>
      <Hideable k="kpi:open-opportunity-rate" label="Open opportunity %"><div className="win-rate-summary-metric open-opp-rate"><span>Open opportunity %</span><strong>{fmtPercent(overall.openOppRate)}</strong><small>Open ÷ all opportunities, by count</small></div></Hideable>
      <Hideable k="kpi:opportunity-counts" label="Opportunities"><div className="win-rate-summary-counts"><span>Opportunities</span>
        <div className="win-rate-summary-counts-grid">
          <div className="count-total"><b>{fmtNumber(overall.opportunities)}</b><small>Total</small></div>
          <div className="count-open"><b>{fmtNumber(overall.open)}</b><small>Open</small></div>
          <div className="count-closed"><b>{fmtNumber(overall.closed)}</b><small>Closed</small></div>
          <div className="count-won"><b>{fmtNumber(overall.wins)}</b><small>Won</small></div>
          <div className="count-lost"><b>{fmtNumber(overall.losses)}</b><small>Lost</small></div>
        </div>
      </div></Hideable>
      <Hideable k="kpi:open-arr-rate" label="Open ARR %"><div className="win-rate-summary-metric open-arr-rate"><span>Open ARR %</span><strong>{fmtPercent(overall.openArrPct)}</strong><small>Open ARR ÷ Total ARR</small></div></Hideable>
    </div>
  </section>;
}

const savedLossBoardState=()=>{
  try{return JSON.parse(localStorage.getItem(`testmu-dashboard-state-${TEMPLATE}`)||'{}');}
  catch{return {};}
};

export default function LossBoard({user}){
  const navigate=useNavigate();
  const {signOut}=useAuth();
  const [filters,setFilters]=useState(()=>{
    const local=savedLossBoardState().filters;
    return local?Object.fromEntries(FILTER_KEYS.map(key=>[key,local[key]??EMPTY[key]])):EMPTY;
  });
  const [options,setOptions]=useState({region:[],orgType:[],industry:[],type:[]});
  const [optionsReady,setOptionsReady]=useState(false);
  const [metrics,setMetrics]=useState(EMPTY_METRICS);
  const [loading,setLoading]=useState(true);
  const [reasonTopN,setReasonTopN]=useState(()=>{
    const v=Number(savedLossBoardState().tableTops?.lossReason);
    return Number.isFinite(v)?v:5;
  });
  const [podTopN,setPodTopN]=useState(()=>{
    const v=Number(savedLossBoardState().tableTops?.pod);
    return [0,5,10,20].includes(v)?v:5;
  });
  const [hydrated,setHydrated]=useState(false);
  const [comparison,setComparison]=useState({available:false});
  const [loadError,setLoadError]=useState('');
  const [filterPanelOpen,setFilterPanelOpen]=useState(false);
  const [percentageMetric,setPercentageMetric]=useState(()=>{
    const v=savedLossBoardState().tableSorting?.percentageMetric;
    return LOSS_VIEW_KEYS.includes(v)?v:DEFAULT_PERCENTAGE_VIEW;
  });

  useEffect(()=>{getDashboardState(TEMPLATE).then(state=>{
    if(state?.filters)setFilters(Object.fromEntries(FILTER_KEYS.map(key=>[key,state.filters[key]??EMPTY[key]])));
    if(Number.isFinite(Number(state?.tableTops?.lossReason)))setReasonTopN(Number(state.tableTops.lossReason));
    if([0,5,10,20].includes(Number(state?.tableTops?.pod)))setPodTopN(Number(state.tableTops.pod));
    if(LOSS_VIEW_KEYS.includes(state?.tableSorting?.percentageMetric))setPercentageMetric(state.tableSorting.percentageMetric);
  }).finally(()=>setHydrated(true));},[]);
  useEffect(()=>{if(!hydrated)return;const timer=setTimeout(()=>{
    const state={view:'loss-board',filters,tableTops:{lossReason:reasonTopN,pod:podTopN},tableSorting:{percentageMetric}};
    localStorage.setItem(`testmu-dashboard-state-${TEMPLATE}`,JSON.stringify(state));
    saveDashboardState(TEMPLATE,state).catch(()=>{});
  },500);return()=>clearTimeout(timer);},[filters,reasonTopN,podTopN,percentageMetric,hydrated]);
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setLoadError('');setComparison({available:false});
    getLossBoardSnapshot(filters).then(snapshot=>{
      if(cancelled)return;
      setMetrics(snapshot.metrics||EMPTY_METRICS);
      setComparison(snapshot.comparison||{available:false});
    }).catch(error=>{
      if(cancelled)return;
      setMetrics(EMPTY_METRICS);setComparison({available:false});
      setLoadError(error.response?.data?.error||error.message||'Could not load Loss Board data');
    }).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[filters]);
  useEffect(()=>{let cancelled=false;getOptions(TEMPLATE).then(value=>{
    if(!cancelled){setOptions(value);setOptionsReady(true);}
  }).catch(()=>{if(!cancelled)setOptionsReady(true);});return()=>{cancelled=true;};},[]);
  useEffect(()=>{if(!optionsReady)return;setFilters(current=>{
    let changed=false;const next={...current};
    for(const key of ['region','orgType','industry','type']){
      const valid=new Set(options[key]||[]);
      const selected=(current[key]||[]).filter(value=>valid.has(value));
      if(selected.length!==(current[key]||[]).length){next[key]=selected;changed=true;}
    }
    return changed?next:current;
  });},[options,optionsReady]);

  const {overall,orgTypes,pods}=metrics;
  const groupComparisons=comparison.groups||{};
  const percentageDefinition=percentageView(percentageMetric);
  const rankedReasons=useMemo(()=>sortMetricRows(metrics.lossReasons||[],percentageMetric,'desc'),[metrics.lossReasons,percentageMetric]);
  const lossReasons=reasonTopN>0?rankedReasons.slice(0,reasonTopN):rankedReasons;

  if(loading&&!metrics.trend.monthly.length)return <AppLoader fullscreen label="Loading Loss Board…"/>;
  const filterDefs=[['region','Region'],['orgType','Org type'],['industry','Industry'],['type','Opp type']];
  // One filter narrowing the data down counts as one, regardless of how many
  // values it has selected — and a filter with every one of its options
  // selected counts as zero, same as none selected, since neither narrows
  // anything down. The date range follows the same rule: it always holds a
  // value (defaults to the current quarter), so it only counts once it's
  // been changed away from that default, not merely because it's populated.
  const dateChangedFromDefault=filters.datePreset!==EMPTY.datePreset||filters.createdFrom!==EMPTY.createdFrom||filters.createdTo!==EMPTY.createdTo;
  const activeFilterCount=filterDefs.reduce((total,[key])=>{
    const selected=filters[key]||[];
    const optionCount=(options[key]||[]).length;
    const isActive=selected.length>0&&selected.length!==optionCount;
    return total+(isActive?1:0);
  },0)+(dateChangedFromDefault?1:0);
  // A filter set to "All" is still a deliberate, non-default state — just
  // not one that narrows the data — so it earns a plain dot on the icon
  // instead of inflating the number with its (often large) option count.
  const hasAnyTouchedFilter=activeFilterCount>0||filterDefs.some(([key])=>(filters[key]||[]).length>0);
  const updateFilter=(key,value)=>setFilters(current=>({...current,[key]:value}));
  const startPresentation=()=>{
    const config={filters,percentageMetric,reasonTopN,podTopN};
    localStorage.setItem('testmu-lossboard-presentation-config',JSON.stringify(config));
    saveDashboardState(TEMPLATE,{view:'loss-board',filters,tableTops:{lossReason:reasonTopN,pod:podTopN},
      tableSorting:{percentageMetric},presentationSettings:{view:'loss-board'}}).catch(()=>{});
    window.open('/present/loss-board','_blank','noopener');
  };

  return <ComparisonProvider value={comparison}><div className="wrap win-board-wrap"><div className="top-nav" style={{margin:'-18px -18px 18px'}}>
    <div className="brand" onClick={()=>navigate('/gallery')} style={{cursor:'pointer'}}><img className="brand-logo" src="/testmu-bi-logo-v2.png" alt="TestMu BI"/><span>TestMu BI</span></div>
    <div className="user-pill"><ThemeToggle/><DashboardSwitcher/><span>{user?.name||'User'}</span><button className="btn-secondary" onClick={signOut}>Sign out</button></div></div>
    <header className="top"><div className="top-row"><div><h1>Loss Board</h1><div className="sub">Where business is being lost. Lost ARR is the primary measure; opportunity loss rate is supporting context.</div>
      {/* Mirrors the Win Board note, against Lost ARR — the two boards use the
          same word for the same shape of calculation on opposite outcomes. */}
      {/* Mirrors the Win Board note against Lost ARR, with a loss reason as the
          example since that is the chart people read first on this board. */}
      <div className="metric-definition">
        <b>Loss ARR contribution %</b> — how much of the total Lost ARR each loss reason, POD or org type accounts for.
        <span className="metric-definition-example">Example: a reason showing <b>18%</b> accounts for <b>$18 of every $100</b> of Lost ARR on screen. It does <b>not</b> mean 18% of those deals were lost.</span>
        <span className="metric-definition-note">Every slice on a chart adds up to 100%.</span>
      </div></div>
      <button type="button" className="present-button" onClick={startPresentation}>▶ Present</button></div>
      <div className="filters win-board-filter-shelf">{filterDefs.map(([key,label])=><MultiSelect key={key} label={label} options={options[key]||[]} value={filters[key]} onChange={value=>updateFilter(key,value)}/>) }
        <LossPercentageViewSelect value={percentageMetric} onChange={setPercentageMetric}/>
        <AdvancedDateRange filters={filters} setFilters={setFilters}/>
        <button className="btn-secondary filter-reset-button" onClick={()=>setFilters(EMPTY)}>Reset</button></div></header>

    {!loading && (loadError || !overall.opportunities) ? <div className="card win-board-empty">
      <div className="win-board-empty-icon">↻</div><div><h3>{loadError ? 'Loss Board could not load' : 'No Loss Board data is loaded'}</h3>
        <p>{loadError || 'Refresh the connected Tableau source or load the mapped source again. Uploaded business rows are kept only in the current server session.'}</p></div>
      <button type="button" className="btn-primary" onClick={()=>navigate('/data-sources')}>Open data sources</button>
    </div> : <>
      <LossRateSummary overall={overall} comparison={comparison}/>

      <div className="g2">
        <ChartCard showComparison={false} title="Lost after trial" hint="Of the closed opportunities that reached a trial, the share that were lost — the deals a trial didn't save.">
          <LostAfterTrialCard stat={overall.lostAfterTrial} changePoints={comparison.lostAfterTrialRatePointChange}/>
        </ChartCard>
        <ChartCard showComparison={false} title={`${percentageDefinition.label} trend`} hint={`Tracks ${percentageDefinition.plain} across ${metrics.trendYear||'the'} year, month by month or quarter by quarter — compared with ${comparison.previousTrendYear||'the prior year'}.`}>
          <TrendChart trend={metrics.trend} previousTrend={comparison.previousTrend} metric={percentageMetric} year={metrics.trendYear} previousYear={comparison.previousTrendYear}/>
        </ChartCard>
      </div>
      <div className="g2">
        <ChartCard showComparison={false} title={`Top loss reasons by ${percentageDefinition.label}`} hint={`The reasons behind the highest ${percentageDefinition.plain}, ranked highest first.`}
          controls={<select className="table-top-select" value={reasonTopN} onChange={event=>setReasonTopN(Number(event.target.value))}><option value="5">Top 5</option><option value="10">Top 10</option><option value="20">Top 20</option><option value="0">All</option></select>}>
          {reasonTopN===5
            ?<RankFunnel items={lossReasons} comparisons={groupComparisons.lossReasons} metric={percentageMetric} dimension="loss reason" dimensionLabel="Loss reason" dimensionPlural="loss reasons"/>
            :<PercentChart items={lossReasons} comparisons={groupComparisons.lossReasons} metric={percentageMetric} label={percentageDefinition.shortLabel} heading="Loss reason performance"/>}
        </ChartCard>
        <ChartCard showComparison={false} title={`${percentageDefinition.label} by org type`} hint={`Shows ${percentageDefinition.plain}, broken down by org type. The small circle marks where it stood last period.`}>
          <OrgTypeFillBars items={orgTypes} comparisons={groupComparisons.orgTypes} metric={percentageMetric}/>
        </ChartCard>
      </div>
      <ChartCard showComparison={false} title={`${percentageDefinition.label} by POD`} hint={`Shows ${percentageDefinition.plain}, broken down by POD. The ring is this period; the dot marks last period.`}
        controls={<select className="table-top-select" aria-label="Number of PODs to display" value={podTopN} onChange={event=>setPodTopN(Number(event.target.value))}><option value="5">Top 5</option><option value="10">Top 10</option><option value="20">Top 20</option><option value="0">All</option></select>}>
        <PodRadialScorecards items={pods} comparisons={groupComparisons.pods} metric={percentageMetric} topN={podTopN}/>
      </ChartCard>
    </>}

    <button type="button" className="floating-filter-button" aria-label="Open Loss Board filters" title="Loss Board filters" onClick={()=>setFilterPanelOpen(open=>!open)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="13" cy="18" r="2"/></svg>
      {activeFilterCount>0
        ?<span className="floating-filter-badge">{activeFilterCount}</span>
        :hasAnyTouchedFilter&&<span className="floating-filter-badge floating-filter-badge-dot" aria-label="Filters set to All"/>}
    </button>

    {filterPanelOpen&&<aside className="floating-filter-panel" aria-label="Loss Board filters">
      <div className="floating-filter-head"><div><b>Loss Board filters</b><span>{fmtNumber(overall.opportunities)} opportunities</span></div>
        <button type="button" aria-label="Close filters" onClick={()=>setFilterPanelOpen(false)}>×</button></div>
      <div className="floating-filter-controls">{filterDefs.map(([key,label])=><MultiSelect key={key} label={label} options={options[key]||[]} value={filters[key]} onChange={value=>updateFilter(key,value)}/>)}
        <LossPercentageViewSelect value={percentageMetric} onChange={setPercentageMetric}/>
        <AdvancedDateRange filters={filters} setFilters={setFilters}/></div>
      <button className="floating-filter-reset" type="button" onClick={()=>setFilters(EMPTY)}>Reset all filters</button>
    </aside>}
  </div></ComparisonProvider>;
}
