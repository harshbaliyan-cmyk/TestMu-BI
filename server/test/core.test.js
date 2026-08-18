import test from 'node:test';
import assert from 'node:assert/strict';
import {autoMap,applyMapping} from '../datasources.js';
import {encryptCredential,decryptCredential} from '../services/credentialCipher.js';
import {buildWinBoardMetrics,buildWinBoardComparisons,buildWinBoardSnapshot} from '../services/winBoardMetrics.js';
import {buildLossBoardMetrics,buildLossBoardComparisons,buildLossBoardSnapshot} from '../services/lossBoardMetrics.js';
import {buildAePerformanceMetrics,buildAePerformanceSnapshot} from '../services/aePerformanceMetrics.js';
import {previousEqualPeriod,compareArr,compareLossArr,buildGenericComparison} from '../services/periodComparison.js';

test('Tableau credentials round-trip with authenticated encryption',()=>{
  const previous=process.env.TABLEAU_CREDENTIAL_ENCRYPTION_KEY;
  process.env.TABLEAU_CREDENTIAL_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
  const encrypted=encryptCredential('secret-value');
  assert.notEqual(encrypted,'secret-value'); assert.equal(decryptCredential(encrypted),'secret-value');
  process.env.TABLEAU_CREDENTIAL_ENCRYPTION_KEY=previous;
});

test('preferred Tableau headers map to canonical identity/owner/date/BDR/type fields',()=>{
  const {fieldMapping}=autoMap(['Owner Name','Opportunity Created Date','BDR Owner Name','Opportunity ID','Account ID','Opportunity Type']);
  assert.equal(fieldMapping.owner,'Owner Name');
  assert.equal(fieldMapping.createdDate,'Opportunity Created Date');
  assert.equal(fieldMapping.bdrName,'BDR Owner Name');
  assert.equal(fieldMapping.id,'Opportunity ID');
  assert.equal(fieldMapping.accountId,'Account ID');
  assert.equal(fieldMapping.type,'Opportunity Type');
});

test('mapping derives closed and won from stage',()=>{
  const [row]=applyMapping([{Id:'A-1',Stage:'Closed Won',Amount:'1,250'}],{id:'Id',stage:'Stage',amount:'Amount'});
  assert.equal(row.id,'A-1'); assert.equal(row.isClosed,true); assert.equal(row.isWon,true); assert.equal(row.amount,1250);
});

test('mapping classifies a blank Industry as "No Industry" rather than leaving it invisible to filters',()=>{
  const [blank,mapped,unmapped]=applyMapping([
    {Id:'A-1',Industry:''},
    {Id:'A-2',Industry:'Fintech'},
    {Id:'A-3'},
  ],{id:'Id',industry:'Industry'});
  assert.equal(blank.industry,'No Industry');
  assert.equal(mapped.industry,'Fintech');
  assert.equal(unmapped.industry,'No Industry');
});

test('Win Board formulas are calculated in the backend',()=>{
  const result=buildWinBoardMetrics([
    {id:'1',isClosed:true,isWon:true,arr:100,team:'AE East',industry:'Tech',orgType:'SMB',pod:'AE Corp',owner:'A',createdDate:'2026-01-01'},
    {id:'2',isClosed:true,isWon:false,arr:300,team:'AE East',industry:'Tech',orgType:'SMB',pod:'AE Corp',owner:'A',createdDate:'2026-01-02'},
  ]);
  assert.equal(result.overall.wonArr,100);
  assert.equal(result.overall.arrWinRate,25);
  assert.equal(result.overall.dealWinRate,50);
  assert.equal(result.teams[0].contribution,100);
});

test('Opportunity win/loss rate KPI tiles are calculated against ALL opportunities, not just closed ones',()=>{
  const rows=[
    {id:'1',isClosed:true,isWon:true,arr:100,createdDate:'2026-01-01'},
    {id:'2',isClosed:true,isWon:false,arr:300,createdDate:'2026-01-02'},
    {id:'3',isClosed:false,isWon:false,arr:600,createdDate:'2026-01-03'},
  ];
  const win=buildWinBoardMetrics(rows);
  assert.equal(win.overall.open,1);
  assert.equal(win.overall.totalArr,1000);
  assert.equal(win.overall.openArr,600);
  assert.ok(Math.abs(win.overall.dealWinRateOfAll-(100/3))<0.0001); // 1 won / 3 total opportunities
  assert.equal(win.overall.openArrPct,60); // 600 open ARR / 1000 total ARR

  const loss=buildLossBoardMetrics(rows);
  assert.equal(loss.overall.open,1);
  assert.ok(Math.abs(loss.overall.lossOppRateOfAll-(100/3))<0.0001); // 1 lost / 3 total opportunities
  assert.equal(loss.overall.openArrPct,60);
});

test('Open opportunity rate (by count, not ARR) is calculated against all opportunities',()=>{
  const rows=[
    {id:'1',isClosed:true,isWon:true,arr:100,createdDate:'2026-01-01'},
    {id:'2',isClosed:false,isWon:false,arr:300,createdDate:'2026-01-02'},
    {id:'3',isClosed:false,isWon:false,arr:600,createdDate:'2026-01-03'},
    {id:'4',isClosed:false,isWon:false,arr:600,createdDate:'2026-01-03'},
  ]; // 1 closed, 3 open opportunities -> 75% open by count
  const win=buildWinBoardMetrics(rows);
  assert.equal(win.overall.openOppRate,75);
  const loss=buildLossBoardMetrics(rows);
  assert.equal(loss.overall.openOppRate,75);
});

test('comparison exposes the open-opportunity-rate point change',()=>{
  const period=previousEqualPeriod('2026-04-01','2026-04-01');
  const win=compareArr(
    [{arr:100,isClosed:false,isWon:false},{arr:100,isClosed:true,isWon:true}],
    [{arr:100,isClosed:false,isWon:false},{arr:100,isClosed:false,isWon:false},{arr:100,isClosed:true,isWon:true},{arr:100,isClosed:true,isWon:true}],
    period,
  );
  assert.equal(win.current.openOppRate,50);
  assert.equal(win.previous.openOppRate,50);
  assert.equal(win.openOppRatePointChange,0);

  const loss=compareLossArr(
    [{arr:100,isClosed:false,isWon:false}],
    [{arr:100,isClosed:true,isWon:false}],
    period,
  );
  assert.equal(loss.current.openOppRate,100);
  assert.equal(loss.previous.openOppRate,0);
  assert.equal(loss.openOppRatePointChange,100);
});

