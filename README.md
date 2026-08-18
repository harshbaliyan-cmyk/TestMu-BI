# TestMu BI

Sales analytics dashboards (Win Board, Loss Board, AE Performance, Opportunity
Analytics) built on live Tableau data. React 18 + Vite client, Express + Node
server, PostgreSQL (Neon).

Each dashboard has two layers: an **interaction layer** for filtering and
exploration, and a **presentation layer** built for a fixed 16:9 TV display.

---

## ⚠️ Before you deploy or push this code

**Rotate every credential in `server/.env` first.** The database password,
Tableau PAT, PAT encryption key and session secret are all live values today.
Full instructions and the reasoning are in **[SECURITY.md](SECURITY.md)**.

This is not yet a git repository. The moment you run `git init`, whatever is in
`server/.env` at that point can end up in history permanently — and history is
not fixed by deleting the file later. Rotate first, then commit.

---

## Setup

```bash
npm run install:all

cp server/.env.example server/.env      # then fill in real values
cp client/.env.example client/.env      # optional, public values only

cd server && npm run db:migrate

npm run dev                             # client :5173, server :3001
```

`server/.env.example` documents every variable, how to generate the secret ones,
and which are required in production.

## Configuration rules

| | |
|---|---|
| Server secrets | `server/.env` only, read via `process.env` |
| Client config | `client/.env`, `VITE_`-prefixed — **public**, inlined into the browser bundle |
| Committed | `*.env.example` files only, placeholders only |

Vite ships every `VITE_` variable to the browser. Nothing sensitive may carry
that prefix.

## Production requirements

The server refuses to start in production unless:

- `SESSION_SECRET` is at least 32 characters and not a placeholder
- `CLIENT_ORIGIN` names the exact browser origin (permissive CORS plus cookie
  auth is a cross-site data-theft primitive)

Also set `TRUSTED_PROXY_HOPS` to the real number of proxies in front of the
process — secure cookies and per-IP rate limiting both depend on seeing the true
client address, and over-counting lets clients spoof `X-Forwarded-For`.

## Testing

```bash
cd server && npm test        # formula, mapping, isolation and auth-guard tests
cd client && npm run build   # production build
```
