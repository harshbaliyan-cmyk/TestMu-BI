# Calculated fields — the canonical formula reference

Every derived field the dashboards depend on, with its exact business rule and
**where it is computed**. Two places exist:

- **In-app** — computed by this codebase at import/refresh time
  ([server/datasources.js](server/datasources.js) `applyMapping`, rules in
  [server/services/productDerivations.js](server/services/productDerivations.js)).
  The source only needs its **raw** columns. This is required whenever the rule
  was a Tableau ad-hoc group or worksheet calculation, because neither travels
  through a published data source / VizQL Data Service.
- **In Tableau** — a row-level calculated field on the published data source;
  it arrives in the app as a normal column.

A directly mapped column **always wins** over an in-app derivation — the app
only fills what the mapping left empty.

---

## Product View source (in-app derivations)

### Product ARR — in-app
Inputs: `Total Price`, `Subscription Duration` (months).

```
Product ARR = ([Total Price] / [Subscription Duration]) * 12
```

Null (not 0) when either input is missing or the duration is ≤ 0 — a missing
price must not deflate averages as a fake $0. The opp-level ARR field is never
used on product rows: it repeats the whole deal's value on every line, so a
multi-product opp would be counted once per product.

### Actual Product Name — in-app
Input: raw `Product Name` (SKU).

Aligned with the **Product Mapping sheet** on 2026-09-05 (ruling): the source spells A2A as `Agent  to Agent Testing` (double space between "Agent" and "to") and that spelling maps to A2A / Agentic AI; the compliance and add-on SKUs (Test at Scale, Test At Scale: Lite, Data Center Region Reservation, Data Retention, GDPR, Unbound, Performance Testing - Basic) display as Others; and the four SKUs the sheet omits are filed with their family, the same way the Executive Dashboard files them (KaneAI Max, KaneAI Desktop Essentials → Kane AI / Agentic AI; HyperExecute Private Cloud → HyperExecute / Agentic cloud: Hyperexecute; Web and App Automation on Virtual Device → Automation / Browser And App). Any other unlisted SKU still keeps its raw name here, so a new SKU is visible rather than silently pooled.

The full SKU → display-name ladder (77 branches):

| Display name | Raw SKUs |
|---|---|
| Virtual Cloud | Virtual Cloud (VMs & Virtual Devices) · LambdaTest Virtual Cloud · Virtual Live · Virtual & Real Device Plus Automation Cloud · ChromeOS Live |
| Private Devices | Private Real Device Cloud · Private Real Device |
| Test Manager | Test Manager · Test Manager Premium |
| HyperExecute | HyperExecute MultiOS · TestMuOne · HyperExecute - Public Cloud · HyperExecute OnPrem (Including Lums + Oauth) · HyperExecute OnPrem (Excluding LUMS + Oauth) · LambdaTestOne · HyperExecute (Dedicated Account On LT) · HyperExecute On Premise · LambdaTest One Plus · HyperExecute - Public Cloud (Linux Only) · TestMuOne - Lite · LambdaTest One Lite · HyperExecute Private Cloud |
| Smart UI | SmartUI Visual Regression |
| Accessibility | Accessibility · Accessibility Scheduling · Accessibility Automation · Native App Accessibility |
| Kane AI | Kane AI (Web) · Kane AI (Mobile + Web) · Kane AI Web · KaneAI Desktop & Mobile Essentials · KaneAI Web & App · KaneAI Max · KaneAI Desktop Essentials |
| Kane CLI | Kane CLI · Kane CLI Pro · Kane CLI Starter |
| Automation | Web Automation on Desktop · App Automation - Virtual Device · Virtual Automation Cloud · Web & Mobile Browser Automation · Native App Automation - Virtual Devices · Web and Mobile App automation on Virtual Devices · Web Automation on Desktop - Linux · Private Cloud Web Automation Desktop- Dedicated VM · Web and App Automation on Virtual Device |
| Automation - RD | Web & Mobile Browser Automation - Real Devices · Native App Automation · Real Device Plus Automation Cloud · Web & Mobile Browser Automation on Real Devices Plus · Real Device Automation Cloud · Virtual & Real Device Automation Cloud · Native App Automation Plus · Add-on: Real Mobile Device - Automation |
| Manual - RD | Real Device Live · Real Device Plus Live · Add-on: Real Mobile Device - Manual |
| A2A | Agent  to Agent Testing (double space, as the source spells it) · Agent to Agent Testing |
| PS | Professional Services |
| Others | Others · Enterprise Plan · Additional Users · IP Whitelisting · SSO Support · SSO Add-On · Dedicated Proxy · Advanced App Performance Analytics · Enterprise Security · Test at Scale · Test At Scale: Lite · Data Center Region Reservation · Data Retention · GDPR · Unbound · Performance Testing - Basic |

