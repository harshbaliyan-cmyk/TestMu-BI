import {useCallback,useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useNavigate} from 'react-router-dom';
import Chart from 'chart.js/auto';
import {getWinBoardSnapshot,getOptions,getDashboardState,saveDashboardState} from '../lib/api';
import {MultiSelect,ChartCard,ChartScroll,fmtNumber,fmtPercent,valueLabels,baseOptions,ComparisonProvider} from '../components/charts';
import ThemeToggle from '../components/ThemeToggle';
import AppLoader from '../components/AppLoader';
import AdvancedDateRange, {rangeFor,isoDate} from '../components/AdvancedDateRange';
import {useAuth} from '../hooks/useAuth';

const TEMPLATE='win-board';
// Win Board defaults to Current quarter (rather than All dates) so previous-period
// comparison arrows are visible immediately, without the user picking a filter first.
const [DEFAULT_QUARTER_START,DEFAULT_QUARTER_TODAY]=rangeFor('currentQuarter');
const EMPTY={region:[],orgType:[],industry:[],type:[],
  createdFrom:isoDate(DEFAULT_QUARTER_START),createdTo:isoDate(DEFAULT_QUARTER_TODAY),
  datePreset:'currentQuarter',dateCount:4,dateUnit:'quarter'};
const FILTER_KEYS=Object.keys(EMPTY);
// Win Board's own high-contrast categorical palette (distinct from the shared
// CHART_PALETTE used by Opportunity Analytics). Validated with the data-viz
// accessibility checker against both the dark (#0B0F16) and light (#FFFFFF)
// Win Board card surfaces: OKLCH lightness band, chroma floor, adjacent-pair
// colorblind separation (deutan/protan/tritan), normal-vision separation, and
// contrast vs. surface. One set works for both themes — see conversation notes.
const WIN_BOARD_PALETTE=['#1E7CFF','#D9530F','#00A06B','#C67900','#E63D79','#2FAE1D','#7C5CFA','#E84747','#00A3B8','#66A80F'];
const COLORS=WIN_BOARD_PALETTE;
// Requested palette for the "by team" chart specifically: blue, green, orange, purple.
const TEAM_COLORS=['#2563EB','#10B981','#F59E0B','#8B5CF6'];
const POD_RANK_COLORS=WIN_BOARD_PALETTE;

// A staggered, more pronounced entrance animation for Win Board's own Chart.js
// charts (bars grow in one after another; the line draws in) on top of Chart.js's
// otherwise-instant default. Skipped for prefers-reduced-motion.
function wbChartAnimation(){
  if(typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
    return {duration:0};
  }
  return {
    duration:900,easing:'easeOutQuart',
    delay:context=>context.type==='data'&&context.mode==='default'?context.dataIndex*70:0,
  };
}

// Light-to-dark vertical gradient in a bar's own hue, so a flat-color canvas
// bar reads as a glossy, top-lit 3D block instead of a flat rectangle.
function lightenHex(hex,amount){
  const n=parseInt(hex.replace('#',''),16);
  const [r,g,b]=[(n>>16)&255,(n>>8)&255,n&255];
  const mix=v=>Math.round(v+(255-v)*amount);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}
function barGradientFill(ctx,color){
  const area=ctx.chart?.chartArea;
  if(!area)return color;
  const gradient=ctx.chart.ctx.createLinearGradient(0,area.top,0,area.bottom);
  gradient.addColorStop(0,lightenHex(color,.5));
  gradient.addColorStop(1,color);
  return gradient;
}

// Draws a soft colored glow behind each bar, in that bar's own color, using
// destination-over so it only shows in the transparent margin around the bar
// and never redraws over (or dulls) the crisp bar Chart.js already painted.
const barGlow={
  id:'barGlow',
  afterDatasetsDraw(chart){
    const {ctx}=chart;
    chart.data.datasets.forEach((dataset,datasetIndex)=>{
      const meta=chart.getDatasetMeta(datasetIndex);
      if(meta.type!=='bar')return;
      meta.data.forEach(bar=>{
        if(!bar||typeof bar.getProps!=='function')return;
        const {x,y,width,base}=bar.getProps(['x','y','width','base'],true);
        const top=Math.min(y,base),bottom=Math.max(y,base);
        if(bottom-top<1||!bar.options?.backgroundColor)return;
        ctx.save();
        ctx.globalCompositeOperation='destination-over';
        ctx.shadowColor=bar.options.backgroundColor;
        ctx.shadowBlur=18;
        ctx.fillStyle=bar.options.backgroundColor;
        ctx.fillRect(x-width/2,top,width,bottom-top);
        ctx.restore();
      });
      // Periodic "wave" sweep: briefly brightens one bar at a time, moving
      // left to right, during the short active window useChartWavePulse
      // drives below. No extra draw happens the rest of each cycle.
      if(chart.$wavePhase!=null&&meta.data.length){
        const bar=meta.data[Math.round(chart.$wavePhase*(meta.data.length-1))];
        if(bar&&typeof bar.getProps==='function'){
          const {x,y,width,base}=bar.getProps(['x','y','width','base'],true);
          const top=Math.min(y,base),bottom=Math.max(y,base);
          if(bottom-top>=1){
            ctx.save();
            ctx.shadowColor='#FFFFFF';
            ctx.shadowBlur=26;
            ctx.fillStyle='rgba(255,255,255,.4)';
            ctx.fillRect(x-width/2,top,width,bottom-top);
            ctx.restore();
          }
        }
      }
    });
  },
};

// Same destination-over trick for line charts: a soft glow halo behind the
// trend line's stroke, in the line's own color.
const lineGlow={
  id:'lineGlow',
  afterDatasetsDraw(chart){
    const {ctx}=chart;
    chart.data.datasets.forEach((dataset,datasetIndex)=>{
      const meta=chart.getDatasetMeta(datasetIndex);
      if(meta.type!=='line'||!meta.data?.length)return;
      // A dataset can carry null "no data yet at this position" entries
      // (used to align a shorter current/previous-period line onto a
      // shared set of x positions) — those render as skipped points with
      // unreliable coordinates, so every pass below walks this filtered
      // list instead of the raw per-point array.
      const points=meta.data.filter(point=>!point.skip&&Number.isFinite(point.x)&&Number.isFinite(point.y));
      if(points.length<2)return;
      ctx.save();
      ctx.globalCompositeOperation='destination-over';
      ctx.shadowColor=dataset.borderColor||'#126BFF';
      ctx.shadowBlur=16;
      ctx.strokeStyle=dataset.borderColor||'#126BFF';
      ctx.lineWidth=dataset.borderWidth||3;
      ctx.lineJoin='round';
      if(dataset.borderDash)ctx.setLineDash(dataset.borderDash);
      ctx.beginPath();
      points.forEach((point,index)=>index===0?ctx.moveTo(point.x,point.y):ctx.lineTo(point.x,point.y));
      ctx.stroke();
      ctx.restore();

      // A thin, lighter highlight traced just above the line's own path gives
      // it a rounded, glossy "tube" cross-section instead of a flat stroke.
      ctx.save();
      ctx.strokeStyle='rgba(255,255,255,.45)';
      ctx.lineWidth=Math.max(1,(dataset.borderWidth||3)*.3);
      ctx.lineJoin='round';
      if(dataset.borderDash)ctx.setLineDash(dataset.borderDash);
      ctx.beginPath();
      points.forEach((point,index)=>{
        const y=point.y-((dataset.borderWidth||3)*.28);
        index===0?ctx.moveTo(point.x,y):ctx.lineTo(point.x,y);
      });
      ctx.stroke();
      ctx.restore();

      // Periodic wave: only the main line itself (no extra ghost/echo
      // copies) eases into a gentle full-width undulation and back out
      // again during the short active window useChartWavePulse drives
      // below, its phase animating while active so it visibly flows for
      // that moment. Rests flat the rest of the cycle — no extra draw
      // happens while chart.$wavePhase is null. The real line Chart.js
      // drew above is never altered; this is an overlay riding on top of it.
      if(chart.$wavePhase!=null){
        const progress=chart.$wavePhase;
        const n=points.length;
        const amplitude=Math.max(3,(dataset.borderWidth||3))*2.4;
        const alpha=Math.sin(progress*Math.PI);
        const wavePhase=progress*Math.PI*2.4;
        const stepsPerSegment=8;
        if(alpha>0.02){
          ctx.save();
          ctx.globalAlpha=alpha;
          ctx.strokeStyle=dataset.borderColor||'#126BFF';
          ctx.lineWidth=dataset.borderWidth||3;
          ctx.lineJoin='round';
          ctx.lineCap='round';
          ctx.shadowColor=dataset.borderColor||'#126BFF';
          ctx.shadowBlur=14;
          ctx.beginPath();
          let first=true;
          for(let seg=0;seg<n-1;seg++){
            const p0=points[seg],p1=points[seg+1];
            for(let s=seg>0?1:0;s<=stepsPerSegment;s++){
              const localT=s/stepsPerSegment;
              const idx=seg+localT;
              const x=p0.x+(p1.x-p0.x)*localT;
              const baseY=p0.y+(p1.y-p0.y)*localT;
              const y=baseY+Math.sin((idx/n)*Math.PI*4-wavePhase)*amplitude;
              first?(ctx.moveTo(x,y),first=false):ctx.lineTo(x,y);
            }
          }
          ctx.stroke();
          ctx.restore();
        }
      }
    });
  },
};

