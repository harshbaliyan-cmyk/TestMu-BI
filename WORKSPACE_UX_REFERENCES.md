# Workspace UI and UX refresh

## Design plan

The existing analytics workspace uses a warm cream canvas (`#F3F2EA`). Preserve that explicit user preference and the completed landing page. Build a quieter working interface with `#FDFCF6` surfaces, `#30352B` text, `#68715D` secondary text, `#D9DDCC` dividers and `#C44224` primary actions. Space Grotesk remains the workspace typeface; dashboard chart typography is outside this change.

Use left-aligned page titles, readable field labels and consistent control sizes. Keep dashboard links prominent and workspace utilities reachable at the bottom of the sidebar. Settings get section navigation; connected sources get a searchable management view and a separate connection flow. Gallery favorites and a compact list help users return to frequently used dashboards.

```
Dashboard links | Page title + primary action
               | Search / section navigation
               | Working content and contextual actions
Workspace tools| Loading, empty and error states in place
Account        |
```

Review against the brief: retain the requested cream identity instead of adopting a template's palette. Use borders to separate controls and information, avoid decorative status numbers, and keep existing dashboard interiors and presentation pages unchanged. Remove dashboard creation without deleting existing dashboard records, routes, charts or editing capabilities.

## Reference sources

- [shadcn/ui](https://github.com/shadcn-ui/ui): accessible controls, restrained page hierarchy and dialog composition; MIT.
- [Shadcn Admin](https://github.com/satnaing/shadcn-admin): settings section navigation, management tables and workspace layout; MIT. Selected source downloaded at commit `e16c87f213a5ba5e45964e9b67c792105ec74d26` into the ignored `.playwright/ui-references/shadcn-admin` directory.
- [Radix Themes](https://github.com/radix-ui/themes): accessible form, dialog and table patterns; MIT.

The implementation uses the project's existing React and CSS stack. Reference projects are not runtime dependencies and their application code is not executed.

## Skills and plugins

- Installed [Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) and [webapp-testing](https://github.com/anthropics/skills/tree/main/skills/webapp-testing), preserving their license files. Source commit: `41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f`.
- Applied the design planning, critique and browser inspection workflow. Python is unavailable, so installation used a reviewed Git checkout and testing uses the project's existing JavaScript Playwright installation.
- Consulted the installed Browser and plugin-management skills. Browser discovery returned no connected browser. The GitHub plugin installation suggestion was not confirmed; public GitHub references remain accessible through Git and web tools.

## Scope boundaries

The landing page, built-in dashboards, calculations, filters and presentations are preserved. My dashboards and Chart builder were subsequently removed entirely at the user's request on 2026-09-14. See [REMOVAL_NOTES.md](REMOVAL_NOTES.md) for the current scope and verification.

## Historical verification of the UX refresh (before feature removal)

- Production Vite build passed. The existing large-bundle advisory remains.
- 42 Chromium browser checks passed across the landing, gallery, workspace navigation, management screens and existing-chart placement suites. The management checks include 320px, 390px and 820px layouts, desktop screenshots, dark mode, keyboard dismissal, input validation, retries and contextual actions.
- Browser checks use intercepted API fixtures. Chart saving, retrying a failed placement, adding a second chart and editing an existing chart were verified without issuing a dashboard creation request or writing to real dashboard records.
- 21 server tests passed, including chart calculations and an isolated HTTP test confirming that anonymous creation requests return 401 and authenticated stale creation requests return 410. Existing layout validation remains active.
- SHA-256 comparisons against the start-of-task snapshot confirmed that all 18 protected landing, dashboard and presentation files were unchanged.
- Three older credential-dependent integration suites now use an isolated existing-dashboard fixture instead of the removed creation API. Test discovery passes; those live-data suites were not executed in this refresh.
- Screenshots are saved under the ignored `.playwright/management` and `.playwright/workspace` directories.
