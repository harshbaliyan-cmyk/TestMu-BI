import {useEffect,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {getAmPerformanceSnapshot,getOptions,getDashboardState,saveDashboardState} from '../lib/api';
// No fmtCurrency: this board reports shares and counts, never ARR amounts.
import {MultiSelect,fmtNumber,ComparisonProvider} from '../components/charts';
import RefreshDataButton from '../components/RefreshDataButton';
import AppLoader from '../components/AppLoader';
import AdvancedDateRange,{rangeFor,isoDate,refreshPreset} from '../components/AdvancedDateRange';
import { AeQuarterPanel, AeDistribution, AeRankingPanel } from '../components/AePerformanceUI';

const TEMPLATE='am-performance';
const [DEFAULT_QUARTER_START,DEFAULT_QUARTER_TODAY]=rangeFor('currentQuarter');
// Close date, not created date (unlike Win/Loss Board): a rep's Won ARR
// belongs to the period the deal actually closed in.
// repStatus defaults to 'active': the board opens showing current reps only.
const EMPTY={region:[],orgType:[],type:[],repStatus:'active',
  closeFrom:isoDate(DEFAULT_QUARTER_START),closeTo:isoDate(DEFAULT_QUARTER_TODAY),
  datePreset:'currentQuarter',dateCount:4,dateUnit:'quarter'};
const FILTER_KEYS=Object.keys(EMPTY);
const EMPTY_METRICS={
  overall:{opportunities:0,closed:0,wins:0,losses:0,closedArr:0,wonArr:0,dealWinRate:0,arrWinRate:0,contribution:0},
  reps:[],pods:[],
};


const savedAmPerformanceState=()=>{
  try{return JSON.parse(localStorage.getItem(`testmu-dashboard-state-${TEMPLATE}`)||'{}');}
  catch{return {};}
};

export default function AmPerformance({user}){
  const navigate=useNavigate();
  const [filters,setFilters]=useState(()=>{
    const local=savedAmPerformanceState().filters;
    return local?refreshPreset(Object.fromEntries(FILTER_KEYS.map(key=>[key,local[key]??EMPTY[key]])),'closeFrom','closeTo'):EMPTY;
  });
  const [options,setOptions]=useState({region:[],orgType:[],type:[]});
  const [optionsReady,setOptionsReady]=useState(false);
  const [metrics,setMetrics]=useState(EMPTY_METRICS);
  const [quota,setQuota]=useState(null);
  const [quotaMetrics,setQuotaMetrics]=useState(EMPTY_METRICS);
  const [loading,setLoading]=useState(true);
  const [repTopN,setRepTopN]=useState(()=>{
    const v=Number(savedAmPerformanceState().tableTops?.rep);
    return [0,5,10,20].includes(v)?v:5;
  });
  const [podTopN,setPodTopN]=useState(()=>{
    const v=Number(savedAmPerformanceState().tableTops?.pod);
    return [0,5,10,20].includes(v)?v:5;
  });
  const [hydrated,setHydrated]=useState(false);
  const [comparison,setComparison]=useState({available:false});
  const [loadError,setLoadError]=useState('');
  const [filterPanelOpen,setFilterPanelOpen]=useState(false);

  useEffect(()=>{getDashboardState(TEMPLATE).then(state=>{
    if(state?.filters)setFilters(refreshPreset(Object.fromEntries(FILTER_KEYS.map(key=>[key,state.filters[key]??EMPTY[key]])),'closeFrom','closeTo'));
    if([0,5,10,20].includes(Number(state?.tableTops?.rep)))setRepTopN(Number(state.tableTops.rep));
    if([0,5,10,20].includes(Number(state?.tableTops?.pod)))setPodTopN(Number(state.tableTops.pod));
  }).catch(()=>{}).finally(()=>setHydrated(true));},[]);
  useEffect(()=>{if(!hydrated)return;const timer=setTimeout(()=>{
    const state={view:'am-performance',filters,tableTops:{rep:repTopN,pod:podTopN}};
    localStorage.setItem(`testmu-dashboard-state-${TEMPLATE}`,JSON.stringify(state));
    saveDashboardState(TEMPLATE,state).catch(()=>{});
  },500);return()=>clearTimeout(timer);},[filters,repTopN,podTopN,hydrated]);
  // Bumped by the header's Refresh-data button after a source re-pull, so
  // the snapshot refetches without pretending the filters changed.
  const [reloadTick,setReloadTick]=useState(0);
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setLoadError('');setComparison({available:false});
    getAmPerformanceSnapshot(filters).then(snapshot=>{
      if(cancelled)return;
      setMetrics(snapshot.metrics||EMPTY_METRICS);
      setQuota(snapshot.quota||null);
      setQuotaMetrics(snapshot.quotaMetrics||EMPTY_METRICS);
      setComparison(snapshot.comparison||{available:false});
    }).catch(error=>{
      if(cancelled)return;
      setMetrics(EMPTY_METRICS);setQuota(null);setQuotaMetrics(EMPTY_METRICS);setComparison({available:false});
      setLoadError(error.response?.data?.error||error.message||'Could not load AM Performance data');
    }).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[filters,reloadTick]);
  useEffect(()=>{let cancelled=false;getOptions(TEMPLATE).then(value=>{
    if(!cancelled){setOptions(value);setOptionsReady(true);}
  }).catch(()=>{if(!cancelled)setOptionsReady(true);});return()=>{cancelled=true;};},[]);
  useEffect(()=>{if(!optionsReady)return;setFilters(current=>{
    let changed=false;const next={...current};
    for(const key of ['region','orgType','type']){
      // An empty list is "no options known" (request failed, rows not loaded
      // yet after a restart), not "nothing is valid": pruning against it
      // erased the saved selection and the autosave made that permanent.
      if(!(options[key]||[]).length)continue;
      const valid=new Set(options[key]);
      const selected=(current[key]||[]).filter(value=>valid.has(value));
      if(selected.length!==(current[key]||[]).length){next[key]=selected;changed=true;}
    }
    return changed?next:current;
  });},[options,optionsReady]);

  // Defaulted rather than destructured bare: a server process started before
  // the POD ranking shipped returns metrics with no `pods` key at all, which
  // replaces EMPTY_METRICS wholesale and would crash on pods.length.
  const {overall}=metrics;
  // Loaded-ness is whether any option list came back, not whether the
  // current date slice has wins: a week with no closed deals used to hide
  // the whole board behind "connect a data source".
  const hasSource=['region','orgType','type'].some(key=>(options[key]||[]).length>0);
  // The ranking reads from quotaMetrics, which is built from the whole quarter
  // rather than the date-filtered slice. metrics still drives the pipeline
  // counts in the filter panel, which SHOULD follow the picker.
  const reps=quotaMetrics.reps||[];
  const pods=quotaMetrics.pods||[];
  const quotaMapped=quota?.mapped;
  const measured=reps.filter(rep=>rep.attainment!==null&&rep.attainment!==undefined);
  const atOrAbove=measured.filter(rep=>rep.attainment>=100).length;
  const teamQuota=measured.reduce((total,rep)=>total+(rep.quota||0),0);
  const teamWon=measured.reduce((total,rep)=>total+(rep.quotaWonArr||0),0);
  const teamAttainment=teamQuota?teamWon/teamQuota*100:null;
  const priorMeasured=reps.filter(rep=>rep.priorAttainment!==null&&rep.priorAttainment!==undefined);
  const priorTeamQuota=priorMeasured.reduce((total,rep)=>total+(rep.priorQuota||0),0);
  const priorTeamWon=priorMeasured.reduce((total,rep)=>total+(rep.priorWonArr||0),0);
  const priorTeamAttainment=priorTeamQuota?priorTeamWon/priorTeamQuota*100:null;

  if(loading&&!reps.length&&!loadError)return <AppLoader fullscreen label="Loading AM Performance…"/>;
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
    localStorage.setItem('testmu-amperformance-presentation-config',JSON.stringify(config));
    saveDashboardState(TEMPLATE,{view:'am-performance',filters,tableTops:{rep:repTopN,pod:podTopN},
      presentationSettings:{view:'am-performance'}}).catch(()=>{});
    window.open('/present/am-performance','_blank','noopener');
  };

  return <ComparisonProvider value={comparison}><div className="wrap win-board-wrap db-page db-reps performance-dashboard ae-studio am-studio"><header className="top"><div className="top-row"><div><h1>AM Performance</h1><div className="sub">Your quarter, your people, and the path to quota.</div><details className="perf-scope-details"><summary>What this board includes</summary><p>AM-owned opportunities only. Opportunity types: New Business, New Business AM, and Existing Business - Up-sell. Quota rankings cover the full current quarter.</p></details></div>
      <div className="db-header-actions"><RefreshDataButton templateId={TEMPLATE} onRefreshed={()=>setReloadTick(tick=>tick+1)}/><button type="button" className="present-button" onClick={startPresentation}>▶ Present</button></div></div>
      <div className="filters win-board-filter-shelf">{filterDefs.map(([key,label])=><MultiSelect key={key} label={label} options={options[key]||[]} value={filters[key]} onChange={value=>updateFilter(key,value)}/>) }
        <AdvancedDateRange filters={filters} setFilters={setFilters} fromKey="closeFrom" toKey="closeTo"
          label="Opportunity close date" title="Opp Close Date" emptyLabel="All close dates"/>
        <label className="fg rep-status-filter"><span>Rep status</span>
          <select value={filters.repStatus||'active'} onChange={event=>updateFilter('repStatus',event.target.value)}
            title="Departed reps are hidden from this ranking, and their quota leaves the POD target with them. Their closed ARR still counts towards team totals and win rates.">
            <option value="active">Active reps only</option>
            <option value="all">Include departed reps</option>
          </select></label>
        <button className="btn-secondary filter-reset-button" onClick={()=>setFilters(EMPTY)}>Reset</button></div></header>

    {!loading && (loadError || (!overall.wins && !hasSource)) ? <div className="card win-board-empty">
      <div className="win-board-empty-icon">↻</div><div><h3>{loadError ? 'AM Performance could not load' : 'No AM Performance data is loaded'}</h3>
        <p>{loadError || 'Connect a data source to AM Performance from Data Sources, and make sure its field mapping includes Owner, Owner role (Role Name) and POD.'}</p></div>
      <button type="button" className="btn-primary" onClick={()=>navigate('/data-sources')}>Open data sources</button>
    </div> : <>
      {quotaMetrics.repStatus?.likelyUnmapped&&<div className="card ae-quota-mismatch" role="alert">
        <b>Rep status is not mapped</b>
        <p>No rep is flagged active, so the <b>Rep status</b> filter has nothing to act on and every rep is being shown.
          Map the <b>Rep is active</b> field on the data source to hide departed reps from this ranking.</p>
        <button type="button" className="btn-secondary" onClick={()=>navigate('/data-sources')}>Open data sources</button>
      </div>}
      {quotaMetrics.repsHidden>0&&<p className="ae-reps-hidden">
        {quotaMetrics.repsHidden} departed rep{quotaMetrics.repsHidden===1?' is':'s are'} hidden from this ranking.
        Their quota leaves the POD target with them, so POD attainment counts only reps still here. Their closed ARR still counts towards team totals and win rates.
      </p>}
      {quota?.mismatch&&<div className="card ae-quota-mismatch" role="alert">
        <b>Quota is mapped to the wrong quarter</b>
        <p>This board reports <b>{quota.mismatch.expected}</b>, but <b>Current quarter quota</b> is mapped to
          {' '}<code>{quota.mismatch.columnName}</code>, which is <b>{quota.mismatch.mappedTo}</b>.
          Every percentage below is this quarter&rsquo;s revenue divided by a different quarter&rsquo;s target.</p>
        <button type="button" className="btn-secondary" onClick={()=>navigate('/data-sources')}>Fix the mapping</button>
      </div>}
      {/* Quota is a whole-quarter commitment, so every figure in this strip is
          anchored to the quarter and deliberately does NOT follow the close-date
          picker. Saying so on screen matters: without it, a viewer who has
          filtered to a fortnight reads a full-quarter number as if it were
          their filtered one. */}
      {quotaMapped?<div className="ae-overview"><AeQuarterPanel role="AM" quota={quota} teamAttainment={teamAttainment} priorTeamAttainment={priorTeamAttainment} atOrAbove={atOrAbove} measuredCount={measured.length}/><AeDistribution reps={reps}/></div>:<div className="card ae-quota-strip ae-quota-unmapped">
        <b>Quota is not mapped</b>
        <p>AM Performance ranks by % of quota achieved. Map <b>Current quarter quota</b> (and optionally <b>Prior quarter quota</b>) on the data source to populate this board.</p>
        <button type="button" className="btn-secondary" onClick={()=>navigate('/data-sources')}>Open data sources</button>
      </div>}

      <div className="ae-rankings">
        <AeRankingPanel role="AM" reps={reps} topN={repTopN} onTopNChange={setRepTopN}/>
        <AeRankingPanel role="AM" reps={pods} topN={podTopN} onTopNChange={setPodTopN} pod/>
      </div>
    </>}

    <button type="button" className="floating-filter-button" aria-label="Open AM Performance filters" title="AM Performance filters" onClick={()=>setFilterPanelOpen(open=>!open)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="13" cy="18" r="2"/></svg>
      {activeFilterCount>0
        ?<span className="floating-filter-badge">{activeFilterCount}</span>
        :hasAnyTouchedFilter&&<span className="floating-filter-badge floating-filter-badge-dot" aria-label="Filters set to All"/>}
    </button>

    {filterPanelOpen&&<aside className="floating-filter-panel" aria-label="AM Performance filters">
      <div className="floating-filter-head"><div><b>AM Performance filters</b><span>{fmtNumber(overall.opportunities)} opportunities</span></div>
        <button type="button" aria-label="Close filters" onClick={()=>setFilterPanelOpen(false)}>×</button></div>
      <div className="floating-filter-controls">{filterDefs.map(([key,label])=><MultiSelect key={key} label={label} options={options[key]||[]} value={filters[key]} onChange={value=>updateFilter(key,value)}/>)}
        <AdvancedDateRange filters={filters} setFilters={setFilters} fromKey="closeFrom" toKey="closeTo"
          label="Opportunity close date" title="Opp Close Date" emptyLabel="All close dates"/></div>
      <button className="floating-filter-reset" type="button" onClick={()=>setFilters(EMPTY)}>Reset all filters</button>
    </aside>}
  </div></ComparisonProvider>;
}