// Drives a short, periodic "traveling highlight" redraw burst for a Chart.js
// instance (used by barGlow/lineGlow above via chart.$wavePhase). Most of
// each cycle is fully idle — no timer or rAF loop runs at all — and a burst
// of chart.draw() calls (a cheap repaint, not a full update/re-layout) only
// happens during the brief active window. Mirrors the same "mostly at rest,
// brief motion" cadence as this page's CSS ambient animations, and is
// likewise skipped for prefers-reduced-motion.
function useChartWavePulse(chartRef,{cycleMs=6500,activeMs=1400,startDelayMs=1800}={}){
  useEffect(()=>{
    if(typeof window==='undefined')return;
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    let cycleTimer=null,rafId=null,cancelled=false,burstStart=null;
    function endBurst(){
      const chart=chartRef.current;
      if(chart&&chart.ctx){chart.$wavePhase=null;try{chart.draw();}catch{/* chart mid-teardown */}}
      if(!cancelled)cycleTimer=setTimeout(runBurst,cycleMs);
    }
    function tick(now){
      if(cancelled)return;
      const chart=chartRef.current;
      if(!chart||!chart.ctx){endBurst();return;}
      const elapsed=now-burstStart;
      if(elapsed>=activeMs){endBurst();return;}
      chart.$wavePhase=elapsed/activeMs;
      try{chart.draw();}catch{endBurst();return;}
      rafId=requestAnimationFrame(tick);
    }
    function runBurst(){
      if(cancelled)return;
      burstStart=performance.now();
      rafId=requestAnimationFrame(tick);
    }
    cycleTimer=setTimeout(runBurst,startDelayMs);
    return()=>{cancelled=true;clearTimeout(cycleTimer);if(rafId)cancelAnimationFrame(rafId);};
  },[chartRef]);
}
const EMPTY_METRICS={overall:{opportunities:0,open:0,wonArr:0,closedArr:0,totalArr:0,openArr:0,closed:0,wins:0,losses:0,arrWinRate:0,dealWinRate:0,dealWinRateOfAll:0,openArrPct:0,openOppRate:0},trend:{monthly:[],quarterly:[]},trendYear:null,teams:[],industries:[],orgTypes:[],pods:[]};
export const DEFAULT_PERCENTAGE_VIEW='contribution';
// Which three of PERCENTAGE_VIEWS' six entries belong to Win Board's own
// selector — the map below also holds Loss Board's three so the two boards
// can share chart components, so this can't just iterate the whole map.
const WIN_VIEW_KEYS=['dealWinRate','arrWinRate','contribution'];
export const PERCENTAGE_VIEWS={
  dealWinRate:{
    label:'Win % by opportunity count',shortLabel:'Opportunity win %',noun:'opportunity-count win rate',
    formula:'Won distinct opportunities ÷ closed distinct opportunities × 100',changeField:'dealWinRatePointChange',
    plain:'the share of closed opportunities that were won',
  },
  arrWinRate:{
    label:'ARR win %',shortLabel:'ARR win %',noun:'ARR win rate',
    formula:'Won ARR ÷ Closed ARR × 100',changeField:'arrWinRatePointChange',
    plain:'the share of closed ARR that was won',
  },
  contribution:{
    label:'Won ARR contribution %',shortLabel:'Contribution %',noun:'Won ARR contribution',
    formula:'Category Won ARR ÷ total filtered Won ARR × 100',changeField:'contributionPointChange',
    plain:"each category's share of total Won ARR",
  },
  // Loss Board's mirror of the three views above. Namespaced with their own
  // keys (not reusing dealWinRate/arrWinRate/contribution) since the two
  // boards' rows carry different field names for what's conceptually the
  // same shape — sharing this map (rather than a second copy of it) is what
  // lets Loss Board reuse Win Board's chart components unchanged.
  lossOppRate:{
    label:'Loss % by opportunity count',shortLabel:'Opportunity loss %',noun:'opportunity-count loss rate',
    formula:'Lost distinct opportunities ÷ closed distinct opportunities × 100',changeField:'lossOppRatePointChange',
    plain:'the share of closed opportunities that were lost',
  },
  arrLostRate:{
    label:'ARR lost %',shortLabel:'ARR lost %',noun:'ARR lost rate',
    formula:'Lost ARR ÷ Closed ARR × 100',changeField:'arrLostRatePointChange',
    plain:'the share of closed ARR that was lost',
  },
  lossContribution:{
    label:'Loss ARR contribution %',shortLabel:'Contribution %',noun:'Loss ARR contribution',
    formula:'Category Lost ARR ÷ total filtered Lost ARR × 100',changeField:'lossContributionPointChange',
    plain:"each category's share of total Lost ARR",
  },
};
// Which three views belong together on one tooltip's secondary-metrics row
// — a Win Board tooltip should never show a Loss Board metric or vice versa.
const METRIC_GROUPS={
  dealWinRate:['dealWinRate','arrWinRate','contribution'],
  arrWinRate:['dealWinRate','arrWinRate','contribution'],
  contribution:['dealWinRate','arrWinRate','contribution'],
  lossOppRate:['lossOppRate','arrLostRate','lossContribution'],
  arrLostRate:['lossOppRate','arrLostRate','lossContribution'],
  lossContribution:['lossOppRate','arrLostRate','lossContribution'],
};
const TOOLTIP_ROW_LABELS={
  dealWinRate:'Opportunity win %',arrWinRate:'ARR win %',contribution:'Won ARR contribution',
  lossOppRate:'Loss opportunity rate',arrLostRate:'ARR lost rate',lossContribution:'Loss ARR contribution',
};
const LOWER_IS_BETTER_METRICS=new Set(['lossOppRate','arrLostRate','lossContribution']);

function comparisonToneDirection(value,lowerIsBetter=false){
  const number=Number(value);
  const movement=!Number.isFinite(number)||Math.abs(number)<=.005?'flat':number>0?'up':'down';
  if(!lowerIsBetter||movement==='flat')return movement;
  return movement==='up'?'down':'up';
}

export function percentageView(metric){return PERCENTAGE_VIEWS[metric]||PERCENTAGE_VIEWS[DEFAULT_PERCENTAGE_VIEW];}
function metricValue(item,metric){return Number(item?.[metric])||0;}
function metricComparison(raw,item,metric){
  if(!raw)return null;
  const definition=percentageView(metric);
  const current=metricValue(item,metric);
  const metricRecord=raw.metrics?.[metric];
  const directPrevious=metricRecord?.previous??raw.previousMetrics?.[metric]??raw.previousValues?.[metric]??(raw.metric===metric?raw.previous:null);
  const rawChange=metricRecord?.changePoints??raw[definition.changeField]??(raw.metric===metric?raw.changePoints:null);
  const change=rawChange==null?null:Number(rawChange);
  const previous=directPrevious!=null&&Number.isFinite(Number(directPrevious))
    ?Number(directPrevious)
    :raw.hasPrevious&&Number.isFinite(change)?current-change:null;
  return {...raw,metric,current,previous,
    changePoints:previous==null?null:current-previous,
    [definition.changeField]:previous==null?null:current-previous};
}

function PercentageViewSelect({value,onChange}){
  const selected=percentageView(value);
  const id=useId();
  return <div className="fg percentage-view-field">
    <label htmlFor={id}>Display charts by</label>
    <select id={id} value={value} onChange={event=>onChange(event.target.value)} title={selected.formula}>
      {WIN_VIEW_KEYS.map(key=><option value={key} key={key}>{PERCENTAGE_VIEWS[key].label}</option>)}
    </select>
  </div>;
}

function tooltipMetrics(item,selectedMetric){
  const keys=METRIC_GROUPS[selectedMetric]||METRIC_GROUPS[DEFAULT_PERCENTAGE_VIEW];
  const percentageRows=keys.map(key=>[TOOLTIP_ROW_LABELS[key],fmtPercent(item[key]),true,key]);
  if(PERCENTAGE_VIEWS[selectedMetric])percentageRows.sort((a,b)=>(a[3]===selectedMetric?-1:0)-(b[3]===selectedMetric?-1:0));
  return [
    ['Closed opportunities',fmtNumber(item.closed),false],
    ['Won / lost',`${fmtNumber(item.wins)} / ${fmtNumber(item.losses)}`,false],
    ...percentageRows,
  ];
}

function tooltipCountLines(item){return tooltipMetrics(item).filter(([, ,highlight])=>!highlight).map(([label,value])=>`${label}: ${value}`);}
function tooltipPercentLines(item,selectedMetric){return tooltipMetrics(item,selectedMetric).filter(([, ,highlight])=>highlight).map(([label,value])=>`${label}: ${value}`);}

function SortButton({direction,onChange,label='chart values'}){
  const next=direction==='desc'?'asc':'desc';
  return <button type="button" className="sort-button" onClick={()=>onChange(next)}
    aria-label={`Sort ${label} ${next === 'desc' ? 'descending' : 'ascending'}`}>
    {direction==='desc'?'↓ Desc':'↑ Asc'}
  </button>;
}


export function comparisonText(value){
  const number=Number(value)||0;
  return `${number>.005?'↑':number<-.005?'↓':'→'} ${Math.abs(number).toFixed(1)}%`;
}

const MONTH_ABBR=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function shortDate(value){
  if(!value)return '';
  const [y,m,d]=value.split('-').map(Number);
  return `${MONTH_ABBR[m-1]} ${d}, ${y}`;
}

export function KpiDelta({value,lowerIsBetter=false}){
  if(value==null||!Number.isFinite(Number(value)))return null;
  const number=Number(value);
  const direction=comparisonToneDirection(number,lowerIsBetter);
  const movement=number>.005?'Increase':number<-.005?'Decrease':'No change';
  const outcome=lowerIsBetter&&Math.abs(number)>.005?(number<0?' — improvement':' — deterioration'):'';
  const label=`${movement} of ${Math.abs(number).toFixed(1)} percentage points compared with the previous period${outcome}`;
  return <span className={`bar-comparison-delta comparison-${direction}`} title={label} aria-label={label}>
    {comparisonText(number)}
  </span>;
}

function selectedMetricDeltaText(comparison){
  if(!comparison?.hasPrevious)return 'New';
  const number=Number(comparison.changePoints);
  if(!Number.isFinite(number))return 'N/A';
  return `${number>.005?'↑':number<-.005?'↓':'→'} ${Math.abs(number).toFixed(1)}%`;
}

function selectedMetricDeltaAriaText(comparison,metric){
  const definition=percentageView(metric);
  if(!comparison?.hasPrevious)return `${definition.noun} has no previous-period category baseline`;
  const number=Number(comparison.changePoints);
  if(!Number.isFinite(number))return `${definition.noun} change is unavailable`;
  if(number>.005)return `${definition.noun} increased ${Math.abs(number).toFixed(1)} percentage points versus the previous period`;
  if(number<-.005)return `${definition.noun} decreased ${Math.abs(number).toFixed(1)} percentage points versus the previous period`;
  return `${definition.noun} was unchanged versus the previous period`;
}

// A distinct palette for the Org Type chart specifically, separate from the
// shared WIN_BOARD_PALETTE the industry chart uses, so the two never clash.
const ORG_TYPE_COLORS=['#00A3B8','#E63D79','#66A80F','#1E7CFF'];
function categoryColor(label){
  const hash=Array.from(String(label||'')).reduce((total,character)=>((total*31)+character.charCodeAt(0))|0,0);
  return ORG_TYPE_COLORS[Math.abs(hash)%ORG_TYPE_COLORS.length];
}

function podRankColor(rank){return POD_RANK_COLORS[(Math.max(1,Number(rank)||1)-1)%POD_RANK_COLORS.length];}

