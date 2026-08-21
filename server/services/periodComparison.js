const DAY = 86_400_000;
const sumArr = rows => rows.reduce((total,row)=>total+(Number(row.arr)||0),0);
const pct = (part,total) => total ? part/total*100 : 0;

export function previousEqualPeriod(from,to,preset='custom',count=1,unit='quarter'){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||''))return null;
  const start=new Date(`${from}T00:00:00Z`),end=new Date(`${to}T00:00:00Z`);
  if(!Number.isFinite(start.getTime())||end<start)return null;
  const days=Math.round((end-start)/DAY)+1;
  let previousFrom;
  let previousTo;
  if(preset==='currentWeek'||preset==='previousWeek'){
    previousFrom=new Date(start.getTime()-7*DAY);
    // Compares with the complete previous week (7 days from previousFrom), not
    // just the same number of days elapsed so far in an in-progress current week.
    previousTo=new Date(previousFrom.getTime()+6*DAY);
  } else if(preset==='currentQuarter'){
    previousFrom=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()-3,1));
    // A current-quarter selection compares with the complete previous
    // calendar quarter. This makes its "previous period" identical to the
    // values shown when the user explicitly selects Previous quarter.
    previousTo=new Date(start.getTime()-DAY);
  } else if(preset==='previousQuarter'){
    previousFrom=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()-3,1));
    previousTo=new Date(start.getTime()-DAY);
  } else if(preset==='currentYear'||preset==='previousYear'){
    previousFrom=new Date(Date.UTC(start.getUTCFullYear()-1,0,1));
    // A current-year selection compares with the complete previous calendar
    // year, not just the same number of days elapsed so far this year.
    previousTo=new Date(Date.UTC(start.getUTCFullYear()-1,11,31));
  } else if(preset==='previousN'){
    const n=Math.max(1,Number(count)||1);
    previousTo=new Date(start.getTime()-DAY);
    if(unit==='week')previousFrom=new Date(start.getTime()-n*7*DAY);
    else if(unit==='year')previousFrom=new Date(Date.UTC(start.getUTCFullYear()-n,0,1));
    else previousFrom=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()-n*3,1));
  }
  else {
    previousTo=new Date(start.getTime()-DAY);
    previousFrom=new Date(previousTo.getTime()-(days-1)*DAY);
  }
  const format=date=>date.toISOString().slice(0,10);
  return {currentFrom:from,currentTo:to,previousFrom:format(previousFrom),previousTo:format(previousTo),days};
}

export function arrMetrics(rows){
  const closed=rows.filter(row=>row.isClosed),won=closed.filter(row=>row.isWon),open=rows.filter(row=>!row.isClosed);
  const arr=sumArr(rows),wonArr=sumArr(won),closedArr=sumArr(closed),openArr=sumArr(open);
  return {
    arr,wonArr,closedArr,openArr,
    opportunities:rows.length,
    openOpportunities:open.length,
    closedOpportunities:closed.length,
    wonOpportunities:won.length,
    arrWinRate:pct(wonArr,closedArr),
    dealWinRate:pct(won.length,closed.length),
    // COUNTD(IF [Opp Stage]="Closed Won" THEN [Opp Id] END) / COUNTD(Total [Opp Id])
    // — win rate against every opportunity (open included), not just closed ones.
    dealWinRateOfAll:pct(won.length,rows.length),
    // SUM(IF NOT [Closed] THEN [ARR] END) / SUM([ARR]) — share of total pipeline ARR still open.
    openArrPct:pct(openArr,arr),
    // COUNTD(IF NOT [Closed] THEN [Opp Id] END) / COUNTD([Opp Id]) — share of
    // all opportunities (by count, not ARR) that are still open.
    openOppRate:pct(open.length,rows.length),
  };
}

// A point change needs a defined rate at BOTH ends. Guarding only the previous
// denominator let an empty current period report a fabricated collapse: a
// filter whose current window has closed nothing produced "0% vs 42.3%" and a
// headline drop of 42.3 points, when in truth no deal had closed yet to have a
// rate at all. No baseline on either side means no comparison, not a plunge.
export function compareArr(currentRows,previousRows,period){
  const current=arrMetrics(currentRows),previous=arrMetrics(previousRows);
  return {period,current,previous,
    arrChangePct:previous.arr ? (current.arr-previous.arr)/previous.arr*100 : null,
    wonArrGrowthPct:previous.wonArr ? (current.wonArr-previous.wonArr)/previous.wonArr*100 : null,
    closedArrGrowthPct:previous.closedArr ? (current.closedArr-previous.closedArr)/previous.closedArr*100 : null,
    arrWinRatePointChange:previous.closedArr && current.closedArr ? current.arrWinRate-previous.arrWinRate : null,
    dealWinRatePointChange:previous.closedOpportunities && current.closedOpportunities
      ? current.dealWinRate-previous.dealWinRate
      : null,
    dealWinRateOfAllPointChange:previous.opportunities && current.opportunities
      ? current.dealWinRateOfAll-previous.dealWinRateOfAll
      : null,
    openArrPctPointChange:previous.arr && current.arr ? current.openArrPct-previous.openArrPct : null,
    openOppRatePointChange:previous.opportunities && current.opportunities ? current.openOppRate-previous.openOppRate : null,
  };
}