> **Deliberate deviation from the original Tableau formula**: its `ELSE ""`
> blanks unrecognised SKUs, which makes a brand-new SKU silently vanish from
> every per-product split. The app instead passes the raw name through —
> visible, filterable, and obviously un-renamed, which is the signal to add a
> new branch to `PRODUCT_NAME_MAP`.

### Product Group — in-app
Input: raw `Product Name` (SKU). Buckets:

- **Agentic AI** — Kane AI (Mobile + Web) · Agent to Agent Testing · Test Manager · Accessibility Scheduling · SmartUI Visual Regression · Kane AI (Web) · Test Manager Premium · Accessibility · Accessibility Automation · Kane AI Web · Native App Accessibility · KaneAI Web & App · KaneAI Desktop & Mobile Essentials · Kane CLI · Kane CLI Pro · Kane CLI Starter · Agent  to Agent Testing (double space) · KaneAI Max · KaneAI Desktop Essentials
- **Agentic cloud: Hyperexecute** — HyperExecute - Public Cloud (Linux Only) · HyperExecute MultiOS · HyperExecute - Public Cloud · TestMuOne · LambdaTestOne · LambdaTest One Plus · LambdaTest One Lite · HyperExecute OnPrem (Including Lums + Oauth) · HyperExecute OnPrem (Excluding LUMS + Oauth) · HyperExecute On Premise · TestMuOne - Lite · HyperExecute (Dedicated Account On LT) · HyperExecute Private Cloud
- **Browser And App** — Private Real Device Cloud · Private Real Device · Native App Automation Plus · Professional Services · Virtual Automation Cloud · Real Device Plus Automation Cloud · Web Automation on Desktop · Real Device Plus Live · Virtual Cloud (VMs & Virtual Devices) · Dedicated Proxy · Native App Automation · Real Device Live · Virtual Live · Web & Mobile Browser Automation - Real Devices · SSO Add-On · Enterprise Plan · Real Device Automation Cloud · Virtual & Real Device Automation Cloud · Web & Mobile Browser Automation · SSO Support · Advanced App Performance Analytics · Web & Mobile Browser Automation on Real Devices Plus · Native App Automation - Virtual Devices · Enterprise Security · LambdaTest Virtual Cloud · App Automation - Virtual Device · Web Automation on Desktop - Linux · ChromeOS Live · Add-on: Real Mobile Device - Automation · Add-on: Real Mobile Device - Manual · Web and Mobile App automation on Virtual Devices · Virtual & Real Device Plus Automation Cloud · Private Cloud Web Automation Desktop- Dedicated VM · Web and App Automation on Virtual Device
- **Others** — Others · IP Whitelisting · Additional Users · Test at Scale · Test At Scale: Lite · Data Center Region Reservation · Data Retention · GDPR · Unbound · Performance Testing - Basic — **and every unrecognised SKU** (the `ELSE` branch). Others growing unexpectedly means a new SKU needs sorting into a real group.

### Continent Group — in-app
Input: raw `Acc Continent`.

```
Asia | Australia | Oceania            → APAC
North America | South America        → Americas
Europe | Africa | Middle East        → EMEA
anything else                        → "" (blank)
```

Already-grouped values (APAC / Americas / EMEA) pass through untouched, so a
source publishing the grouped column also works. Note this is the
**customer's** geography; the Region field derives from the owning **rep's**
role — the two need not agree, and this one says "Americas" where Region says
"AMER".

### Opportunity Forecast buckets — in-app (metrics layer)
Input: raw `Opportunity Forecast`. The Tableau side merged these with an
ad-hoc group, which does not survive the published-datasource pull, so
[productViewMetrics.js](server/services/productViewMetrics.js) applies it:

