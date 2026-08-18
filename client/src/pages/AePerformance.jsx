import {useEffect,useMemo,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {getAePerformanceSnapshot,getOptions,getDashboardState,saveDashboardState} from '../lib/api';
// No fmtCurrency: this board reports shares and counts, never ARR amounts.
import {MultiSelect,ChartCard,fmtNumber,fmtPercent,ComparisonProvider} from '../components/charts';
import ThemeToggle from '../components/ThemeToggle';
import AppLoader from '../components/AppLoader';
import AdvancedDateRange, {rangeFor,isoDate} from '../components/AdvancedDateRange';
import {useAuth} from '../hooks/useAuth';
import {KpiDelta} from './WinBoard';

const TEMPLATE='ae-performance';
const [DEFAULT_QUARTER_START,DEFAULT_QUARTER_TODAY]=rangeFor('currentQuarter');
// Close date, not created date (unlike Win/Loss Board): a rep's Won ARR
// belongs to the period the deal actually closed in.
const EMPTY={region:[],orgType:[],type:[],
  closeFrom:isoDate(DEFAULT_QUARTER_START),closeTo:isoDate(DEFAULT_QUARTER_TODAY),
  datePreset:'currentQuarter',dateCount:4,dateUnit:'quarter'};
const FILTER_KEYS=Object.keys(EMPTY);
const EMPTY_METRICS={
  overall:{opportunities:0,closed:0,wins:0,losses:0,closedArr:0,wonArr:0,dealWinRate:0,arrWinRate:0,contribution:0},
  reps:[],pods:[],
};

// Two-letter initials for the avatar placeholder — first + last name initial,
// or the first two letters of a single-word name. Stands in for a real photo
// until Slack (or another photo source) is wired up.
function repInitials(name){
  const parts=String(name||'').trim().split(/\s+/).filter(Boolean);
  if(!parts.length)return '?';
  if(parts.length===1)return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0]+parts[parts.length-1][0]).toUpperCase();
}

// Darkened from the shared Win Board palette specifically for white initials
// on top — the original (brighter) hues read below 4.5:1 white-text contrast
// (validated with the data-viz accessibility checker; e.g. #2FAE1D only hit
// 2.9:1). Each hue here clears ≥4.5:1 while staying inside the same lightness
// band and chroma floor the checker requires.
const AVATAR_COLORS=['#1761c7','#a9410c','#007d53','#9a5e00','#b3305e','#258817','#6148c3','#b53737','#50830c'];
function avatarColor(name){
  const hash=Array.from(String(name||'')).reduce((total,character)=>((total*31)+character.charCodeAt(0))|0,0);
  return AVATAR_COLORS[Math.abs(hash)%AVATAR_COLORS.length];
}

const MEDAL_CLASS={1:'gold',2:'silver',3:'bronze'};

// Reused by both the interactive dashboard and the presentation view, and by
// both the rep and POD rankings — the ranked list itself, independent of the
// filter/Top-N chrome around it. showAvatar is off for the POD ranking: an
// initials bubble reads as a person, and a POD is a team.
export function RepLeaderboard({reps=[],comparisons=[],topN=5,showAvatar=true,emptyLabel='No AE-owned won opportunities in the selected scope.'}){
  const comparisonByLabel=useMemo(()=>new Map((comparisons||[]).map(item=>[item.label,item])),[comparisons]);
  const rows=topN>0?reps.slice(0,topN):reps;
  if(!rows.length)return <div className="ae-leaderboard-empty">{emptyLabel}</div>;
  return <div className={showAvatar?'ae-leaderboard':'ae-leaderboard ae-leaderboard-no-avatar'}>
    {rows.map((rep,index)=>{
      const rank=index+1;
      const comparison=comparisonByLabel.get(rep.label);
      const medal=MEDAL_CLASS[rank];
      return <div key={rep.label} className={`ae-leaderboard-row${medal?` ae-rank-${rank}`:''}`}>
        {medal
          ?<span className={`ae-rank-medal ${medal}`} aria-label={`Rank ${rank}`}>{rank}</span>
          :<span className="ae-rank-number" aria-label={`Rank ${rank}`}>{rank}</span>}
        {showAvatar&&<span className="ae-avatar" style={{background:avatarColor(rep.label)}} aria-hidden="true">{repInitials(rep.label)}</span>}
        <span className="ae-leaderboard-name"><strong>{rep.label}</strong></span>
        <span className="ae-leaderboard-value"><strong>{fmtPercent(rep.contribution)}</strong><KpiDelta value={comparison?.changePoints}/></span>
      </div>;
    })}
  </div>;
}

const savedAePerformanceState=()=>{
  try{return JSON.parse(localStorage.getItem(`testmu-dashboard-state-${TEMPLATE}`)||'{}');}
  catch{return {};}
};

