# Deployment: Vercel + Supabase PostgreSQL

This deploys the app to Vercel with Supabase as a **plain PostgreSQL host**.
Nothing Supabase-specific is used: no Supabase Auth, no client SDK, no Data
API. The app only needs a PostgreSQL connection string, so you can move to
Neon, RDS or any other PostgreSQL by changing environment variables. The code
and schema stay the same.

> Two parts of this guide could not be tested from the development machine:
> connecting to a live Supabase project (TLS details) and the exact labels in
> the Supabase and Vercel dashboards, which change over time. Steps that depend
> on them say so. Everything else (migrations, scripts, environment handling,
> the hardening SQL) was tested locally.

## Overview

| Piece | Where | Notes |
|---|---|---|
| App | Vercel (Node.js serverless functions) | Next.js is detected automatically |
| Database | Supabase PostgreSQL 15+ | Same region as the Vercel functions |
| `DATABASE_URL` | Vercel env | Supabase **transaction pooler** (port `6543`): right for serverless |
| `DIRECT_DATABASE_URL` | your machine only | **Session pooler** (port `5432`) or direct connection, for migrations and admin commands |
| Migrations, password, backups | run from your machine | Explicit and reviewable, and builds never touch the production schema |

## 1. Create the Supabase project

1. Create a project and save the database password in your password manager.
2. Pick the region closest to you. You'll match the Vercel function region to it.
3. Open the project's **Connect** dialog and copy two connection strings:
   - **Transaction pooler**, e.g.
     `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`
   - **Session pooler**, e.g. the same host on port `5432`. (The "direct
     connection" `db.<ref>.supabase.co` also works if your network supports IPv6.)

Why two? Serverless functions open many short-lived connections, which the
transaction pooler multiplexes. Migrations, `pg_dump` and admin scripts need a
session-level connection, which the transaction pooler doesn't provide.

**TLS (check when you deploy):** Supabase requires SSL. Start by appending
`?sslmode=require` to both URLs. If connections fail with a certificate error
such as `self-signed certificate in certificate chain`, download Supabase's CA
certificate (database settings → SSL configuration) and use
`sslmode=verify-full&sslrootcert=<path-to-cert>`, which verifies the server.
Don't switch certificate verification off to make the error go away.

## 2. Back up, migrate and verify (production)

> **Two different databases, two different backups.** `npm run db:backup` on its
> own backs up the **local Docker** database on your machine. It does **not**
> protect production. A production backup is made only when you give the
> script the production URL (`BACKUP_DATABASE_URL=…`), and its file name says
> so (`fitness-remote-….dump`, versus `fitness-local-….dump`).

### 2a. Keep the production connection string out of your history and the repository

The connection string contains your database password. Never type it into a
command (it would be saved in your shell history) and never keep it in the
project folder. Put it in a file only you can read, outside the project:

```bash
install -m 600 /dev/null ~/.fitness-prod.env     # creates an empty, owner-only file
```

Open `~/.fitness-prod.env` in an editor and add one line. Use the **session
pooler or direct** connection string (port `5432`), with any special characters
in the password URL-encoded (`@` is `%40`):

```
PROD_DIRECT_URL='postgresql://postgres.<ref>:<url-encoded-password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require'
```

Load it into the terminal where you run production commands, and only there:

```bash
set -a; source ~/.fitness-prod.env; set +a
```

(Alternative that never touches a file: `read -rs -p "Production URL: " PROD_DIRECT_URL; export PROD_DIRECT_URL`.)
Every command below refers to `$PROD_DIRECT_URL`, so no secret appears in any
command. The scripts print only the host and database name they are working on,
never the user or password. Connection strings copied from Prisma with
`?schema=public` or `?pgbouncer=true` are accepted: those parameters are
removed before they reach the Postgres tools.

**Check you are pointed at production** (read-only; shows the host it connects to):

```bash
COUNT_DATABASE_URL="$PROD_DIRECT_URL" npm run db:counts
```

Expected: a first line like
`Row counts, REMOTE database "postgres" on aws-0-<region>.pooler.supabase.com:5432:`
followed by one `table | count` line per table (11 lines). The counts are zero on a new database.

### 2b. Back up production (mandatory before every migration)

```bash
BACKUP_DATABASE_URL="$PROD_DIRECT_URL" npm run db:backup
```

Expected output (note **REMOTE**, the host, and `remote` in the file name):

```
Backing up REMOTE database "postgres" on aws-0-<region>.pooler.supabase.com:5432 ...
Backup written (remote): backups/fitness-remote-20261027T081500Z.dump (48K, 13 tables with data)
```

If you see `Backing up LOCAL Docker database`, you did **not** back up
production: `BACKUP_DATABASE_URL` was not set in this terminal. The file is
readable only by you (`600`) and `backups/` is git-ignored. Store a copy
encrypted, off this machine.

If the URL's host is `localhost`, the script refuses and explains why (inside
Docker, `localhost` is the container itself); use `host.docker.internal` for a
database on your own machine.

