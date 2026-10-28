# Security

## Threat model in brief

A single person's health data on the public internet. The protections aim to
make sure that:

- only someone with the password can read or change data,
- a stolen database copy doesn't reveal the password or any usable session,
- other websites can't make your browser change data (CSRF),
- online password guessing is slow and capped,
- imported JSON can't corrupt data or reach other owners' rows.

## Passwords

- Argon2id (`@node-rs/argon2`) with OWASP parameters: 19 MiB memory, 2
  iterations, 1 lane. Length 12–256 characters.
- Set only from the command line (`npm run set-password`). There is no
  password field anywhere in the web UI except sign-in.
- Sign-in spends the same hashing effort whether or not a password exists, and
  returns one generic error message.

## Sessions and cookies

- The session token is 32 random bytes (256 bits), base64url-encoded, in the
  cookie only. The database stores its **SHA-256 hash**, so a database leak
  yields no usable session.
- No signing secret is involved. Tokens are random and checked against the
  database, so there is no `SESSION_SECRET` to manage or rotate.
- Cookie: `__Host-ft_session` in production. The `__Host-` prefix makes
  browsers require `Secure`, `Path=/` and no `Domain`, so subdomains can't set
  or override it. Flags: `HttpOnly` (JavaScript can't read it), `SameSite=Lax`,
  `Secure` (production), `Expires` = session expiry.
- 30-day sliding expiry, renewed hourly in the database. The browser cookie's
  expiry is extended by `GET /api/auth/session`, which the app calls on every
  full page load and when a tab becomes visible again after 30+ minutes. That
  endpoint only answers for a **valid** session, so a forged, unknown or expired
  cookie is never given a new expiry (and a 401 sends the tab to the sign-in page).
- Every page (`requireOwner`) and every API route (`withOwner`) validates the
  session against the database. `proxy.ts` only does an optimistic redirect when
  there is no cookie at all; it never sets cookies, never touches the database,
  and is not relied on for security. It does not run on `/api/*`.
- Visiting `/login` while signed in redirects to the app; an invalid or expired
  cookie shows the form.
- Logout deletes the session row. A password change deletes all sessions, and
  sessions older than the last password change are rejected anyway.

## CSRF

Layered defences for every state-changing request (`POST` to `/api/auth/*`
and `/api/import/*`):

1. `SameSite=Lax` cookies: browsers don't send the session cookie on
   cross-site `POST`s.
2. **Origin check:** the `Origin` header must equal the app's origin, which is
   `APP_ORIGIN` if set, otherwise the request's own host. If `Origin` is
   missing, `Sec-Fetch-Site: same-origin` is required instead. Otherwise the
   response is HTTP 403. The sign-in endpoint is protected too, against login CSRF.
3. Import endpoints require `Content-Type: application/json`, which an HTML
   form can't send cross-site without a CORS preflight that the app doesn't allow.

`GET` endpoints (exports) never change data.

## Rate limiting and trusted proxies

Failed sign-ins are recorded in PostgreSQL *before* the password is checked,
so parallel guesses can't race past the limit: **5 failures per client per 15
minutes** and **50 failures overall per 15 minutes**. A success clears that
client's failures. Recovery: `npm run unlock-login`.

- **Storage is bounded.** An attempt over the limit is refused and its record
  removed again, so hammering the endpoint stores at most 5 rows per client and
  50 overall, however many requests arrive.
- **Lockouts end on time.** Because refused attempts aren't recorded, a lockout
  ends 15 minutes after the failures that caused it; continuing to hammer does
  not extend it.
- **Cleanup doesn't depend on a successful sign-in.** Every sign-in attempt
  (successful or not) first deletes up to 500 login-attempt rows older than the
  window and up to 500 expired sessions. The work per request is bounded, and
  stale rows disappear as long as anyone (including an attacker) is making
  attempts. With no attempts, nothing new is being written, so nothing grows.
  To clean up on a schedule as well, e.g. with `pg_cron` on Supabase:
  `DELETE FROM login_attempts WHERE "createdAt" < now() - interval '1 hour';`
  and `DELETE FROM sessions WHERE "expiresAt" < now();`.

Identifying "the client" safely depends on `TRUST_PROXY`:

| `TRUST_PROXY` | How the client is identified | Use when |
|---|---|---|
| `false` (default) | All clients share **one** bucket. No header is trusted | Local development, or any server reachable directly from the internet |
| `true` | The **last** entry of `X-Forwarded-For` | Only behind a proxy you control that every request must pass through, and that appends or overwrites `X-Forwarded-For`. **Vercel qualifies** |

Why the last entry: a client can send its own `X-Forwarded-For: 1.2.3.4`, and a
proxy then *appends* the real address. The first entry is attacker-controlled;
the last is the one your proxy wrote. The app never reads `X-Real-IP`.

`TRUST_PROXY=true` also lets the CSRF check use `X-Forwarded-Host` and
`X-Forwarded-Proto` to work out the public origin. Setting `APP_ORIGIN` removes
any reliance on those headers and is recommended once you have a fixed domain.

**Never set `TRUST_PROXY=true` if the app can be reached without going through
the proxy** (for example on a VPS with an open port). Anyone could then claim
any IP and dodge the per-client limit. The 50-per-15-minutes global cap still
applies.

## Authorization and data ownership

- The owner is always taken from the server-side session. No request field
  (query, body, header) can select whose data is read or written. A test sends
  `owner_id` and confirms it is rejected or ignored.
- All data access goes through owner-scoped functions (`lib/server/repo.ts`,
  the import planner). Every query filters by `ownerId`.
- Every record table's primary key is `(ownerId, id)`. Exercise sets reference
  their workout through `(ownerId, workoutId)`, so the database itself refuses
  to attach a set to another owner's workout.
- Cross-owner isolation is covered by tests (`tests/ownership.test.ts`,
  `tests/api-authz.test.ts`) using a second owner.
- PostgreSQL row-level security is **not** used for ownership; the app layer
  enforces it. On Supabase, RLS with no policies is enabled only to shut out
  the Data API roles (see [deployment](deployment.md#4-lock-down-supabases-data-api)).

## Input validation

- Imports are validated with strict Zod schemas. Unknown fields reject the
  record, or the whole import when the unknown key is at the top level.
  Numbers are range-checked and dates must be real calendar dates.
- Request bodies are size-capped: 4 KB for sign-in, 16 KB for settings, 10 MB for
  an import preview (a confirm may add 4 KB for its wrapper), and at most 20,000
  records per import. The cap is enforced while the body streams, so an oversized
  upload (declared or chunked) is rejected with **HTTP 413** and a message naming
  the limit as soon as it is crossed, without being held in memory. Authorization
  and the origin check run before the body is read. `/api/*` is excluded from the
  proxy because Next.js buffers (and silently truncates at 10 MB) any request
  body that passes through a proxy.
- Database CHECK constraints back up the validation (non-negative nutrition,
  RPE 0–10, weight basis `raw` or `cooked`, and so on).
- A confirm is accepted only if it matches the previewed plan (the
  `preview_token`). Writes run in one transaction under a per-owner advisory lock.

## HTTP headers

Every response carries `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: same-origin`, `Permissions-Policy` (camera, microphone and
geolocation disabled), and in production `Strict-Transport-Security`. The
`X-Powered-By` header is off. API responses are `Cache-Control: no-store`.

## Secrets

| Secret | Lives in | Never in |
|---|---|---|
| `DATABASE_URL` (contains the DB password) | `.env` locally; Vercel env (Production) | git, client code, logs |
| `DIRECT_DATABASE_URL` / production URLs | your shell or password manager, only while running admin commands | Vercel, git |
| `POSTGRES_PASSWORD` (local container) | `.env` | git |
| Your app password | your head or password manager | anywhere else; only its hash is stored |
| Backups (`*.dump`) | encrypted storage | git (ignored), email |

No server environment variable is exposed to the browser: none use the
`NEXT_PUBLIC_` prefix, and database code is marked `server-only`. If a database
URL leaks, rotate the database password in Supabase and update the Vercel
variable.

## Known limitations

- **Lockout:** the global cap lets someone keep the owner locked out for 15
  minutes at a time by failing to sign in 50 times (a lockout cannot be extended
  by further attempts, but can be re-triggered after it ends). Recovery is
  `npm run unlock-login`. For
  stronger protection, put an access gate in front of the app (Vercel
  Deployment Protection with a password or Vercel login, or Cloudflare Access).
- No second factor (TOTP or passkeys).
- No absolute session lifetime: an active session can be renewed indefinitely,
  until logout or a password change.
- No Content-Security-Policy header yet. It would need nonces for Next.js
  scripts, and there is no user-generated HTML, so the XSS surface is small.
- Without `TRUST_PROXY`, all clients share one rate-limit bucket.

## Reporting a problem

If you find a security issue, change the password first (`npm run set-password`),
then investigate. Treat the session table as the record of where you are
signed in.