// The generic dashboard comparison (Opportunity Analytics and any other
// template without its own board service).
//
// Opportunity Analytics can filter on Created date, Close date, or both, and
// its date picker defaults its quick ranges to Close date — so Close-only is
// the common case, not the exception. This used to derive the period from
// createdFrom/createdTo alone, which meant a Close-date filter left the whole
// comparison layer unavailable: the user picked a range and every trend badge
// on the dashboard silently disappeared. Compare on whichever field the range
// was actually set on; when both are set, Created date wins so behaviour
// matches the Win and Loss boards, which compare on created date only.
export function buildGenericComparison(rows, query = {}) {
  const hasCreated = Boolean(query.createdFrom && query.createdTo);
  const hasClose = Boolean(query.closeFrom && query.closeTo);
  const useCloseDate = !hasCreated && hasClose;
  const dateField = useCloseDate ? 'closeDate' : 'createdDate';
  const [from, to] = useCloseDate
    ? [query.closeFrom, query.closeTo]
    : [query.createdFrom, query.createdTo];
  const period = previousEqualPeriod(from, to, query.datePreset, query.dateCount, query.dateUnit);
  if (!period) {
    return { available: false, reason: 'Select both Created Date or both Close Date boundaries' };
  }

  const list = value => (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
  let filtered = rows;
  for (const field of ['region','orgType','stage','owner','source','type','industry','pod','team']) {
    const selected = list(query[field]);
    if (selected.length) filtered = filtered.filter(row => selected.includes(row[field]));
  }

  const seen = new Set();
  filtered = filtered.filter(row => {
    const id = String(row.id || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const inRange = (row, start, end) => row[dateField] && row[dateField] >= start && row[dateField] <= end;
  const currentRows = filtered.filter(row => inRange(row, period.currentFrom, period.currentTo));
  const previousRows = filtered.filter(row => inRange(row, period.previousFrom, period.previousTo));
  return { available: true, dateField, ...compareArr(currentRows, previousRows, period) };
}

// Loss Board's mirror of arrMetrics/compareArr above. lostAfterTrial is
// scoped to CLOSED opportunities that reached a trial (row.trialStageAt is
// set) — the rate is "of the closed deals that got a trial, what share were
// lost", not "of all lost deals, how many had a trial".
export function lossArrMetrics(rows){
  const closed=rows.filter(row=>row.isClosed),lost=closed.filter(row=>!row.isWon),open=rows.filter(row=>!row.isClosed);
  const trialClosed=closed.filter(row=>row.trialStageAt);
  const trialLost=trialClosed.filter(row=>!row.isWon);
  const arr=sumArr(rows),lostArr=sumArr(lost),closedArr=sumArr(closed),openArr=sumArr(open);
  return {
    arr,lostArr,closedArr,openArr,
    opportunities:rows.length,
    openOpportunities:open.length,
    closedOpportunities:closed.length,
    lostOpportunities:lost.length,
    arrLostRate:pct(lostArr,closedArr),
    lossOppRate:pct(lost.length,closed.length),
    // COUNTD(IF [Opp Stage]="Closed Lost" THEN [Opp Id] END) / COUNTD(Total [Opp Id])
    // — loss rate against every opportunity (open included), not just closed ones.
    lossOppRateOfAll:pct(lost.length,rows.length),
    // SUM(IF NOT [Closed] THEN [ARR] END) / SUM([ARR]) — share of total pipeline ARR still open.
    openArrPct:pct(openArr,arr),
    // COUNTD(IF NOT [Closed] THEN [Opp Id] END) / COUNTD([Opp Id]) — share of
    // all opportunities (by count, not ARR) that are still open.
    openOppRate:pct(open.length,rows.length),
    trialClosedOpportunities:trialClosed.length,
    lostAfterTrialCount:trialLost.length,
    lostAfterTrialRate:pct(trialLost.length,trialClosed.length),
  };
}

export function compareLossArr(currentRows,previousRows,period){
  const current=lossArrMetrics(currentRows),previous=lossArrMetrics(previousRows);
  return {period,current,previous,
    arrChangePct:previous.arr ? (current.arr-previous.arr)/previous.arr*100 : null,
    lostArrGrowthPct:previous.lostArr ? (current.lostArr-previous.lostArr)/previous.lostArr*100 : null,
    closedArrGrowthPct:previous.closedArr ? (current.closedArr-previous.closedArr)/previous.closedArr*100 : null,
    arrLostRatePointChange:previous.closedArr ? current.arrLostRate-previous.arrLostRate : null,
    lossOppRatePointChange:previous.closedOpportunities
      ? current.lossOppRate-previous.lossOppRate
      : null,
    lossOppRateOfAllPointChange:previous.opportunities
      ? current.lossOppRateOfAll-previous.lossOppRateOfAll
      : null,
    openArrPctPointChange:previous.arr ? current.openArrPct-previous.openArrPct : null,
    openOppRatePointChange:previous.opportunities ? current.openOppRate-previous.openOppRate : null,
    lostAfterTrialRatePointChange:previous.trialClosedOpportunities
      ? current.lostAfterTrialRate-previous.lostAfterTrialRate
      : null,
  };
}