test('comparison exposes the all-opportunities win/loss rate and open-ARR% point changes',()=>{
  const currentRows=[
    {id:'c1',isClosed:true,isWon:true,arr:100},
    {id:'c2',isClosed:false,isWon:false,arr:100},
  ];
  const previousRows=[
    {id:'p1',isClosed:true,isWon:true,arr:50},
    {id:'p2',isClosed:true,isWon:true,arr:50},
    {id:'p3',isClosed:true,isWon:false,arr:50},
    {id:'p4',isClosed:false,isWon:false,arr:50},
  ];
  const period=previousEqualPeriod('2026-04-01','2026-04-01');
  const win=compareArr(currentRows,previousRows,period);
  assert.equal(win.current.dealWinRateOfAll,50);     // 1 won / 2 total
  assert.equal(win.previous.dealWinRateOfAll,50);    // 2 won / 4 total
  assert.equal(win.dealWinRateOfAllPointChange,0);
  assert.equal(win.current.openArrPct,50);
  assert.equal(win.previous.openArrPct,25);
  assert.equal(win.openArrPctPointChange,25);

  const loss=compareLossArr(currentRows,previousRows,period);
  assert.equal(loss.current.lossOppRateOfAll,0);     // 0 lost / 2 total
  assert.equal(loss.previous.lossOppRateOfAll,25);   // 1 lost / 4 total
  assert.equal(loss.lossOppRateOfAllPointChange,-25);
});

test('Win Board counts opportunities distinctly by Opportunity ID',()=>{
  const row={id:'1',isClosed:true,isWon:true,arr:100,team:'AE East',industry:'Tech',orgType:'SMB',pod:'AE Corp',createdDate:'2026-01-01'};
  const result=buildWinBoardMetrics([row,{...row}]);
  assert.equal(result.overall.closed,1);
  assert.equal(result.overall.wins,1);
  assert.equal(result.overall.wonArr,100);
});

test('Win Board category tooltip metrics use the documented denominators',()=>{
  const result=buildWinBoardMetrics([
    {id:'1',isClosed:true,isWon:true,arr:100,industry:'Tech',createdDate:'2026-01-01'},
    {id:'2',isClosed:true,isWon:false,arr:300,industry:'Tech',createdDate:'2026-01-02'},
    {id:'3',isClosed:true,isWon:true,arr:300,industry:'Finance',createdDate:'2026-01-03'},
  ]);
  const tech=result.industries.find(item=>item.label==='Tech');
  assert.equal(tech.closed,2);
  assert.equal(tech.wins,1);
  assert.equal(tech.losses,1);
  assert.equal(tech.wonArr,100);
  assert.equal(tech.dealWinRate,50);       // 1 won / 2 closed opportunities
  assert.equal(tech.arrWinRate,25);        // 100 Won ARR / 400 closed ARR
  assert.equal(tech.contribution,25);      // 100 / 400 total Won ARR
});

test('Win Board contribution excludes records marked won but not closed',()=>{
  const result=buildWinBoardMetrics([
    {id:'closed-win',isClosed:true,isWon:true,arr:100,industry:'Tech',createdDate:'2026-01-01'},
    {id:'malformed-open-win',isClosed:false,isWon:true,arr:900,industry:'Other',createdDate:'2026-01-02'},
  ]);
  const tech=result.industries.find(item=>item.label==='Tech');
  assert.equal(result.overall.wonArr,100);
  assert.equal(tech.contribution,100);
});

test('comparison uses the immediately preceding inclusive equal-length period',()=>{
  assert.deepEqual(previousEqualPeriod('2026-04-01','2026-06-30'),{
    currentFrom:'2026-04-01',currentTo:'2026-06-30',
    previousFrom:'2025-12-31',previousTo:'2026-03-31',days:91,
  });
});

test('current-quarter comparison uses the complete previous calendar quarter',()=>{
  assert.deepEqual(previousEqualPeriod('2026-07-01','2026-08-12','currentQuarter'),{
    currentFrom:'2026-07-01',currentTo:'2026-08-12',
    previousFrom:'2026-04-01',previousTo:'2026-06-30',days:43,
  });
});

test('previous-quarter comparison uses the preceding calendar quarter',()=>{
  assert.deepEqual(previousEqualPeriod('2026-04-01','2026-06-30','previousQuarter'),{
    currentFrom:'2026-04-01',currentTo:'2026-06-30',
    previousFrom:'2026-01-01',previousTo:'2026-03-31',days:91,
  });
});

test('current-year comparison uses the complete previous calendar year',()=>{
  assert.deepEqual(previousEqualPeriod('2026-01-01','2026-01-31','currentYear'),{
    currentFrom:'2026-01-01',currentTo:'2026-01-31',
    previousFrom:'2025-01-01',previousTo:'2025-12-31',days:31,
  });
});

test('current-week comparison uses the complete previous week',()=>{
  assert.deepEqual(previousEqualPeriod('2026-08-10','2026-08-12','currentWeek'),{
    currentFrom:'2026-08-10',currentTo:'2026-08-12',
    previousFrom:'2026-08-03',previousTo:'2026-08-09',days:3,
  });
});

test('current-quarter previous metrics equal the explicit previous-quarter metrics',()=>{
  const rows=[
    {id:'q2-win',createdDate:'2026-04-15',isClosed:true,isWon:true,arr:100,region:'AMER'},
    {id:'q2-loss',createdDate:'2026-06-20',isClosed:true,isWon:false,arr:300,region:'AMER'},
    {id:'q3-win',createdDate:'2026-07-12',isClosed:true,isWon:true,arr:200,region:'AMER'},
  ];
  const currentQuarter=buildWinBoardSnapshot(rows,{
    region:['AMER'],createdFrom:'2026-07-01',createdTo:'2026-08-13',datePreset:'currentQuarter',
  });
  const previousQuarter=buildWinBoardSnapshot(rows,{
    region:['AMER'],createdFrom:'2026-04-01',createdTo:'2026-06-30',datePreset:'previousQuarter',
  });
  assert.equal(currentQuarter.comparison.previous.arrWinRate,previousQuarter.metrics.overall.arrWinRate);
  assert.equal(currentQuarter.comparison.previous.closedArr,previousQuarter.metrics.overall.closedArr);
  assert.equal(currentQuarter.comparison.previous.closedOpportunities,previousQuarter.metrics.overall.closed);
});

test('Win Board compares each category displayed percentage with the same prior category',()=>{
  const base={isClosed:true,createdDate:'2026-04-01'};
  const comparisons=buildWinBoardComparisons([
    {...base,id:'c1',isWon:true,arr:60,team:'Enterprise',industry:'Tech',orgType:'Enterprise',pod:'AE'},
    {...base,id:'c2',isWon:false,arr:40,team:'Enterprise',industry:'Tech',orgType:'Enterprise',pod:'AE'},
  ],[
    {...base,id:'p1',isWon:true,arr:50,team:'Enterprise',industry:'Tech',orgType:'Enterprise',pod:'AE'},
    {...base,id:'p2',isWon:false,arr:50,team:'Enterprise',industry:'Tech',orgType:'Enterprise',pod:'AE'},
  ]);
  assert.equal(comparisons.teams[0].changePoints,0); // each period has one category, so contribution is 100%
  assert.equal(comparisons.orgTypes[0].changePoints,10); // ARR win rate rises from 50% to 60%
  assert.equal(comparisons.teams[0].wonArrGrowthPct,20); // Won ARR rises from 50 to 60
});

