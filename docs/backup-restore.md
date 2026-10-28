# Backup and restore

Your fitness history exists only in PostgreSQL. Back it up regularly and
**practise a restore** before you need one.

> **There are two databases, so there are two backups.**
> `npm run db:backup` on its own backs up the **local Docker database** on your
> machine and says so. It does **not** protect production (Supabase or any
> remote host). A production backup is made only when you pass the production
> URL as `BACKUP_DATABASE_URL`; its file is named `fitness-remote-….dump`, and
> local ones `fitness-local-….dump`. The script prints which one it made.

Three scripts do the work. They run the PostgreSQL 17 client tools inside
Docker, so nothing needs installing beyond Docker.

| Script | What it does |
|---|---|
| `npm run db:backup` | Dumps the app tables (`public` schema) to `backups/`, then re-reads the file to prove it is a complete archive. **Local** by default, **remote** with `BACKUP_DATABASE_URL` |
| `npm run db:restore -- <file>` | Restores into a **scratch local** database `fitness_restore` and prints row counts. It overwrites real data only when you ask explicitly, shows which database it is about to replace, and asks you to confirm |
| `npm run db:counts` | Read-only: prints the row count of every app table for a local or remote database, to compare a source with a restored copy |

Backups use `pg_dump`'s custom format with `--no-owner --no-privileges`, so a
local backup can be restored to Supabase and vice versa. Files are created with
owner-only permissions (`600`), a failed backup never leaves a partial file
behind, and `backups/` is git-ignored.

> **Backups contain personal health data and your password hash.** Store copies
> somewhere encrypted (an encrypted disk, a password-manager attachment, or
> encrypted cloud storage). Don't email them or commit them.

## Connection strings: keep them out of history and logs

A remote connection string contains the database password.

- The scripts never print it. They show only `host:port` and the database name.
- Don't type it into a command: that saves the password in your shell history.
  Keep it in a file only you can read, **outside the project folder**, and load
  it for the terminal session that needs it:

  ```bash
  install -m 600 /dev/null ~/.fitness-prod.env    # one time: empty, owner-only file
  # add the line: PROD_DIRECT_URL='postgresql://postgres.<ref>:<url-encoded-password>@<host>:5432/postgres?sslmode=require'
  set -a; source ~/.fitness-prod.env; set +a      # in the terminal where you run admin commands
  ```

  Alternative without a file: `read -rs -p "Production URL: " PROD_DIRECT_URL; export PROD_DIRECT_URL`.
- Use the **direct** or **session pooler** URL (port `5432`). The transaction
  pooler (port `6543`) can't be used for dumps.
- Prisma-style extras such as `?schema=public` or `?pgbouncer=true` are removed
  automatically before the Postgres tools see the URL.
- A URL whose host is `localhost` is refused with an explanation: inside Docker,
  `localhost` is the container itself. Use `host.docker.internal` for a
  database on your own machine.

The commands below use `$PROD_DIRECT_URL`, so no secret appears in them.

## Back up

### Local database (your development data only)

```bash
npm run db:backup
```

```
Backing up LOCAL Docker database "fitness" (this is not a backup of production) ...
Backup written (local): backups/fitness-local-20261027T081500Z.dump (48K, 13 tables with data)
```

### Production (Supabase or any remote PostgreSQL)

```bash
BACKUP_DATABASE_URL="$PROD_DIRECT_URL" npm run db:backup
```

```
Backing up REMOTE database "postgres" on aws-0-<region>.pooler.supabase.com:5432 ...
Backup written (remote): backups/fitness-remote-20261027T081500Z.dump (48K, 13 tables with data)
```

**Check the first line says REMOTE** and names the production host. If it says
`LOCAL Docker database`, `BACKUP_DATABASE_URL` wasn't set in this terminal and
you have **not** backed up production.

### How often

- **Before every deployment that includes a migration.** This is mandatory. It is your rollback.
- Weekly otherwise, keeping at least the last 4 weeks.
- On Supabase, also check which automatic backups your plan includes. Treat
  them as a second copy, not a replacement: you can only restore your own
  `.dump` files to another provider or to your machine.

