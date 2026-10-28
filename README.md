# Personal Fitness & Nutrition Tracker

A single-user web app for tracking meals, workouts, cardio, steps and body weight.
You describe your day to ChatGPT, ChatGPT replies with JSON, and you import that
JSON here. The app validates and previews every import before saving anything,
then derives every total, verdict and chart from the stored records.

**Stack:** Next.js 16 (App Router, Cache Components), TypeScript, PostgreSQL,
Prisma 7, Zod, Recharts, Tailwind CSS 4. Authentication is a built-in single
password (Argon2id) with database-backed sessions. Supabase Auth is not used.

## Quick start (local)

Requirements: Node.js 24 (the version this was built and tested with), npm, and
Docker with Docker Compose.

```bash
npm install                    # also generates the Prisma client
cp .env.example .env           # then replace every "change-me-local-only"
npm run db:up                  # starts PostgreSQL on 127.0.0.1:5434
npm run db:deploy              # applies the database migrations
npm run set-password           # prompts for your password (min 12 characters)
npm run dev                    # http://localhost:3000
```

The full walkthrough, with checks after each step, is in [docs/setup.md](docs/setup.md).

## Documentation

| Guide | What it covers |
|---|---|
| [Local setup](docs/setup.md) | Prerequisites, Docker Compose, environment variables, migrations, first run |
| [User guide](docs/user-guide.md) | Importing from ChatGPT, preview and confirm, stable IDs, corrections, deletes, exports, the context prompt, the JSON field reference |
| [Authentication](docs/authentication.md) | Setting and changing the password, sessions, logout, lockout recovery |
| [Backup and restore](docs/backup-restore.md) | Backing up and restoring local and Supabase databases, with a tested walkthrough |
| [Deployment](docs/deployment.md) | Vercel with Supabase PostgreSQL: connection pooling, migrations, environment, hardening, checklist |
| [Security](docs/security.md) | Threat model, sessions and cookies, CSRF, rate limiting and trusted proxies, secrets, known limitations |
| [Operations](docs/operations.md) | Commands, tests, troubleshooting, upgrades and rollback |

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run build` / `npm start` | Production build / serve it |
| `npm test` | Test suite (needs the Docker database running) |
| `npm run test:e2e` | Browser tests with your local Chrome (builds first) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint checks |
| `npm run db:up` | Start the local PostgreSQL container and wait until it is healthy |
| `npm run db:deploy` | Apply pending migrations (local or production) |
| `npm run db:migrate` | Create a new migration while developing schema changes |
| `npm run set-password` | Set or change the password (revokes all sessions) |
| `npm run unlock-login` | Clear failed-login lockouts |
| `npm run db:backup` | Back up the **local** database to `backups/` (set `BACKUP_DATABASE_URL` to back up a remote/production database instead; the output says which) |
| `npm run db:counts` | Print row counts for a local or remote database (to compare a database with its backup) |
| `npm run db:restore -- <file>` | Restore a backup (into a scratch database by default) |

## Project layout

```
app/(app)/            Signed-in pages: Today, History, Trends, Exercises, Data, Settings
app/api/              Route handlers: auth, import preview/commit, export, settings
app/login/            Sign-in page
components/           UI components and Recharts charts
lib/server/import/    Import protocol: schema spec, planner, transactional apply
lib/server/auth/      Password hashing, sessions, rate limiting
lib/server/           Owner-scoped data access, summaries, verdict, trends, exports
prisma/               Schema and migrations
scripts/              set-password, unlock-login, backup/restore, Supabase hardening
tests/                Vitest suite (runs against a real PostgreSQL test database)
```
