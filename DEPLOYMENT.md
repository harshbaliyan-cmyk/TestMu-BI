# Deployment

Client on **Vercel** (static Vite build), Express on **Render** (persistent Node
process). Vercel proxies `/api/*` to Render, so the browser only ever talks to
one origin — session cookies keep working unchanged and there is no CORS to
configure.

Why the server is not on Vercel: dashboard rows, both cron schedules and the
rate limiter all live in the Node process's memory. Serverless functions are
stateless and short-lived, so each cold start would serve an empty dashboard and
re-sync Tableau. A persistent process keeps all three working with no code
changes.

---

## Step 0 — Rotate credentials FIRST

Do this before putting secrets into a hosting provider, not after. Every value
below has spent time in a plaintext `.env`; adding a second copy in a provider's
env store widens the blast radius of anything already exposed.

### 0a. Database password (Neon)

1. <https://console.neon.tech> → your project → **Roles** (under Branches, or
   Settings → Roles depending on console version).
2. Find the owning role (the username in your current `DATABASE_URL`) →
   **Reset password** → copy the new password. Neon shows it once.
3. Rebuild the connection string, keeping everything except the password:
   `postgresql://<role>:<NEW_PASSWORD>@<host>/<database>?sslmode=require`
4. Update `server/.env` locally, then restart your local server.
5. Put the same value into Render's environment (Step 3).

The running app will fail to reach the database between steps 2 and 4 — that is
expected. Nothing is lost; the connection string is the only thing that changed.

### 0b. Tableau PAT + encryption key (together)

```bash
cd server
node scripts/rotate-tableau-secrets.mjs
```

Create the new token in Tableau first (My Account Settings → Personal Access
Tokens); the script prompts for it without echoing, verifies it against Tableau
before saving anything, re-encrypts the stored credential under a new key, and
updates `server/.env`. Restart, confirm a dashboard loads, **then** revoke the
old token.

Rotating the key alone would make every stored PAT undecryptable — that is why
the script does both in one pass.

### 0c. Session secret

Already a random 64-character value. Generate a **different** one for
production so a local session can never be replayed against the deployed app:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 0d. GitHub PAT

The token used for the initial push should be revoked once the Vercel and Render
GitHub integrations are connected — those use their own OAuth grants and do not
need it. GitHub → Settings → Developer settings → Personal access tokens.

---

## Step 1 — Deploy the API to Render

1. <https://dashboard.render.com> → **New** → **Blueprint** → connect the
   `TestMu-BI` repository. Render reads `render.yaml` from the repo root.
2. It creates a web service from `server/`. Fill in the secrets it marks as
   required (they are deliberately not in the file):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the rotated Neon string from Step 0a |
   | `SESSION_SECRET` | the fresh value from Step 0c |
   | `TABLEAU_CREDENTIAL_ENCRYPTION_KEY` | from `server/.env` after Step 0b |
   | `CLIENT_ORIGIN` | your Vercel URL, e.g. `https://testmu-bi.vercel.app` |
   | `ADMIN_EMAILS` | `harshbaliyan@lambdatest.com` |
   | `ALLOWED_DOMAIN` | `lambdatest.com` |

3. Deploy, then note the service URL — `https://<name>.onrender.com`.

The server **refuses to start** in production without `SESSION_SECRET` (32+
chars, not a placeholder) and `CLIENT_ORIGIN`. That is intentional: it fails
loudly rather than running insecurely.

## Step 2 — Deploy the client to Vercel

1. <https://vercel.com/new> → import the `TestMu-BI` repository.
2. Vercel reads `vercel.json`; leave the build settings alone.
3. **Before the first deploy**, edit `vercel.json` and replace
   `https://testmu-bi-api.onrender.com` with your actual Render URL from Step 1,
   then commit and push. The rewrite is what makes `/api/*` reach the backend.
4. Deploy. Set `CLIENT_ORIGIN` on Render to the Vercel URL if you had to guess
   it in Step 1, and redeploy the API.

## Step 3 — Create the first administrator

There is no self-service signup. `POST /api/auth/signup` returns 403 unless
`ALLOW_SELF_SIGNUP=true`, which production must **not** set: the old behaviour
accepted any address ending in `ALLOWED_DOMAIN` and issued a session on the
spot, and a domain suffix is not proof that the address belongs to anyone.

**If you pointed `DATABASE_URL` at the database you already use**, your existing
admin account carries over and there is nothing to do here.

**For a fresh database**, run the migrations and create the first admin from
your own machine, pointed at the production database:

```bash
cd server
DATABASE_URL='<production-url>' node scripts/migrate.js
DATABASE_URL='<production-url>' node scripts/create-admin.mjs
```

The script prompts for the address, name and password, applies the same
password policy and `ALLOWED_DOMAIN` rule the app enforces, and needs no shell
on the server — which matters, because Render's free plan does not give you one.
Everyone else is then added from **Admin → Users**, which issues a temporary
password and forces a change on first login.

Deliberately not a route: any network-facing bootstrap ("first account wins",
or "a listed address may sign up while no admin exists") is opened by whoever
reaches the URL first, and on a public URL that is not necessarily you.

## Step 4 — Verify

```bash
curl -s https://<your-vercel-url>/api/health/database
# {"ok":true,"database":"postgresql","time":"..."}
```

Then sign in and confirm a dashboard loads. If dashboards are empty, the Tableau
sources have not re-synced yet — open Data Sources and refresh one. A cold start
re-syncs every bound source automatically, which takes roughly ten seconds per
source, so give it a moment before assuming something is wrong.

### Check the proxy hop count

Rate limiting and `Secure` cookies both depend on the server seeing the real
client IP. With Vercel in front of Render there are two proxies, so
`TRUSTED_PROXY_HOPS` is set to `2`. Confirm it after deploying: a wrong value
means either everyone shares one rate-limit bucket, or clients can forge
`X-Forwarded-For` and evade the limit entirely.

Sign in with a deliberately wrong password, then check the audit log — the
recorded `ip_address` should be your public IP, not a Vercel or Render address.

---

## Known limitations of this deployment

Accepted for an internal rollout; each needs addressing before wider use.

- **Render's free plan sleeps after ~15 minutes idle.** A cold start loses the
  in-memory row cache and re-syncs from Tableau, so the first dashboard load
  after an idle period is slow or briefly empty. For an always-on TV this mostly
  self-solves; overnight it will sleep. The paid plan removes this.
- **Rate limiting is per-process.** Correct on one instance; across replicas an
  attacker gets N× the attempts before lockout. Move the counters to Postgres
  before scaling out.
- **Business rows are memory-only** — a restart means an empty dashboard until
  Tableau re-syncs, and if the PAT is expired they stay empty.
- **`xlsx` has a high-severity prototype-pollution advisory** and is reachable
  by any authenticated user uploading a spreadsheet. Consider disabling file
  upload until the parser is replaced.
- **No SMTP configured** → security notifications (password changed, account
  deleted) are silently disabled.