### 2c. Prove the backup restores (do this once before you rely on it, and after any change to the scripts)

Restoring into the scratch **local** database never touches production:

```bash
npm run db:restore -- backups/fitness-remote-20261027T081500Z.dump
```

It prints row counts for the restored copy (`Row counts in LOCAL database "fitness_restore"`).
Compare them with production right away; they must match line for line (if you
import something in between, the counts legitimately differ, so compare straight
after taking the backup):

```bash
COUNT_DATABASE_URL="$PROD_DIRECT_URL" npm run db:counts
```

Optional deeper check: start the app against the restored copy and look at your
data (sign in with the password that was current when the backup was taken):

```bash
DATABASE_URL="postgresql://fitness:<local-password>@localhost:5434/fitness_restore?schema=public" npm run dev
```

Clean up when done:
`docker compose exec db psql -U fitness -d postgres -c "DROP DATABASE fitness_restore"`.

### 2d. Apply the migrations

```bash
DIRECT_DATABASE_URL="$PROD_DIRECT_URL" npm run db:deploy
```

`prisma.config.ts` uses `DIRECT_DATABASE_URL` when it is set, otherwise
`DATABASE_URL`. **Check:** `All migrations have been successfully applied.`
On a brand-new database there is nothing to back up yet, so 2b and 2c can be
skipped the first time only.