test('Win Board category comparisons expose all three selectable percentage views',()=>{
  const row=(id,label,isWon,arr)=>(
    {id,industry:label,isClosed:true,isWon,arr,createdDate:'2026-04-01'}
  );
  const comparisons=buildWinBoardComparisons([
    row('current-tech-win','Tech',true,60),
    row('current-tech-loss','Tech',false,40),
    row('current-finance-win','Finance',true,40),
  ],[
    row('previous-tech-win','Tech',true,50),
    row('previous-tech-loss-a','Tech',false,25),
    row('previous-tech-loss-b','Tech',false,25),
    row('previous-finance-win','Finance',true,200),
  ]);
  const tech=comparisons.industries.find(item=>item.label==='Tech');

  assert.equal(tech.currentDealWinRate,50);
  assert.ok(Math.abs(tech.previousDealWinRate-100/3)<1e-10);
  assert.ok(Math.abs(tech.dealWinRatePointChange-(50-100/3))<1e-10);
  assert.equal(tech.currentArrWinRate,60);
  assert.equal(tech.previousArrWinRate,50);
  assert.equal(tech.arrWinRatePointChange,10);
  assert.equal(tech.currentContribution,60);
  assert.equal(tech.previousContribution,20);
  assert.equal(tech.contributionPointChange,40);
  assert.deepEqual(tech.metrics.arrWinRate,{current:60,previous:50,changePoints:10});
  assert.deepEqual(tech.metrics.contribution,{current:60,previous:20,changePoints:40});
  assert.ok(Math.abs(tech.metrics.dealWinRate.changePoints-(50-100/3))<1e-10);

  // Existing clients still receive the category's original default metric.
  assert.equal(tech.metric,'contribution');
  assert.equal(tech.current,60);
  assert.equal(tech.previous,20);
  assert.equal(tech.changePoints,40);
});

test('Win Board selectable category comparisons use null when no prior category exists',()=>{
  const comparisons=buildWinBoardComparisons([
    {id:'current-new',industry:'New market',isClosed:true,isWon:true,arr:80,createdDate:'2026-04-01'},
  ],[]);
  const item=comparisons.industries[0];

  assert.equal(item.hasPrevious,false);
  assert.equal(item.previous,null);
  assert.equal(item.changePoints,null);
  for(const metric of ['dealWinRate','arrWinRate','contribution']){
    assert.equal(item.metrics[metric].previous,null);
    assert.equal(item.metrics[metric].changePoints,null);
  }
  assert.equal(item.previousDealWinRate,null);
  assert.equal(item.previousArrWinRate,null);
  assert.equal(item.previousContribution,null);
  assert.equal(item.dealWinRatePointChange,null);
  assert.equal(item.arrWinRatePointChange,null);
  assert.equal(item.contributionPointChange,null);
});

test('Win Board compares PODs by Won ARR contribution while preserving supporting metrics',()=>{
  const row=(id,createdDate,pod,isWon,arr)=>({
    id,createdDate,pod,isClosed:true,isWon,arr,
  });
  const comparisons=buildWinBoardComparisons([
    row('current-a-win','2026-04-01','POD A',true,60),
    row('current-a-loss','2026-04-01','POD A',false,40),
    row('current-b-win','2026-04-01','POD B',true,40),
  ],[
    row('previous-a-win','2026-03-01','POD A',true,50),
    row('previous-a-loss','2026-03-01','POD A',false,50),
    row('previous-b-win','2026-03-01','POD B',true,200),
  ]);
  const podA=comparisons.pods.find(item=>item.label==='POD A');

  assert.equal(podA.metric,'contribution');
  assert.equal(podA.current,60);                 // 60 / 100 selected-period Won ARR
  assert.equal(podA.previous,20);                // 50 / 250 previous-period Won ARR
  assert.equal(podA.changePoints,40);             // Won ARR contribution change
  assert.equal(podA.arrWinRatePointChange,10);    // 60% vs 50%, retained for tooltip
  assert.equal(podA.wonArrGrowthPct,20);          // 60 vs 50, retained for arrow
});

test('Win Board category growth handles increases, full declines, new categories and missing baselines',()=>{
  const row=(id,label,isWon,arr)=>({
    id,isClosed:true,isWon,arr,team:label,industry:label,orgType:label,pod:label,createdDate:'2026-04-01',
  });
  const comparisons=buildWinBoardComparisons([
    row('c-tech-win','Tech',true,120),row('c-tech-loss','Tech',false,80),
    row('c-decline','Decline',false,50),
    row('c-new','New category',true,30),
    row('c-no-base','No baseline',true,40),
  ],[
    row('p-no-base','No baseline',false,100),
    row('p-decline-win','Decline',true,50),row('p-decline-loss','Decline',false,50),
    row('p-tech-win','Tech',true,100),row('p-tech-loss','Tech',false,100),
  ]);

  for(const groupName of ['teams','industries','orgTypes','pods']){
    const byLabel=new Map(comparisons[groupName].map(item=>[item.label,item]));
    assert.equal(byLabel.get('Tech').wonArrGrowthPct,20);
    assert.equal(byLabel.get('Decline').wonArrGrowthPct,-100);
    assert.equal(byLabel.get('New category').hasPrevious,false);
    assert.equal(byLabel.get('New category').wonArrGrowthPct,null);
    assert.equal(byLabel.get('New category').changePoints,null);
    assert.equal(byLabel.get('No baseline').hasPrevious,true);
    assert.equal(byLabel.get('No baseline').hasWonArrBaseline,false);
    assert.equal(byLabel.get('No baseline').wonArrGrowthPct,null);
  }
});

test('Win Board snapshot uses identical current rows for KPI values and comparison badges',()=>{
  const rows=[
    {id:'current-win',createdDate:'2026-04-01',isClosed:true,isWon:true,arr:100,region:'AMER'},
    {id:'current-loss',createdDate:'2026-04-02',isClosed:true,isWon:false,arr:300,region:'AMER'},
    {id:'previous-win',createdDate:'2026-03-31',isClosed:true,isWon:true,arr:50,region:'AMER'},
    {id:'previous-loss',createdDate:'2026-03-30',isClosed:true,isWon:false,arr:50,region:'AMER'},
  ];
  const snapshot=buildWinBoardSnapshot(rows,{
    region:['AMER'],createdFrom:'2026-04-01',createdTo:'2026-04-02',datePreset:'custom',
  });
  assert.equal(snapshot.metrics.overall.arrWinRate,snapshot.comparison.current.arrWinRate);
  assert.equal(snapshot.metrics.overall.dealWinRate,snapshot.comparison.current.dealWinRate);
  assert.equal(snapshot.metrics.overall.closedArr,snapshot.comparison.current.closedArr);
});

