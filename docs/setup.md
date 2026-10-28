# Local setup

This sets up a working copy on your machine: PostgreSQL in Docker, the app in
Node.js. Each step ends with a check so you know it worked before moving on.

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 24 (built and tested with 24.x) | `node -v` |
| npm | comes with Node | `npm -v` |
| Docker Engine + Compose v2 | any recent | `docker compose version` |
| Git | any | `git --version` |

Docker must be running (`docker ps` prints a table rather than an error).
Nothing else is needed: PostgreSQL and its client tools run inside containers.
On Windows, use WSL 2 because the backup and restore scripts are Bash.

## 2. Get the code and install dependencies

```bash
git clone <your-repository-url> fitness-tracker
cd fitness-tracker
npm install
```

`npm install` also runs `prisma generate` (the `postinstall` script), which
writes the database client to `generated/prisma/`. That folder is git-ignored.

**Check:** the output ends with `Generated Prisma Client`, and `ls generated/prisma`
lists files.

## 3. Create `.env`

```bash
cp .env.example .env
```

Open `.env` and replace **every** `change-me-local-only` with the same new value.
It appears in `POSTGRES_PASSWORD` and inside both database URLs. This password
only protects the local container, which listens on `127.0.0.1` only. Still,
don't reuse a real password.

| Variable | Required | Meaning |
|---|---|---|
| `POSTGRES_PASSWORD` | yes (local) | Password Docker sets for the `fitness` database user |
| `POSTGRES_PORT` | no, default `5434` | Host port for the container. If you change it, change it in both URLs too |
| `DATABASE_URL` | yes | Connection string the app uses |
| `TEST_DATABASE_URL` | for `npm test` | Separate test database. Its name **must end in `_test`** |
| `DIRECT_DATABASE_URL` | no | Non-pooled URL for migrations (production with a pooler; see [deployment](deployment.md)) |
| `DATABASE_POOL_MAX` | no | Max connections per app process (set on Vercel) |
| `SESSION_TTL_DAYS` | no, default `30` | Sliding session lifetime |
| `APP_ORIGIN` | no | Exact public origin for the CSRF check (see [security](security.md)) |
| `TRUST_PROXY` | no, default `false` | Leave `false` locally (see [security](security.md#rate-limiting-and-trusted-proxies)) |

`.env` is git-ignored. Never commit it.

## 4. Start PostgreSQL

```bash
npm run db:up
```

This runs `docker compose up -d --wait db`. It starts `postgres:17-alpine` on
`127.0.0.1:5434` with a named volume (`fitness_pgdata`) so data survives
restarts. The first start also creates the `fitness_test` database (from
`docker/init-test-db.sql`).

**Check:** `docker compose ps` shows the `db` service as `healthy`.

> Port already in use? Set `POSTGRES_PORT=5435` (for example) in `.env`, change
> `5434` to `5435` in both URLs, and run `npm run db:up` again.

## 5. Apply the database migrations

```bash
npm run db:deploy
```

This runs `prisma migrate deploy`, which applies every migration in
`prisma/migrations/`: the tables, the composite owner keys and the CHECK
constraints. It never prompts and never deletes data, so it is the right
command for a fresh setup and for production. (`npm run db:migrate` is only for
creating new migrations while changing the schema.)

**Check:** the output ends with `All migrations have been successfully applied.`

## 6. Set your password

```bash
npm run set-password
```

You are asked for the password twice. Typing is hidden. It must be at least 12
characters. Only an Argon2id hash is stored. Running the command again later
changes the password and signs out every session (see [authentication](authentication.md)).

**Check:** it prints `Password saved (Argon2id). 0 existing session(s) revoked.`

## 7. Run the app

```bash
npm run dev
```

Open <http://localhost:3000>. You are redirected to the sign-in page. After you
sign in, the Today page shows an empty day. Go to **Data** to import your first
JSON (see the [user guide](user-guide.md)).

Before importing, open **Settings** and fill in your profile and daily
targets. Only the values you know are needed, and **Suggest targets** can
propose estimates for you to review. You can also set them by importing JSON:

```json
{
  "schema_version": "1.0",
  "profile": { "name": "Your name", "height_cm": 178, "timezone": "Asia/Kolkata" },
  "targets": [{ "effective_from": "2026-10-01", "calories": 2200, "protein_g": 150, "carbs_g": 220,
                "fat_g": 70, "fiber_g": 30, "steps": 8000, "goal_weight_kg": 75 }]
}
```

## 8. Run the tests (optional, recommended)

```bash
npm test
```

The suite runs against `fitness_test`, never `fitness`. It wipes the test
tables between tests, and it refuses to start if `TEST_DATABASE_URL` doesn't
end in `_test`.

**Check:** `Test Files  17 passed`, `Tests  201 passed` (or more as tests are added).

Browser tests (optional; needs Google Chrome at `/usr/bin/google-chrome` or `CHROME_PATH`): `npm run test:e2e` (builds first; 23 tests, about 8 minutes because two of them wait for a simulated midnight).

> If you see `database "fitness_test" does not exist`, the volume was created
> before the init script existed. Create the database once:
> `docker compose exec db psql -U fitness -d postgres -c "CREATE DATABASE fitness_test OWNER fitness"`

## Stopping and resetting

| Goal | Command |
|---|---|
| Stop the database (keep data) | `docker compose stop` |
| Start it again | `npm run db:up` |
| Delete **all** local data | `docker compose down -v`. This removes the volume; take a backup first |
