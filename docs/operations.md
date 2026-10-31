# Operations

## Checks to run before every commit or deploy

```bash
npm run typecheck   # TypeScript, no emit
npm run lint        # ESLint (Next.js rules)
npm test            # Vitest against the fitness_test database (Docker db must be running)
npm run build       # production build
npm run test:e2e    # browser tests: builds, then drives your local Chrome (CHROME_PATH) against the test database
```

All four must pass. The test suite covers:

| File | Area |
|---|---|
| `tests/import-partial.test.ts` | Partial imports, date inheritance, validation policy, null vs omitted |
| `tests/import-ids.test.ts` | Stable and generated IDs, idempotency, moves, duplicates, deletes, preview/confirm, target versions |
| `tests/import-bulk.test.ts` | A month in one import, mixed valid/invalid, export round trips |
| `tests/ownership.test.ts` | Cross-owner isolation, composite foreign keys, CHECK constraints |
| `tests/auth.test.ts` | Hashing, cookies, rate limits (including forged headers and parallel guesses), sessions, logout, password change |
| `tests/api-authz.test.ts` | Every endpoint requires a session; CSRF; content type; full HTTP flow |
| `tests/summary.test.ts` | Totals with unknowns, exercise kept separate, targets history, context prompt |
| `tests/dashboard-logic.test.ts` | Verdict, meal timeline, trends and adherence, PRs, views tracking moves/edits/deletes |
| `tests/fixes-regression.test.ts` | Today/date resolution across IST midnight, day-view consistency, History filtering, Settings (profile, targets, history, field errors), suggested targets, totals agreeing across views |
| `tests/e2e/navigation.e2e.ts` | Real browser: Today shortcut, historical URLs, date picker, back/forward, **midnight rollover** with a shifted server clock, mobile bottom-nav overlap at 375/390 px |
| `tests/theme.test.ts` | Pre-paint theme script (stored/system/invalid/blocked storage), every theme defines every token, validated chart palettes unchanged, text and button contrast ≥ 4.5:1 and accent mark ≥ 3:1 per theme, a stylesheet with no gradients, blur, glow or shadows, a saved `aurora` preference reads as `ember` |
| `tests/status.test.ts` | Day status describes the whole day: all 243 ok/under/over combinations, today vs finished day, unknown never counted as under, per-measure strip markup |
| `tests/cardio.test.ts` | Cardio grouping by normalised name, totals, pace only from distance and time, per-activity sessions, 1RM hint is a closed labelled button |
| `tests/phase-d.test.ts` | Steps quick log (past/today, keeps weight and notes, replace message, invalid and future input writes nothing), context name lists (dedupe, order, caps, length) |
| `tests/e2e/themes.e2e.ts` | Real browser: live switching with no reload (charts, colours, browser UI colour), persistence and first-paint theme, System following the OS, keyboard use, phone layout |
| `tests/e2e/today.e2e.ts` | Real browser, Today page: no overflow or console errors at 1440/768/390 px in all three themes, panels end on the content edge, the status detail disclosure, steps quick log on yesterday (keeps weight, rejects decimals, disabled on future days). Set `SHOTS_DIR` to also save screenshots |
| `tests/e2e/pages.e2e.ts` | Real browser, History / Trends / Exercises / Cardio / Data / Settings: no overflow, console errors or extra `h1` at 1440/768/390/375 px, bottom-nav labels not cut off in all three themes, figure strips end on the content edge, a History row opens its day when clicked anywhere, current range and mode are marked with `aria-current` |
| `tests/daily-log.test.ts` | The Log today save (steps, weight or both; a blank field never clears; invalid and future input writes nothing; replaced-value message), the weight log (order, change since the previous weigh-in, gap days), the import toast wording |
| `tests/e2e/logging.e2e.ts` | Real browser: the Log data button, Log today with a toast and refreshed values, import toast with the text cleared and Clear hidden while the result stays, Trends weight log with an Add link for a missed day |
| `tests/audit-import.test.ts` | Several records for one date in a single import (merge / conflict / targets), cross-workout set moves and `allow_move`, existing-set updates |
| `tests/audit-completeness.test.ts` | Per-nutrient completeness for all 32 missing-nutrient combinations, the shared steps/target policy and its boundaries, empty-day confidence, future date ranges, weekly labels |
| `tests/audit-auth.test.ts` | Bounded rate-limit storage and cleanup, lockout timing, parallel guesses, expired-session purge, proxy never setting cookies, session keep-alive |
| `tests/audit-limits.test.ts` | 413 handling for streamed and declared oversize bodies, boundaries, CSRF/auth ordering |
| `tests/audit-misc.test.ts` | Weigh-ins vs profile saves, birth dates (incl. timezone boundaries), goal/activity matching, stale weights, safe redirects, exercise lookup, workout ordering |
| `tests/audit-prompt.test.ts` | Hidden password prompt: Ctrl+C/Ctrl+D/EOF release the terminal and never echo |
| `tests/audit-scripts.test.ts` | Backup/restore helpers: URL sanitising, no credentials printed, localhost refusal |
| `tests/e2e/audit.e2e.ts` | Real browser: date-picker typing, login redirect, cookie renewal, clipboard failures, re-selecting a file, month selects, exercise URLs, History toggle semantics, future ranges, Settings dates at midnight |
| `tests/e2e/limits.e2e.ts` | Real production server: chunked uploads just under / over the limit, CSRF and auth first |
| `tests/docs-examples.test.ts` | Every JSON example in `docs/setup.md` and `docs/user-guide.md` imports without rejections |

