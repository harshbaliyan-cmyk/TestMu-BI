# Security

## ⚠️ Rotate these credentials before deployment

Secrets that have ever existed in a shared location — a chat message, a
screenshot, a file that was emailed, or a commit — must be treated as
compromised, because you cannot un-share them. **Rotating is the only fix.**
Deleting a value from a file does not help: if the file was ever committed, the
old value stays in git history forever and is recoverable with one command.

This repository IS a git repository. `.gitignore` and the CI secret scan keep
`.env` files and credential-shaped strings out of commits — but that only
protects the future. Any value that has ever appeared in a chat, screenshot,
or shared file still needs rotating.

Rotate all four before this app is deployed or the code is pushed anywhere new:

| Credential | Where it lives | How to rotate |
|---|---|---|
| **PostgreSQL password** (`DATABASE_URL`) | `server/.env` | Neon console → Roles → reset the password for the owning role, then update `DATABASE_URL` |
| **Tableau Personal Access Token** (`TABLEAU_PAT_SECRET`) | `server/.env` | Tableau Cloud → My Account Settings → revoke the token, create a new one. The secret is shown **once** |
| **PAT encryption key** (`TABLEAU_CREDENTIAL_ENCRYPTION_KEY`) | `server/.env` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — see the warning below |
| **Session secret** (`SESSION_SECRET`) | `server/.env` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |

### Rotating the Tableau PAT and encryption key (use the script)

**Rotating the encryption key alone invalidates every stored Tableau
credential.** The key is what decrypts PATs already in `tableau_connections`;
change it and those rows become unreadable. Rotate the PAT *and* the key
together — the script does exactly that, writing the new token under the new
key so **no reconnect is needed**:

```bash
cd server
node scripts/rotate-tableau-secrets.mjs
```

It reads the new secret from a hidden prompt (never an argument or env var —
both leak into shell history and process listings), **verifies the token against
Tableau before saving anything**, re-encrypts the stored credential in place,
and updates `server/.env`. On any failure it changes nothing.

Keep the old token alive until the script reports success, then restart the
server, confirm a dashboard loads, and only then revoke the old token in
Tableau.

Anyone who learns `SESSION_SECRET` can mint a valid session cookie for any user
without a password, so it deserves the same care as the database password. The
server now refuses to start in production if it is short or left as a
placeholder.

## Where secrets are allowed to live

- **`server/.env` only.** Read via `process.env`, never as a literal in source.
- **Never in `client/`.** Vite inlines every `VITE_`-prefixed variable into the
  browser bundle. A `VITE_` secret is published, not configured.
- **Never in logs.** The global error handler redacts error objects before
  printing, because an axios failure carries the outbound request body — a
  failed Tableau sign-in would otherwise write the PAT to the log in clear text.
- **Never in API responses.** Tableau connections are returned through an
  explicit column list that omits `encrypted_pat_secret`; password hashes are
  never selected into a response shape.

Public-by-design values are the exception: a Google OAuth **client ID** is meant
to ship to the browser. Its **client secret** is not, and this app does not use
one.

## Reporting

Email `salesops@lambdatest.com` with the details. Please do not open a public
issue for a suspected credential leak — report it privately so it can be rotated
before it is advertised.
