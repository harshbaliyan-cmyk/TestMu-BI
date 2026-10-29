# AM performance: approved AE design

AM now uses the approved AE quarter summary, attainment distribution, rep chart,
POD ranking and presentation composition. The shared components accept a role
label; existing AE callers retain their defaults. AM keeps its own API requests,
saved-state keys, presentation config, AM-owned scope and leader-photo mappings.

The presentation adds the same weighted quarter summary as the AM dashboard.
Its three-POD gallery uses the available width and keeps prior-quarter badges
inside the cards. AM-specific compact styles fit shorter desktop displays;
they do not change AE styling. Data calculations and server services are unchanged.

Pre-push validation also fixed AE POD overflow when prior-quarter badges are
present. That adjustment is conditional, preserving the approved AE layout
when no prior-quarter comparison is available.

Validation completed with mocked APIs, without starting the real backend:

- Production client build passed (existing bundle-size warning).
- All 23 performance browser tests passed: AM/AE filters, saved state, photos, responsive
  layout, keyboard pagination, hide/restore, signed-out TV, and missing targets.
- Four POD leader mapping tests passed.
- All 202 server tests passed; the isolated staged frontend build also passed.
- Inspected dashboard and presentation screenshots, including dark mode.
- AM presentation inspected at 1280x720, 1440x900, 1840x956, 1920x1080 and
  3840x2160; no clipped cards or overflowing ranking rows.
- Hash review found changes only to the two AM pages and their shared UI files.

Changes were made directly in the app. No separate preview was created.
