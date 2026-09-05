import {useEffect,useMemo,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {getAePerformanceSnapshot,getOptions,getDashboardState,saveDashboardState} from '../lib/api';
// No fmtCurrency: this board reports shares and counts, never ARR amounts.
import {MultiSelect,ChartCard,fmtNumber,fmtPercent,ComparisonProvider} from '../components/charts';
import ThemeToggle from '../components/ThemeToggle';
import DashboardSwitcher from '../components/DashboardSwitcher';
import RefreshDataButton from '../components/RefreshDataButton';
import AppLoader from '../components/AppLoader';
import RankBadge from '../components/RankBadge';
import AdvancedDateRange, {rangeFor,isoDate} from '../components/AdvancedDateRange';
import {useAuth} from '../hooks/useAuth';
import {KpiDelta} from './WinBoard';

const TEMPLATE='ae-performance';
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
// Attainment is null when a rep has no usable target (unmapped quota, or a
// zero one). That is not 0% and must not render as 0% - it is shown as "No
// quota" so a data-mapping gap never reads as a performance result.
// Attainment bands. Colour here is DATA, not decoration: on a wall display the
// band is readable before the number is, and it is the difference between
// "scan five rows" and "see who is behind". The thresholds are the ones a
// quota conversation actually turns on.
export const attainmentBand = pct =>
  pct >= 100 ? 'hit'
  : pct >= 75 ? 'close'
  : pct >= 25 ? 'behind'
  : 'risk';

const attainmentLabel=rep=>rep.attainment===null||rep.attainment===undefined
  ?<span className="ae-no-quota" title="No quota mapped for this rep, so attainment cannot be calculated">No quota</span>
  :<strong>{fmtPercent(rep.attainment)}</strong>;

// POD leaders, supplied by the sales ops team. Keyed by the POD label exactly
// as it arrives in the data, so a POD whose name changes upstream simply loses
// its leader rather than showing the wrong person.
//
// Hardcoded on purpose: there is no leader column in the source, and inventing
// one would mean a mapping that nobody maintains. Update this map when a POD
// changes hands. A POD absent from here renders without a leader, which is the
// correct state for one that has none assigned.
export const POD_LEADERS = {
  'EMEA AE':      { name: 'Saif Rizvi',     photo: '/pod-leaders/saif-rizvi.webp' },
  'AMER AE II':   { name: 'Misbah Farooqi', photo: '/pod-leaders/misbah-farooqi.webp' },
  'APAC AE':      { name: 'Karan Rana',     photo: '/pod-leaders/karan-rana.webp' },
  'AMER AE III':  { name: 'Mohit Juneja',   photo: '/pod-leaders/mohit-juneja.webp' },
  'AMER AE Corp': { name: 'Misbah Farooqi', photo: '/pod-leaders/misbah-farooqi.webp' },
  'GCC':          { name: 'Saif Rizvi',     photo: '/pod-leaders/saif-rizvi.webp' },

  // AM PODs. Karan Rana leads APAC on both sides, so the same asset is reused
  // rather than stored twice.
  'AMER AM':      { name: 'Prakhar Goyal',   photo: '/pod-leaders/prakhar-goyal.webp' },
  'APAC AM':      { name: 'Karan Rana',      photo: '/pod-leaders/karan-rana.webp' },
  'EMEA AM':      { name: 'Rishabh Agarwal', photo: '/pod-leaders/rishabh-agarwal.webp' },
};

// Photos are served from this app, not hotlinked from Slack. The originals were
// ~350 KB each for a 34px circle, they would break on a TV with no route to
// Slack's CDN, and every view leaked a request to a third party. Re-encoded to
// 96px WebP: 1.4 MB total became 9 KB.
//
// The error fallback stays anyway - a missing file should degrade to initials
// rather than collapse the row around a broken image.
function LeaderAvatar({leader}){
  const [failed,setFailed]=useState(false);
  if(failed||!leader.photo){
    return <span className="ae-avatar ae-leader-avatar" style={{background:avatarColor(leader.name)}} aria-hidden="true">{repInitials(leader.name)}</span>;
  }
  return <img className="ae-leader-avatar" src={leader.photo} alt="" loading="lazy" referrerPolicy="no-referrer"
    onError={()=>setFailed(true)} />;
}

// badges swaps the small rank disc on the left for the sculpted podium badge
// on the right, beside the percentage. It is the presentation shell's shape:
// on a TV the rank is read off the artwork, and the left column that carried
// it is better spent on the name. The dashboard keeps the compact form, where
// a 68px medal per row would crowd a card sharing the screen with three others.
export function RepLeaderboard({reps=[],comparisons=[],topN=5,showAvatar=true,leaders=null,badges=false,emptyLabel='No AE-owned won opportunities in the selected scope.'}){
  const comparisonByLabel=useMemo(()=>new Map((comparisons||[]).map(item=>[item.label,item])),[comparisons]);
  const rows=topN>0?reps.slice(0,topN):reps;
  if(!rows.length)return <div className="ae-leaderboard-empty">{emptyLabel}</div>;
  // The row is a fixed grid, so a leader avatar adds a COLUMN. Without this
  // class the extra child overflowed the template and every row wrapped.
  const cls=['ae-leaderboard', showAvatar?'':'ae-leaderboard-no-avatar', leaders?'ae-leaderboard-leaders':'', badges?'ae-leaderboard-badges':''].filter(Boolean).join(' ');
  return <div className={cls}>
    {rows.map((rep,index)=>{
      const rank=index+1;
      const comparison=comparisonByLabel.get(rep.label);
      const medal=MEDAL_CLASS[rank];
      const leader=leaders?leaders[rep.label]:null;
      const delta=rep.priorAttainment!==null&&rep.priorAttainment!==undefined&&rep.attainment!==null&&rep.attainment!==undefined
        ?<KpiDelta value={rep.attainment-rep.priorAttainment}/>:null;
      return <div key={rep.label} className={`ae-leaderboard-row${medal?` ae-rank-${rank}`:''}`}>
        {/* One rank marker per row, never two: with badges on, the podium
            badge in the value group IS the rank. */}
        {!badges&&(medal
          ?<span className={`ae-rank-medal ${medal}`} aria-label={`Rank ${rank}`}>{rank}</span>
          :<span className="ae-rank-number" aria-label={`Rank ${rank}`}>{rank}</span>)}
        {showAvatar&&<span className="ae-avatar" style={{background:avatarColor(rep.label)}} aria-hidden="true">{repInitials(rep.label)}</span>}
        {/* A POD with no leader still needs to occupy the avatar COLUMN, or grid
            auto-placement slides its name left and it stops lining up with the
            rows above it. */}
        {leaders&&(leader?<LeaderAvatar leader={leader}/>:<span className="ae-leader-avatar-empty" aria-hidden="true"/>)}
        <span className="ae-leaderboard-name"><strong>{rep.label}</strong>
          {/* The POD is what is ranked, so it stays the primary label and the
              leader sits under it rather than replacing it. */}
          {leader&&<small className="ae-leader-name">{leader.name}</small>}</span>
        {/* Quarter-on-quarter movement in percentage points, shown ONLY when
            the prior quarter had a real target. It used to fall back to the
            contribution-share delta, which put a different metric in the same
            pill next to a quota figure with nothing to distinguish them. No
            prior quota now means no delta. */}
        {badges
          ?<span className="ae-leaderboard-value">
            <RankBadge rank={rank}/>
            {/* The number leads and the unit sits under it, so a wall viewer
                reads the figure before the caption explaining it. */}
            <span className="ae-value-stack">{attainmentLabel(rep)}
              <span className="ae-value-caption">
                {rep.attainment!==null&&rep.attainment!==undefined&&<small>of quota</small>}
                {delta}</span></span></span>
          :<span className="ae-leaderboard-value">{attainmentLabel(rep)}{delta}</span>}
        {/* Attainment as form, not only as a number. A ranked list of
            percentages makes you read every value to compare two rows; a
            common baseline makes the gap between them visible at a glance,
            which is the whole job of this board.

            The track is 0-100% of quota, so the notch at the end is the
            target itself rather than a decorative tick. The fill is CAPPED at
            100% while the printed number keeps the true value - a 134.6% rep
            cannot overflow the row, and the number never disagrees with the
            data. Anything over target gets its own end cap instead. */}
        {rep.attainment!==null&&rep.attainment!==undefined&&(
          <span className={`ae-attain ae-band-${attainmentBand(rep.attainment)}`} aria-hidden="true">
            <span className="ae-attain-fill" style={{'--pct': Math.max(0, Math.min(100, rep.attainment)) + '%'}}/>
          </span>
        )}
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
  const [quota,setQuota]=useState(null);
  const [quotaMetrics,setQuotaMetrics]=useState(EMPTY_METRICS);
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
  // Bumped by the header's Refresh-data button after a source re-pull, so
  // the snapshot refetches without pretending the filters changed.
  const [reloadTick,setReloadTick]=useState(0);
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setLoadError('');setComparison({available:false});
    getAePerformanceSnapshot(filters).then(snapshot=>{
      if(cancelled)return;
      setMetrics(snapshot.metrics||EMPTY_METRICS);
      setQuota(snapshot.quota||null);
      setQuotaMetrics(snapshot.quotaMetrics||EMPTY_METRICS);
      setComparison(snapshot.comparison||{available:false});
    }).catch(error=>{
      if(cancelled)return;
      setMetrics(EMPTY_METRICS);setQuota(null);setQuotaMetrics(EMPTY_METRICS);setComparison({available:false});
      setLoadError(error.response?.data?.error||error.message||'Could not load AE Performance data');
    }).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[filters,reloadTick]);
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
  // Both lists arrive sorted by attainment with unmeasurable entries last, so
  // the leader is the first entry that actually has a number.
  const topRep=measured[0]||null;
  const topPod=(pods||[]).find(pod=>pod.attainment!==null&&pod.attainment!==undefined)||null;
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
    <div className="brand" onClick={()=>navigate('/gallery')} style={{cursor:'pointer'}}><img className="brand-logo" src="/testmu-bi-logo-v3.png" alt="TestMu BI"/><span>TestMu BI</span></div>
    <div className="user-pill"><ThemeToggle/><DashboardSwitcher/><RefreshDataButton templateId={TEMPLATE} onRefreshed={()=>setReloadTick(tick=>tick+1)}/><span>{user?.name||'User'}</span><button className="btn-secondary" onClick={signOut}>Sign out</button></div></div>
    <header className="top"><div className="top-row"><div><h1>AE Performance</h1><div className="sub">Ranks AE reps by <strong>% of quota achieved</strong> for {quota?.currentQuarter||'the current quarter'}. <strong>Owned by an AE-prefixed role only.</strong></div><div className="board-scope-note">Opp type = New Business, New Business AM, Existing Business - Up-sell</div></div>
      <button type="button" className="present-button" onClick={startPresentation}>▶ Present</button></div>
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

    {!loading && (loadError || !overall.wins) ? <div className="card win-board-empty">
      <div className="win-board-empty-icon">↻</div><div><h3>{loadError ? 'AE Performance could not load' : 'No AE Performance data is loaded'}</h3>
        <p>{loadError || 'Connect a data source to AE Performance from Data Sources, and make sure its field mapping includes Owner, Owner role (Role Name) and POD.'}</p></div>
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
      {quotaMapped?<div className="card ae-quota-strip">
        <div className="ae-quota-head">
          <div><b>Quota attainment</b>
            <span className="ae-quota-scope">All of {quota.currentQuarter}. Not affected by the close-date filter.</span></div>
          {priorTeamAttainment!==null&&<span className="ae-quota-vs">vs {quota.previousQuarter}</span>}
        </div>
        <div className="ae-quota-tiles">
          <div className="ae-quota-tile">
            <span className="ae-quota-label">Team attainment</span>
            <span className="ae-quota-value">{teamAttainment===null?'\u2014':fmtPercent(teamAttainment)}
              {priorTeamAttainment!==null&&teamAttainment!==null&&<KpiDelta value={teamAttainment-priorTeamAttainment}/>}</span>
          </div>
          <div className="ae-quota-tile">
            <span className="ae-quota-label">Reps at or above quota</span>
            <span className="ae-quota-value">{atOrAbove}</span>
          </div>
          <div className="ae-quota-tile">
            <span className="ae-quota-label">{quota.previousQuarter} attainment</span>
            <span className="ae-quota-value">{priorTeamAttainment===null?'\u2014':fmtPercent(priorTeamAttainment)}</span>
            {!quota.priorMapped&&<span className="ae-quota-meta">Prior quarter quota not mapped</span>}
          </div>
        </div>

        {/* The two names are the point of this strip, so they are the largest
            thing in it. Emphasis comes from size, weight and a lifted surface
            rather than from colour: the one accent stays reserved for actions. */}
        <div className="ae-top-tiles">
          <div className="ae-top-tile">
            <span className="ae-quota-label">Top AE performer</span>
            {topRep
              ?<><span className="ae-top-name">{topRep.label}</span>
                 <span className="ae-top-value">{fmtPercent(topRep.attainment)}<small> of quota</small></span></>
              :<span className="ae-top-empty">No rep carries a measurable target</span>}
          </div>
          <div className="ae-top-tile">
            <span className="ae-quota-label">Top POD</span>
            {topPod
              ?<><span className="ae-top-name">{topPod.label}</span>
                 <span className="ae-top-value">{fmtPercent(topPod.attainment)}<small> of quota</small></span></>
              :<span className="ae-top-empty">No POD carries a measurable target</span>}
          </div>
        </div>
      </div>:<div className="card ae-quota-strip ae-quota-unmapped">
        <b>Quota is not mapped</b>
        <p>AE Performance ranks by % of quota achieved. Map <b>Current quarter quota</b> (and optionally <b>Prior quarter quota</b>) on the data source to populate this board.</p>
        <button type="button" className="btn-secondary" onClick={()=>navigate('/data-sources')}>Open data sources</button>
      </div>}

      <div className="g2">
        <ChartCard className="ae-performance-card" showComparison={false} title="AE Quota Attainment" hint={`Won ARR closed in ${quota?.currentQuarter||'the quarter'} divided by each rep’s quota. ${measured.length} of ${reps.length} rep${reps.length===1?'':'s'} carry a target.`}
          controls={<select className="table-top-select" aria-label="Number of reps to display" value={repTopN} onChange={event=>setRepTopN(Number(event.target.value))}><option value="5">Top 5</option><option value="10">Top 10</option><option value="20">Top 20</option><option value="0">All</option></select>}>
          <RepLeaderboard reps={reps} comparisons={groupComparisons.reps} topN={repTopN}/>
        </ChartCard>
        <ChartCard className="ae-performance-card" showComparison={false} title="AE POD Quota Attainment" hint={`The same attainment, grouped by POD instead of by rep — ${pods.length} POD${pods.length===1?'':'s'}. A POD quota is the sum of its reps targets, including reps who closed nothing.`}
          controls={<select className="table-top-select" aria-label="Number of PODs to display" value={podTopN} onChange={event=>setPodTopN(Number(event.target.value))}><option value="5">Top 5</option><option value="10">Top 10</option><option value="20">Top 20</option><option value="0">All</option></select>}>
          <RepLeaderboard reps={pods} comparisons={groupComparisons.pods} topN={podTopN} showAvatar={false} leaders={POD_LEADERS}
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
