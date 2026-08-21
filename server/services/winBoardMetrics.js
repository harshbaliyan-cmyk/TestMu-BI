import {previousEqualPeriod,compareArr} from './periodComparison.js';

const sumArr = rows => rows.reduce((total, row) => total + (Number(row.arr) || 0), 0);
// A zero denominator means the rate is undefined, not zero. Returning 0 here
// claimed a real result: a month with opportunities created but none closed
// yet rendered as a flat 0% win rate — "we won nothing" rather than "nothing
// has closed". emptyYearSummary already made that distinction for periods with
// no rows at all; the same reasoning applies whenever the denominator is empty.
// fmtPercent renders null as an em dash and the trend line breaks at the gap.
const percent = (numerator, denominator) => denominator ? numerator / denominator * 100 : null;

export function summarizeWinRows(rows, label, totalWonArr) {
  const closedRows = rows.filter(row => row.isClosed);
  const openRows = rows.filter(row => !row.isClosed);
  const wonRows = closedRows.filter(row => row.isWon);
  const lostRows = closedRows.filter(row => !row.isWon);
  const wonArr = sumArr(wonRows);
  const closedArr = sumArr(closedRows);
  const totalArr = sumArr(rows);
  const openArr = sumArr(openRows);
  return {
    label,
    opportunities: rows.length,
    open: openRows.length,
    wonArr,
    closedArr,
    totalArr,
    openArr,
    closed: closedRows.length,
    wins: wonRows.length,
    losses: lostRows.length,
    // SUM(IF Won THEN ARR END) / SUM(IF Closed THEN ARR END)
    arrWinRate: percent(wonArr, closedArr),
    // SUM(IF Won THEN 1 ELSE 0 END) / SUM(IF Closed THEN 1 ELSE 0 END)
    dealWinRate: percent(wonRows.length, closedRows.length),
    // COUNTD(IF [Opp Stage]="Closed Won" THEN [Opp Id] END) / COUNTD(Total [Opp Id])
    dealWinRateOfAll: percent(wonRows.length, rows.length),
    // SUM(IF NOT [Closed] THEN [ARR] END) / SUM([ARR])
    openArrPct: percent(openArr, totalArr),
    // COUNTD(IF NOT [Closed] THEN [Opp Id] END) / COUNTD([Opp Id])
    openOppRate: percent(openRows.length, rows.length),
    // SUM(Won ARR for category) / TOTAL(SUM(Won ARR))
    contribution: percent(wonArr, totalWonArr),
  };
}

function groupRows(rows, key, totalWonArr) {
  return [...new Set(rows.map(row => row[key]).filter(Boolean))]
    .map(value => summarizeWinRows(rows.filter(row => row[key] === value), value, totalWonArr));
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function monthLabel(period) {
  const [year, month] = period.split('-');
  return `${MONTH_ABBR[Number(month)-1]}-${year.slice(2)}`;
}

// The trend chart is always a full calendar year (plus the same months one
// year earlier, for a real year-over-year comparison line) rather than
// whatever the active date filter happens to be — a "Last 7 days" or
// "Current quarter" filter still shows the whole year's trend, so the two
// lines always share identical calendar labels and never need the
// relative-position alignment the old date-range-scoped trend required.
// The year itself follows the active date filter (its end date) so a user
// looking at historical data sees that year's trend, not always today's.
export function resolveTrendYear(filters) {
  const source = filters?.createdTo || filters?.createdFrom;
  const year = source ? Number(String(source).slice(0, 4)) : NaN;
  return Number.isFinite(year) ? year : new Date().getFullYear();
}

// A month/quarter with zero created opportunities is a true gap, not a real
// 0% — summarizeWinRows would return 0 for every rate (percent() treats a
// zero denominator as 0), which reads as "0% won" rather than "no data".
// Nulls let the chart show a break in the line instead of a misleading flat
// zero, and fmtPercent already renders null as "—".
function emptyYearSummary(label) {
  return {
    label, opportunities: 0, open: 0, wonArr: 0, closedArr: 0, totalArr: 0, openArr: 0,
    closed: 0, wins: 0, losses: 0,
    arrWinRate: null, dealWinRate: null, dealWinRateOfAll: null, openArrPct: null, openOppRate: null, contribution: null,
  };
}

// Builds both granularities from the same year-scoped row set so the
// frontend's Month/Quarter toggle is instant (no extra request) — quarterly
// figures are re-derived from raw rows rather than averaged from the
// monthly percentages, since a percentage of a percentage isn't the same
// number as the true quarter-wide rate.
export function buildYearlyTrend(yearRows, year) {
  const totalWonArr = sumArr(yearRows.filter(row => row.isClosed && row.isWon));
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const rows = yearRows.filter(row => row.createdDate?.startsWith(period));
    const label = `${MONTH_ABBR[i]}-${String(year).slice(2)}`;
    return { ...(rows.length ? summarizeWinRows(rows, label, totalWonArr) : emptyYearSummary(label)), period };
  });
  const quarterly = Array.from({ length: 4 }, (_, i) => {
    const quarter = i + 1;
    const monthKeys = [quarter * 3 - 2, quarter * 3 - 1, quarter * 3].map(m => `${year}-${String(m).padStart(2, '0')}`);
    const rows = yearRows.filter(row => row.createdDate && monthKeys.some(key => row.createdDate.startsWith(key)));
    const label = `Q${quarter}-${String(year).slice(2)}`;
    return { ...(rows.length ? summarizeWinRows(rows, label, totalWonArr) : emptyYearSummary(label)), period: `${year}-Q${quarter}` };
  });
  return { monthly, quarterly };
}