test('Win Board snapshot deduplicates Opportunity IDs within each comparison period',()=>{
  const duplicateIdRows=[
    {id:'same-opportunity',createdDate:'2026-03-31',isClosed:true,isWon:false,arr:100},
    {id:'same-opportunity',createdDate:'2026-04-01',isClosed:true,isWon:true,arr:200},
    {id:'same-opportunity',createdDate:'2026-04-01',isClosed:true,isWon:true,arr:200},
  ];
  const snapshot=buildWinBoardSnapshot(duplicateIdRows,{
    createdFrom:'2026-04-01',createdTo:'2026-04-01',datePreset:'custom',
  });
  assert.equal(snapshot.metrics.overall.opportunities,1);
  assert.equal(snapshot.metrics.overall.arrWinRate,100);
  assert.equal(snapshot.comparison.current.arrWinRate,100);
  assert.equal(snapshot.comparison.previous.arrWinRate,0);
  assert.equal(snapshot.comparison.current.closedOpportunities,1);
  assert.equal(snapshot.comparison.previous.closedOpportunities,1);
});

test('comparison reports ARR percent and ARR win-rate point changes',()=>{
  const result=compareArr(
    [{arr:100,isClosed:true,isWon:true}],
    [{arr:110,isClosed:true,isWon:false}],
    previousEqualPeriod('2026-04-01','2026-04-01'),
  );
  assert.ok(Math.abs(result.arrChangePct-(-9.090909))<0.0001);
  assert.ok(Math.abs(result.closedArrGrowthPct-(-9.090909))<0.0001);
  assert.equal(result.wonArrGrowthPct,null);
  assert.equal(result.arrWinRatePointChange,100);
  assert.equal(result.dealWinRatePointChange,100);
});

test('KPI comparison calculates Closed ARR growth and deal win-rate point change independently',()=>{
  const result=compareArr(
    [{arr:200,isClosed:true,isWon:true},{arr:100,isClosed:true,isWon:false}],
    [
      {arr:100,isClosed:true,isWon:true},
      {arr:100,isClosed:true,isWon:false},
      {arr:100,isClosed:true,isWon:false},
      {arr:100,isClosed:true,isWon:false},
    ],
    previousEqualPeriod('2026-04-01','2026-04-01'),
  );
  assert.equal(result.current.dealWinRate,50);
  assert.equal(result.previous.dealWinRate,25);
  assert.equal(result.dealWinRatePointChange,25);
  assert.equal(result.closedArrGrowthPct,-25);
});

test('KPI comparison does not invent growth when the previous period has no valid baseline',()=>{
  const result=compareArr(
    [{arr:100,isClosed:true,isWon:true}],
    [{arr:100,isClosed:false,isWon:false}],
    previousEqualPeriod('2026-04-01','2026-04-01'),
  );
  assert.equal(result.closedArrGrowthPct,null);
  assert.equal(result.arrWinRatePointChange,null);
  assert.equal(result.dealWinRatePointChange,null);
});

test('comparison reports Won ARR growth from the previous equal-length period',()=>{
  const result=compareArr(
    [{arr:150,isClosed:true,isWon:true}],
    [{arr:100,isClosed:true,isWon:true}],
    previousEqualPeriod('2026-04-01','2026-04-01'),
  );
  assert.equal(result.wonArrGrowthPct,50);
});

test('Won ARR growth is unavailable when the previous period has no Won ARR',()=>{
  const result=compareArr(
    [{arr:150,isClosed:true,isWon:true}],
    [{arr:100,isClosed:true,isWon:false}],
    previousEqualPeriod('2026-04-01','2026-04-01'),
  );
  assert.equal(result.wonArrGrowthPct,null);
});

test('Won ARR growth reports a complete decline when current Won ARR reaches zero',()=>{
  const result=compareArr(
    [{arr:150,isClosed:true,isWon:false}],
    [{arr:100,isClosed:true,isWon:true}],
    previousEqualPeriod('2026-04-01','2026-04-01'),
  );
  assert.equal(result.wonArrGrowthPct,-100);
});

test('Loss Board formulas are calculated in the backend',()=>{
  const result=buildLossBoardMetrics([
    {id:'1',isClosed:true,isWon:false,arr:100,pod:'AE Corp',orgType:'SMB',lossReason:'Budget',createdDate:'2026-01-01'},
    {id:'2',isClosed:true,isWon:true,arr:300,pod:'AE Corp',orgType:'SMB',createdDate:'2026-01-02'},
  ]);
  assert.equal(result.overall.lostArr,100);
  assert.equal(result.overall.arrLostRate,25);   // 100 lost ARR / 400 closed ARR
  assert.equal(result.overall.lossOppRate,50);   // 1 lost / 2 closed opportunities
  assert.equal(result.pods[0].lossContribution,100); // AE Corp carries all $100 of lost ARR
});

test('Loss Board counts opportunities distinctly by Opportunity ID',()=>{
  const row={id:'1',isClosed:true,isWon:false,arr:100,pod:'AE Corp',orgType:'SMB',createdDate:'2026-01-01'};
  const result=buildLossBoardMetrics([row,{...row}]);
  assert.equal(result.overall.closed,1);
  assert.equal(result.overall.losses,1);
  assert.equal(result.overall.lostArr,100);
});

test('Loss Board category tooltip metrics use the documented denominators',()=>{
  const result=buildLossBoardMetrics([
    {id:'1',isClosed:true,isWon:false,arr:100,orgType:'SMB',createdDate:'2026-01-01'},
    {id:'2',isClosed:true,isWon:true,arr:300,orgType:'SMB',createdDate:'2026-01-02'},
    {id:'3',isClosed:true,isWon:false,arr:300,orgType:'Enterprise',createdDate:'2026-01-03'},
  ]);
  const smb=result.orgTypes.find(item=>item.label==='SMB');
  assert.equal(smb.closed,2);
  assert.equal(smb.wins,1);
  assert.equal(smb.losses,1);
  assert.equal(smb.lostArr,100);
  assert.equal(smb.lossOppRate,50);        // 1 lost / 2 closed opportunities
  assert.equal(smb.arrLostRate,25);        // 100 lost ARR / 400 closed ARR
  assert.equal(smb.lossContribution,25);   // 100 / 400 total lost ARR (SMB 100 + Enterprise 300)
});

test('Loss Board lost-after-trial matches COUNTD(trial AND Closed Lost) over COUNTD(trial AND Closed)',()=>{
  const result=buildLossBoardMetrics([
    {id:'1',isClosed:true,isWon:false,trialStageAt:'2026-01-01',createdDate:'2026-01-05',arr:100}, // trial + lost -> in numerator and denominator
    {id:'2',isClosed:true,isWon:true,trialStageAt:'2026-01-01',createdDate:'2026-01-05',arr:200},  // trial + won -> denominator only
    {id:'3',isClosed:true,isWon:false,createdDate:'2026-01-05',arr:150},                           // lost, never reached a trial -> excluded entirely
    {id:'4',isClosed:false,isWon:false,trialStageAt:'2026-01-01',createdDate:'2026-01-05',arr:50},  // still open -> not "Closed", excluded
  ]);
  assert.equal(result.overall.lostAfterTrial.count,1);
  assert.equal(result.overall.lostAfterTrial.trialClosedCount,2);
  assert.equal(result.overall.lostAfterTrial.rate,50);
});

