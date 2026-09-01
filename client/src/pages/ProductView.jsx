import {useEffect,useMemo,useRef,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import Chart from 'chart.js/auto';
import {getProductPipelineSnapshot,getProductWonSnapshot,getOptions,getDashboardState,saveDashboardState} from '../lib/api';
import {MultiSelect,ChartCard,fmtNumber,fmtPercent,fmtCurrency,baseOptions,Pill,rateTone,Th} from '../components/charts';
import ThemeToggle from '../components/ThemeToggle';
import DashboardSwitcher from '../components/DashboardSwitcher';
import RefreshDataButton from '../components/RefreshDataButton';
import AdvancedDateRange,{isoDate,rangeFor} from '../components/AdvancedDateRange';
import AppLoader from '../components/AppLoader';
import {Hideable} from '../components/Hideable';
import {useAuth} from '../hooks/useAuth';

export const TEMPLATE='product-view';
const [DEFAULT_QUARTER_START,DEFAULT_QUARTER_TODAY]=rangeFor('currentQuarter');

// Two views, one board: Pipeline is scoped by the Opp CREATED date, Won ARR
// by the Opp CLOSE date, and each keeps its own filter state — the spec's
// core rule is that touching one view's filters must never move the other.
const CATEGORY_KEYS=['productGroup','product','type','orgType','pod','stage','owner','continentGroup'];
const emptyFilters=(fromKey,toKey)=>({
  ...Object.fromEntries(CATEGORY_KEYS.map(key=>[key,[]])),
  [fromKey]:isoDate(DEFAULT_QUARTER_START),[toKey]:isoDate(DEFAULT_QUARTER_TODAY),
  datePreset:'currentQuarter',dateCount:4,dateUnit:'quarter',
});
export const EMPTY_PIPELINE=emptyFilters('createdFrom','createdTo');
export const EMPTY_WON=emptyFilters('closeFrom','closeTo');

// Opportunity Type defaults to the new-business trio on BOTH views. Matched
// by normalised name because the source spells "Up-Sell" inconsistently.
const normalizeType=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
const DEFAULT_TYPE_SET=new Set(['newbusiness','newbusinessam','existingbusinessupsell']);
export const defaultTypes=options=>(options||[]).filter(value=>DEFAULT_TYPE_SET.has(normalizeType(value)));

export const shortDate=value=>{
  if(!value)return '';
  const [year,month,day]=String(value).split('-');
  return `${Number(day)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(month)-1]} ${year}`;
};

// ===== Chart.js plumbing shared by the board and both presentations =====
function useChart(build,deps){
  const ref=useRef(null);
  useEffect(()=>{
    if(!ref.current)return undefined;
    const chart=new Chart(ref.current,build());
    return()=>chart.destroy();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },deps);
  return ref;
}
const currencyTicks=value=>fmtCurrency(value);

// Validated categorical palette (dataviz skill's reference instance): fixed
// slot order IS the colorblind-safety mechanism — never cycle or re-order.
// Both mode sets pass scripts/validate_palette.js on this app's card
// surfaces (#FFFFFF / #1D1D1F); light mode's three sub-3:1 hues are covered
// by the relief rule — the charts carry visible value labels.
const PV_LIGHT=['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#008300','#4a3aa7','#e34948'];
const PV_DARK=['#3987e5','#d95926','#199e70','#c98500','#d55181','#008300','#9085e9','#e66767'];
const isLightTheme=()=>typeof document==='undefined'||document.documentElement.dataset.theme!=='dark';
const pvColor=index=>(isLightTheme()?PV_LIGHT:PV_DARK)[index%8];
// Color follows the ENTITY, never its rank: the known product groups own
// fixed slots, "Others" is deliberately the de-emphasis gray, and a filter
// that changes the series count never repaints the survivors.
const GROUP_SLOTS={'Browser And App':0,'Agentic cloud: Hyperexecute':1,'Agentic AI':2};
const OTHERS_GRAY='#898781';
export const groupColor=label=>label==='Others'?OTHERS_GRAY
  :GROUP_SLOTS[label]!==undefined?pvColor(GROUP_SLOTS[label]):pvColor(3+(Math.abs([...String(label)].reduce((h,c)=>h*31+c.charCodeAt(0)|0,0))%5));
const ink=(token,fallback)=>{
  try{return getComputedStyle(document.documentElement).getPropertyValue(token).trim()||fallback;}
  catch{return fallback;}
};

// Selective direct labels — the agreed detail level. Bars carry their value
// at the data end; lines carry the series name + latest value at the line
// end (with a color chip, so the text itself stays in text ink).
const pvBarValues={
  id:'pvBarValues',
  afterDatasetsDraw(chart,_args,opts){
    const format=opts?.format||fmtCurrency;
    const horizontal=chart.options.indexAxis==='y';
    const {ctx}=chart;
    ctx.save();
    ctx.font='600 10.5px system-ui,-apple-system,"Segoe UI",sans-serif';
    ctx.fillStyle=ink('--txt-2','#556');
    chart.data.datasets.forEach((dataset,datasetIndex)=>{
      if(!chart.isDatasetVisible(datasetIndex))return;
      chart.getDatasetMeta(datasetIndex).data.forEach((bar,index)=>{
        const value=dataset.data[index];
        if(value===null||value===undefined||value===0)return;
        if(horizontal){ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(format(value),bar.x+5,bar.y);}
        else{ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(format(value),bar.x,bar.y-4);}
      });
    });
    ctx.restore();
  },
};
const pvLineEndLabels={
  id:'pvLineEndLabels',
  afterDatasetsDraw(chart,_args,opts){
    const format=opts?.format||fmtCurrency;
    const {ctx,chartArea}=chart;
    ctx.save();
    ctx.font='600 11px system-ui,-apple-system,"Segoe UI",sans-serif';
    ctx.textBaseline='middle';
    // Labels live in the reserved RIGHT MARGIN, never inside the plot — a
    // series that tails off to zero mid-year would otherwise drop its label
    // on top of other lines. Anchored at the y of the series' latest real
    // value, stacked apart when line ends crowd together.
    const placed=[];
    chart.data.datasets.forEach((dataset,datasetIndex)=>{
      if(!chart.isDatasetVisible(datasetIndex))return;
      const points=chart.getDatasetMeta(datasetIndex).data;
      let last=-1;
      dataset.data.forEach((value,index)=>{if(value!==null&&value!==undefined&&value!==0)last=index;});
      if(last<0||!points[last])return;
      let y=points[last].y;
      while(placed.some(existing=>Math.abs(existing-y)<14))y+=14;
      placed.push(y);
      const x=chartArea.right+6;
      ctx.fillStyle=dataset.borderColor;
      ctx.beginPath();ctx.arc(x+3,y,3,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=ink('--txt-2','#556');
      ctx.textAlign='left';
      const name=dataset.label.length>18?`${dataset.label.slice(0,17)}…`:dataset.label;
      ctx.fillText(`${name} · ${format(dataset.data[last])}`,x+10,y);
    });
    ctx.restore();
  },
};

// Custom HTML tooltip shared by every canvas chart — the native Chart.js
// tooltip can't be styled into the app's card language. It renders the
// SAME content the charts' existing callbacks produce (name: value · N
// opps, footers), just re-skinned: color dot, name left, value right in
// tabular figures, counts muted, total under a hairline.
const escapeHtml=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function renderPvTooltip(context){
  const {chart,tooltip}=context;
  const parent=chart.canvas.parentNode;
  let el=parent.querySelector(':scope > .pv-tooltip');
  if(!el){el=document.createElement('div');el.className='pv-tooltip';parent.appendChild(el);}
  if(tooltip.opacity===0){el.style.opacity='0';return;}
  const rows=(tooltip.body||[]).map((body,index)=>{
    const colors=tooltip.labelColors?.[index]||{};
    const color=colors.backgroundColor&&colors.backgroundColor!=='rgba(0,0,0,0)'?colors.backgroundColor:colors.borderColor||'#888';
    const [first,...rest]=body.lines;
    const trimmed=String(first||'').trim();
    // LAST ': ' — a series name may itself contain one ("Agentic cloud:
    // Hyperexecute"); the value part never does.
    const split=trimmed.lastIndexOf(': ');
    const name=split>0?trimmed.slice(0,split):trimmed;
    const valueText=split>0?trimmed.slice(split+2):'';
    const dot=valueText.indexOf(' · ');
    const value=dot>0?valueText.slice(0,dot):valueText;
    const extra=dot>0?valueText.slice(dot+3):'';
    const subLines=rest.map(line=>`<div class="pv-tooltip-sub">${escapeHtml(String(line).trim())}</div>`).join('');
    return `<div class="pv-tooltip-row"><i style="background:${escapeHtml(String(color))}"></i><span>${escapeHtml(name)}</span><b>${escapeHtml(value)}</b>${extra?`<small>${escapeHtml(extra)}</small>`:''}</div>${subLines}`;
  }).join('');
  const footer=(tooltip.footer||[]).map(line=>`<div class="pv-tooltip-footer">${escapeHtml(line)}</div>`).join('');
  const title=(tooltip.title||[]).join(' ');
  el.innerHTML=`${title?`<div class="pv-tooltip-title">${escapeHtml(title)}</div>`:''}${rows}${footer}`;
  el.style.opacity='1';
  // Clamp inside the card; flip below the caret when there's no headroom.
  const width=el.offsetWidth,height=el.offsetHeight,parentWidth=parent.clientWidth;
  const left=Math.max(6,Math.min(tooltip.caretX-width/2,parentWidth-width-6));
  const top=tooltip.caretY-height-12<0?tooltip.caretY+14:tooltip.caretY-height-12;
  el.style.left=`${left}px`;el.style.top=`${top}px`;
}
// Merge into a chart's tooltip config: keeps the content callbacks, swaps
// the renderer. Line charts also sort rows biggest-first.
const PV_TOOLTIP={enabled:false,external:renderPvTooltip};
const sortByValueDesc=(a,b)=>(Number(b.parsed?.y)||0)-(Number(a.parsed?.y)||0);

// Tooltip detail lines shared by the win-rate and avg-deal charts: the
// actual money and distinct opportunity counts behind each rate.
export const winLossDetail=item=>
  `${fmtNumber(item.closedWonCount)} won · ${fmtCurrency(item.closedWonArr)}  |  ${fmtNumber(item.closedLostCount)} lost · ${fmtCurrency(item.closedLostArr)}`;
export const avgDealBars=(rows,topN)=>{
  const items=rows.filter(row=>row.avgDealSize!==null).slice().sort((a,b)=>b.avgDealSize-a.avgDealSize);
  return topN>0?items.slice(0,topN):items;
};

// One line per series member (Product Group or Product), monthly or
// quarterly. Groups keep their fixed entity colors; product series take
// their slot from the FULL ranked list, so changing Top N never repaints a
// surviving line. Detail layer: end-of-line name + latest value, an enlarged
// dot on each series' peak, and an index tooltip with a period total footer.
export function SeriesLineChart({trend,granularity='monthly',topN=0,format=fmtCurrency,byGroup=false,fill=false}){
  const series=topN>0?trend.series.slice(0,topN):trend.series;
  const bucketKey=granularity==='quarterly'?'quarterly':'monthly';
  const countKey=granularity==='quarterly'?'quarterlyCounts':'monthlyCounts';
  // Trailing empty buckets are cut, not drawn: months that haven't happened
  // yet (or a filter emptied) would otherwise drag a flat zero line to
  // Dec and squash the real data into half the plot. Interior gaps stay —
  // only the empty TAIL goes.
  const lastWithData=series.reduce((last,item)=>{
    (item[bucketKey]||[]).forEach((value,index)=>{if(value)last=Math.max(last,index);});
    return last;
  },-1);
  const allLabels=granularity==='quarterly'?trend.quarterlyLabels:trend.monthlyLabels;
  const cut=lastWithData>=0?lastWithData+1:allLabels.length;
  const labels=allLabels.slice(0,cut);
  const ref=useChart(()=>{
    const base=baseOptions();
    const colorOf=item=>byGroup?groupColor(item.label):pvColor(trend.series.indexOf(item));
    return {
      type:'line',
      data:{labels,datasets:series.map(item=>{
        const data=item[bucketKey].slice(0,cut);
        const peak=data.indexOf(Math.max(...data.map(v=>v??0)));
        const color=colorOf(item);
        return {
          label:item.label,data,
          // Bucket opp counts ride on the dataset so the tooltip can show them.
          pvCounts:(item[countKey]||[]).slice(0,cut),
          borderColor:color,backgroundColor:color,
          tension:.35,borderWidth:2,spanGaps:true,
          pointRadius:context=>context.dataIndex===peak?4.5:2.5,
          pointHoverRadius:6,pointBorderColor:ink('--card','#fff'),pointBorderWidth:1,
        };
      })},
      options:{...base,responsive:true,maintainAspectRatio:false,
        layout:{padding:{top:14,right:170,left:4,bottom:0}},
        interaction:{mode:'index',intersect:false},
        plugins:{...base.plugins,
          legend:{...base.plugins.legend,labels:{...base.plugins.legend.labels,boxWidth:8,boxHeight:8,font:{size:10}}},
          tooltip:{...base.plugins.tooltip,...PV_TOOLTIP,itemSort:sortByValueDesc,callbacks:{
            label:context=>{
              const line=` ${context.dataset.label}: ${format(context.parsed.y)}`;
              const count=context.dataset.pvCounts?.[context.dataIndex];
              return count?`${line} · ${fmtNumber(count)} opps`:line;
            },
            footer:items=>{
              const total=items.reduce((sum,item)=>sum+(item.parsed.y||0),0);
              return total?`Total: ${format(total)}`:'';
            },
          }},
          pvLineEndLabels:{format},
        },
        scales:{
          y:{beginAtZero:true,grace:'8%',border:{display:false},
            grid:{color:isLightTheme()?'rgba(15,23,42,.06)':'rgba(255,255,255,.07)'},
            ticks:{callback:format===fmtPercent?value=>`${value}%`:currencyTicks,font:{size:10.5},maxTicksLimit:6}},
          x:{grid:{display:false},ticks:{font:{size:10.5},maxRotation:0,autoSkip:true}},
        }},
      plugins:[pvLineEndLabels],
    };
  },[trend,granularity,topN,byGroup]);
  return <div className={`pv-chart${fill?' pv-chart-fill':''}`}><canvas ref={ref}/></div>;
}

// Clustered bars: Open pipe next to every forecast category per Product
// Group. No Projection is a rep's explicit "don't count on this" — a named
// bucket (Low + No Projection merged), distinct from a blank forecast.
// Detail layer: value at each bar top, opportunity counts in the tooltip.
const FORECAST_COUNT_KEYS={'Open pipe':'openOppCount',Commit:'commitOppCount','Best Case':'bestCaseOppCount','No Projection':'noProjectionOppCount'};
export function ForecastBars({items,fill=false}){
  const ref=useChart(()=>{
    const base=baseOptions();
    const bar=(label,key,slot)=>({label,data:items.map(item=>item[key]),
      backgroundColor:pvColor(slot),borderRadius:{topLeft:4,topRight:4},borderSkipped:'bottom',
      maxBarThickness:42,categoryPercentage:.78,barPercentage:.9});
    return {
      type:'bar',
      data:{labels:items.map(item=>item.label),datasets:[
        bar('Open pipe','openPipe',0),bar('Commit','commitArr',1),
        bar('Best Case','bestCaseArr',2),bar('No Projection','noProjectionArr',3),
      ]},
      options:{...base,responsive:true,maintainAspectRatio:false,
        plugins:{...base.plugins,
          legend:{...base.plugins.legend,labels:{...base.plugins.legend.labels,boxWidth:8,boxHeight:8,font:{size:10}}},
          tooltip:{...base.plugins.tooltip,...PV_TOOLTIP,callbacks:{label:context=>{
            const line=` ${context.dataset.label}: ${fmtCurrency(context.parsed.y)}`;
            const count=items[context.dataIndex]?.[FORECAST_COUNT_KEYS[context.dataset.label]];
            return Number.isFinite(count)?`${line} · ${fmtNumber(count)} opps`:line;
          }}},
          pvBarValues:{format:fmtCurrency},
        },
        scales:{
          y:{beginAtZero:true,grace:'12%',border:{display:false},
            grid:{color:isLightTheme()?'rgba(15,23,42,.06)':'rgba(255,255,255,.07)'},
            ticks:{callback:currencyTicks,font:{size:10.5},maxTicksLimit:6}},
          x:{grid:{display:false},ticks:{font:{size:11}}},
        }},
      plugins:[pvBarValues],
    };
  },[items]);
  return <div className={`pv-chart${fill?' pv-chart-fill':''}`}><canvas ref={ref}/></div>;
}

// Group × Stage heatmap — replaced the horizontal stacked bars, where every
// mid-stack segment was unreadable. Cell shade is a single-hue sequential
// ramp (magnitude has one color job) and every cell prints its value, so
// nothing is buried; stages still run early → late.
const HEAT_LIGHT=['#cde2fb','#9ec5f4','#6da7ec','#3987e5','#256abf','#184f95','#0d366b'];
const HEAT_DARK=['#0d366b','#104281','#184f95','#1c5cab','#256abf','#2a78d6','#3987e5'];
export function StageHeatmap({stages,stack,fill=false}){
  const ramp=isLightTheme()?HEAT_LIGHT:HEAT_DARK;
  const max=Math.max(1,...stack.flatMap(row=>row.stages));
  const cellStyle=value=>{
    if(!value)return {};
    const step=Math.min(ramp.length-1,Math.floor((value/max)*ramp.length));
    // Ink flips to white once the cell is dark enough to swallow dark text.
    const deep=isLightTheme()?step>=3:step<=2;
    return {background:ramp[step],color:deep?'#FFFFFF':'#0B0B0B'};
  };
  const grandTotal=stack.reduce((sum,row)=>sum+row.total,0);
  return <div className={`pv-heatmap-wrap${fill?' pv-chart-fill':''}`}><table className="pv-heatmap">
    <thead><tr><th>Group</th>{stages.map(stage=><th key={stage}>{stage}</th>)}<th className="pv-heatmap-total">Total</th></tr></thead>
    <tbody>{stack.map(row=><tr key={row.label}>
      <td className="pv-heatmap-label">{row.label}</td>
      {row.stages.map((value,index)=><td key={stages[index]} style={cellStyle(value)}
        title={`${row.label} · ${stages[index]}: ${fmtCurrency(value)}${row.counts?.[index]?` · ${fmtNumber(row.counts[index])} opps`:''}${grandTotal?` — ${fmtPercent(value/grandTotal*100)} of open pipe`:''}`}>
        {value?fmtCurrency(value):''}
      </td>)}
      <td className="pv-heatmap-total" title={row.totalCount?`${fmtNumber(row.totalCount)} open opps`:undefined}>{fmtCurrency(row.total)}</td>
    </tr>)}</tbody>
  </table>
  <small className="pv-heatmap-hint">Darker cell = more open ARR · hover any cell for its share of total open pipe</small></div>;
}

// 100% stacked column: each group's share of the quarter's Won ARR (kept by
// the user's call). Polished: 2px surface gaps between segments, fixed
// entity colors, a % label inside every segment big enough to hold one, and
// the actual $ value in the tooltip via the group trend.
const pvSegmentLabels={
  id:'pvSegmentLabels',
  afterDatasetsDraw(chart){
    const {ctx}=chart;
    ctx.save();
    ctx.font='700 10px system-ui,-apple-system,"Segoe UI",sans-serif';
    ctx.textAlign='center';ctx.textBaseline='middle';
    chart.data.datasets.forEach((dataset,datasetIndex)=>{
      if(!chart.isDatasetVisible(datasetIndex))return;
      chart.getDatasetMeta(datasetIndex).data.forEach((segment,index)=>{
        const value=dataset.data[index];
        if(!value||value<8)return; // a label needs ~8% of column height to fit
        ctx.fillStyle='#FFFFFF';
        ctx.fillText(`${Math.round(value)}%`,segment.x,(segment.y+segment.base)/2);
      });
    });
    ctx.restore();
  },
};
export function ProductMixChart({mix,trend=null,fill=false}){
  // Same trailing-tail rule as the trend lines: quarters with no Won ARR at
  // all (typically the ones that haven't happened yet) are cut, not drawn
  // as empty columns.
  const lastWithData=mix.groups.reduce((last,group)=>{
    group.shares.forEach((share,index)=>{if(share!==null&&share!==undefined)last=Math.max(last,index);});
    return last;
  },-1);
  const cut=lastWithData>=0?lastWithData+1:mix.labels.length;
  const ref=useChart(()=>{
    const base=baseOptions({stacked:true});
    const surface=ink('--card','#fff');
    const seriesFor=label=>trend?.series.find(series=>series.label===label);
    const arrFor=(label,quarterIndex)=>seriesFor(label)?.quarterly[quarterIndex];
    const countFor=(label,quarterIndex)=>seriesFor(label)?.quarterlyCounts?.[quarterIndex];
    return {
      type:'bar',
      data:{labels:mix.labels.slice(0,cut),datasets:mix.groups.map(group=>({
        label:group.label,data:group.shares.slice(0,cut),backgroundColor:groupColor(group.label),
        borderColor:surface,borderWidth:2,borderRadius:2,maxBarThickness:72,
      }))},
      options:{...base,responsive:true,maintainAspectRatio:false,
        plugins:{...base.plugins,
          legend:{...base.plugins.legend,labels:{...base.plugins.legend.labels,boxWidth:8,boxHeight:8,font:{size:10}}},
          tooltip:{...base.plugins.tooltip,...PV_TOOLTIP,itemSort:sortByValueDesc,callbacks:{label:context=>{
            const arr=arrFor(context.dataset.label,context.dataIndex);
            const count=countFor(context.dataset.label,context.dataIndex);
            let line=` ${context.dataset.label}: ${fmtPercent(context.parsed.y)}`;
            if(Number.isFinite(arr))line+=` · ${fmtCurrency(arr)}`;
            if(Number.isFinite(count))line+=` · ${fmtNumber(count)} opps`;
            return line;
          }}},
        },
        scales:{x:{stacked:true,grid:{display:false},ticks:{font:{size:11}}},
          y:{stacked:true,max:100,border:{display:false},
            grid:{color:isLightTheme()?'rgba(15,23,42,.06)':'rgba(255,255,255,.07)'},
            ticks:{callback:value=>`${value}%`,font:{size:10.5},stepSize:25}}}},
      plugins:[pvSegmentLabels],
    };
  },[mix,trend]);
  return <div className={`pv-chart${fill?' pv-chart-fill':''}`}><canvas ref={ref}/></div>;
}

// Horizontal bars, one or two measures. Used for win rates (count vs ARR),
// average deal size and top products by open pipe. Detail layer: value at
// every bar end (the relief labels the light palette requires).
export function HBarChart({items,measures,format=fmtCurrency,percentAxis=false,tooltipExtra,fill=false}){
  const ref=useChart(()=>{
    const base=baseOptions();
    return {
      type:'bar',
      data:{labels:items.map(item=>item.label),datasets:measures.map((measure,index)=>({
        label:measure.label,data:items.map(item=>item[measure.key]),
        backgroundColor:pvColor(measure.colorIndex??index),
        borderRadius:{topRight:4,bottomRight:4},borderSkipped:'left',
        maxBarThickness:22,categoryPercentage:measures.length>1?.72:.62,
      }))},
      options:{...base,responsive:true,maintainAspectRatio:false,indexAxis:'y',
        layout:{padding:{top:6,right:64,left:4,bottom:0}},
        plugins:{...base.plugins,
          legend:measures.length>1
            ?{...base.plugins.legend,labels:{...base.plugins.legend.labels,boxWidth:8,boxHeight:8,font:{size:10}}}
            :{display:false},
          tooltip:{...base.plugins.tooltip,...PV_TOOLTIP,callbacks:{label:context=>{
            const line=` ${context.dataset.label}: ${format(context.parsed.x)}`;
            const extra=tooltipExtra?.(items[context.dataIndex]);
            return extra?[line,` ${extra}`]:line;
          }}},
          pvBarValues:{format},
        },
        scales:{
          x:{...(percentAxis?{max:100,ticks:{callback:value=>`${value}%`,font:{size:10.5}}}
            :{ticks:{callback:currencyTicks,font:{size:10.5},maxTicksLimit:6}}),
            border:{display:false},
            grid:{color:isLightTheme()?'rgba(15,23,42,.06)':'rgba(255,255,255,.07)'}},
          y:{grid:{display:false},ticks:{font:{size:11}}},
        }},
      plugins:[pvBarValues],
    };
  },[items,measures]);
  return <div className={`pv-chart${fill?' pv-chart-fill':''}`}><canvas ref={ref}/></div>;
}

// ===== Tables =====
const TABLE_FORMATS={count:fmtNumber,arr:fmtCurrency,rate:fmtPercent,avg:fmtCurrency};
export function ProductTable({rows,grandTotal,columns,maxRows=0}){
  // Click a header to sort, click again to flip. No sort state = the
  // server's order (open pipe / Won ARR descending). Sorting runs BEFORE
  // the Top-N slice, so "Top 5 by Lost ARR" shows the five biggest losers,
  // not the default five re-shuffled.
  const [sort,setSort]=useState(null);
  const onSort=key=>setSort(current=>current?.key===key
    ?{key,dir:current.dir==='desc'?'asc':'desc'}
    :{key,dir:key==='label'?'asc':'desc'});
  const sorted=useMemo(()=>{
    if(!sort)return rows;
    return [...rows].sort((a,b)=>{
      const av=a[sort.key],bv=b[sort.key];
      if(sort.key==='label')return sort.dir==='desc'?String(bv).localeCompare(String(av)):String(av).localeCompare(String(bv));
      // Null rates (nothing closed) sink to the bottom in either direction —
      // "no rate yet" is not a 0% and must not top the ascending sort.
      if(av===null||av===undefined)return 1;
      if(bv===null||bv===undefined)return -1;
      return sort.dir==='desc'?bv-av:av-bv;
    });
  },[rows,sort]);
  const visible=maxRows>0?sorted.slice(0,maxRows):sorted;
  return <div className="pv-table-scroll"><table className="pv-table">
    <thead><tr><Th label={columns.firstHeader} sortKey="label" sort={sort} onSort={onSort}/>
      {columns.cells.map(cell=><Th key={cell.key} label={cell.label} sortKey={cell.key} sort={sort} onSort={onSort} numeric/>)}
    </tr></thead>
    <tbody>{visible.map(row=><tr key={row.label}><td>{row.label}</td>
      {columns.cells.map(cell=><td key={cell.key} className="num">
        {cell.kind==='rate'
          ?(row[cell.key]===null?<span className="pv-na">—</span>:<Pill tone={rateTone(row[cell.key])}>{fmtPercent(row[cell.key])}</Pill>)
          :TABLE_FORMATS[cell.kind](row[cell.key])}
      </td>)}
    </tr>)}</tbody>
    {/* The grand total row is computed server-side as a TRUE distinct count
        across the whole table — summing the rows above would double-count
        any opportunity that spans product groups. */}
    {grandTotal&&<tfoot><tr><td>Grand total</td>
      {columns.cells.map(cell=><td key={cell.key} className="num">
        {cell.kind==='rate'
          ?(grandTotal[cell.key]===null?'—':fmtPercent(grandTotal[cell.key]))
          :TABLE_FORMATS[cell.kind](grandTotal[cell.key])}
      </td>)}
    </tr></tfoot>}
  </table></div>;
}
export const FUNNEL_COLUMNS=firstHeader=>({firstHeader,cells:[
  {key:'openOppCount',label:'Open #',kind:'count'},{key:'openPipe',label:'Open pipe',kind:'arr'},
  {key:'closedWonCount',label:'Won #',kind:'count'},{key:'closedWonArr',label:'Won ARR',kind:'arr'},
  {key:'closedLostCount',label:'Lost #',kind:'count'},{key:'closedLostArr',label:'Lost ARR',kind:'arr'},
  {key:'winRateCount',label:'Win rate',kind:'rate'},
  {key:'commitOppCount',label:'Commit #',kind:'count'},{key:'commitArr',label:'Commit',kind:'arr'},
  {key:'bestCaseOppCount',label:'Best Case #',kind:'count'},{key:'bestCaseArr',label:'Best Case',kind:'arr'},
]});
export function TopNSelect({value,onChange,options=[5,10,15,0],label='Top N'}){
  return <select className="pv-topn" value={value} onChange={event=>onChange(Number(event.target.value))} aria-label={label}>
    {options.map(n=><option key={n} value={n}>{n===0?'All':`Top ${n}`}</option>)}
  </select>;
}

export const WON_LOST_COLUMNS=firstHeader=>({firstHeader,cells:[
  {key:'closedWonCount',label:'Won #',kind:'count'},{key:'closedWonArr',label:'Won ARR',kind:'arr'},
  {key:'closedLostCount',label:'Lost #',kind:'count'},{key:'closedLostArr',label:'Lost ARR',kind:'arr'},
  {key:'winRateCount',label:'Win rate',kind:'rate'},{key:'winRateArr',label:'ARR win rate',kind:'rate'},
  {key:'avgDealSize',label:'Avg deal',kind:'avg'},
]});

// ===== KPI strip =====
function KpiDelta({value,kind='growth'}){
  if(value===null||value===undefined||!Number.isFinite(Number(value)))return <small className="pv-kpi-delta muted">no prior period</small>;
  const up=value>=0;
  const text=kind==='points'?`${up?'+':''}${value.toFixed(1)} pts`:`${up?'+':''}${value.toFixed(1)}%`;
  return <small className={`pv-kpi-delta ${up?'up':'down'}`}>{up?'▲':'▼'} {text} vs prior period</small>;
}
export function ProductKpis({view,overall,comparison}){
  const growth=comparison?.growth||{};
  const points=comparison?.pointChange||{};
  const tiles=view==='pipeline'?[
    {key:'open-pipe',label:'Open pipeline',value:fmtCurrency(overall.openPipe),sub:`${fmtNumber(overall.openOppCount)} open opps`,delta:growth.openPipe},
    {key:'closed-won',label:'Closed Won',value:fmtCurrency(overall.closedWonArr),sub:`${fmtNumber(overall.closedWonCount)} won`,delta:growth.closedWonArr},
    {key:'commit',label:'Commit',value:fmtCurrency(overall.commitArr),sub:`${fmtNumber(overall.commitOppCount)} opps`,delta:growth.commitArr},
    {key:'best-case',label:'Best Case',value:fmtCurrency(overall.bestCaseArr),sub:`${fmtNumber(overall.bestCaseOppCount)} opps`,delta:growth.bestCaseArr},
  ]:[
    {key:'closed-won',label:'Closed Won',value:fmtCurrency(overall.closedWonArr),sub:`${fmtNumber(overall.closedWonCount)} won`,delta:growth.closedWonArr},
    {key:'closed-lost',label:'Closed Lost',value:fmtCurrency(overall.closedLostArr),sub:`${fmtNumber(overall.closedLostCount)} lost`,delta:growth.closedLostArr},
    {key:'win-rate',label:'Win rate',value:fmtPercent(overall.winRateCount),sub:`${fmtPercent(overall.winRateArr)} by ARR`,delta:points.winRateCount,kind:'points'},
    {key:'avg-deal',label:'Avg deal size',value:overall.avgDealSize===null?'—':fmtCurrency(overall.avgDealSize),sub:'Won ARR ÷ won opps',delta:growth.avgDealSize},
  ];
  // Hideable is inert on the interactive board (no provider) and makes each
  // KPI double-click-hideable on the presentations — Win Board parity.
  return <div className="pv-kpi-strip">
    {tiles.map(tile=><Hideable key={tile.key} k={`kpi:${view}:${tile.key}`} label={tile.label}>
      <div className="pv-kpi">
        <span>{tile.label}</span><strong>{tile.value}</strong><small>{tile.sub}</small>
        <KpiDelta value={tile.delta} kind={tile.kind||'growth'}/>
      </div>
    </Hideable>)}
  </div>;
}

const EMPTY_PIPELINE_METRICS={overall:{},trendYear:null,trend:{monthlyLabels:[],quarterlyLabels:[],series:[]},stages:[],stageStack:[],forecastByGroup:[],funnelByGroup:[],funnelByProduct:[],topProducts:[]};
const EMPTY_WON_METRICS={overall:{},trendYear:null,trendByGroup:{monthlyLabels:[],quarterlyLabels:[],series:[]},trendByProduct:{monthlyLabels:[],quarterlyLabels:[],series:[]},productMix:{labels:[],groups:[]},winRateByGroup:[],winRateByProduct:[],avgDealSizeByProduct:[],wonLostByGroup:[],wonLostByProduct:[]};

// One view's data lifecycle: snapshot on filter change, reload tick from the
// refresh button. Inactive views keep their last data — switching tabs is
// instant and never refetches unless something actually changed.
function useSnapshot(fetcher,filters,reloadTick,empty){
  const [state,setState]=useState({loading:true,error:'',metrics:empty,comparison:{available:false}});
  useEffect(()=>{
    let cancelled=false;
    setState(current=>({...current,loading:true,error:''}));
    fetcher(filters).then(snapshot=>{
      if(cancelled)return;
      setState({loading:false,error:'',metrics:snapshot.metrics||empty,comparison:snapshot.comparison||{available:false}});
    }).catch(error=>{
      if(cancelled)return;
      setState({loading:false,error:error.response?.data?.error||error.message||'Could not load Product View data',metrics:empty,comparison:{available:false}});
    });
    return()=>{cancelled=true;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[filters,reloadTick]);
  return state;
}

const savedState=()=>{
  try{return JSON.parse(localStorage.getItem(`testmu-dashboard-state-${TEMPLATE}`)||'{}');}
  catch{return {};}
};
const hydrate=(saved,empty)=>saved?Object.fromEntries(Object.keys(empty).map(key=>[key,saved[key]??empty[key]])):empty;

export default function ProductView({user}){
  const navigate=useNavigate();
  const {signOut}=useAuth();
  const [tab,setTab]=useState(()=>savedState().view==='product-won'?'won':'pipeline');
  const [pipelineFilters,setPipelineFilters]=useState(()=>hydrate(savedState().filters?.pipeline,EMPTY_PIPELINE));
  const [wonFilters,setWonFilters]=useState(()=>hydrate(savedState().filters?.won,EMPTY_WON));
  const [options,setOptions]=useState(Object.fromEntries(CATEGORY_KEYS.map(key=>[key,[]])));
  const [optionsReady,setOptionsReady]=useState(false);
  const [hydrated,setHydrated]=useState(false);
  const [reloadTick,setReloadTick]=useState(0);
  const [pipelineGranularity,setPipelineGranularity]=useState('monthly');
  const [wonGranularity,setWonGranularity]=useState('monthly');
  // Every by-product chart and table carries its own Top-N, all defaulting
  // to Top 5 — the user's call (per-chart controls, not one shared one).
  const [topProductsN,setTopProductsN]=useState(5);
  const [trendTopN,setTrendTopN]=useState(5);
  const [winRateTopN,setWinRateTopN]=useState(5);
  const [avgDealTopN,setAvgDealTopN]=useState(5);
  const [funnelProductTopN,setFunnelProductTopN]=useState(5);
  const [wonLostTopN,setWonLostTopN]=useState(5);

  useEffect(()=>{getDashboardState(TEMPLATE).then(state=>{
    if(state?.filters?.pipeline)setPipelineFilters(hydrate(state.filters.pipeline,EMPTY_PIPELINE));
    if(state?.filters?.won)setWonFilters(hydrate(state.filters.won,EMPTY_WON));
    if(state?.view==='product-won')setTab('won');
    if(state?.view==='product-pipeline')setTab('pipeline');
  }).catch(()=>{}).finally(()=>setHydrated(true));},[]);
  useEffect(()=>{if(!hydrated)return;const timer=setTimeout(()=>{
    const state={view:tab==='won'?'product-won':'product-pipeline',filters:{pipeline:pipelineFilters,won:wonFilters}};
    localStorage.setItem(`testmu-dashboard-state-${TEMPLATE}`,JSON.stringify(state));
    saveDashboardState(TEMPLATE,state).catch(()=>{});
  },500);return()=>clearTimeout(timer);},[tab,pipelineFilters,wonFilters,hydrated]);

  useEffect(()=>{let cancelled=false;getOptions(TEMPLATE).then(value=>{
    if(!cancelled){setOptions(current=>({...current,...value}));setOptionsReady(true);}
  }).catch(()=>{if(!cancelled)setOptionsReady(true);});return()=>{cancelled=true;};},[reloadTick]);

  // Apply the Opportunity Type default once options arrive — but only to a
  // view that has no explicit type selection saved, so a user's deliberate
  // "all types" reset (impossible to distinguish from never-touched) still
  // converges on the documented default rather than silently widening scope.
  useEffect(()=>{if(!optionsReady||!hydrated)return;
    const defaults=defaultTypes(options.type);
    if(!defaults.length)return;
    const applyDefault=setter=>setter(current=>current.type?.length?current:{...current,type:defaults});
    applyDefault(setPipelineFilters);applyDefault(setWonFilters);
  },[optionsReady,hydrated,options.type]);

  const pipeline=useSnapshot(getProductPipelineSnapshot,pipelineFilters,reloadTick,EMPTY_PIPELINE_METRICS);
  const won=useSnapshot(getProductWonSnapshot,wonFilters,reloadTick,EMPTY_WON_METRICS);

  const active=tab==='won'?won:pipeline;
  const filters=tab==='won'?wonFilters:pipelineFilters;
  const setFilters=tab==='won'?setWonFilters:setPipelineFilters;
  const empty=tab==='won'?EMPTY_WON:EMPTY_PIPELINE;

  const startPresentation=view=>{
    const config=view==='won'
      ?{filters:wonFilters,granularity:wonGranularity,trendTopN}
      :{filters:pipelineFilters,granularity:pipelineGranularity,topProductsN};
    localStorage.setItem(`testmu-productview-${view}-presentation-config`,JSON.stringify(config));
    saveDashboardState(TEMPLATE,{view:view==='won'?'product-won':'product-pipeline',
      filters:{pipeline:pipelineFilters,won:wonFilters},
      presentationSettings:{view:view==='won'?'product-won':'product-pipeline'}}).catch(()=>{});
    window.open(`/present/product-${view==='won'?'won':'pipeline'}`,'_blank','noopener');
  };

  if(active.loading&&!active.metrics.overall.label)return <AppLoader fullscreen label="Loading Product View…"/>;
  const filterDefs=[['productGroup','Product Group'],['product','Product'],['type','Opp type'],['orgType','Org type'],
    ['pod','Sales POD'],['stage','Stage'],['owner','Rep'],['continentGroup','Continent']];
  const {metrics,comparison}=active;
  const granularity=tab==='won'?wonGranularity:pipelineGranularity;
  const setGranularity=tab==='won'?setWonGranularity:setPipelineGranularity;

  return <div className="wrap win-board-wrap"><div className="top-nav" style={{margin:'-18px -18px 18px'}}>
    <div className="brand" onClick={()=>navigate('/gallery')} style={{cursor:'pointer'}}><img className="brand-logo" src="/testmu-bi-logo-v2.png" alt="TestMu BI"/><span>TestMu BI</span></div>
    <div className="user-pill"><ThemeToggle/><DashboardSwitcher/><RefreshDataButton templateId={TEMPLATE} onRefreshed={()=>setReloadTick(tick=>tick+1)}/><span>{user?.name||'User'}</span><button className="btn-secondary" onClick={signOut}>Sign out</button></div></div>

    <header className="top"><div className="top-row"><div><h1>Product View</h1>
      <div className="sub">{tab==='won'
        ?<>Actual Won ARR by product — scoped by <strong>Opp Close Date</strong>. Open pipe, Commit and Best Case are deliberately absent: open deals have tentative close dates.</>
        :<>Pipeline built by product — scoped by <strong>Opp Created Date</strong>.</>}</div>
      <div className="pv-tabs" role="tablist" aria-label="Product View views">
        <button role="tab" aria-selected={tab==='pipeline'} className={tab==='pipeline'?'on':''} onClick={()=>setTab('pipeline')}>Pipeline · by Created Date</button>
        <button role="tab" aria-selected={tab==='won'} className={tab==='won'?'on':''} onClick={()=>setTab('won')}>Won ARR · by Close Date</button>
      </div></div>
      <button type="button" className="present-button" onClick={()=>startPresentation(tab)}>▶ Present</button></div>
      <div className="filters win-board-filter-shelf">
        {filterDefs.map(([key,label])=><MultiSelect key={`${tab}:${key}`} label={label} options={options[key]||[]} value={filters[key]} onChange={value=>setFilters(current=>({...current,[key]:value}))}/>)}
        {tab==='won'
          ?<AdvancedDateRange key="won-dates" filters={wonFilters} setFilters={setWonFilters} fromKey="closeFrom" toKey="closeTo" label="Opportunity close date" title="Opp Close Date" emptyLabel="All close dates"/>
          :<AdvancedDateRange key="pipeline-dates" filters={pipelineFilters} setFilters={setPipelineFilters} label="Opportunity created date" title="Opp Created Date" emptyLabel="All created dates"/>}
        <button className="btn-secondary filter-reset-button" onClick={()=>setFilters({...empty,type:defaultTypes(options.type)})}>Reset</button>
      </div></header>

    {active.error&&<div className="error">{active.error}</div>}
    {/* "No data" must mean NO SOURCE, never an empty selection: the filter
        options are built from the template's unfiltered rows, so any option
        existing proves a source is loaded — an all-zero scope then gets a
        zeroed board and an honest note, not "connect a source". A previous
        quarter with nothing closed used to show the connect card. */}
    {!active.loading&&!active.error
      &&!metrics.overall.openOppCount&&!metrics.overall.closedWonCount&&!metrics.overall.closedLostCount
      &&!CATEGORY_KEYS.some(key=>(options[key]||[]).length>0)
      ?<div className="card win-board-empty"><div className="win-board-empty-icon">▦</div>
        <div><h3>No Product View data is loaded</h3><p>Connect the product source (product line rows with Product Group, Actual Product Name, Product ARR, Opportunity Forecast and Continent Group) and map it to this dashboard.</p></div>
        <button type="button" className="btn-primary" onClick={()=>navigate('/data-sources')}>Open data sources</button></div>
      :<>
      {!active.loading&&!active.error
        &&!metrics.overall.openOppCount&&!metrics.overall.closedWonCount&&!metrics.overall.closedLostCount
        &&<div className="empty">Nothing matches this view&rsquo;s filters and date range — the source is loaded, the current selection is just empty.</div>}
      {tab==='pipeline'?<>
        <ProductKpis view="pipeline" overall={metrics.overall} comparison={comparison}/>
        <div className="pv-grid">
          <ChartCard className="pv-card-full" title="Pipeline created trend" hint={`Created ARR per ${granularity==='quarterly'?'quarter':'month'} of ${metrics.trendYear} — line ends show the latest value, the big dot marks each group's peak`}
            controls={<div className="pv-toggle"><button className={granularity==='monthly'?'on':''} onClick={()=>setGranularity('monthly')}>M</button><button className={granularity==='quarterly'?'on':''} onClick={()=>setGranularity('quarterly')}>Q</button></div>}>
            <SeriesLineChart trend={metrics.trend} granularity={granularity} byGroup/>
          </ChartCard>
          <ChartCard title="Forecast vs open pipe by Product Group" hint="Open pipe next to Commit, Best Case (incl. High) and No Projection (incl. Low) — hover for opportunity counts">
            <ForecastBars items={metrics.forecastByGroup}/>
          </ChartCard>
          <ChartCard title="Top products by open pipe" hint="Hover for the open opportunity count"
            controls={<TopNSelect value={topProductsN} onChange={setTopProductsN} label="Top N products"/>}>
            <HBarChart items={topProductsN>0?metrics.topProducts.slice(0,topProductsN):metrics.topProducts}
              measures={[{key:'openPipe',label:'Open pipe'}]} tooltipExtra={item=>`${fmtNumber(item.openOppCount)} open opps`}/>
          </ChartCard>
          <ChartCard className="pv-card-full" title="Open pipeline by stage" hint="Every cell readable — darker means more open ARR, stages run early → late">
            <StageHeatmap stages={metrics.stages} stack={metrics.stageStack}/>
          </ChartCard>
        </div>
        <ChartCard title="Funnel by Product Group" hint="Distinct opportunity counts; the grand total is a true COUNTD across the table">
          <ProductTable rows={metrics.funnelByGroup} grandTotal={metrics.overall} columns={FUNNEL_COLUMNS('Product Group')}/>
        </ChartCard>
        <ChartCard title="Funnel by Product" hint="Sorted by open pipe, descending; the grand total spans ALL products, not just the visible rows"
          controls={<TopNSelect value={funnelProductTopN} onChange={setFunnelProductTopN} options={[5,10,20,0]} label="Top N products"/>}>
          <ProductTable rows={metrics.funnelByProduct} grandTotal={metrics.overall} columns={FUNNEL_COLUMNS('Product')} maxRows={funnelProductTopN}/>
        </ChartCard>
      </>:<>
        <ProductKpis view="won" overall={metrics.overall} comparison={comparison}/>
        <div className="pv-grid">
          <ChartCard className="pv-card-full" title="Won ARR trend by Product Group" hint={`Closed Won ARR per ${granularity==='quarterly'?'quarter':'month'} of ${metrics.trendYear} — line ends show the latest value, the big dot marks each group's peak`}
            controls={<div className="pv-toggle"><button className={granularity==='monthly'?'on':''} onClick={()=>setGranularity('monthly')}>M</button><button className={granularity==='quarterly'?'on':''} onClick={()=>setGranularity('quarterly')}>Q</button></div>}>
            <SeriesLineChart trend={metrics.trendByGroup} granularity={granularity} byGroup/>
          </ChartCard>
          <ChartCard className="pv-card-full" title="Won ARR trend by Product" hint="Top products by full-year Won ARR — more lines than this are unreadable"
            controls={<TopNSelect value={trendTopN} onChange={setTrendTopN} options={[3,5,8]} label="Top N product lines"/>}>
            <SeriesLineChart trend={metrics.trendByProduct} granularity={granularity} topN={trendTopN}/>
          </ChartCard>
          <ChartCard title="Product mix % of Won ARR" hint="Each Product Group's share of the quarter's Won ARR — segments are labeled, hover for the actual $">
            <ProductMixChart mix={metrics.productMix} trend={metrics.trendByGroup}/>
          </ChartCard>
          <ChartCard title="Win rate by Product Group" hint={`Overall: ${fmtPercent(metrics.overall.winRateCount)} by count · ${fmtPercent(metrics.overall.winRateArr)} by ARR`}>
            <HBarChart items={metrics.wonLostByGroup} percentAxis format={fmtPercent}
              measures={[{key:'winRateCount',label:'By count'},{key:'winRateArr',label:'By ARR'}]}
              tooltipExtra={winLossDetail}/>
          </ChartCard>
          <ChartCard title="Win rate by Product" hint={`Overall: ${fmtPercent(metrics.overall.winRateCount)} by count · ${fmtPercent(metrics.overall.winRateArr)} by ARR`}
            controls={<TopNSelect value={winRateTopN} onChange={setWinRateTopN} label="Top N products"/>}>
            <HBarChart items={winRateTopN>0?metrics.wonLostByProduct.slice(0,winRateTopN):metrics.wonLostByProduct} percentAxis format={fmtPercent}
              measures={[{key:'winRateCount',label:'By count'},{key:'winRateArr',label:'By ARR'}]}
              tooltipExtra={winLossDetail}/>
          </ChartCard>
          <ChartCard title="Average deal size by Product" hint={`Overall average: ${metrics.overall.avgDealSize===null?'—':fmtCurrency(metrics.overall.avgDealSize)}`}
            controls={<TopNSelect value={avgDealTopN} onChange={setAvgDealTopN} label="Top N products"/>}>
            <HBarChart items={avgDealBars(metrics.wonLostByProduct,avgDealTopN)}
              measures={[{key:'avgDealSize',label:'Avg deal size'}]}
              tooltipExtra={item=>`${fmtNumber(item.closedWonCount)} won opps · ${fmtCurrency(item.closedWonArr)} Won ARR`}/>
          </ChartCard>
        </div>
        <ChartCard title="Won vs Lost by Product Group" hint="Distinct opportunity counts; grand total is a true COUNTD across the table">
          <ProductTable rows={metrics.wonLostByGroup} grandTotal={metrics.overall} columns={WON_LOST_COLUMNS('Product Group')}/>
        </ChartCard>
        <ChartCard title="Won vs Lost by Product" hint="Sorted by Won ARR, descending; the grand total spans ALL products, not just the visible rows"
          controls={<TopNSelect value={wonLostTopN} onChange={setWonLostTopN} options={[5,10,20,0]} label="Top N products"/>}>
          <ProductTable rows={metrics.wonLostByProduct} grandTotal={metrics.overall} columns={WON_LOST_COLUMNS('Product')} maxRows={wonLostTopN}/>
        </ChartCard>
      </>}
    </>}
  </div>;
}