export function buildWinBoardMetrics(rows) {
  const seen = new Set();
  rows = rows.filter(row => {
    const id = String(row.id || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const totalWonArr = sumArr(rows.filter(row => row.isClosed && row.isWon));
  const overall = summarizeWinRows(rows, 'All opportunities', totalWonArr);
  const periods = [...new Set(rows.map(row => row.createdDate?.slice(0, 7)).filter(Boolean))].sort();
  const trend = periods.map(period => ({
    ...summarizeWinRows(rows.filter(row => row.createdDate?.startsWith(period)), monthLabel(period), totalWonArr),
    period,
  }));
  const teams = groupRows(rows, 'team', totalWonArr).sort((a,b) => b.contribution-a.contribution);
  const industries = groupRows(rows, 'industry', totalWonArr).filter(item => item.closed > 0).sort((a,b) => b.wonArr-a.wonArr);
  const orgTypes = groupRows(rows, 'orgType', totalWonArr).filter(item => item.closed > 0).sort((a,b) => b.wonArr-a.wonArr);
  const pods = groupRows(rows, 'pod', totalWonArr).filter(item => item.closed > 0).sort((a,b) => b.wonArr-a.wonArr);
  return { overall, trend, teams, industries, orgTypes, pods };
}

function compareGroup(currentItems,previousItems,metric){
  const previousByLabel=new Map(previousItems.map(item=>[item.label,item]));
  return currentItems.map(item=>{
    const previous=previousByLabel.get(item.label);
    const hasPrevious=Boolean(previous);
    const currentDealWinRate=Number(item.dealWinRate)||0;
    const currentArrWinRate=Number(item.arrWinRate)||0;
    const currentContribution=Number(item.contribution)||0;
    const previousDealWinRate=hasPrevious?(Number(previous.dealWinRate)||0):null;
    const previousArrWinRate=hasPrevious?(Number(previous.arrWinRate)||0):null;
    const previousContribution=hasPrevious?(Number(previous.contribution)||0):null;
    const currentByMetric={
      dealWinRate:currentDealWinRate,
      arrWinRate:currentArrWinRate,
      contribution:currentContribution,
    };
    const previousByMetric={
      dealWinRate:previousDealWinRate,
      arrWinRate:previousArrWinRate,
      contribution:previousContribution,
    };
    const pointChange=(currentValue,previousValue)=>hasPrevious?currentValue-previousValue:null;
    const dealWinRatePointChange=pointChange(currentDealWinRate,previousDealWinRate);
    const arrWinRatePointChange=pointChange(currentArrWinRate,previousArrWinRate);
    const contributionPointChange=pointChange(currentContribution,previousContribution);
    const pointChanges={dealWinRatePointChange,arrWinRatePointChange,contributionPointChange};
    const currentValue=currentByMetric[metric];
    const previousValue=previousByMetric[metric];
    const currentWonArr=Number(item.wonArr)||0;
    const previousWonArr=Number(previous?.wonArr)||0;
    const hasWonArrBaseline=hasPrevious&&previousWonArr!==0;
    return {
      label:item.label,
      metric,
      current:currentValue,
      previous:hasPrevious?previousValue:null,
      hasPrevious,
      hasWonArrBaseline,
      wonArrGrowthPct:hasWonArrBaseline?(currentWonArr-previousWonArr)/previousWonArr*100:null,
      changePoints:pointChanges[`${metric}PointChange`],

      // All three percentage views use the same comparison record. The flat
      // fields make the API self-describing; `metrics` gives clients a stable
      // selector-friendly shape. The legacy metric/current/previous/changePoints
      // fields above remain intact for existing Win Board clients.
      currentDealWinRate,
      previousDealWinRate,
      dealWinRatePointChange,
      currentArrWinRate,
      previousArrWinRate,
      arrWinRatePointChange,
      currentContribution,
      previousContribution,
      contributionPointChange,
      metrics:{
        dealWinRate:{
          current:currentDealWinRate,
          previous:previousDealWinRate,
          changePoints:dealWinRatePointChange,
        },
        arrWinRate:{
          current:currentArrWinRate,
          previous:previousArrWinRate,
          changePoints:arrWinRatePointChange,
        },
        contribution:{
          current:currentContribution,
          previous:previousContribution,
          changePoints:contributionPointChange,
        },
      },
    };
  });
}

export function buildWinBoardComparisons(currentRows,previousRows){
  const current=buildWinBoardMetrics(currentRows),previous=buildWinBoardMetrics(previousRows);
  return {
    teams:compareGroup(current.teams,previous.teams,'contribution'),
    industries:compareGroup(current.industries,previous.industries,'contribution'),
    orgTypes:compareGroup(current.orgTypes,previous.orgTypes,'arrWinRate'),
    // POD scorecards display contribution to the selected period's total Won ARR.
    // ARR win rate remains available as supporting tooltip context, while the
    // comparison's Won ARR growth percentage continues to drive the arrow.
    pods:compareGroup(current.pods,previous.pods,'contribution'),
  };
}

export function distinctOpportunityRows(rows){
  const seen=new Set();
  return rows.filter(row=>{
    const id=String(row.id||'').trim();
    if(!id||seen.has(id))return false;
    seen.add(id);
    return true;
  });
}

export function buildWinBoardSnapshot(rows,filters={}){
  const list=value=>(Array.isArray(value)?value:value?[value]:[]).filter(Boolean);
  const baseFilters={region:filters.region,orgType:filters.orgType,industry:filters.industry,type:filters.type};
  let filtered=rows;
  for(const [field,value] of Object.entries(baseFilters)){
    const selected=list(value);
    if(selected.length)filtered=filtered.filter(row=>selected.includes(row[field]));
  }

  const inRange=(row,from,to)=>row.createdDate&&row.createdDate>=from&&row.createdDate<=to;
  // The trend chart always shows a full calendar year (see buildYearlyTrend)
  // regardless of the active date filter, plus the same year-1 for a real
  // year-over-year comparison line — computed from the categorical filters
  // only (`filtered`), never from the date-range-narrowed rows below.
  const trendYear=resolveTrendYear(filters);
  const previousTrendYear=trendYear-1;
  const trend=buildYearlyTrend(distinctOpportunityRows(filtered.filter(row=>inRange(row,`${trendYear}-01-01`,`${trendYear}-12-31`))),trendYear);
  const previousTrend=buildYearlyTrend(distinctOpportunityRows(filtered.filter(row=>inRange(row,`${previousTrendYear}-01-01`,`${previousTrendYear}-12-31`))),previousTrendYear);

  const period=previousEqualPeriod(
    filters.createdFrom,filters.createdTo,filters.datePreset,filters.dateCount,filters.dateUnit,
  );
  if(!period){
    let currentRows=filtered;
    if(filters.createdFrom)currentRows=currentRows.filter(row=>row.createdDate&&row.createdDate>=filters.createdFrom);
    if(filters.createdTo)currentRows=currentRows.filter(row=>row.createdDate&&row.createdDate<=filters.createdTo);
    const metrics=buildWinBoardMetrics(distinctOpportunityRows(currentRows));
    metrics.trend=trend;metrics.trendYear=trendYear;
    return {metrics,comparison:{available:false,reason:'Select both Created Date boundaries',previousTrend,previousTrendYear}};
  }

  const currentRows=distinctOpportunityRows(filtered.filter(row=>inRange(row,period.currentFrom,period.currentTo)));
  const previousRows=distinctOpportunityRows(filtered.filter(row=>inRange(row,period.previousFrom,period.previousTo)));
  const comparison=compareArr(currentRows,previousRows,period);
  comparison.groups=buildWinBoardComparisons(currentRows,previousRows);
  comparison.previousTrend=previousTrend;
  comparison.previousTrendYear=previousTrendYear;
  const metrics=buildWinBoardMetrics(currentRows);
  metrics.trend=trend;metrics.trendYear=trendYear;
  return {metrics,comparison:{available:true,...comparison}};
}