test('Loss Board lost-after-trial rate is zero (not NaN) with no trial data at all',()=>{
  const result=buildLossBoardMetrics([
    {id:'1',isClosed:true,isWon:false,arr:100,createdDate:'2026-01-01'},
  ]);
  assert.equal(result.overall.lostAfterTrial.trialClosedCount,0);
  assert.equal(result.overall.lostAfterTrial.count,0);
  assert.equal(result.overall.lostAfterTrial.rate,0);
});

test('Loss Board category comparisons expose all three selectable percentage views',()=>{
  const comparisons=buildLossBoardComparisons([
    {id:'cur-1',isClosed:true,isWon:false,arr:100,pod:'AE Corp',createdDate:'2026-04-01'},
    {id:'cur-2',isClosed:true,isWon:true,arr:300,pod:'AE Corp',createdDate:'2026-04-02'},
  ],[
    {id:'prev-1',isClosed:true,isWon:false,arr:50,pod:'AE Corp',createdDate:'2026-03-01'},
    {id:'prev-2',isClosed:true,isWon:true,arr:50,pod:'AE Corp',createdDate:'2026-03-02'},
  ]);
  const [pod]=comparisons.pods;
  assert.equal(pod.hasPrevious,true);
  assert.equal(pod.metrics.lossOppRate.current,50);
  assert.equal(pod.metrics.arrLostRate.current,25);
  assert.equal(pod.metrics.lossContribution.current,100);
  assert.equal(pod.metrics.lossOppRate.previous,50);
  assert.equal(pod.metrics.arrLostRate.previous,50);
});

test('Loss Board snapshot uses identical current rows for KPI values and comparison badges',()=>{
  const rows=[
    {id:'current-loss',createdDate:'2026-04-01',isClosed:true,isWon:false,arr:100,region:'AMER'},
    {id:'current-win',createdDate:'2026-04-02',isClosed:true,isWon:true,arr:300,region:'AMER'},
    {id:'previous-loss',createdDate:'2026-03-31',isClosed:true,isWon:false,arr:50,region:'AMER'},
    {id:'previous-win',createdDate:'2026-03-30',isClosed:true,isWon:true,arr:50,region:'AMER'},
  ];
  const snapshot=buildLossBoardSnapshot(rows,{
    region:['AMER'],createdFrom:'2026-04-01',createdTo:'2026-04-02',datePreset:'custom',
  });
  assert.equal(snapshot.metrics.overall.arrLostRate,snapshot.comparison.current.arrLostRate);
  assert.equal(snapshot.metrics.overall.lossOppRate,snapshot.comparison.current.lossOppRate);
  assert.equal(snapshot.metrics.overall.closedArr,snapshot.comparison.current.closedArr);
});

test('Loss Board snapshot narrows by industry, matching Win Board',()=>{
  const rows=[
    {id:'fin-loss',createdDate:'2026-04-01',isClosed:true,isWon:false,arr:100,industry:'Financial Services'},
    {id:'fin-win',createdDate:'2026-04-02',isClosed:true,isWon:true,arr:100,industry:'Financial Services'},
    {id:'health-loss',createdDate:'2026-04-01',isClosed:true,isWon:false,arr:900,industry:'Health Care'},
  ];
  const filters={createdFrom:'2026-04-01',createdTo:'2026-04-02',datePreset:'custom'};
  const all=buildLossBoardSnapshot(rows,filters);
  const financial=buildLossBoardSnapshot(rows,{...filters,industry:['Financial Services']});
  assert.equal(all.metrics.overall.opportunities,3);
  assert.equal(all.metrics.overall.lostArr,1000);
  // Health Care's 900 of lost ARR must drop out entirely, not merely be
  // excluded from a chart — the whole board rescales to the chosen industry.
  assert.equal(financial.metrics.overall.opportunities,2);
  assert.equal(financial.metrics.overall.lostArr,100);
  assert.equal(financial.metrics.overall.arrLostRate,50);
});

test('Loss Board snapshot deduplicates Opportunity IDs within each comparison period',()=>{
  const duplicateIdRows=[
    {id:'same-opportunity',createdDate:'2026-03-31',isClosed:true,isWon:true,arr:100},
    {id:'same-opportunity',createdDate:'2026-04-01',isClosed:true,isWon:false,arr:200},
    {id:'same-opportunity',createdDate:'2026-04-01',isClosed:true,isWon:false,arr:200},
  ];
  const snapshot=buildLossBoardSnapshot(duplicateIdRows,{
    createdFrom:'2026-04-01',createdTo:'2026-04-01',datePreset:'custom',
  });
  assert.equal(snapshot.metrics.overall.opportunities,1);
  assert.equal(snapshot.metrics.overall.arrLostRate,100);
  assert.equal(snapshot.comparison.current.arrLostRate,100);
  assert.equal(snapshot.comparison.previous.arrLostRate,0);
});

test('Loss Board trend is always the full calendar year (12 months, 4 quarters), plus year-1 for comparison',()=>{
  const rows=[
    {id:'1',createdDate:'2026-04-01',isClosed:true,isWon:false,arr:100},
    {id:'2',createdDate:'2025-04-15',isClosed:true,isWon:false,arr:200},
  ];
  const snapshot=buildLossBoardSnapshot(rows,{
    createdFrom:'2026-04-01',createdTo:'2026-04-30',datePreset:'custom',
  });
  assert.equal(snapshot.metrics.trendYear,2026);
  assert.equal(snapshot.comparison.previousTrendYear,2025);
  assert.equal(snapshot.metrics.trend.monthly.length,12);
  assert.equal(snapshot.metrics.trend.quarterly.length,4);
  // April (index 3) is this year's data point; row '1' falls in it.
  assert.equal(snapshot.metrics.trend.monthly[3].period,'2026-04');
  assert.equal(snapshot.metrics.trend.monthly[3].lostArr,100);
  // A month with zero opportunities is a true gap (null), not a misleading 0%.
  assert.equal(snapshot.metrics.trend.monthly[0].lostArr,0);
  assert.equal(snapshot.metrics.trend.monthly[0].arrLostRate,null);
  // Q2 (Apr-Jun, index 1) rolls the same April row up quarter-wise.
  assert.equal(snapshot.metrics.trend.quarterly[1].period,'2026-Q2');
  assert.equal(snapshot.metrics.trend.quarterly[1].lostArr,100);
  // The comparison line is the exact same calendar months one year earlier.
  assert.equal(snapshot.comparison.previousTrend.monthly[3].period,'2025-04');
  assert.equal(snapshot.comparison.previousTrend.monthly[3].lostArr,200);
  assert.equal(snapshot.comparison.previousTrend.quarterly[1].lostArr,200);
});

test('comparison reports ARR lost percent and loss-rate point changes',()=>{
  const result=compareLossArr(
    [{arr:100,isClosed:true,isWon:false}],
    [{arr:110,isClosed:true,isWon:true}],
    previousEqualPeriod('2026-04-01','2026-04-01'),
  );
  assert.ok(Math.abs(result.arrChangePct-(-9.090909))<0.0001);
  assert.equal(result.arrLostRatePointChange,100);
  assert.equal(result.lossOppRatePointChange,100);
});

