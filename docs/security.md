# Security

## Threat model in brief

Many people's health data on the public internet, one account each. The
protections aim to make sure that:

- only the account holder can read or change their data,
- a stolen database copy doesn't reveal any password or any usable token,
- other websites can't make your browser change data (CSRF),
- online password guessing is slow and capped,
- imported JSON can't corrupt data or reach other owners' rows.

## Passwords

- Argon2id (`@node-rs/argon2`) with OWASP parameters: 19 MiB memory, 2
  iterations, 1 lane. Length 8–128 characters (no other composition rules).
- Set at sign-up (`/register`) or by an administrator
  (`npm run set-password -- <email>`).
- Sign-in spends the same hashing effort whether or not the account exists, and
  returns one generic error message. Sign-up gives the same reply for a taken
  address as for a new one.

## Tokens and cookies

- **Access token:** a JWT signed with HS256 using `JWT_ACCESS_SECRET` (32+
  characters, required). It carries the account id, issuer, audience, a unique
  id and a 15-minute expiry; `alg: none` and other algorithms are refused. It is
  verified without a database lookup.
- **Refresh token:** 32 random bytes (256 bits), base64url, in the cookie only.
  The database stores its **SHA-256 hash**, so a database leak yields no usable
  token. 30-day sliding expiry.
- **Rotation and theft detection:** every refresh exchanges the token for a new
  one in the same family. Reusing a spent token after a 10-second grace window
  deletes the whole family. Parallel requests inside the window get only a new
  access token, so two tabs can't sign each other out.
- **Cookies:** `__Host-ft_access` and `__Host-ft_refresh` in production. The
  `__Host-` prefix makes browsers require `Secure`, `Path=/` and no `Domain`, so
  subdomains can't set or override them. Flags: `HttpOnly`, `SameSite=Lax`,
  `Secure` (production), `Expires`.
- Every page (`requireOwner`) and API route (`withOwner`) verifies the access
  token. `proxy.ts` does an optimistic redirect (to `/login`, or through
  `/api/auth/refresh` when only a refresh cookie is present); it never sets
  cookies itself, never touches the database, and is not relied on for
  security. It does not run on `/api/*`.
- Visiting `/login` or `/register` while signed in redirects to the app.
- Logout deletes the token family. A password change deletes all of an
  account's refresh tokens; access tokens already issued last at most 15 more
  minutes. A refresh token is refused for an unconfirmed account.
- Only the access token's signature is checked per request, so revoking an
  account takes effect within 15 minutes, not instantly. That is the usual
  trade-off for avoiding a database lookup on every request.

## Email confirmation

- Sign-up creates the account unconfirmed; sign-in is refused until a 6-digit
  code from the inbox is entered. Codes come from the OS CSPRNG, last 10 minutes
  and are single use.
- Only a keyed hash is stored (HMAC-SHA256 with the server secret, bound to the
  account). A plain hash of one million possibilities would fall in milliseconds
  to anyone holding a database copy; the key prevents that.
- **Guessing is bounded three ways:** 5 wrong guesses burn the code (counted
  atomically *before* comparing, so parallel requests cannot get more), 10
  submissions per address and 20 per client per 15 minutes, and a new code needs
  60 seconds and counts toward 3 per 15 minutes. Every failure looks the same.
- **Pre-registration:** signing up again with an unconfirmed address replaces the
  stored password, so someone who registered another person's address first
  cannot keep their password. A narrow window remains if they register again
  between the owner's sign-up and the owner entering the code.
- **No enumeration:** a new, unconfirmed and confirmed address get the same reply
  at the same speed, because everything that depends on the account runs after
  the response. Refusals are keyed on the address, not on whether it exists.
- Unconfirmed accounts are deleted after 24 hours, so open sign-up cannot pile up
  abandoned rows.
- Delivery is SMTP (Gmail App Password by default) with connection timeouts.
  Credentials come from the environment only.

## CSRF

Layered defences for every state-changing request (`POST` to `/api/auth/*`
and `/api/import/*`):

1. `SameSite=Lax` cookies: browsers don't send the auth cookies on
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
so parallel guesses can't race past the limit: **20 failures per client per 15
minutes** and **5 failures per email address per 15 minutes**. Confirmation codes
(60 s apart, 3 per address, 10 requests per client) and code submissions use the
same mechanism, and every refusal reports the seconds left. A
success clears that account's failures, not the client's. Recovery:
`npm run unlock-login`.

- **Storage is bounded.** An attempt over the limit is refused and its record
  removed again, so hammering the endpoint stores at most 20 rows per client and
  5 per address, however many requests arrive.
- **Lockouts end on time.** Because refused attempts aren't recorded, a lockout
  ends 15 minutes after the failures that caused it; continuing to hammer does
  not extend it.
- **Cleanup doesn't depend on a successful sign-in.** Every sign-in attempt
  (successful or not) first deletes up to 500 login-attempt rows older than the
  window and up to 500 expired refresh tokens (and as many expired confirmation tokens). The work per request is bounded, and
  stale rows disappear as long as anyone (including an attacker) is making
  attempts. With no attempts, nothing new is being written, so nothing grows.
  To clean up on a schedule as well, e.g. with `pg_cron` on Supabase:
  `DELETE FROM login_attempts WHERE "createdAt" < now() - interval '1 hour';`
  and `DELETE FROM refresh_tokens WHERE "expiresAt" < now();`.

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

- The owner is always taken from the signed access token. No request field
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

- **Lockout:** the per-address cap lets someone who knows your email keep that
  account locked out for 15 minutes at a time by failing to sign in 5 times (a
  lockout cannot be extended by further attempts, but can be re-triggered after
  it ends). Other accounts are unaffected. Recovery is `npm run unlock-login`.
- Sign-up is open, so anyone can create accounts (limited to 10 code requests per
  client IP per 15 minutes). Without `TRUST_PROXY` all clients share that limit.
- No self-service password reset; an administrator uses `npm run set-password`.
- Revoking an account takes effect within 15 minutes (the access-token lifetime).
- No second factor (TOTP or passkeys).
- No absolute sign-in lifetime: an active sign-in can be renewed indefinitely,
  until logout, a password change or token-reuse detection.
- No Content-Security-Policy header yet. It would need nonces for Next.js
  scripts, and there is no user-generated HTML, so the XSS surface is small.
- Without `TRUST_PROXY`, all clients share one rate-limit bucket.

## Reporting a problem

If you find a security issue, change the affected password first (`npm run set-password -- <email>`),
then investigate. Treat the `refresh_tokens` table as the record of where each
account is signed in.