For an automatic weekly local backup, a cron entry such as
`0 9 * * 1 cd /path/to/fitness-tracker && npm run -s db:backup` works. Copy the
files off the machine as well. (For production, the cron environment must load
the URL file: `set -a; . ~/.fitness-prod.env; set +a; BACKUP_DATABASE_URL="$PROD_DIRECT_URL" npm run -s db:backup`.)

## Restore

### Step 1: always verify into a scratch database first

This works for local **and** production backups, and never touches real data:

```bash
npm run db:restore -- backups/fitness-remote-20261027T081500Z.dump
```

It drops and recreates the **local** database `fitness_restore`, restores
into it in a single transaction, and prints row counts:

```
Restoring backups/… into scratch LOCAL database "fitness_restore" (nothing else is touched) ...
Restore complete. Row counts in LOCAL database "fitness_restore":
food_entries | 89
workout_sessions | 11
...
```

**Verify** by comparing with the source, line for line:

```bash
COUNT_DATABASE_URL="$PROD_DIRECT_URL" npm run db:counts      # production
npm run db:counts                                            # local "fitness"
```

(Compare straight after taking the backup. If you import data in between, the
numbers legitimately differ.)

To look at the restored data in the app, start it against the scratch database:

```bash
DATABASE_URL="postgresql://fitness:<local-password>@localhost:5434/fitness_restore?schema=public" npm run dev
```

Sign in with the password that was current when the backup was taken. When
you're done:
`docker compose exec db psql -U fitness -d postgres -c "DROP DATABASE fitness_restore"`

### Step 2a: replace the local database

Stop the app (`Ctrl+C` on `npm run dev`), then:

```bash
npm run db:restore -- backups/fitness-local-20261027T081500Z.dump --into fitness
```

You must type `fitness` to confirm. The restore runs in a single transaction
with `--exit-on-error`: if anything fails, the database is left exactly as it
was. Existing sessions in the backup are restored too. Sessions created after
the backup no longer exist, so you may need to sign in again.

### Restore a remote (Supabase) database

1. **Back up the current remote state first** (see above). Even a bad state is
   worth keeping.
2. Restore, using the direct or session-pooler URL:

   ```bash
   RESTORE_DATABASE_URL="$PROD_DIRECT_URL" npm run db:restore -- backups/fitness-remote-20261027T081500Z.dump --remote
   ```

   The script names the database it is about to replace (host and database,
   no credentials) and you must type `restore` to confirm. Row counts of the
   restored database are printed afterwards.
3. Re-run the Supabase hardening SQL (see [deployment](deployment.md#4-lock-down-supabases-data-api)),
   because restored tables come back without row-level security enabled.

## Restoring onto a newer schema

A backup contains its own schema and migration history (`_prisma_migrations`),
so a restore returns the database to exactly that version. If the app has
since gained migrations, run `npm run db:deploy` (with the right
`DATABASE_URL`, or `DIRECT_DATABASE_URL`) after restoring to bring it forward.
Migrations only move forward, so restoring an older backup is also how you
undo a migration (see [operations](operations.md#rollback)).

## Tested walkthrough

The procedure above was run end to end, on a clean checkout with a fresh
Docker volume, using a second database on the same server as a stand-in for
"production" (reached through `host.docker.internal`, with the URL held in an
owner-only file and loaded as described above). Production itself was never touched.

1. A database was set up with the setup guide and filled with three weeks of
   synthetic data (89 food entries, 11 workouts with 33 sets, 7 cardio sessions,
   21 activity days) through the app's import API.
2. `BACKUP_DATABASE_URL=… npm run db:backup` printed REMOTE and wrote
   `fitness-remote-….dump`; run without the variable it printed LOCAL and wrote
   `fitness-local-….dump`.
3. `npm run db:restore -- <file>` restored it into `fitness_restore`. `npm run
   db:counts` for the source and for the restored copy matched line for line.
4. Exporting all data from the source and from the restored database (through
   the app) produced identical JSON apart from the export timestamp.
5. A food entry was deleted from the source, and `RESTORE_DATABASE_URL=… npm run
   db:restore -- <file> --remote` brought it back after typing `restore`;
   typing anything else cancelled with nothing changed.

Re-run this walkthrough (against a scratch copy, never production) after any
change to the backup scripts.