test('KPI comparison does not invent loss growth when the previous period has no valid baseline',()=>{
  const result=compareLossArr(
    [{arr:100,isClosed:true,isWon:false}],
    [{arr:100,isClosed:false,isWon:false}],
    previousEqualPeriod('2026-04-01','2026-04-01'),
  );
  assert.equal(result.closedArrGrowthPct,null);
  assert.equal(result.arrLostRatePointChange,null);
  assert.equal(result.lossOppRatePointChange,null);
});

test('Lost-after-trial rate point change is unavailable when the previous period had no trial baseline',()=>{
  const result=compareLossArr(
    [{arr:100,isClosed:true,isWon:false,trialStageAt:'2026-04-01'}],
    [{arr:100,isClosed:true,isWon:false}],
    previousEqualPeriod('2026-04-01','2026-04-01'),
  );
  assert.equal(result.current.lostAfterTrialRate,100);
  assert.equal(result.previous.trialClosedOpportunities,0);
  assert.equal(result.lostAfterTrialRatePointChange,null);
});

test('AE contribution is each rep Won ARR over total AE Won ARR, and sums to 100%',()=>{
  const {overall,reps}=buildAePerformanceMetrics([
    {id:'1',owner:'A',ownerRole:'AE APAC',arr:60,isClosed:true,isWon:true},
    {id:'2',owner:'B',ownerRole:'AE EMEA',arr:40,isClosed:true,isWon:true},
  ]);
  assert.equal(overall.wonArr,100);
  assert.equal(reps.find(r=>r.label==='A').contribution,60);
  assert.equal(reps.find(r=>r.label==='B').contribution,40);
  assert.equal(reps.reduce((total,rep)=>total+rep.contribution,0),100);
});

test('AE contribution ignores lost ARR entirely — a large loss earns no contribution',()=>{
  // The rep with the bigger CLOSED book (100) but the smaller WON book (10)
  // must rank below the rep who actually won more. Guards the won-vs-closed
  // denominator: on closed ARR this order would invert.
  const {reps}=buildAePerformanceMetrics([
    {id:'1',owner:'Loser',ownerRole:'AE APAC',arr:10,isClosed:true,isWon:true},
    {id:'2',owner:'Loser',ownerRole:'AE APAC',arr:90,isClosed:true,isWon:false},
    {id:'3',owner:'Winner',ownerRole:'AE EMEA',arr:30,isClosed:true,isWon:true},
  ]);
  assert.equal(reps[0].label,'Winner');
  assert.equal(reps[0].contribution,75);
  assert.equal(reps[1].contribution,25);
});

test('AE board counts only AE-prefixed roles, closed-won rows, and distinct opportunity IDs',()=>{
  const {overall,reps}=buildAePerformanceMetrics([
    {id:'1',owner:'A',ownerRole:'AE APAC',arr:50,isClosed:true,isWon:true},
    {id:'1',owner:'A',ownerRole:'AE APAC',arr:50,isClosed:true,isWon:true}, // duplicate ID is NOT deduped here
    {id:'2',owner:'M',ownerRole:'AM AMER',arr:500,isClosed:true,isWon:true},   // AM excluded
    {id:'3',owner:'S',ownerRole:'BDR US',arr:500,isClosed:true,isWon:true},    // BDR excluded
    {id:'4',owner:'A',ownerRole:'AE APAC',arr:900,isClosed:false,isWon:false}, // open excluded
  ]);
  assert.equal(reps.length,1);
  assert.equal(reps[0].label,'A');
  assert.equal(reps[0].contribution,100);
  assert.equal(overall.wonArr,100); // both '1' rows counted: dedup happens in the snapshot layer
});

test('AE snapshot dedupes opportunity IDs and compares contribution against the previous period',()=>{
  const rows=[
    {id:'1',owner:'A',ownerRole:'AE APAC',arr:60,isClosed:true,isWon:true,closeDate:'2026-07-05'},
    {id:'1',owner:'A',ownerRole:'AE APAC',arr:60,isClosed:true,isWon:true,closeDate:'2026-07-05'},
    {id:'2',owner:'B',ownerRole:'AE EMEA',arr:40,isClosed:true,isWon:true,closeDate:'2026-07-06'},
    {id:'3',owner:'A',ownerRole:'AE APAC',arr:25,isClosed:true,isWon:true,closeDate:'2026-04-05'},
    {id:'4',owner:'B',ownerRole:'AE EMEA',arr:75,isClosed:true,isWon:true,closeDate:'2026-04-06'},
  ];
  const {metrics,comparison}=buildAePerformanceSnapshot(rows,
    {closeFrom:'2026-07-01',closeTo:'2026-09-30',datePreset:'currentQuarter'});
  assert.equal(metrics.overall.wonArr,100); // the duplicate '1' counted once
  assert.equal(metrics.reps.find(r=>r.label==='A').contribution,60);
  const a=comparison.groups.reps.find(r=>r.label==='A');
  assert.equal(a.previous,25);              // 25/100 in Q2
  assert.equal(a.changePoints,35);          // 60% - 25%
});

test('AE comparison reports Won ARR growth separately from the contribution point change',()=>{
  // A rep can grow their own Won ARR while their share of the team total
  // falls — the two figures must not be conflated.
  const rows=[
    {id:'1',owner:'A',ownerRole:'AE APAC',arr:200,isClosed:true,isWon:true,closeDate:'2026-07-05'},
    {id:'2',owner:'B',ownerRole:'AE EMEA',arr:800,isClosed:true,isWon:true,closeDate:'2026-07-06'},
    {id:'3',owner:'A',ownerRole:'AE APAC',arr:100,isClosed:true,isWon:true,closeDate:'2026-04-05'},
    {id:'4',owner:'B',ownerRole:'AE EMEA',arr:100,isClosed:true,isWon:true,closeDate:'2026-04-06'},
  ];
  const {comparison}=buildAePerformanceSnapshot(rows,
    {closeFrom:'2026-07-01',closeTo:'2026-09-30',datePreset:'currentQuarter'});
  const a=comparison.groups.reps.find(r=>r.label==='A');
  assert.equal(a.wonArrGrowthPct,100);   // Won ARR doubled, 100 -> 200
  assert.equal(a.changePoints,-30);      // but share fell 50% -> 20%
});

test('AE reps with no Won ARR are dropped rather than listed at 0%',()=>{
  const {reps}=buildAePerformanceMetrics([
    {id:'1',owner:'A',ownerRole:'AE APAC',arr:100,isClosed:true,isWon:true},
    {id:'2',owner:'B',ownerRole:'AE EMEA',arr:100,isClosed:true,isWon:false},
  ]);
  assert.deepEqual(reps.map(rep=>rep.label),['A']);
});

test('AE board reports zero (not NaN) when no AE rep has won anything',()=>{
  const {overall,reps}=buildAePerformanceMetrics([
    {id:'1',owner:'A',ownerRole:'AE APAC',arr:100,isClosed:true,isWon:false},
  ]);
  assert.equal(overall.wonArr,0);
  assert.equal(overall.contribution,0);
  assert.equal(reps.length,0);
});