function colorMapFor(items,palette=COLORS){
  const labels=[...new Set((items||[]).map(item=>String(item?.label||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  return new Map(labels.map((label,index)=>[label,palette[index%palette.length]]));
}

export function PercentChart({items,comparisons,metric='arrWinRate',label='ARR win rate',heading='Performance summary',height=300,fill=false}){
  const ref=useRef(null);
  const chartInstanceRef=useRef(null);
  const [sortDirection,setSortDirection]=useState('desc');
  const definition=percentageView(metric);
  const rows=useMemo(()=>[...(items||[])].sort((a,b)=>{
    const difference=(Number(a?.[metric])||0)-(Number(b?.[metric])||0);
    const tie=String(a?.label||'').localeCompare(String(b?.label||''));
    return sortDirection==='asc'?(difference||tie):(-difference||tie);
  }),[items,metric,sortDirection]);

  useEffect(()=>{
    if(!ref.current)return;
    const chartBase=baseOptions();
    const comparisonByLabel=new Map((comparisons||[]).map(item=>[item.label,item]));
    const comparisonRows=rows.map(item=>metricComparison(comparisonByLabel.get(item.label),item,metric));
    const chart=new Chart(ref.current,{type:'bar',plugins:[valueLabels,barGlow],data:{labels:rows.map(item=>item.label),datasets:[{
      label,data:rows.map(item=>item[metric]),
      backgroundColor:ctx=>barGradientFill(ctx,COLORS[ctx.dataIndex%COLORS.length]),
      borderRadius:7,valueFormat:value=>fmtPercent(value),showZeroValues:true,
      secondaryData:comparisonRows.map(item=>item?.changePoints),
      secondaryLabels:comparisonRows.map(item=>item?selectedMetricDeltaText(item):''),
      secondaryToneData:comparisonRows.map(item=>item?.changePoints==null?null:
        Number(item.changePoints)*(LOWER_IS_BETTER_METRICS.has(metric)?-1:1)),
    }]},options:{...chartBase,maintainAspectRatio:false,animation:wbChartAnimation(),plugins:{...chartBase.plugins,legend:{display:false},tooltip:{...chartBase.plugins.tooltip,
      footerColor:'#20C9B5',footerFont:{size:13,weight:'800'},footerMarginTop:8,
      callbacks:{title:contexts=>`${heading} — ${rows[contexts[0]?.dataIndex]?.label||''}`,label:context=>tooltipCountLines(rows[context.dataIndex]),
        footer:contexts=>{
          const index=contexts[0]?.dataIndex;
          const item=rows[index];
          const itemComparison=comparisonRows[index];
          return [
            itemComparison?.hasPrevious
              ?`${comparisonText(itemComparison.changePoints)} vs previous period (${fmtPercent(itemComparison.previous)})`
              :'No previous-period comparison yet',
            ...tooltipMetrics(item,metric).filter(([, ,highlight,key])=>highlight&&key!==metric).map(([label,value])=>`${label}: ${value}`),
          ];
        }}}},scales:{
        x:{...chartBase.scales.x,ticks:{...chartBase.scales.x.ticks,maxRotation:28,minRotation:0}},
        y:{display:false,beginAtZero:true,max:100,grace:'12%'}}}});
    chartInstanceRef.current=chart;
    return()=>{chartInstanceRef.current=null;chart.destroy();};
  },[rows,comparisons,metric,label,heading,definition.noun,definition.shortLabel]);
  useChartWavePulse(chartInstanceRef);

  return <>
    <div className="chart-inline-controls"><SortButton direction={sortDirection} onChange={setSortDirection} label={label}/></div>
    <div className={fill ? 'chart-fill' : undefined} style={fill ? undefined : {height}}><canvas ref={ref} role="img" aria-label={`${heading}. Each bar includes its ${definition.noun} change versus the previous comparison period.`}/></div>
  </>;
}

// The Won ARR contribution/win-rate trend, always a full calendar year (see
// buildYearlyTrend in winBoardMetrics.js) with a Month/Quarter toggle, and a
// year-over-year comparison line (the same months one year earlier) when
// that data exists. Self-contained (owns its own granularity state) so it
// can be reused as-is by the Win/Loss Board presentations. Both lines are
// built from the same fixed 12-month or 4-quarter calendar sequence, so
// they always share real, matching calendar labels index-for-index — no
// relative-position alignment guesswork, unlike the old date-range-scoped
// trend where the two periods' calendar months rarely lined up.
export function TrendChart({trend,previousTrend,metric,year,previousYear,height=310,fill=false}){
  const definition=percentageView(metric);
  const [granularity,setGranularity]=useState('month');
  const trendRef=useRef(null);
  const chartInstanceRef=useRef(null);
  const current=useMemo(()=>(granularity==='quarter'?trend?.quarterly:trend?.monthly)||[],[trend,granularity]);
  const previous=useMemo(()=>(granularity==='quarter'?previousTrend?.quarterly:previousTrend?.monthly)||[],[previousTrend,granularity]);
  // A dataless point (see emptyYearSummary on the backend) still has an
  // entry so the axis stays a complete year — opportunities>0 is what
  // actually distinguishes "no prior-year data at all" from "there is one".
  const hasPrevious=useMemo(()=>previous.some(point=>point?.opportunities>0),[previous]);
  const pointCount=current.length;
  // The year is already identified once in the chart key. Keep the axis
  // compact everywhere (dashboard and presentation, Win and Loss boards)
  // while retaining each point's complete source label in the tooltip.
  const labels=useMemo(()=>current.map(point=>
    String(point.label||'').replace(/-\d{2,4}$/,'')),[current]);

  useEffect(()=>{
    if(!trendRef.current||!current.length)return;
    const chartBase=baseOptions();
    const currentData=current.map(point=>point[metric]);
    const previousData=previous.map(point=>point[metric]);
    const datasets=[{
      label:`${definition.label} — this period`,data:currentData,borderColor:'#126BFF',backgroundColor:'rgba(18,107,255,.16)',fill:true,tension:.4,
      borderWidth:4,pointRadius:4,pointHoverRadius:7,pointBackgroundColor:'#09142B',pointBorderColor:'#4BC8FF',pointBorderWidth:2,
      valueFormat:value=>fmtPercent(value),valueLabelBackground:false,
    }];
    if(hasPrevious)datasets.push({
      label:`${definition.label} — previous period`,data:previousData,borderColor:'#DC2626',backgroundColor:'transparent',fill:false,tension:.4,
      borderWidth:3,borderDash:[7,5],pointRadius:3,pointHoverRadius:6,pointBackgroundColor:'#2E0505',pointBorderColor:'#FF8A8A',pointBorderWidth:2,
      valueFormat:value=>fmtPercent(value),valueLabelPosition:'below',valueLabelBackground:false,
    });
    const chart=new Chart(trendRef.current,{type:'line',plugins:[valueLabels,lineGlow],data:{labels,datasets},
      // Chart.js's own bottom legend is disabled here — the "This period /
      // Previous period" key row above the chart already covers it, and
      // having both duplicated the legend and, at the shorter heights a
      // paired presentation slide gives this chart, pushed the native one
      // past the card's own bottom edge.
      options:{...chartBase,maintainAspectRatio:false,animation:wbChartAnimation(),plugins:{...chartBase.plugins,legend:{display:false},tooltip:{...chartBase.plugins.tooltip,
      footerColor:'#20C9B5',footerFont:{size:13,weight:'800'},footerMarginTop:8,
      callbacks:{
        title:contexts=>{
          const index=contexts[0]?.dataIndex;
          const currentLabel=current[index]?.label||'';
          return hasPrevious?`${currentLabel}  ·  vs ${previous[index]?.label||''}`:currentLabel;
        },
        label:context=>{
          const isCurrent=context.datasetIndex===0;
          const source=(isCurrent?current:previous)[context.dataIndex];
          const tag=isCurrent?'This period':'Previous period';
          if(!source||source[metric]==null)return `${tag} (${source?.label||''}): no data`;
          return [`${tag} (${source.label}): ${fmtPercent(source[metric])}`,...tooltipCountLines(source)];
        },
        footer:contexts=>{
          const currentItem=contexts.find(item=>item.datasetIndex===0);
          const source=currentItem?current[currentItem.dataIndex]:null;
          return source&&source[metric]!=null?tooltipPercentLines(source,metric):[];
        },
      }}},
      scales:{x:chartBase.scales.x,y:{display:false,beginAtZero:true,max:100,grace:'12%'}}}});
    chartInstanceRef.current=chart;
    return()=>{chartInstanceRef.current=null;chart.destroy();};
  },[current,previous,hasPrevious,labels,metric,definition.label]);
  useChartWavePulse(chartInstanceRef);

  return <>
    <div className="chart-inline-controls">
      {hasPrevious&&<div className="trend-chart-key">
        <span><i className="trend-key-current"/>{year||'This period'}</span>
        <span><i className="trend-key-previous"/>{previousYear||'Previous period'}</span>
      </div>}
      <div className="trend-granularity-toggle" role="group" aria-label="Trend granularity">
        <button type="button" className={granularity==='month'?'on':''} onClick={()=>setGranularity('month')}>Month</button>
        <button type="button" className={granularity==='quarter'?'on':''} onClick={()=>setGranularity('quarter')}>Quarter</button>
      </div>
    </div>
    <ChartScroll count={pointCount} height={height} fill={fill}><canvas ref={trendRef}/></ChartScroll>
  </>;
}

export function sortMetricRows(items,metric,direction){
  return [...(items||[])].sort((a,b)=>{
    const difference=(Number(a?.[metric])||0)-(Number(b?.[metric])||0);
    const tie=String(a?.label||'').localeCompare(String(b?.label||''));
    return direction==='asc'?(difference||tie):(-difference||tie);
  });
}

function MetricTooltip({item,comparison,eyebrow,metric='arrWinRate',anchorRef:externalAnchorRef=null,controlledOpen}){
  const definition=percentageView(metric);
  // metricComparison returns a new object. Keeping that object stable is
  // important here because it participates in the layout-measurement effect
  // below: when a click focuses a chart row, an unstable dependency can make
  // the effect run again after every position update (and animated/sub-pixel
  // bounds can then keep the update loop alive).
  const resolvedComparison=useMemo(()=>metricComparison(comparison,item,metric),[comparison,item,metric]);
  const changeDirection=resolvedComparison?.hasPrevious&&Number.isFinite(Number(resolvedComparison.changePoints))
    ?comparisonToneDirection(resolvedComparison.changePoints,LOWER_IS_BETTER_METRICS.has(metric)):null;
  const tooltipId=useId();
  const anchorMarkerRef=useRef(null);
  const tooltipRef=useRef(null);
  const [internalOpen,setInternalOpen]=useState(false);
  const [position,setPosition]=useState(null);
  const isControlled=controlledOpen!==undefined;
  const open=isControlled?Boolean(controlledOpen):internalOpen;
  const getAnchor=useCallback(()=>{
    const anchor=externalAnchorRef?.current||anchorMarkerRef.current?.parentElement;
    return anchor?.isConnected&&typeof anchor.getBoundingClientRect==='function'?anchor:null;
  },[externalAnchorRef]);

  const updatePosition=useCallback(()=>{
    const anchor=getAnchor();
    const tooltip=tooltipRef.current;
    if(!anchor||!tooltip)return;

    const margin=12;
    const gap=10;
    const viewportWidth=document.documentElement.clientWidth;
    const viewportHeight=window.innerHeight;
    const anchorRect=anchor.getBoundingClientRect();
    const tooltipRect=tooltip.getBoundingClientRect();
    const roomBelow=viewportHeight-anchorRect.bottom-gap-margin;
    const roomAbove=anchorRect.top-gap-margin;
    const placement=tooltipRect.height>roomBelow&&roomAbove>roomBelow?'above':'below';
    const unclampedTop=placement==='above'
      ?anchorRect.top-tooltipRect.height-gap
      :anchorRect.bottom+gap;
    const top=Math.max(margin,Math.min(unclampedTop,viewportHeight-tooltipRect.height-margin));
    const centeredLeft=anchorRect.left+(anchorRect.width-tooltipRect.width)/2;
    const left=Math.max(margin,Math.min(centeredLeft,viewportWidth-tooltipRect.width-margin));

    if(!Number.isFinite(left)||!Number.isFinite(top))return;
    setPosition(current=>current&&Math.abs(current.left-left)<.5&&Math.abs(current.top-top)<.5&&current.placement===placement
      ?current:{left,top,placement});
  },[getAnchor]);

  useEffect(()=>{
    if(isControlled)return undefined;
    const anchor=getAnchor();
    if(!anchor)return undefined;
    const previousDescription=anchor.getAttribute('aria-describedby');
    const show=()=>{
      anchor.setAttribute('aria-describedby',tooltipId);
      setPosition(null);
      setInternalOpen(true);
    };
    const hide=()=>{
      if(previousDescription)anchor.setAttribute('aria-describedby',previousDescription);
      else anchor.removeAttribute('aria-describedby');
      setInternalOpen(false);
    };
    const handleFocusOut=event=>{if(!anchor.contains(event.relatedTarget))hide();};
    const handleKeyDown=event=>{if(event.key==='Escape')hide();};
    anchor.addEventListener('pointerenter',show);
    anchor.addEventListener('pointerleave',hide);
    anchor.addEventListener('focusin',show);
    anchor.addEventListener('focusout',handleFocusOut);
    anchor.addEventListener('keydown',handleKeyDown);
    return()=>{
      if(previousDescription)anchor.setAttribute('aria-describedby',previousDescription);
      else anchor.removeAttribute('aria-describedby');
      anchor.removeEventListener('pointerenter',show);
      anchor.removeEventListener('pointerleave',hide);
      anchor.removeEventListener('focusin',show);
      anchor.removeEventListener('focusout',handleFocusOut);
      anchor.removeEventListener('keydown',handleKeyDown);
    };
  },[getAnchor,isControlled,tooltipId]);

  useEffect(()=>{
    if(!isControlled)return undefined;
    const anchor=getAnchor();
    if(!anchor)return undefined;
    const previousDescription=anchor.getAttribute('aria-describedby');
    if(open)anchor.setAttribute('aria-describedby',tooltipId);
    return()=>{
      if(previousDescription)anchor.setAttribute('aria-describedby',previousDescription);
      else anchor.removeAttribute('aria-describedby');
    };
  },[getAnchor,isControlled,open,tooltipId]);

  useLayoutEffect(()=>{
    if(!open)return undefined;
    updatePosition();
    const frame=requestAnimationFrame(updatePosition);
    return()=>cancelAnimationFrame(frame);
  },[open,item,resolvedComparison,updatePosition]);

  useEffect(()=>{
    if(!open)return undefined;
    let frame=0;
    const schedulePosition=()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(updatePosition);
    };
    window.addEventListener('resize',schedulePosition);
    window.addEventListener('scroll',schedulePosition,true);
    return()=>{
      cancelAnimationFrame(frame);
      window.removeEventListener('resize',schedulePosition);
      window.removeEventListener('scroll',schedulePosition,true);
    };
  },[open,updatePosition]);

  const portalTarget=typeof document!=='undefined'?document.body:null;
  const tooltip=open&&portalTarget&&createPortal(<div ref={tooltipRef}
    id={tooltipId}
    className={`rank-metric-tooltip win-metric-tooltip metric-tooltip-portal${position?` placement-${position.placement}`:''}`}
    role="tooltip" style={{left:position?.left??0,top:position?.top??0,visibility:position?'visible':'hidden'}}>
      <div className="rank-tooltip-eyebrow">{eyebrow}</div>
      <h4>{item.label}</h4>

      <div className="tooltip-hero">
        <strong>{fmtPercent(metricValue(item,metric))}</strong>
        <span>{definition.shortLabel}</span>
      </div>

      {changeDirection?<div className={`tooltip-change comparison-${changeDirection}`}>
        <b>{comparisonText(resolvedComparison.changePoints)}</b> vs previous period ({fmtPercent(resolvedComparison.previous)})
      </div>:<div className="tooltip-change muted">No previous-period comparison yet</div>}

      <div className="tooltip-context">{fmtNumber(item.closed)} closed · {fmtNumber(item.wins)} won / {fmtNumber(item.losses)} lost</div>

      <div className="tooltip-secondary">
        {tooltipMetrics(item,metric).filter(([, ,highlight,key])=>highlight&&key!==metric).map(([label,value])=>
          <span key={label}>{label} <b>{value}</b></span>)}
      </div>
    </div>,document.body);

  return <>{!externalAnchorRef&&<span ref={anchorMarkerRef} hidden aria-hidden="true"/>}{tooltip}</>;
}

function buildDonutCallouts(segments,size,radius,circumference){
  const center=size/2;
  const entries=(segments||[]).map(segment=>{
    const angle=-Math.PI/2+((segment.offset+segment.length/2)/circumference)*Math.PI*2;
    const cosine=Math.cos(angle);
    // Very small final slices sit almost exactly at 12 o'clock. Sending those
    // callouts to the right keeps the two sides balanced (and keeps AE Corp
    // from colliding with AM Corp on the left).
    const side=Math.abs(cosine)<.075?1:cosine>=0?1:-1;
    return {
      ...segment,
      side,
      anchorX:center+Math.cos(angle)*(radius+14),
      anchorY:center+Math.sin(angle)*(radius+14),
      elbowX:center+Math.cos(angle)*(radius+29),
      elbowY:center+Math.sin(angle)*(radius+29),
      naturalY:center+Math.sin(angle)*(radius+29),
    };
  });

  const distribute=side=>{
    const rows=entries.filter(entry=>entry.side===side).sort((a,b)=>a.naturalY-b.naturalY);
    // Leave room for the value, outcome counts and period-change lines.
    const gap=52,minY=20,maxY=size-50;
    let cursor=minY;
    rows.forEach(entry=>{entry.labelY=Math.max(entry.naturalY,cursor);cursor=entry.labelY+gap;});
    if(rows.length){
      const overflow=rows[rows.length-1].labelY-maxY;
      if(overflow>0)rows.forEach(entry=>{entry.labelY-=overflow;});
      for(let index=rows.length-2;index>=0;index-=1){
        rows[index].labelY=Math.min(rows[index].labelY,rows[index+1].labelY-gap);
      }
      const underflow=minY-rows[0].labelY;
      if(underflow>0)rows.forEach(entry=>{entry.labelY+=underflow;});
    }
    return rows.map(entry=>({
      ...entry,
      lineX:center+side*(radius+55),
      textX:center+side*(radius+61),
    }));
  };

  return [...distribute(-1),...distribute(1)];
}

export function TeamContributionDonut({items,comparisons,metric,showCallouts=false}){
  const definition=percentageView(metric);
  const isContribution=metric==='contribution';
  const [sortDirection,setSortDirection]=useState('desc');
  const [activeLabel,setActiveLabel]=useState('');
  const activeTooltipAnchorRef=useRef(null);
  const rows=useMemo(()=>sortMetricRows(items,metric,sortDirection),[items,metric,sortDirection]);
  const teamColors=useMemo(()=>colorMapFor(items,TEAM_COLORS),[items]);
  const comparisonByLabel=useMemo(()=>new Map((comparisons||[]).map(item=>[item.label,item])),[comparisons]);
  if(!rows.length)return <div className="empty">No team data for the active filters.</div>;

  const size=252,radius=92,circumference=2*Math.PI*radius;
  // Each team's contribution is its own independent division (teamArr/totalArr),
  // so re-summing them here doesn't always reassociate back to a clean 100 in
  // floating point — a fully-assigned set of teams can land on 99.99999999999999
  // instead of 100. Rounded to 6 decimals (far finer than the 1-decimal display),
  // that noise disappears while a real shortfall (an actual unassigned team) is
  // still preserved down to 0.0001%.
  const rawTotal=Math.round(rows.reduce((sum,item)=>sum+Math.max(0,metricValue(item,metric)),0)*1e6)/1e6;
  const scale=isContribution&&rawTotal>100?100/rawTotal:1;
  let offset=0;
  const segments=isContribution?rows.map((item,index)=>{
    const share=Math.max(0,metricValue(item,metric))*scale;
    const length=share/100*circumference;
    const segment={item,index,length,offset};
    offset+=length;
    return segment;
  }).filter(segment=>segment.length>0):[];
  const remainder=isContribution?Math.max(0,circumference-offset):0;

  const useCallouts=showCallouts&&isContribution;
  const callouts=useCallouts?buildDonutCallouts(segments,size,radius,circumference):[];
  const activeItem=activeLabel?rows.find(item=>item.label===activeLabel):null;
  const showTeamTooltip=(item,event)=>{
    activeTooltipAnchorRef.current=event.currentTarget;
    setActiveLabel(item.label);
  };
  const hideTeamTooltip=()=>{
    activeTooltipAnchorRef.current=null;
    setActiveLabel('');
  };

  return <>
    <div className="chart-inline-controls"><SortButton direction={sortDirection} onChange={setSortDirection} label={definition.noun}/></div>
    <div className={`team-share-layout${useCallouts?' team-share-layout--callouts':''}`}>
      {isContribution?<div className={`team-share-donut${activeLabel?' has-active':''}${useCallouts?' has-callouts':''}`}>
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-labelledby="team-share-title team-share-desc">
          <title id="team-share-title">{definition.label} by team</title>
          <desc id="team-share-desc">Segments divide total filtered Won ARR among teams. The adjacent ranked legend gives exact values and previous-period changes.</desc>
          <circle className="team-share-track" cx={size/2} cy={size/2} r={radius}/>
          <g transform={`rotate(-90 ${size/2} ${size/2})`}>
            {segments.map(({item,index,length,offset:segmentOffset})=>{
              const comparisonItem=metricComparison(comparisonByLabel.get(item.label),item,metric);
              return <circle key={item.label}
              className={`team-share-segment${activeLabel===item.label?' active':''}`}
              cx={size/2} cy={size/2} r={radius}
              stroke={teamColors.get(item.label)}
              strokeDasharray={`${Math.max(0,length-3)} ${circumference-Math.max(0,length-3)}`}
              strokeDashoffset={-segmentOffset}
              style={{filter:`drop-shadow(0 0 5px ${teamColors.get(item.label)})`}}
              tabIndex="0" role="img"
              aria-label={`${item.label}, ${fmtPercent(metricValue(item,metric))} ${definition.noun}, ${fmtNumber(item.closed)} closed opportunities, ${fmtNumber(item.wins)} won and ${fmtNumber(item.losses)} lost${comparisonItem?`, ${selectedMetricDeltaAriaText(comparisonItem,metric)}`:''}`}
              onPointerEnter={event=>showTeamTooltip(item,event)} onPointerLeave={hideTeamTooltip}
              onFocus={event=>showTeamTooltip(item,event)} onBlur={hideTeamTooltip}/>;
            })}
            {remainder>.5&&<circle className="team-share-remainder" cx={size/2} cy={size/2} r={radius}
              strokeDasharray={`${remainder} ${circumference-remainder}`} strokeDashoffset={-offset}>
              <title>{`Unassigned Won ARR share: ${fmtPercent(100-Math.min(rawTotal,100))}`}</title>
            </circle>}
          </g>
          {useCallouts&&<g className="team-share-callouts" aria-hidden="true">
            {callouts.map(callout=>{
              const comparisonItem=metricComparison(comparisonByLabel.get(callout.item.label),callout.item,metric);
              const change=Number(comparisonItem?.changePoints);
              const direction=!comparisonItem?.hasPrevious||!Number.isFinite(change)?'flat':
                comparisonToneDirection(change,LOWER_IS_BETTER_METRICS.has(metric));
              return <g key={callout.item.label} className="team-share-callout" style={{'--callout-color':teamColors.get(callout.item.label)}}
                onPointerEnter={event=>showTeamTooltip(callout.item,event)} onPointerLeave={hideTeamTooltip}>
                <polyline points={`${callout.anchorX},${callout.anchorY} ${callout.elbowX},${callout.elbowY} ${callout.lineX},${callout.labelY}`}/>
                <circle cx={callout.anchorX} cy={callout.anchorY} r="2.5"/>
                <text className="team-share-callout-label" x={callout.textX} y={callout.labelY} textAnchor={callout.side>0?'start':'end'}>{callout.item.label} · {fmtPercent(metricValue(callout.item,metric))}</text>
                {comparisonItem&&<text className={`team-share-callout-delta comparison-${direction}`} x={callout.textX} y={callout.labelY+17} textAnchor={callout.side>0?'start':'end'}>{selectedMetricDeltaText(comparisonItem)}</text>}
              </g>;
            })}
          </g>}
        </svg>
        <div className="team-share-center"><strong>{fmtPercent(Math.min(rawTotal,100))}</strong><span>assigned to teams</span></div>
        {activeItem&&<MetricTooltip item={activeItem} comparison={comparisonByLabel.get(activeItem.label)} metric={metric}
          eyebrow={`Team ${definition.noun}`} anchorRef={activeTooltipAnchorRef} controlledOpen/>}
      </div>:
      <div className="team-rate-gauges" role="list" aria-label={`${definition.label} by team. Each team is its own independent donut gauge on a zero to one hundred percent scale.`}>
        {rows.map((item,index)=>{
          const value=Math.max(0,Math.min(100,metricValue(item,metric)));
          return <div key={item.label} role="listitem" tabIndex={0}
            className={`team-rate-gauge${activeLabel===item.label?' active':''}`}
            style={{'--gauge-color':teamColors.get(item.label),'--gauge-value':`${value*3.6}deg`,'--i':index}}
            onMouseEnter={()=>setActiveLabel(item.label)} onMouseLeave={()=>setActiveLabel('')}
            onFocus={()=>setActiveLabel(item.label)} onBlur={()=>setActiveLabel('')}
            aria-label={`${item.label}, ${fmtPercent(value)} ${definition.noun}`}>
            <div className="team-rate-gauge-ring"><div className="team-rate-gauge-center"><strong>{fmtPercent(value)}</strong></div></div>
            <span className="team-rate-gauge-label">{item.label}</span>
          </div>;
        })}
      </div>}
      <div className="team-share-list" role="list" aria-label={`Teams ranked by ${definition.noun}`}>
        {rows.map((item,index)=>{
          const comparisonItem=metricComparison(comparisonByLabel.get(item.label),item,metric);
          return <div key={item.label} role="listitem" tabIndex={0} className="team-share-row"
            style={{'--i':index}}
            onMouseEnter={()=>setActiveLabel(item.label)} onMouseLeave={()=>setActiveLabel('')}
            onFocus={()=>setActiveLabel(item.label)} onBlur={()=>setActiveLabel('')}
            aria-label={`${item.label}, ${fmtPercent(metricValue(item,metric))} ${definition.noun}${comparisonItem?`, ${selectedMetricDeltaAriaText(comparisonItem,metric)}`:''}`}>
            <span className="team-share-rank">{index+1}</span>
            <i style={{background:teamColors.get(item.label)}}/>
            <strong>{item.label}</strong>
            <span className="team-share-value-wrap">
              <span className="team-share-value">{fmtPercent(metricValue(item,metric))}</span>
              <ComparisonDelta comparison={comparisonItem} metric={metric}/>
            </span>
            <MetricTooltip item={item} comparison={comparisonItem} metric={metric} eyebrow={`Team ${definition.noun}`}/>
          </div>;
        })}
      </div>
    </div>
  </>;
}

// Presentation-only POD summary. Unlike ARR/opportunity win rates, contribution
// is a true part-to-whole measure, so one segmented donut is mathematically
// meaningful here. The displayed Top N keeps its real share of total Won ARR;
// any unshown or unmapped share remains the neutral part of the ring rather
// than being renormalized to 100%.
export function PodContributionRail({items,comparisons,topN=5}){
  const metric='contribution';
  const rows=useMemo(()=>sortMetricRows(items,metric,'desc').slice(0,Math.max(1,topN||5)),[items,topN]);
  const [activeLabel,setActiveLabel]=useState('');
  const comparisonByLabel=useMemo(()=>new Map((comparisons||[]).map(item=>[item.label,item])),[comparisons]);
  const colors=useMemo(()=>new Map(rows.map((item,index)=>[item.label,podRankColor(index+1)])),[rows]);

  if(!rows.length)return <div className="empty">No POD contribution data for the active filters.</div>;

  const size=220;
  const radius=78;
  const circumference=2*Math.PI*radius;
  const displayedShare=rows.reduce((sum,item)=>sum+Math.max(0,metricValue(item,metric)),0);
  const scale=displayedShare>100?100/displayedShare:1;
  let offset=0;
  const segments=rows.map((item,index)=>{
    const share=Math.max(0,metricValue(item,metric))*scale;
    const length=share/100*circumference;
    const segment={item,index,length,offset};
    offset+=length;
    return segment;
  }).filter(segment=>segment.length>0);
  const remainder=Math.max(0,circumference-offset);

  return <div className="pod-contribution-rail-chart">
    <div className={`pod-rail-donut${activeLabel?' has-active':''}`}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-labelledby="pod-rail-title pod-rail-desc">
        <title id="pod-rail-title">Won ARR contribution by POD</title>
        <desc id="pod-rail-desc">The donut shows each displayed POD's share of total filtered Won ARR. The neutral remainder represents PODs outside the displayed Top N or unassigned Won ARR.</desc>
        <circle className="pod-rail-track" cx={size/2} cy={size/2} r={radius}/>
        <g transform={`rotate(-90 ${size/2} ${size/2})`}>
          {segments.map(({item,index,length,offset:segmentOffset})=><circle key={item.label}
            className={`pod-rail-segment${activeLabel===item.label?' active':''}`}
            cx={size/2} cy={size/2} r={radius}
            stroke={colors.get(item.label)}
            strokeDasharray={`${Math.max(0,length-3)} ${circumference-Math.max(0,length-3)}`}
            strokeDashoffset={-segmentOffset}
            style={{'--i':index}}
            onMouseEnter={()=>setActiveLabel(item.label)} onMouseLeave={()=>setActiveLabel('')}>
            <title>{`${item.label}: ${fmtPercent(metricValue(item,metric))} of total Won ARR`}</title>
          </circle>)}
          {remainder>.5&&<circle className="pod-rail-remainder" cx={size/2} cy={size/2} r={radius}
            strokeDasharray={`${remainder} ${circumference-remainder}`} strokeDashoffset={-offset}/>} 
        </g>
      </svg>
      <div className="pod-rail-center"><strong>{rows.length}</strong><span>PODs</span></div>
    </div>

    <div className="pod-rail-section-label">Won ARR contribution</div>
    <div className="pod-rail-list" role="list" aria-label="PODs ranked by Won ARR contribution">
      {rows.map((item,index)=>{
        const comparisonItem=metricComparison(comparisonByLabel.get(item.label),item,metric);
        const current=Math.max(0,Math.min(100,metricValue(item,metric)));
        return <div key={item.label} role="listitem" tabIndex={0}
          className={`pod-rail-row${activeLabel===item.label?' active':''}`}
          style={{'--pod-color':colors.get(item.label),'--i':index}}
          onMouseEnter={()=>setActiveLabel(item.label)} onMouseLeave={()=>setActiveLabel('')}
          onFocus={()=>setActiveLabel(item.label)} onBlur={()=>setActiveLabel('')}
          aria-label={`${item.label}, ${fmtPercent(current)} of total Won ARR, ${fmtNumber(item.closed)} closed opportunities, ${fmtNumber(item.wins)} won and ${fmtNumber(item.losses)} lost`}>
          <div className="pod-rail-row-head"><i/><strong>{item.label}</strong><b>{fmtPercent(current)}</b></div>
          <div className="pod-rail-progress"><span style={{width:`${current}%`}}/></div>
          <div className="pod-rail-row-foot"><span>{fmtNumber(item.closed)} closed · {fmtNumber(item.wins)} won / {fmtNumber(item.losses)} lost</span><ComparisonDelta comparison={comparisonItem} metric={metric}/></div>
          <MetricTooltip item={item} comparison={comparisonItem} metric={metric} eyebrow="POD Won ARR contribution · selected period"/>
        </div>;
      })}
    </div>
    <div className="pod-rail-note">Donut and rows use each POD's share of total filtered Won ARR.</div>
  </div>;
}

export function OrgTypeFillBars({items,comparisons,metric,dimension='organisation type'}){
  const definition=percentageView(metric);
  const [sortDirection,setSortDirection]=useState('desc');
  const rows=useMemo(()=>sortMetricRows(items,metric,sortDirection),[items,metric,sortDirection]);
  const [spotlight,setSpotlight]=useState('');
  const comparisonByLabel=useMemo(()=>new Map((comparisons||[]).map(item=>[item.label,item])),[comparisons]);
  if(!rows.length)return <div className="empty">No {dimension} data for the active filters.</div>;

  const hasComparison=rows.some(item=>comparisonByLabel.get(item.label)?.hasPrevious);
  return <>
    <div className="chart-inline-controls"><SortButton direction={sortDirection} onChange={setSortDirection} label={definition.noun}/></div>
    <div className="org-fill-chart" role="list" aria-label={`${definition.noun} by ${dimension} on a zero to one hundred percent scale`}>
      <div className="org-fill-key"><span><i className="current"/>Selected-period {definition.noun}</span>{hasComparison&&<span><i className="previous"/>Previous-period position</span>}</div>
      {rows.map((item,index)=>{
        const comparisonItem=metricComparison(comparisonByLabel.get(item.label),item,metric);
        const current=Math.max(0,Math.min(100,metricValue(item,metric)));
        const previous=comparisonItem?.hasPrevious?Math.max(0,Math.min(100,Number(comparisonItem.previous)||0)):null;
        const closed=Number(item.closed)||0;
        const wins=Number(item.wins)||0;
        const losses=Number(item.losses)||0;
        return <div key={item.label} role="listitem" tabIndex={0} className={`org-fill-row${spotlight===item.label?' active':''}`}
          style={{'--mark-color':categoryColor(item.label),'--i':index}}
          onMouseEnter={()=>setSpotlight(item.label)} onMouseLeave={()=>setSpotlight('')}
          onFocus={()=>setSpotlight(item.label)} onBlur={()=>setSpotlight('')}
          aria-label={`${item.label}, selected period ${fmtPercent(current)}, ${fmtNumber(closed)} closed opportunities, ${fmtNumber(wins)} won and ${fmtNumber(losses)} lost${previous==null?'':`, previous period ${fmtPercent(previous)}`}${comparisonItem?`, ${selectedMetricDeltaAriaText(comparisonItem,metric)}`:''}`}>
          <strong className="org-fill-label">{item.label}</strong>
          <div className="org-fill-track">
            <span className="org-fill-value" style={{width:`${current}%`}}/>
            {previous!=null&&<span className="org-fill-previous" style={{left:`${previous}%`}}><em>{fmtPercent(previous)}</em></span>}
          </div>
          <span className="org-fill-summary"><strong>{fmtPercent(current)}</strong></span>
          <ComparisonDelta comparison={comparisonItem} metric={metric}/>
          <MetricTooltip item={item} comparison={comparisonItem} metric={metric} eyebrow={`${dimension} ${definition.noun}`}/>
        </div>;
      })}
      <div className="org-fill-axis-row" aria-hidden="true">
        <span/>
        <div className="org-fill-axis"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
      </div>
    </div>
  </>;
}

// Semicircle gauge for the presentation POD card (hand-drawn reference: name
// on top, the gauge's own open belly holds the value readout, previous-period
// marker rides the arc, a tick marks the 50% reference point). pathLength=100
// on the fill arc maps 0-100(%) directly to stroke-dasharray with no angle
// math; the marker still needs trig since it's a point, not a dash offset.
// cx-r,cy -> cx+r,cy sweeping through the top matches t=0..1 for both.
function PodGauge({current,previous}){
  const cx=100,cy=95,r=78,sw=14;
  const arcPath=`M ${cx-r},${cy} A ${r},${r} 0 0 1 ${cx+r},${cy}`;
  const clamped=Math.max(0,Math.min(100,current));
  const hasPrevious=previous!=null;
  const t=hasPrevious?Math.max(0,Math.min(100,previous))/100:0;
  const markerX=cx-r*Math.cos(t*Math.PI);
  const markerY=cy-r*Math.sin(t*Math.PI);
  // Keep the marker value close to its point while clamping the text inside
  // the compact viewBox. This avoids both the old permanent side gutters and
  // clipping at the 0%, 50%, and 100% positions.
  const labelR=r+20;
  const rawLabelX=cx-labelR*Math.cos(t*Math.PI);
  const rawLabelY=cy-labelR*Math.sin(t*Math.PI);
  const labelX=Math.max(32,Math.min(168,rawLabelX));
  const labelY=Math.max(12,Math.min(92,rawLabelY));
  return <svg className="pod-gauge" viewBox="0 0 200 104" role="img" aria-hidden="true">
    <path className="pod-gauge-track" d={arcPath} strokeWidth={sw} fill="none"/>
    <path className="pod-gauge-fill" d={arcPath} strokeWidth={sw} fill="none" pathLength={100} strokeDasharray={`${clamped} ${100-clamped}`}/>
    <line className="pod-gauge-tick" x1={cx} y1={cy-r-sw/2-3} x2={cx} y2={cy-r+sw/2+3}/>
    {hasPrevious&&<>
      <circle className="pod-gauge-marker" cx={markerX} cy={markerY} r={6.5}/>
      <text className="pod-gauge-marker-label" x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle">{fmtPercent(previous)}</text>
    </>}
  </svg>;
}

export function PodRadialScorecards({items,comparisons,metric,topN=5,layout='grid',showCenterLabel=true,previousPeriodLabel='',showContext=false,comparisonBesideGauge=false}){
  const definition=percentageView(metric);
  const [sortDirection,setSortDirection]=useState('desc');
  const rankedRows=useMemo(()=>sortMetricRows(items,metric,'desc').map((item,index)=>({item,rank:index+1})),[items,metric]);
  const selectedRows=useMemo(()=>topN>0?rankedRows.slice(0,topN):rankedRows,[rankedRows,topN]);
  const rankByLabel=useMemo(()=>new Map(rankedRows.map(({item,rank})=>[item.label,rank])),[rankedRows]);
  const rows=useMemo(()=>sortMetricRows(selectedRows.map(({item})=>item),metric,sortDirection)
    .map(item=>({item,rank:rankByLabel.get(item.label)})),[selectedRows,metric,sortDirection,rankByLabel]);
  const [spotlight,setSpotlight]=useState('');
  const comparisonByLabel=useMemo(()=>new Map((comparisons||[]).map(item=>[item.label,item])),[comparisons]);
  if(!rows.length)return <div className="empty">No POD data for the active filters.</div>;

  const hasComparison=rows.some(({item})=>comparisonByLabel.get(item.label)?.hasPrevious);
  const withContext=layout==='list'||showContext;
  // Automatic sizing (dashboard grid mode only — the gauge branch below
  // already sizes its fill arc by value): ring diameter/thickness/value-font
  // interpolate continuously against the top POD's value instead of a fixed
  // 4-tier rank lookup (224/190/160/124px for rank 1/2/3/rest). The old tiers
  // meant two "rest"-ranked PODs — one at 40%, one at 5% — rendered identical
  // rings; a rank-2 POD barely behind rank-1 rendered visibly smaller anyway.
  const maxValue=Math.max(...rows.map(({item})=>metricValue(item,metric)),0.0001);
  return <>
    <div className="chart-inline-controls"><SortButton direction={sortDirection} onChange={setSortDirection} label={`POD ${definition.noun}`}/></div>
    <div className="pod-scorecard-key">
      <span><i className={withContext?'pod-key-gauge':'pod-key-arc'}/>{withContext?'Gauge':'Ring'} = selected-period {definition.noun}</span>
      {hasComparison&&<span><i className="pod-key-marker"/>Marker = previous-period {definition.noun}</span>}
      {hasComparison&&<span className="pod-growth-key">↑/↓ = {definition.noun} change vs previous period</span>}
    </div>
    <div className={`pod-scorecard-grid${layout==='list'?' pod-scorecard-grid--list':''}`} role="list" aria-label={`${topN>0?`Top ${Math.min(topN,rankedRows.length)}`:'All'} PODs ranked by ${definition.noun}`}>
      {rows.map(({item,rank},index)=>{
        const comparisonItem=metricComparison(comparisonByLabel.get(item.label),item,metric);
        const current=Math.max(0,Math.min(100,metricValue(item,metric)));
        const previous=comparisonItem?.hasPrevious&&Number.isFinite(Number(comparisonItem.previous))
          ?Math.max(0,Math.min(100,Number(comparisonItem.previous))):null;
        const ariaLabel=`Rank ${rank}, ${item.label}, selected-period ${definition.noun} ${fmtPercent(current)}${previous==null?'':`, previous-period ${definition.noun} ${fmtPercent(previous)}`}${comparisonItem?`, ${selectedMetricDeltaAriaText(comparisonItem,metric)}`:''}`;

        // Presentation (TV rail / Loss Board list) swaps the dashboard's full
        // 360deg ring for a semicircle gauge, per a hand-drawn reference:
        // name on top, the gauge's own open belly holds the big current-value
        // readout, previous-period marker rides the arc, delta pill anchors
        // the bottom. A gauge reads as a meter at a glance in a way a full
        // ring (which needs comparing against its own unfilled remainder)
        // doesn't, and its open belly is purpose-built for the value text
        // instead of squeezing it into a ring's tight center. The rank badge
        // stays from the earlier list/showContext treatment.
        if(withContext)return <div key={item.label} role="listitem" tabIndex={0}
          className={`pod-gauge-card${spotlight===item.label?' active':''}`}
          style={{'--pod-color':podRankColor(rank),'--i':index}}
          onMouseEnter={()=>setSpotlight(item.label)} onMouseLeave={()=>setSpotlight('')}
          onFocus={()=>setSpotlight(item.label)} onBlur={()=>setSpotlight('')}
          aria-label={ariaLabel}>
          <span className="pod-list-rank">{rank}</span>
          <h4>{item.label}</h4>
          <div className="pod-gauge-body">
            <div className="pod-gauge-wrap">
              <PodGauge current={current} previous={previous}/>
              <div className="pod-gauge-value-row">
                <span className="pod-gauge-value">{fmtPercent(current)}</span>
                {!comparisonBesideGauge&&<ComparisonDelta comparison={comparisonItem} metric={metric}/>}
              </div>
            </div>
            <div className="pod-gauge-details">
              <div className="pod-gauge-value-row pod-gauge-value-row-inline">
                <strong className="pod-gauge-value-inline">{fmtPercent(current)}</strong>
                {!comparisonBesideGauge&&<ComparisonDelta comparison={comparisonItem} metric={metric}/>}
              </div>
              {comparisonBesideGauge&&<ComparisonDelta comparison={comparisonItem} metric={metric}/>}
              {previous!=null&&<small>{previousPeriodLabel||`Previous ${definition.noun}`}: {fmtPercent(previous)}</small>}
            </div>
          </div>
          <MetricTooltip item={item} comparison={comparisonItem} metric={metric} eyebrow={`POD ${definition.noun} · selected period`}/>
        </div>;

        const sizeRatio=Math.max(0,Math.min(1,current/maxValue));
        return <div key={item.label} role="listitem" tabIndex={0} className={`pod-scorecard ${rank<=3?`pod-rank-${rank}`:'pod-rank-rest'}${spotlight===item.label?' active':''}`}
          style={{'--pod-color':podRankColor(rank),'--pod-value':`${current*3.6}deg`,'--i':index,
            '--pod-ring-size':`${124+100*sizeRatio}px`,'--pod-ring-thickness':`${11+7*sizeRatio}px`,'--pod-value-font':`${22+12*sizeRatio}px`}}
          onMouseEnter={()=>setSpotlight(item.label)} onMouseLeave={()=>setSpotlight('')}
          onFocus={()=>setSpotlight(item.label)} onBlur={()=>setSpotlight('')}
          aria-label={ariaLabel}>
          <div className="pod-score-ring">
            {previous!=null&&<span className="pod-score-previous-marker" style={{transform:`rotate(${previous*3.6}deg)`}}>
              <i/><em style={{transform:`rotate(${-previous*3.6}deg)`}}>{fmtPercent(previous)}</em>
            </span>}
            <div className="pod-score-center"><strong>{fmtPercent(current)}</strong>{showCenterLabel&&<span>{definition.shortLabel}</span>}</div>
          </div>
          <h4>{item.label}</h4>
          {previous!=null&&<small>{previousPeriodLabel||`Previous ${definition.noun}`}: {fmtPercent(previous)}</small>}
          <ComparisonDelta comparison={comparisonItem} metric={metric}/>
          <MetricTooltip item={item} comparison={comparisonItem} metric={metric} eyebrow={`POD ${definition.noun} · selected period`}/>
        </div>;
      })}
    </div>
  </>;
}

export function RankFunnel({items,comparisons,metric,dimension='industry',dimensionLabel='Industry',dimensionPlural='industries'}){
  const definition=percentageView(metric);
  const [sortDirection,setSortDirection]=useState('desc');
  const rows=useMemo(()=>sortMetricRows(items,metric,sortDirection).slice(0,5).map((item,index)=>({item,rank:index+1})),[items,metric,sortDirection]);
  const [spotlight,setSpotlight]=useState('');
  if(!rows.length)return <div className="empty">No {dimension} data for the active filters.</div>;

  const comparisonByLabel=new Map((comparisons||[]).map(item=>[item.label,item]));
  // Start with value-proportional widths, then enforce enough taper between
  // adjacent ranks for the lower edge of one trapezoid to remain wider than
  // the upper edge of the next. Without this clearance, close values (for
  // example 11.6% and 11.4%) can make rank 4 look wider than rank 3 because
  // of the trapezoid's clipped/sloping sides.
  const maxValue=Math.max(...rows.map(({item})=>metricValue(item,metric)),0.0001);
  const segmentWidths=[];
  rows.forEach(({item},index)=>{
    const proportional=Math.max(40,(metricValue(item,metric)/maxValue)*100);
    segmentWidths.push(index===0?100:Math.min(proportional,segmentWidths[index-1]*.92));
  });
  return <>
    <div className="chart-inline-controls"><SortButton direction={sortDirection} onChange={setSortDirection} label={definition.noun}/></div>
    <div className="rank-funnel" role="list" aria-label={`Top five ${dimensionPlural} ranked by ${definition.noun}`}>
      {rows.map(({item,rank},index)=>{
        const itemComparison=metricComparison(comparisonByLabel.get(item.label),item,metric);
        const segmentWidth=segmentWidths[index];
        return <div key={item.label} role="listitem" tabIndex={0}
          className={`rank-funnel-row rank-${rank}${rank<=3?' rank-highlight':''}${spotlight===item.label?' active':''}`}
          style={{'--segment-width':`${segmentWidth}%`,'--i':index}}
          onMouseEnter={()=>setSpotlight(item.label)} onMouseLeave={()=>setSpotlight('')}
          onFocus={()=>setSpotlight(item.label)} onBlur={()=>setSpotlight('')}
          aria-label={`Rank ${rank}, ${item.label}, ${fmtPercent(metricValue(item,metric))} ${definition.noun}${itemComparison?`, ${selectedMetricDeltaAriaText(itemComparison,metric)}`:''}`}>
          <div className="rank-funnel-segment">
            <span className="rank-funnel-badge">{rank}</span>
            <strong>{item.label}</strong>
            <span className="rank-funnel-values"><b>{fmtPercent(metricValue(item,metric))}</b><em>{definition.shortLabel}</em>
              <ComparisonDelta comparison={itemComparison} metric={metric}/></span>
          </div>
          <MetricTooltip item={item} comparison={itemComparison} metric={metric} eyebrow={`${dimensionLabel} performance · #${rank} by ${definition.noun}`}/>
        </div>;
      })}
      <div className="rank-funnel-key"><span><i/>Ranked by {definition.noun}</span><span>Displayed % = {definition.formula}</span></div>
    </div>
  </>;
}

// Extracted so the presentation layer can show the exact same KPI strip
// (all five tiles) rather than a separate, simplified subset.
export function WinRateSummary({overall,comparison}){
  return <section className="win-rate-summary" aria-labelledby="win-rate-summary-title">
    <div className="win-rate-summary-head"><span id="win-rate-summary-title">Win-rate summary</span><small>Selected opportunity scope</small></div>
    {comparison.available&&comparison.period&&<div className="win-rate-summary-period">
      Comparing <b>{shortDate(comparison.period.currentFrom)} – {shortDate(comparison.period.currentTo)}</b> against the previous period <b>{shortDate(comparison.period.previousFrom)} – {shortDate(comparison.period.previousTo)}</b>
    </div>}
    <div className="win-rate-summary-metrics">
      <div className="win-rate-summary-metric arr-rate"><span>ARR win rate</span><strong>{fmtPercent(overall.arrWinRate)}</strong><small>Won ARR ÷ Closed ARR</small><KpiDelta value={comparison.arrWinRatePointChange}/></div>
      <div className="win-rate-summary-metric deal-rate"><span>Opportunity win rate</span><strong>{fmtPercent(overall.dealWinRateOfAll)}</strong><small>Won ÷ all opportunities, open + closed</small><KpiDelta value={comparison.dealWinRateOfAllPointChange}/></div>
      <div className="win-rate-summary-metric open-opp-rate"><span>Open opportunity %</span><strong>{fmtPercent(overall.openOppRate)}</strong><small>Open ÷ all opportunities, by count</small><KpiDelta value={comparison.openOppRatePointChange}/></div>
      <div className="win-rate-summary-counts"><span>Opportunities</span>
        <div className="win-rate-summary-counts-grid">
          <div className="count-total"><b>{fmtNumber(overall.opportunities)}</b><small>Total</small></div>
          <div className="count-open"><b>{fmtNumber(overall.open)}</b><small>Open</small></div>
          <div className="count-closed"><b>{fmtNumber(overall.closed)}</b><small>Closed</small></div>
          <div className="count-won"><b>{fmtNumber(overall.wins)}</b><small>Won</small></div>
          <div className="count-lost"><b>{fmtNumber(overall.losses)}</b><small>Lost</small></div>
        </div>
      </div>
      <div className="win-rate-summary-metric open-arr-rate"><span>Open ARR %</span><strong>{fmtPercent(overall.openArrPct)}</strong><small>Open ARR ÷ Total ARR</small><KpiDelta value={comparison.openArrPctPointChange}/></div>
    </div>
  </section>;
}

// Instant local seed, mirroring the pattern Dashboard.jsx uses for Opportunity
// Analytics, so Win Board also has a fast pre-hydration cache and a fallback
// if the backend request fails.
const savedWinBoardState = () => {
  try { return JSON.parse(localStorage.getItem(`testmu-dashboard-state-${TEMPLATE}`) || '{}'); }
  catch { return {}; }
};

export default function WinBoard({user}){
  const navigate=useNavigate();
  const {signOut}=useAuth();
  const [filters,setFilters]=useState(()=>{
    const local=savedWinBoardState().filters;
    return local?Object.fromEntries(FILTER_KEYS.map(key=>[key,local[key]??EMPTY[key]])):EMPTY;
  });
  const [options,setOptions]=useState({region:[],orgType:[],industry:[],type:[]});
  const [optionsReady,setOptionsReady]=useState(false);
  const [metrics,setMetrics]=useState(EMPTY_METRICS);
  const [loading,setLoading]=useState(true);
  const [topN,setTopN]=useState(()=>{
    const v=Number(savedWinBoardState().tableTops?.industry);
    return Number.isFinite(v)?v:5;
  });
  const [podTopN,setPodTopN]=useState(()=>{
    const v=Number(savedWinBoardState().tableTops?.pod);
    return [0,5,10,20].includes(v)?v:5;
  });
  const [hydrated,setHydrated]=useState(false);
  const [comparison,setComparison]=useState({available:false});
  const [loadError,setLoadError]=useState('');
  const [filterPanelOpen,setFilterPanelOpen]=useState(false);
  const [percentageMetric,setPercentageMetric]=useState(()=>{
    const v=savedWinBoardState().tableSorting?.percentageMetric;
    return PERCENTAGE_VIEWS[v]?v:DEFAULT_PERCENTAGE_VIEW;
  });

  useEffect(()=>{getDashboardState(TEMPLATE).then(state=>{
    if(state?.filters)setFilters(Object.fromEntries(FILTER_KEYS.map(key=>[key,state.filters[key]??EMPTY[key]])));
    if(Number.isFinite(Number(state?.tableTops?.industry)))setTopN(Number(state.tableTops.industry));
    if([0,5,10,20].includes(Number(state?.tableTops?.pod)))setPodTopN(Number(state.tableTops.pod));
    if(PERCENTAGE_VIEWS[state?.tableSorting?.percentageMetric])setPercentageMetric(state.tableSorting.percentageMetric);
  }).finally(()=>setHydrated(true));},[]);
  useEffect(()=>{if(!hydrated)return;const timer=setTimeout(()=>{
    const state={view:'win-board',filters,tableTops:{industry:topN,pod:podTopN},tableSorting:{percentageMetric}};
    localStorage.setItem(`testmu-dashboard-state-${TEMPLATE}`,JSON.stringify(state));
    saveDashboardState(TEMPLATE,state).catch(()=>{});
  },500);return()=>clearTimeout(timer);},[filters,topN,podTopN,percentageMetric,hydrated]);
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);setLoadError('');setComparison({available:false});
    getWinBoardSnapshot(filters).then(snapshot=>{
      if(cancelled)return;
      setMetrics(snapshot.metrics||EMPTY_METRICS);
      setComparison(snapshot.comparison||{available:false});
    }).catch(error=>{
      if(cancelled)return;
      setMetrics(EMPTY_METRICS);setComparison({available:false});
      setLoadError(error.response?.data?.error||error.message||'Could not load Win Board data');
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

  const {overall,teams,orgTypes,pods}=metrics;
  const groupComparisons=comparison.groups||{};
  const percentageDefinition=percentageView(percentageMetric);
  const rankedIndustries=useMemo(()=>sortMetricRows(metrics.industries||[],percentageMetric,'desc'),[metrics.industries,percentageMetric]);
  const industries=topN>0?rankedIndustries.slice(0,topN):rankedIndustries;

  if(loading&&!metrics.trend.monthly.length)return <AppLoader fullscreen label="Loading Win Board…"/>;
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
    const config={filters,percentageMetric,topN,podTopN};
    localStorage.setItem('testmu-winboard-presentation-config',JSON.stringify(config));
    saveDashboardState(TEMPLATE,{view:'win-board',filters,tableTops:{industry:topN,pod:podTopN},
      tableSorting:{percentageMetric},presentationSettings:{view:'win-board'}}).catch(()=>{});
    window.open('/present/win-board','_blank','noopener');
  };

  return <ComparisonProvider value={comparison}><div className="wrap win-board-wrap"><div className="top-nav" style={{margin:'-18px -18px 18px'}}>
    <div className="brand" onClick={()=>navigate('/gallery')} style={{cursor:'pointer'}}><img className="brand-logo" src="/testmu-bi-logo-v2.png" alt="TestMu BI"/><span>TestMu BI</span></div>
    <div className="user-pill"><ThemeToggle/><span>{user?.name||'User'}</span><button className="btn-secondary" onClick={signOut}>Sign out</button></div></div>
    <header className="top"><div className="top-row"><div><h1>Win Board</h1><div className="sub">Won ARR is the primary measure; deal win rate is supporting context. <strong>Opportunity type = New Business, New Business AM and Existing Business Up-Sell.</strong></div>
      {/* Spelled out on the board itself: "contribution" reads like a rate to
          anyone who has not been told otherwise, and the share-of-total
          reading is the one that makes the charts add up. */}
      {/* Named categories and a worked example rather than a formula: the
          confusion this clears up is "share of the total" vs "win rate", and
          a concrete number settles that faster than ÷ and × ever will. */}
      <div className="metric-definition">
        <b>Won ARR contribution %</b> — how much of the total Won ARR each team, industry, org type or POD brought in.
        <span className="metric-definition-example">Example: a POD showing <b>40%</b> won <b>$40 of every $100</b> of Won ARR on screen. It does <b>not</b> mean it won 40% of its deals.</span>
        <span className="metric-definition-note">Every slice on a chart adds up to 100%.</span>
      </div></div>
      <button type="button" className="present-button" onClick={startPresentation}>▶ Present</button></div>
      <div className="filters win-board-filter-shelf">{filterDefs.map(([key,label])=><MultiSelect key={key} label={label} options={options[key]||[]} value={filters[key]} onChange={value=>updateFilter(key,value)}/>) }
        <PercentageViewSelect value={percentageMetric} onChange={setPercentageMetric}/>
        <AdvancedDateRange filters={filters} setFilters={setFilters}/>
        <button className="btn-secondary filter-reset-button" onClick={()=>setFilters(EMPTY)}>Reset</button></div></header>

    {!loading && (loadError || !overall.opportunities) ? <div className="card win-board-empty">
      <div className="win-board-empty-icon">↻</div><div><h3>{loadError ? 'Win Board could not load' : 'No Win Board data is loaded'}</h3>
        <p>{loadError || 'Refresh the connected Tableau source or load the mapped source again. Uploaded business rows are kept only in the current server session.'}</p></div>
      <button type="button" className="btn-primary" onClick={()=>navigate('/data-sources')}>Open data sources</button>
    </div> : <>
      <WinRateSummary overall={overall} comparison={comparison}/>

      <div className="g2"><ChartCard showComparison={false} title={`${percentageDefinition.label} trend`} hint={`Tracks ${percentageDefinition.plain} across ${metrics.trendYear||'the'} year, month by month or quarter by quarter — compared with ${comparison.previousTrendYear||'the prior year'}.`}>
        <TrendChart trend={metrics.trend} previousTrend={comparison.previousTrend} metric={percentageMetric} year={metrics.trendYear} previousYear={comparison.previousTrendYear}/></ChartCard>
        <ChartCard showComparison={false} title={`${percentageDefinition.label} by team`} hint={`Shows ${percentageDefinition.plain}, broken down by team. ${percentageMetric==='contribution'?'Segments add up to the whole.':'Each team has its own independent 0-100% gauge.'}`}><TeamContributionDonut items={teams} comparisons={groupComparisons.teams} metric={percentageMetric}/></ChartCard></div>
      <div className="g2"><ChartCard showComparison={false} title={`Top industries by ${percentageDefinition.label}`} hint={`The industries with the highest ${percentageDefinition.plain}, ranked highest first.`}
        controls={<select className="table-top-select" value={topN} onChange={event=>setTopN(Number(event.target.value))}><option value="5">Top 5</option><option value="10">Top 10</option><option value="20">Top 20</option><option value="0">All</option></select>}>
        {topN===5?<RankFunnel items={industries} comparisons={groupComparisons.industries} metric={percentageMetric}/>:<PercentChart items={industries} comparisons={groupComparisons.industries} metric={percentageMetric} label={percentageDefinition.shortLabel} heading="Industry performance"/>}</ChartCard>
        <ChartCard showComparison={false} title={`${percentageDefinition.label} by org type`} hint={`Shows ${percentageDefinition.plain}, broken down by org type. The small circle marks where it stood last period.`}><OrgTypeFillBars items={orgTypes} comparisons={groupComparisons.orgTypes} metric={percentageMetric}/></ChartCard></div>
      <ChartCard showComparison={false} title={`${percentageDefinition.label} by POD`} hint={`Shows ${percentageDefinition.plain}, broken down by POD. The ring is this period; the dot marks last period.`}
        controls={<select className="table-top-select" aria-label="Number of PODs to display" value={podTopN} onChange={event=>setPodTopN(Number(event.target.value))}><option value="5">Top 5</option><option value="10">Top 10</option><option value="20">Top 20</option><option value="0">All</option></select>}>
        <PodRadialScorecards items={pods} comparisons={groupComparisons.pods} metric={percentageMetric} topN={podTopN}/></ChartCard>
    </>}

    <button type="button" className="floating-filter-button" aria-label="Open Win Board filters" title="Win Board filters" onClick={()=>setFilterPanelOpen(open=>!open)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="13" cy="18" r="2"/></svg>
      {activeFilterCount>0
        ?<span className="floating-filter-badge">{activeFilterCount}</span>
        :hasAnyTouchedFilter&&<span className="floating-filter-badge floating-filter-badge-dot" aria-label="Filters set to All"/>}
    </button>

    {filterPanelOpen&&<aside className="floating-filter-panel" aria-label="Win Board filters">
      <div className="floating-filter-head"><div><b>Win Board filters</b><span>{fmtNumber(overall.opportunities)} opportunities</span></div>
        <button type="button" aria-label="Close filters" onClick={()=>setFilterPanelOpen(false)}>×</button></div>
      <div className="floating-filter-controls">{filterDefs.map(([key,label])=><MultiSelect key={key} label={label} options={options[key]||[]} value={filters[key]} onChange={value=>updateFilter(key,value)}/>)}
        <PercentageViewSelect value={percentageMetric} onChange={setPercentageMetric}/>
        <AdvancedDateRange filters={filters} setFilters={setFilters}/></div>
      <button className="floating-filter-reset" type="button" onClick={()=>setFilters(EMPTY)}>Reset all filters</button>
    </aside>}
  </div></ComparisonProvider>;
}

function ComparisonDelta({comparison,metric='arrWinRate'}){
  if(!comparison)return null;
  const definition=percentageView(metric);
  const number=Number(comparison.changePoints);
  const hasBaseline=comparison.hasPrevious&&Number.isFinite(number);
  const direction=!hasBaseline?'flat':comparisonToneDirection(number,LOWER_IS_BETTER_METRICS.has(metric));
  const title=!comparison.hasPrevious
    ?`New category: ${definition.noun} has no previous-period baseline`
    :!hasBaseline
      ?`${definition.noun} change is unavailable`
      :`${definition.noun} change versus previous period: ${number>0?'+':''}${number.toFixed(1)} percentage points`;
  return <span className={`bar-comparison-delta comparison-${direction}`}
    title={title} aria-label={title}>
    {comparison.hasPrevious?selectedMetricDeltaText(comparison):'New'}
  </span>;
}