`npm run test:watch` re-runs tests on change. Tests refuse to run unless
`TEST_DATABASE_URL` names a database ending in `_test`.

## Changing the database schema

1. Edit `prisma/schema.prisma`.
2. `npm run db:migrate -- --name short_description` creates and applies a new migration locally.
3. Commit the new folder in `prisma/migrations/`. Never edit a migration that
   has already been applied anywhere.
4. In production, apply it with `npm run db:deploy` (see [deployment](deployment.md#deploying-updates)).

Prefer additive changes (new nullable columns or tables). Water and sleep, for
example, would be new nullable columns on `daily_activity` and `target_sets`
plus fields in `lib/server/import/spec.ts`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `npm run db:up` fails with "port is already allocated" | Another service uses 5434 | Set `POSTGRES_PORT` in `.env` and update both URLs |
| `required variable POSTGRES_PASSWORD is missing` | No `.env`, or the variable is missing | `cp .env.example .env` and fill it in |
| `P1001: Can't reach database server` | Container not running, or wrong port | `npm run db:up`; check `docker compose ps`; check the port in `DATABASE_URL` |
| `password authentication failed` | `.env` password differs from the one the volume was created with | Use the original password, or reset with `docker compose down -v` (deletes local data; back up first) |
| `database "fitness_test" does not exist` | The volume predates the init script | `docker compose exec db psql -U fitness -d postgres -c "CREATE DATABASE fitness_test OWNER fitness"` |
| `Refusing to run tests against …` | `TEST_DATABASE_URL` doesn't end in `_test` | Point it at the test database |
| Sign-in says "Invalid password." on a fresh install | No password set yet | `npm run set-password` |
| HTTP 429 at sign-in | Too many failed attempts | Wait 15 minutes or run `npm run unlock-login` |
| Signed out everywhere unexpectedly | Password was changed, or the session expired after 30 idle days | Sign in again |
| Sign-in works locally with `npm start` but the cookie isn't kept | Production mode sets `Secure` cookies; plain-HTTP origins other than `localhost` drop them | Use `npm run dev` locally, or serve over HTTPS |
| HTTP 403 "Cross-origin request rejected" behind a proxy or custom domain | The origin the app computes differs from the browser's | Set `APP_ORIGIN=https://your.domain` (and `TRUST_PROXY=true` only if appropriate) |
| Import: "The import was rejected as a whole" | Unknown top-level key or wrong `schema_version` | Read the listed errors; the "did you mean" hint names the right key |
| Import: individual records rejected | Validation errors on those records | Fix them and import again. Valid records were applied and are reported |
| Confirm says "Your data changed since the preview" | Data or payload changed between preview and confirm | Review the refreshed preview and confirm again |
| Today shows yesterday's records | Records were imported with yesterday's date (common when a ChatGPT conversation continues the next day), or a very old page was open | Check the date in the import preview; move entries with `{"id": "...", "date": "YYYY-MM-DD"}`. Open pages refresh themselves at midnight |
| Verdict says "In progress" with no assessment | No targets set for that date | **Settings → Daily targets** |
| Totals show "partial" | Some entries have unknown nutrition (`null`) | Re-import those entries by ID with the missing values |
| Build fails with `DATABASE_URL is not set` | The variable is missing at build time | Set it in the build environment (Vercel provides env at build) |
| Supabase: certificate errors | TLS verification settings | See [deployment](deployment.md#1-create-the-supabase-project) |

Logs: locally, the `npm run dev` terminal; on Vercel, the project's **Logs** tab.
Database logs: `docker compose logs db`.

## Rollback

### Application code

- Git tags mark known-good baselines: `phase-1` (backend) and `phase-2`
  (dashboard). Later releases should be tagged the same way
  (`git tag -a v1.0.0 -m "…"`).
- **Locally:** `git checkout <tag>`, then `npm install` and `npm run build`.
- **Vercel:** open the project's Deployments, choose the last good deployment
  and promote it ("Instant Rollback"). This needs no rebuild.

### Database

Migrations only move forward. To undo a migration or recover from bad data:

1. Back up the current state anyway: `npm run db:backup` (add
   `BACKUP_DATABASE_URL=…` for production).
2. Verify the backup you want to return to: `npm run db:restore -- backups/<file>.dump`.
3. Restore it: `--into fitness` locally, or `--remote` with `RESTORE_DATABASE_URL`
   for production. On Supabase, re-run the hardening SQL.
4. Roll the application code back to the matching version, as above.

To undo a bad *import*, prefer a corrective import: a `delete` list for
records that shouldn't exist, and re-imports by ID for wrong values. That
affects only the records involved, unlike a full restore.

## Routine maintenance

| Task | How often |
|---|---|
| `npm run db:backup` for local data; `BACKUP_DATABASE_URL="$PROD_DIRECT_URL" npm run db:backup` for production (a local backup does not protect production), copied off the machine, encrypted | Weekly, and before migrations |
| Practise a restore into the scratch database | Every few months |
| `npm outdated`; update dependencies, then run all checks | Monthly |
| Review the Vercel and Supabase dashboards for errors and usage | Monthly |

Expired sessions and old login attempts are purged automatically: every sign-in
attempt deletes up to 500 stale login-attempt rows and 500 expired sessions, and
attempts over the rate limit are not stored at all, so the tables stay small
even under a flood of failed logins (see [security](security.md#rate-limiting-and-trusted-proxies)
for an optional scheduled cleanup).