test('AE POD ranking shares the rep denominator so each list sums to 100%',()=>{
  const {reps,pods}=buildAePerformanceMetrics([
    {id:'1',owner:'A',ownerRole:'AE EMEA',arr:60,isClosed:true,isWon:true},
    {id:'2',owner:'B',ownerRole:'AE EMEA',arr:20,isClosed:true,isWon:true},
    {id:'3',owner:'C',ownerRole:'AE APAC',arr:20,isClosed:true,isWon:true},
  ]);
  // Same 100 total Won ARR drives both lists, so each sums to 100% on its own.
  assert.equal(pods.find(p=>p.label==='AE EMEA').contribution,80); // 60+20
  assert.equal(pods.find(p=>p.label==='AE APAC').contribution,20);
  assert.equal(pods.reduce((t,p)=>t+p.contribution,0),100);
  assert.equal(reps.reduce((t,r)=>t+r.contribution,0),100);
  // A rep's share is always <= their POD's share, since the denominator is shared.
  assert.ok(reps.find(r=>r.label==='A').contribution <= pods.find(p=>p.label==='AE EMEA').contribution);
});

test('AE POD ranking excludes non-AE roles and compares against the previous period',()=>{
  const rows=[
    {id:'1',owner:'A',ownerRole:'AE EMEA',arr:75,isClosed:true,isWon:true,closeDate:'2026-07-05'},
    {id:'2',owner:'B',ownerRole:'AE APAC',arr:25,isClosed:true,isWon:true,closeDate:'2026-07-06'},
    {id:'3',owner:'M',ownerRole:'AM AMER',arr:900,isClosed:true,isWon:true,closeDate:'2026-07-07'},
    {id:'4',owner:'A',ownerRole:'AE EMEA',arr:50,isClosed:true,isWon:true,closeDate:'2026-04-05'},
    {id:'5',owner:'B',ownerRole:'AE APAC',arr:50,isClosed:true,isWon:true,closeDate:'2026-04-06'},
  ];
  const {metrics,comparison}=buildAePerformanceSnapshot(rows,
    {closeFrom:'2026-07-01',closeTo:'2026-09-30',datePreset:'currentQuarter'});
  assert.deepEqual(metrics.pods.map(p=>p.label),['AE EMEA','AE APAC']); // no AM bucket
  const emea=comparison.groups.pods.find(p=>p.label==='AE EMEA');
  assert.equal(emea.previous,50);       // 50/100 in Q2
  assert.equal(emea.changePoints,25);   // 75% - 50%
});

test('cycle days, stale threshold and is-stalled are derived when the source omits them',()=>{
  // Tableau worksheet calcs are not exposed to the data source API, so a
  // published source arrives with no such columns. They must be recomputed.
  const mapping={id:'Id',stage:'Stage',orgType:'Org Type',createdDate:'Created',closeDate:'Closed',daysStuck:'Days In Stage'};
  const [won,smbOpen,entOpen,backwards]=applyMapping([
    {Id:'1',Stage:'Closed Won',  'Org Type':'Enterprise','Created':'2026-01-01','Closed':'2026-03-02','Days In Stage':'5'},
    {Id:'2',Stage:'Negotiation', 'Org Type':'SMB',       'Created':'2026-01-01','Closed':'',          'Days In Stage':'20'},
    {Id:'3',Stage:'Negotiation', 'Org Type':'Enterprise','Created':'2026-01-01','Closed':'',          'Days In Stage':'20'},
    {Id:'4',Stage:'Closed Lost', 'Org Type':'SMB',       'Created':'2026-03-05','Closed':'2026-03-01','Days In Stage':'2'},
  ],mapping);

  assert.equal(won.cycleDays,60);          // Jan 1 -> Mar 2
  assert.equal(won.isStalled,false);       // closed deals are never stalled
  assert.equal(won.staleThreshold,90);     // Enterprise

  // Identical 20 days in stage, opposite verdicts — the whole point of an
  // org-type-scaled threshold.
  assert.equal(smbOpen.staleThreshold,15);
  assert.equal(smbOpen.isStalled,true);
  assert.equal(entOpen.staleThreshold,90);
  assert.equal(entOpen.isStalled,false);

  // Close date before creation is a bad CRM export, not a negative cycle.
  assert.equal(backwards.cycleDays,null);
});

test('a real mapped column always beats the derived fallback',()=>{
  const [row]=applyMapping(
    [{Id:'1',Stage:'Closed Won',Created:'2026-01-01',Closed:'2026-03-02','Cycle Days':'7','Is Stalled':'true','Stale Threshold':'45','Org Type':'SMB'}],
    {id:'Id',stage:'Stage',createdDate:'Created',closeDate:'Closed',
     cycleDays:'Cycle Days',isStalled:'Is Stalled',staleThreshold:'Stale Threshold',orgType:'Org Type'},
  );
  assert.equal(row.cycleDays,7);        // not the 60 the dates would imply
  assert.equal(row.isStalled,true);
  assert.equal(row.staleThreshold,45);  // not the SMB default of 15
});

// Opportunity Analytics date filter — its picker applies quick ranges to
// Close date by default, so a Close-only range is the common case, not an
// edge case. It used to leave the whole comparison layer unavailable.
const OA_ROWS=[
  // Created in Q2, closed in Q3.
  {id:'a',createdDate:'2026-05-10',closeDate:'2026-08-10',isClosed:true,isWon:true,arr:400},
  {id:'b',createdDate:'2026-05-11',closeDate:'2026-08-11',isClosed:true,isWon:false,arr:100},
  // Created in Q1, closed in Q2 — the previous period on both axes.
  {id:'c',createdDate:'2026-02-10',closeDate:'2026-05-10',isClosed:true,isWon:true,arr:100},
  {id:'d',createdDate:'2026-02-11',closeDate:'2026-05-11',isClosed:true,isWon:false,arr:100},
];

test('Opportunity Analytics comparison works from a Close date range alone',()=>{
  const result=buildGenericComparison(OA_ROWS,{closeFrom:'2026-07-01',closeTo:'2026-09-30'});
  assert.equal(result.available,true);
  assert.equal(result.dateField,'closeDate');
  assert.equal(result.period.currentFrom,'2026-07-01');
  // Rows a+b close in Q3; c+d close in the equal-length window before it.
  assert.equal(result.current.opportunities,2);
  assert.equal(result.current.arr,500);
  assert.equal(result.previous.opportunities,2);
  assert.equal(result.previous.arr,200);
  assert.equal(result.arrWinRatePointChange,30);
});

test('Opportunity Analytics comparison still prefers Created date when both ranges are set',()=>{
  const result=buildGenericComparison(OA_ROWS,{
    createdFrom:'2026-04-01',createdTo:'2026-06-30',
    closeFrom:'2026-07-01',closeTo:'2026-09-30',
  });
  assert.equal(result.dateField,'createdDate');
  assert.equal(result.period.currentFrom,'2026-04-01');
  // a+b were created in Q2 — the same two rows, selected on the other axis.
  assert.equal(result.current.opportunities,2);
  assert.equal(result.current.arr,500);
});