If a migration goes wrong, restore the backup from 2b (see
[backup and restore](backup-restore.md#restore-a-remote-supabase-database)).

## 3. Set the production password

```bash
DATABASE_URL="$PROD_DIRECT_URL" npm run set-password
```

This creates the owner and stores the Argon2id hash in the Supabase database.

## 4. Lock down Supabase's Data API

Supabase automatically publishes the `public` schema through its Data API
(PostgREST) to the `anon` and `authenticated` roles. Its "anon" key is designed
to be public. This app never uses that API, so close it off:

1. **Dashboard:** in the project's Data API settings, disable the Data API (or
   remove `public` from the exposed schemas). *Dashboard wording varies; check
   on the day.*
2. **Database (defence in depth):** run [`scripts/supabase-hardening.sql`](../scripts/supabase-hardening.sql).
   It enables row-level security with **no policies** on every app table (so
   roles other than the table owner see nothing) and revokes the
   `anon`/`authenticated` privileges. The app connects as the table owner, so
   it is unaffected. Run it either by pasting the file into the Supabase SQL
   editor, or with:

   ```bash
   docker run --rm -i -e PROD_DIRECT_URL postgres:17-alpine \
     sh -c 'psql "$PROD_DIRECT_URL" -v ON_ERROR_STOP=1' < scripts/supabase-hardening.sql
   ```

   The final query should list every table with `rls_enabled = t`.

**Re-run the hardening SQL after every migration and every restore**, because
new or restored tables start without row-level security.

This isn't Supabase Auth and doesn't use `auth.uid()`. Ownership is still
enforced by the app's server-side repository layer (see
[security](security.md#authorization-and-data-ownership)). The SQL only stops
the Data API roles from reading the tables.

## 5. Create the Vercel project

1. Import the Git repository in Vercel. The framework preset is **Next.js**.
   Keep the default install command (`npm install`, which generates the
   Prisma client) and build command (`npm run build`).
2. **Settings → Functions → Region:** choose the region matching your Supabase project.
3. **Settings → Environment Variables**, scoped to **Production** only:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Transaction pooler URL (port `6543`, with `?sslmode=require`) |
| `DATABASE_POOL_MAX` | `3` |
| `TRUST_PROXY` | `true`: Vercel sets `X-Forwarded-For` itself (see [security](security.md#rate-limiting-and-trusted-proxies)) |
| `SESSION_TTL_DAYS` | `30` (optional) |
| `APP_ORIGIN` | `https://<your-production-domain>` (optional; recommended once you have one fixed domain) |

Don't set `NODE_ENV`; Vercel sets it to `production`, which turns on secure
cookies and HSTS. Don't add `DIRECT_DATABASE_URL`, `POSTGRES_PASSWORD` or
`TEST_DATABASE_URL` to Vercel.

**Preview deployments:** if the database variables are also scoped to
*Preview*, every branch deploy reads and writes your real data. Either keep
them Production-only (previews then fail to load data, which is safe), or give
previews a separate Supabase database.

4. Deploy.

## 6. Verify the deployment

- [ ] `https://<domain>/` redirects to `/login`.
- [ ] Signing in works. In the browser's dev tools, the cookie is
      `__Host-ft_session` with `Secure`, `HttpOnly` and `SameSite=Lax`.
- [ ] Response headers include `Strict-Transport-Security`,
      `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`.
- [ ] **Data → Import** a small test payload with preview, then confirm, then
      delete it with `"delete"`.
- [ ] **Data → Copy context** returns the prompt.
- [ ] Five wrong passwords give HTTP 429. Then run
      `DATABASE_URL="$PROD_DIRECT_URL" npm run unlock-login` and sign in normally.
- [ ] Take a first production backup:
      `BACKUP_DATABASE_URL="$PROD_DIRECT_URL" npm run db:backup`.

## Deploying updates

1. `npm run typecheck && npm run lint && npm test && npm run build` locally.
2. If the update includes a migration (new folder in `prisma/migrations/`):
   1. back up production: `BACKUP_DATABASE_URL="$PROD_DIRECT_URL" npm run db:backup`,
   2. apply it: `DIRECT_DATABASE_URL="$PROD_DIRECT_URL" npm run db:deploy`,
   3. re-run `scripts/supabase-hardening.sql`.

   Apply migrations **before** pushing the code that needs them. Keep
   migrations additive (new nullable columns or tables) so the previous
   deployment keeps working if you have to roll back the code.
3. Push to the production branch. Vercel builds and deploys.
4. Run through the verification list above (sign-in and one import at least).

Rolling back is covered in [operations](operations.md#rollback).

## Switching database providers

Load both connection strings as described in [2a](#2a-keep-the-production-connection-string-out-of-your-history-and-the-repository)
(for example `OLD_URL` and `NEW_URL` in your `~/.fitness-prod.env`), never typed inline.

1. `BACKUP_DATABASE_URL="$OLD_URL" npm run db:backup`, and prove it restores (2c).
2. Create the new database, then
   `RESTORE_DATABASE_URL="$NEW_URL" npm run db:restore -- backups/<fitness-remote-…>.dump --remote`
3. `DIRECT_DATABASE_URL="$NEW_URL" npm run db:deploy` (applies any newer migrations).
4. Compare `COUNT_DATABASE_URL="$OLD_URL" npm run db:counts` with the same command for `$NEW_URL`.
5. Update `DATABASE_URL` in Vercel (Neon: use its `-pooler` host) and redeploy.
6. On Supabase, run the hardening SQL. Other providers don't publish a Data API by default.

## Deployment checklist

- [ ] Supabase project in the same region as the Vercel functions
- [ ] Migrations applied with the session/direct URL
- [ ] Production password set with `set-password`
- [ ] Data API disabled, and the hardening SQL run (all tables `rls_enabled = t`)
- [ ] Vercel env (Production scope): `DATABASE_URL` (port 6543), `DATABASE_POOL_MAX=3`, `TRUST_PROXY=true`, optional `APP_ORIGIN`
- [ ] Preview deployments can't reach the production database
- [ ] Verification list passed (redirect, cookie flags, headers, import, rate limit, unlock)
- [ ] First production backup taken with `BACKUP_DATABASE_URL` (file is `fitness-remote-…`; output said REMOTE) and stored encrypted
- [ ] Restore of that backup proven into the scratch database, with row counts matching production (2c)
- [ ] Production URL kept in a `600` file outside the project, never typed on a command line