```
Best Case     ← Best Case, High
Commit        ← Commit
No Projection ← Low, No Projection
null / blank  ← NO bucket  (an explicit "No Projection" is a rep's call;
                            a blank is the absence of one)
```

### Org Type — in-app when raw inputs are mapped, in Tableau on the Opportunity source
Inputs: `Free Domain` (boolean), `Employees`.

```
IF [Free Domain] THEN "SMB"
ELSEIF [Employees] >= 2000 THEN "Enterprise"
ELSEIF [Employees] >= 100 THEN "Mid-Market"
ELSE "SMB"
END
```

The app derives this only when Org type is unmapped **and** at least one raw
input is mapped — otherwise a source with no org information would mislabel
every row as SMB.

---

## Opportunity source (calculated in Tableau, arrive as columns)

Documented in full on each field in [server/datasources.js](server/datasources.js) `OPP_SCHEMA`:

- **ARR** = `([Amount] / [Subscription Duration]) * 12`
- **Org type** = the Free Domain / Employees rule above
- **Region** = `AMER*` role prefixes collapsed to AMER, else the region detail
- **Region (detail)** = AMER I / II / III / EMEA / APAC pattern-matched from Role Name (test order is load-bearing)
- **POD** = AE Corp / AE Enterprise / AM / Others pattern-matched from Role Name
  *(on the Product source POD arrives as a raw column instead)*
- **BDR Owner Name** = `IF NOT ISNULL([BDR Owner]) THEN [Full Name] END`
- **Cycle days** = `DATEDIFF('day', [Created Date], [Close Date])` for closed deals, ≥ 0 guard
- **Stale threshold** = 90 / 30 / 15 days by org type
- **Is stalled** = open AND days-in-stage ≥ stale threshold

## Opportunity Analytics board rules (metrics layer, `server/services/opportunityMetrics.js`)

Validated 2026-09-04 against the published source **"Opportunity flow Data"**
(54,873 rows = 54,873 distinct Opportunity IDs, so no LOD is needed): every
headline number was recomputed independently from the raw columns and
matched the board on 38/38 checks.

- **Money** — every $ figure on this board is **ARR**. Amount is never read (business ruling).
- **Won / lost counts** (the footnotes of the Won ARR and Lost ARR tiles, and everywhere a won or lost count appears) — `COUNTD(IF [Opp Stage] = "Closed Won" THEN [Opportunity ID] END)` and the same for `"Closed Lost"`. The app counts rows by the mapped Closed / Won flags after de-duplicating on Opportunity ID; on the live source the two rules agree on every row (26,733 won, 13,381 lost), and when the flag columns are unmapped the flags are themselves derived from the stage name.
- **Geography** — the customer's **Continent Group** (Acc Continent rolled up to APAC / Americas / EMEA by the rule above), never the rep-role Region column (business ruling). A blank or unknown continent is the visible bucket **"No Continent"**; likewise a blank mapped Region / POD / Team becomes "No Region" / "No POD" / "No Team" so a fully ticked filter never silently drops rows (49 of 740 Q3-2026 opportunities had a blank Region).
- **Columns used as-is from the source** — ARR (= Amount / Subscription Duration × 12, verified on 100% of rows), Cycle Days (= close − created for closed deals; null while open), Days In Stage, Stale Threshold (SMB 15 / Mid-Market 30 / Enterprise 90), Deal Health, Org Type, Forecast Category. The app's own gap-fills only run when a column is unmapped.
- **Is stalled** = open AND Days In Stage ≥ Stale Threshold (derived; the source carries no column).
- **Stage order** (funnel and aging) — by Salesforce stage probability read off the source: Qualification, Risk, No Contact, Demo, Pre-Trial, Work In Progress, Trial, Post Trial Discussion, Proposal, Confirmed, Negotiation, Procurement, then Closed Won / Closed Lost. A stage the source adds later is appended, never dropped.
- **Deal Health** — Green / Amber / Red as written; blank is its own **"Not rated"** state (95% of open deals) and is never treated as Green.
- **Loss-reason families** (raw reasons stay in the drill-down table):
  - *Disengaged / no decision* — Not Responding, No Decision / Non-Responsive, Decision Deferred, No Longer In Company
  - *Priority or budget* — Change of Priority, No Budget / Lost Funding, Upcoming Cut, Project Based
  - *Product fit* — Product Feature Gap, Limitation/Complex Use Case, Product Issue, Support
  - *Competition or price* — Competition, Lost to Competitor, Price
  - *Not a real deal* — Duplicate Deal, Junk Lead
  - *Other / not recorded* — Others, blank, and any reason not listed above
