# TOOLING.md — Claude Code plugins & skills for this project

Everything here is installed from inside a Claude Code session unless noted.
Marketplaces are catalogs; you add the catalog first, then install plugins.

> **Security note.** Plugins and marketplaces run arbitrary code with your user
> privileges. Anthropic doesn't verify third-party plugin behaviour. Only add
> marketplaces you trust.
> Source: https://code.claude.com/docs/en/discover-plugins

## Installed and verified (2026-08-27)

| Plugin | From | Notes |
|---|---|---|
| `typescript-lsp` | claude-plugins-official | plus `npm i -g typescript-language-server typescript` (the plugin does not install the binary) |
| `security-guidance` | claude-plugins-official | reviews changes for common vulnerabilities |
| `superpowers` | superpowers-marketplace (`obra/superpowers-marketplace`) | brainstorm/plan/execute skills |
| `commit-commands` | claude-plugins-official | small-commits workflow |
| `playwright` | claude-plugins-official | **this is the confirmed name** for the old TODO |
| `frontend-design` | claude-plugins-official | **confirmed name** for the other TODO |

Playwright is also installed **in the project**: `@playwright/test` 1.62 at the
repo root (chromium only), config `playwright.config.ts`, suites in `tests/`.
`tests/baseline.spec.ts` is the dead-code-removal gate — run before and after a
deletion and diff `.playwright/baseline/report.json`.

## Marketplaces configured

- `claude-plugins-official` — `/plugin marketplace add anthropics/claude-plugins-official`
- `superpowers-marketplace` — `/plugin marketplace add obra/superpowers-marketplace`
- `impeccable` (`pbakaus/impeccable`) — design-review hook, pre-existing on this machine

## Corrections to the previous version of this file

The earlier draft described a different app (self-hosted Node, DuckDB,
model-generated SQL, LLM API keys). None of that exists: the app is Vercel +
Render + Neon, there is no AI layer, and the planned `duckdb-analysis` skill
is moot. `chart-spec` is also moot — the chart catalogue lives in
`server/services/chartCatalog.js` as code, which beats a prose skill.

## What to add next

- A local `.claude/skills/tableau-api/SKILL.md` capturing the PAT one-session
  gotcha, VDS query shape, and webhook registration quirks (today these live
  as comments in `server/datasources.js` — fine, but a skill would surface
  them to future sessions sooner).
- `pr-review-toolkit` once more than one person is committing.

## Housekeeping

```
/plugin list                    # what's installed
/reload-plugins                 # apply installs without restarting
/plugin disable <name>@<market> # drop context cost without uninstalling
```