export default function AePerformance({user}){
  const navigate=useNavigate();
  const {signOut}=useAuth();
  const [filters,setFilters]=useState(()=>{
    const local=savedAePerformanceState().filters;
    return local?Object.fromEntries(FILTER_KEYS.map(key=>[key,local[key]??EMPTY[key]])):EMPTY;
  });
  const [options,setOptions]=useState({region:[],orgType:[],type:[]});
  const [optionsReady,setOptionsReady]=useState(false);
  const [metrics,setMetrics]=useState(EMPTY_METRICS);
  const [loading,setLoading]=useState(true);
  const [repTopN,setRepTopN]=useState(()=>{
    const v=Number(savedAePerformanceState().tableTops?.rep);
    return [0,5,10,20].includes(v)?v:5;
  });
  const [podTopN,setPodTopN]=useState(()=>{
    const v=Number(savedAePerformanceState().tableTops?.pod);
    return [0,5,10,20].includes(v)?v:5;
  });
  const [hydrated,setHydrated]=useState(false);
  const [comparison,setComparison]=useState({available:false});
  const [loadError,setLoadError]=useState('');
  const [filterPanelOpen,setFilterPanelOpen]=useState(false);

  useEffect(()=>{getDashboardState(TEMPLATE).then(state=>{
    if(state?.filters)setFilters(Object.fromEntries(FILTER_KEYS.map(key=>[key,state.filters[key]??EMPTY[key]])));
    if([0,5,10,20].includes(Number(state?.tableTops?.rep)))setRepTopN(Number(state.tableTops.rep));
    if([0,5,10,20].includes(Number(state?.tableTops?.pod)))setPodTopN(Number(state.tableTops.pod));
  }).finally(()=>setHydrated(true));},[]);
  useEffect(()=>{if(!hydrated)return;const timer=setTimeout(()=>{
    const state={view:'ae-performance',filters,tableTops:{rep:repTopN,pod:podTopN}};
    localStorage.setItem(`testmu-dashboard-state-${TEMPLATE}`,JSON.stringify(state));
    saveDashboardState(TEMPLATE,state).catch(()=>{});
  },500);return()=>clearTimeout(timer);},[filters,repTopN,podTopN,hydrated]);
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setLoadError('');setComparison({available:false});
    getAePerformanceSnapshot(filters).then(snapshot=>{
      if(cancelled)return;
      setMetrics(snapshot.metrics||EMPTY_METRICS);
      setComparison(snapshot.comparison||{available:false});
    }).catch(error=>{
      if(cancelled)return;
      setMetrics(EMPTY_METRICS);setComparison({available:false});
      setLoadError(error.response?.data?.error||error.message||'Could not load AE Performance data');
    }).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[filters]);
  useEffect(()=>{let cancelled=false;getOptions(TEMPLATE).then(value=>{
    if(!cancelled){setOptions(value);setOptionsReady(true);}
  }).catch(()=>{if(!cancelled)setOptionsReady(true);});return()=>{cancelled=true;};},[]);
  useEffect(()=>{if(!optionsReady)return;setFilters(current=>{
    let changed=false;const next={...current};
    for(const key of ['region','orgType','type']){
      const valid=new Set(options[key]||[]);
      const selected=(current[key]||[]).filter(value=>valid.has(value));
      if(selected.length!==(current[key]||[]).length){next[key]=selected;changed=true;}
    }
    return changed?next:current;
  });},[options,optionsReady]);

  // Defaulted rather than destructured bare: a server process started before
  // the POD ranking shipped returns metrics with no `pods` key at all, which
  // replaces EMPTY_METRICS wholesale and would crash on pods.length.
  const {overall}=metrics;
  const reps=metrics.reps||[];
  const pods=metrics.pods||[];
  const groupComparisons=comparison.groups||{};

  if(loading&&!reps.length&&!loadError)return <AppLoader fullscreen label="Loading AE Performance…"/>;
  const filterDefs=[['region','Region'],['orgType','Org type'],['type','Opp type']];
  const dateChangedFromDefault=filters.datePreset!==EMPTY.datePreset||filters.closeFrom!==EMPTY.closeFrom||filters.closeTo!==EMPTY.closeTo;
  const activeFilterCount=filterDefs.reduce((total,[key])=>{
    const selected=filters[key]||[];
    const optionCount=(options[key]||[]).length;
    const isActive=selected.length>0&&selected.length!==optionCount;
    return total+(isActive?1:0);
  },0)+(dateChangedFromDefault?1:0);
  const hasAnyTouchedFilter=activeFilterCount>0||filterDefs.some(([key])=>(filters[key]||[]).length>0);
  const updateFilter=(key,value)=>setFilters(current=>({...current,[key]:value}));
  const startPresentation=()=>{
    const config={filters,repTopN,podTopN};
    localStorage.setItem('testmu-aeperformance-presentation-config',JSON.stringify(config));
    saveDashboardState(TEMPLATE,{view:'ae-performance',filters,tableTops:{rep:repTopN,pod:podTopN},
      presentationSettings:{view:'ae-performance'}}).catch(()=>{});
    window.open('/present/ae-performance','_blank','noopener');
  };

  return <ComparisonProvider value={comparison}><div className="wrap win-board-wrap"><div className="top-nav" style={{margin:'-18px -18px 18px'}}>
    <div className="brand" onClick={()=>navigate('/gallery')} style={{cursor:'pointer'}}><img className="brand-logo" src="/testmu-bi-logo-v2.png" alt="TestMu BI"/><span>TestMu BI</span></div>
    <div className="user-pill"><ThemeToggle/><span>{user?.name||'User'}</span><button className="btn-secondary" onClick={signOut}>Sign out</button></div></div>
    <header className="top"><div className="top-row"><div><h1>AE Performance</h1><div className="sub">Ranks AE reps by share of Won ARR. <strong>Owned by an AE-prefixed role only.</strong></div></div>
      <button type="button" className="present-button" onClick={startPresentation}>▶ Present</button></div>
      <div className="filters win-board-filter-shelf">{filterDefs.map(([key,label])=><MultiSelect key={key} label={label} options={options[key]||[]} value={filters[key]} onChange={value=>updateFilter(key,value)}/>) }
        <AdvancedDateRange filters={filters} setFilters={setFilters} fromKey="closeFrom" toKey="closeTo"
          label="Opportunity close date" title="Opp Close Date" emptyLabel="All close dates"/>
        <button className="btn-secondary filter-reset-button" onClick={()=>setFilters(EMPTY)}>Reset</button></div></header>

    {!loading && (loadError || !overall.wins) ? <div className="card win-board-empty">
      <div className="win-board-empty-icon">↻</div><div><h3>{loadError ? 'AE Performance could not load' : 'No AE Performance data is loaded'}</h3>
        <p>{loadError || 'Connect a data source to AE Performance from Data Sources, and make sure its field mapping includes Owner, Owner role (Role Name) and POD.'}</p></div>
      <button type="button" className="btn-primary" onClick={()=>navigate('/data-sources')}>Open data sources</button>
    </div> : <>
      {/* Both rankings divide the same total AE Won ARR, so a rep's % and
          their POD's % are read off one denominator and each list sums to 100. */}
      <div className="g2">
        <ChartCard className="ae-performance-card" showComparison={false} title="AE Top Performer" hint={`Contribution % of total AE Won ARR — ${fmtNumber(overall.wins)} won opportunities across ${reps.length} rep${reps.length===1?'':'s'}.`}
          controls={<select className="table-top-select" aria-label="Number of reps to display" value={repTopN} onChange={event=>setRepTopN(Number(event.target.value))}><option value="5">Top 5</option><option value="10">Top 10</option><option value="20">Top 20</option><option value="0">All</option></select>}>
          <RepLeaderboard reps={reps} comparisons={groupComparisons.reps} topN={repTopN}/>
        </ChartCard>
        <ChartCard className="ae-performance-card" showComparison={false} title="AE POD Performance Ranking" hint={`The same Won ARR contribution, grouped by POD instead of by rep — ${pods.length} POD${pods.length===1?'':'s'}. Same POD field the Win and Loss boards use.`}
          controls={<select className="table-top-select" aria-label="Number of PODs to display" value={podTopN} onChange={event=>setPodTopN(Number(event.target.value))}><option value="5">Top 5</option><option value="10">Top 10</option><option value="20">Top 20</option><option value="0">All</option></select>}>
          <RepLeaderboard reps={pods} comparisons={groupComparisons.pods} topN={podTopN} showAvatar={false}
            emptyLabel="No AE-owned won opportunities in the selected scope."/>
        </ChartCard>
      </div>
    </>}

    <button type="button" className="floating-filter-button" aria-label="Open AE Performance filters" title="AE Performance filters" onClick={()=>setFilterPanelOpen(open=>!open)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="13" cy="18" r="2"/></svg>
      {activeFilterCount>0
        ?<span className="floating-filter-badge">{activeFilterCount}</span>
        :hasAnyTouchedFilter&&<span className="floating-filter-badge floating-filter-badge-dot" aria-label="Filters set to All"/>}
    </button>

    {filterPanelOpen&&<aside className="floating-filter-panel" aria-label="AE Performance filters">
      <div className="floating-filter-head"><div><b>AE Performance filters</b><span>{fmtNumber(overall.opportunities)} opportunities</span></div>
        <button type="button" aria-label="Close filters" onClick={()=>setFilterPanelOpen(false)}>×</button></div>
      <div className="floating-filter-controls">{filterDefs.map(([key,label])=><MultiSelect key={key} label={label} options={options[key]||[]} value={filters[key]} onChange={value=>updateFilter(key,value)}/>)}
        <AdvancedDateRange filters={filters} setFilters={setFilters} fromKey="closeFrom" toKey="closeTo"
          label="Opportunity close date" title="Opp Close Date" emptyLabel="All close dates"/></div>
      <button className="floating-filter-reset" type="button" onClick={()=>setFilters(EMPTY)}>Reset all filters</button>
    </aside>}
  </div></ComparisonProvider>;
}