- **Disengagement losses** = lost deals in the *Disengaged / no decision* family ÷ closed deals.
- **Weighted forecast** — removed from the board (business ruling).
- **Default scope** — this year by Opp Created Date; a saved named preset re-derives its dates on load.
- **Public wall** (`/present/opportunity-analytics`) — counts, rates and owner names only: no currency figure, no day count, no account or opportunity name.

## Executive Dashboard (`server/services/executiveMetrics.js`)

A port of the Tableau **"Dashboard 11: Executive Dashboard"** (workbook definition extracted 2026-09-04) over the **"Opp + Product"** source — **one row per Opportunity × Product line**. Self-contained by business ruling (2026-09-05): its product, continent, org-type and forecast rules are restated in this service and shared with no other board. Board only, no presentation.

- **Grain rule** — opportunity-level values (Amount, ARR, quota, Stage, dates) repeat on every line of an opportunity and are read **once per Opportunity ID as MIN over the surviving lines** (`{FIXED [Opportunity ID]: MIN(...)}`); product-line values (Total Price, Product ARR) are **summed per row**. Never SUM an opportunity-level column across lines.
- **Survival rule** — filters restrict rows; every deduped measure is summed over the opportunities / users with **at least one surviving row**. `Target ARR` is therefore "sum of quota for users who have ≥ 1 row passing the filters", not the sum of all quotas.
- **ARR** = `[Amount] / [Subscription Duration] × 12` (opportunity level). **Product ARR** = `[Total Price] / [Subscription Duration-1] × 12` (line level; falls back to the opportunity duration on a source with one duration column). A pre-computed mapped column is only the fallback when the inputs cannot compute.
- **Target ARR** = Σ per-user MIN(`Q<q>-<yyyy> Quota`), users present in the filtered rows. Key = `User ID`, falling back to the rep name when User ID is unmapped. The quota column is mapped by hand (`quotaCurrent`).
- **Current Quarter Won ARR** = Σ per-opp MIN(IF Won AND close date in **today's** calendar quarter THEN ARR). Pinned to today's quarter whatever the close-date filter says ("KPI's data are fixed for this Quarter only").
- **%age of Quota Achievement** = Current Quarter Won ARR ÷ Target ARR · **Gap to Quota** = Target ARR − Current Quarter Won ARR.
- **Gross Pipeline ARR** (Open Pipeline tile) = Σ per-opp MIN(IF NOT Closed THEN ARR) · **Coverage** = ÷ Target ARR.
- **Current Quarter Commit ARR** (Forecast (Commit) tile) = Σ per-opp MIN(IF forecast group = Commit AND close in today's quarter THEN ARR), over open rows.
- **Trial Opps #** = COUNTD(IF Stage = "Trial" THEN Opportunity ID) · **Trial Pipeline ARR** = Σ per-opp MIN(IF Stage = "Trial" THEN ARR) · **Trial Coverage** = ÷ Target ARR. **Trial only** (redefined 4 Sep 2026).
- **won product ARR** = SUM(IF Stage = "Closed Won" THEN Product ARR) — product grain, used on the Product Group split only. **Won Deal ARR** = per-opp MIN(IF Won THEN ARR) — shown only at opportunity grain (the deals table).
- **Opportunity Forecast (group)** — Low, No Projection → "No Projection"; Best Case, High → "Best Case"; Commit → "Commit"; blank stays blank and is shown as **"No Forecast"**.
- **Product Group** — TRIM(Product Name) looked up in the four lists of the **Product Mapping sheet** (source of truth, supplied 2026-09-05: Agentic AI 16 SKUs / Agentic cloud: Hyperexecute 12 / Browser And App 34 / Others 10 — the sheet files the add-on, infra and compliance SKUs such as Test at Scale, GDPR and Data Retention under Others where the earlier formula left them Unmapped); anything else → **"Unmapped"**. Four SKUs live in the source but are missing from the sheet and are filed with their family by ruling of 2026-09-05: KaneAI Max and KaneAI Desktop Essentials → Agentic AI, HyperExecute Private Cloud → Agentic cloud: Hyperexecute, Web and App Automation on Virtual Device → Browser And App (the sheet already has it there). Because of that, ARR the workbook shows as Unmapped appears under Agentic AI here ($59K open / $2.4K won in Q3-2026). The A2A SKU carries a double space in the source — between "Agent" and "to" (`Agent  to Agent Testing`), verified against the published data on 2026-09-05; the spec's transcription put it before "Testing". Both spellings are matched. With that, every product-group figure ties to the workbook to the cent.
- **Mapping the source** — `product` must be the raw **"Product Name"** column (the auto-mapper prefers it over "Product Family"), `createdDate` is "Opp Created Date" (not the product line's "Created Date"), and this source has no Org Type column, so Org Type is computed from Free Domain / Employees. Validated 2026-09-05 against the spec's golden values (Q3-2026, default filters): all ten KPI measures, the forecast mix, and every per-POD and per-product-group object matched exactly; an independent recomputation from the raw columns agreed on all of them.
- **Actual Product Name** — TRIM(Product Name) → friendly name per the Product Mapping sheet (71 SKUs); unlisted SKUs → **"Others"** (sign-off 26 Aug 2026), except the four sheet omissions above, which keep their family names (Kane AI, Kane AI, HyperExecute, Automation).
- **Org Type** — a mapped Org Type column wins; otherwise Free Domain → SMB, Employees ≥ 2000 → Enterprise, ≥ 100 → Mid-Market, else SMB.
- **Continent Group** — Asia / Australia / Oceania → APAC; North / South America → Americas; Europe / Africa / Middle East → EMEA; already-rolled values pass through; else **"No Continent"** (the workbook's literal "NULL").
- **Blank buckets** — POD → "No POD", Sales POD → "No Sales POD", Rep → "No Owner", Opportunity Type → "No Type", so a fully ticked filter never drops rows.
- **Global controls** — Opp Close Date (default: the WHOLE current calendar quarter, `wholeQuarter` preset — quarter-to-date would drop deals still due to close), Segment Selector (Product default; Product Group / Org Type / Continent Group / Sales POD / Rep) + Segment values, Opportunity Type (default New Business, New Business AM, Existing Business - Up-sell), MIS Required (default All), and **POD** (business ruling 2026-09-05: the workbook's hard-coded POD exclusions on "Quota Achievement % by POD" and "Active Trials by POD" are NOT reproduced; instead POD is a global filter whose **default is the sales-ops owner's own selection** — AE AMER I/II/III, AE APAC, AE EMEA, AM AMER, AM APAC, AM EMEA, AM Saahil, AMER CORP, AMER I/II/III, APAC AE, EMEA AE, GCC, MD — i.e. every quota-carrying AE/AM POD, with BDR, Partnerships, Retention, SDR, Self Serve and the blank POD left unticked. The list lives in `DEFAULT_PODS` on the page, is matched against the source's own POD values, and a new POD name must be added there to show by default).
- **Active Trials by POD** keeps Active = true AND User Active = true, each enforced only once the source shows the flag is really mapped (a flag that is false on every row is an unmapped column, not a business fact).
- **Product-grain vs opportunity-grain** — Σ Open Pipe by Product = Σ Open Pipe by Product Group; both exceed the Open Pipeline tile by the source's own line-vs-amount gap, reported on the card and never forced to match.
- **Identities that hold for any filter state** — attainment, gap, coverage and trial coverage are the ratios above; Σ Open Pipeline by POD = Open Pipeline; Σ Forecast Mix ARR = Open Pipeline; Forecast Mix "Commit" = Σ Commit bars of Forecast by POD; Σ Active Trials by POD = Active Trials # (when every trial is active); Σ Closed-Won by Product Group = Current Quarter Won ARR under the current-quarter close scope.

## Derived in-app for every source (gap-fills in `applyMapping`)

- **Is closed / Is won** — from Stage when unmapped: contains "Closed" → closed; "Closed Won" → won; "Closed Lost" → lost. The Product source maps its raw `Closed` / `Won` columns directly.
- **Cycle days / Stale threshold / Is stalled** — recomputed from arriving columns because they are worksheet-level calcs in Tableau (worksheet calcs, like ad-hoc groups, are not exposed to the data source API).
- **Industry** — blanks become the explicit "No Industry" category so fully-selected filters don't silently drop them.
