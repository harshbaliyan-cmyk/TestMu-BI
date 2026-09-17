# Dashboard interior refresh

The user expanded the scope on 10 September 2026 to include dashboard typography, controls and chart arrangements. The completed landing and workspace management pages remain outside this pass. Dashboard creation stays removed.

## Direction

Revenue review should move from headline measures to trends, then to the teams, segments and deals behind those results. Use the user's cream canvas (#F3F2EA), paper surfaces (#FDFCF6), dark olive text (#30352B), muted olive (#68715D), fine dividers (#D9DDCC) and orange actions (#C44224). Preserve categorical and positive/negative chart colors so their meaning remains stable. Space Grotesk connects the dashboard to the workspace; tabular numerals keep financial values easy to compare.

```
Title + current scope                 Refresh / Present
Filters with clear labels, wrapping at narrow widths
Key metrics in a calm, readable strip
Wide time-series or pipeline view     Supporting breakdown
Segment / industry comparisons       Organization / POD view
Detailed tables with their own horizontal scrolling
```

Win and Loss get wider trend panels and compact summaries. Rep boards separate quarter totals from leader highlights and give rep rankings more space. Product views keep a broad trend panel, balance the forecast/product breakdowns, and keep wide data tables full width. Executive metrics are grouped by priority, followed by related charts.

Review against the brief: cream is the user's explicit direction, not a template palette choice. Chart priority and relative widths follow the type of analysis. Keep every chart and control, replace decorative glow and repeated borders with readable grouping, and keep the original data calculations, filters, sorting and presentation behavior.

## Public references

- [Tremor's open-source dashboard](https://github.com/tremorlabs/template-dashboard-oss): overview hierarchy and chart composition. Apache 2.0.
- [Shadcn Admin dashboard source](https://github.com/satnaing/shadcn-admin/blob/main/src/features/dashboard/index.tsx): responsive metrics and asymmetric overview/detail grids. MIT.
- [shadcn/ui charts](https://ui.shadcn.com/charts): restrained framing, labels and compact controls.

Browsed directly without a GitHub plugin. These are design references, not new runtime dependencies. Applied the installed frontend-design and webapp-testing skills.

## Implementation and verification

- Scoped the new styling to working dashboards in `DashboardInteriors.css`; the landing and full-screen presentation styles are outside that scope.
- Consolidated board actions into the heading, made metric definitions expandable, clarified product trend controls, and retained all existing filtering, sorting, refresh and presentation actions.
- Rebalanced trends, rankings and breakdowns. Donut legends and organization comparisons fit within supporting cards. Saved custom grids stack for reading on phones while retaining their saved coordinates and editable layout.
- Used synthetic rows with the existing server snapshot builders for browser previews. The browser checks cover populated routes, filters, product view switching, executive deal search/sort, date controls, dark mode, mobile chart bounds and existing custom chart placement. No live dashboard data was changed for verification.
- Production build passes (the existing large-bundle advisory remains). All 57 browser checks across dashboard, workspace, landing, gallery, management and chart placement suites passed, as did 156 server checks for calculations and removal of dashboard creation.
- SHA-256 comparisons confirm that the three landing files and seven presentation files are unchanged from the previous workspace pass. Screenshots are saved under `.playwright/dashboard-refresh/`.

Subsequent removal (2026-09-14): My dashboards and Chart builder, including custom TV displays, are retired. Built-in layouts and charts remain. See [REMOVAL_NOTES.md](REMOVAL_NOTES.md).