test('Opportunity Analytics comparison is unavailable only when neither range is complete',()=>{
  assert.equal(buildGenericComparison(OA_ROWS,{}).available,false);
  // A half-open range on either axis is not enough to derive a previous period.
  assert.equal(buildGenericComparison(OA_ROWS,{closeFrom:'2026-07-01'}).available,false);
  assert.equal(buildGenericComparison(OA_ROWS,{createdTo:'2026-06-30'}).available,false);
});

test('Opportunity Analytics comparison applies categorical filters and dedupes IDs',()=>{
  const rows=[
    {id:'dup',createdDate:'2026-08-01',closeDate:'2026-08-01',isClosed:true,isWon:true,arr:100,region:'AMER'},
    {id:'dup',createdDate:'2026-08-01',closeDate:'2026-08-01',isClosed:true,isWon:true,arr:100,region:'AMER'},
    {id:'other',createdDate:'2026-08-02',closeDate:'2026-08-02',isClosed:true,isWon:true,arr:900,region:'EMEA'},
  ];
  const result=buildGenericComparison(rows,{closeFrom:'2026-08-01',closeTo:'2026-08-31',region:['AMER']});
  assert.equal(result.current.opportunities,1);
  assert.equal(result.current.arr,100);
});

// AE Performance, Win Board and Loss Board all read the same source, so the
// POD ranking has to group by the same POD field they do — grouping by raw
// Role Name split identical rows a different way and under-reported the PODs.
test('AE POD ranking groups by the shared POD field, not raw Role Name',()=>{
  const rows=[
    {id:'1',owner:'Ada',ownerRole:'AE EMEA',        pod:'EMEA AE',    isClosed:true,isWon:true,arr:400,createdDate:'2026-01-01'},
    {id:'2',owner:'Ben',ownerRole:'AE EMEA-Manager',pod:'EMEA AE',    isClosed:true,isWon:true,arr:100,createdDate:'2026-01-02'},
    {id:'3',owner:'Cal',ownerRole:'AE AMER II',     pod:'AMER AE II', isClosed:true,isWon:true,arr:500,createdDate:'2026-01-03'},
  ];
  const {pods}=buildAePerformanceMetrics(rows);
  // Two PODs, not the three distinct Role Names: the EMEA rep and the EMEA
  // manager belong to one POD and their Won ARR adds up.
  assert.deepEqual(pods.map(p=>p.label),['EMEA AE','AMER AE II']);
  assert.equal(pods[0].wonArr,500);
  assert.equal(pods[0].contribution,50);
  assert.equal(pods[1].contribution,50);
});

test('AE POD ranking falls back to Role Name when the source maps no POD column',()=>{
  const rows=[
    {id:'1',owner:'Ada',ownerRole:'AE EMEA',isClosed:true,isWon:true,arr:300,createdDate:'2026-01-01'},
    {id:'2',owner:'Cal',ownerRole:'AE APAC',isClosed:true,isWon:true,arr:100,createdDate:'2026-01-02'},
  ];
  const {pods}=buildAePerformanceMetrics(rows);
  assert.deepEqual(pods.map(p=>p.label),['AE EMEA','AE APAC']);
  assert.equal(pods[0].contribution,75);
});

test('AE POD ranking still excludes non-AE rows even when they share a POD',()=>{
  const rows=[
    {id:'1',owner:'Ada',ownerRole:'AE EMEA',          pod:'EMEA AE',isClosed:true,isWon:true,arr:400,createdDate:'2026-01-01'},
    // An AM rep sitting in an AM pod, and an SDR whose POD string looks AE-ish:
    // neither is AE-owned, so neither may reach the denominator.
    {id:'2',owner:'Moe',ownerRole:'AM EMEA',          pod:'EMEA AM',isClosed:true,isWon:true,arr:600,createdDate:'2026-01-02'},
    {id:'3',owner:'Sid',ownerRole:'BDR US CORP',      pod:'EMEA AE',isClosed:true,isWon:true,arr:900,createdDate:'2026-01-03'},
  ];
  const {pods,overall}=buildAePerformanceMetrics(rows);
  assert.deepEqual(pods.map(p=>p.label),['EMEA AE']);
  assert.equal(pods[0].wonArr,400);
  assert.equal(pods[0].contribution,100);
  assert.equal(overall.wonArr,400);
});

// AE Performance ranks reps by Won ARR, so its period is the Opp Close Date:
// a win belongs to the period the deal closed in, not the period the
// opportunity was first raised. Win Board and Loss Board still use created date.
test('AE Performance filters and compares on close date, not created date',()=>{
  const rows=[
    // Created long before the window, closed inside it — must COUNT.
    {id:'1',owner:'Ada',ownerRole:'AE EMEA',pod:'EMEA AE',isClosed:true,isWon:true,arr:300,
      createdDate:'2025-02-01',closeDate:'2026-08-10'},
    // Created inside the window but closed after it — must NOT count.
    {id:'2',owner:'Ben',ownerRole:'AE APAC',pod:'APAC AE',isClosed:true,isWon:true,arr:900,
      createdDate:'2026-08-02',closeDate:'2026-12-20'},
    // Closed in the previous equal period — the comparison baseline.
    {id:'3',owner:'Ada',ownerRole:'AE EMEA',pod:'EMEA AE',isClosed:true,isWon:true,arr:100,
      createdDate:'2025-01-01',closeDate:'2026-05-10'},
  ];
  const snapshot=buildAePerformanceSnapshot(rows,{
    closeFrom:'2026-07-01',closeTo:'2026-09-30',datePreset:'currentQuarter',
  });
  // Only the deal that CLOSED in Q3 is in scope; Ben's Q3-created deal is not.
  assert.equal(snapshot.metrics.overall.wins,1);
  assert.equal(snapshot.metrics.overall.wonArr,300);
  assert.deepEqual(snapshot.metrics.reps.map(r=>r.label),['Ada']);
  assert.deepEqual(snapshot.metrics.pods.map(p=>p.label),['EMEA AE']);
  // Ada held 100% of AE Won ARR in both periods, so contribution is flat
  // while her own Won ARR tripled — the two must not be conflated.
  assert.equal(snapshot.comparison.available,true);
  const [ada]=snapshot.comparison.groups.reps;
  assert.equal(ada.changePoints,0);
  assert.equal(ada.wonArrGrowthPct,200);
});

test('AE Performance reports no comparison until both close-date bounds are set',()=>{
  const rows=[{id:'1',owner:'Ada',ownerRole:'AE EMEA',pod:'EMEA AE',isClosed:true,isWon:true,arr:300,
    createdDate:'2026-01-01',closeDate:'2026-08-10'}];
  const open=buildAePerformanceSnapshot(rows,{closeFrom:'2026-07-01'});
  assert.equal(open.comparison.available,false);
  assert.match(open.comparison.reason,/Close Date/);
  // A one-sided bound still filters the board itself.
  assert.equal(open.metrics.overall.wins,1);
});
