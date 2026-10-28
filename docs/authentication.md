# Authentication

The app has exactly one account, the owner, protected by one password. There
is no registration, no username, no social login and no Supabase Auth.

## Setting the password for the first time

```bash
npm run set-password
```

- You type the password twice at a hidden prompt. It must be 12–256 characters.
  A long passphrase is ideal.
- The command creates the owner and a default profile (timezone `Asia/Kolkata`)
  if they don't exist yet, and stores **only an Argon2id hash**
  (19 MiB memory, 2 iterations, 1 lane). The password itself is never stored or logged.
- It uses `DATABASE_URL` from your environment or `.env`.

**For a production database,** run the same command on your own machine and
point it at production for that one command. Variables set on the command line
take priority over `.env`:

```bash
DATABASE_URL="postgresql://…production connection string…" npm run set-password
```

**Non-interactive use** (scripts, CI): when stdin is not a terminal, the first
line of stdin is used as the password. Avoid putting a real password in shell
history. For example, read it from a password manager:

```bash
op read "op://Private/Fitness Tracker/password" | npm run set-password
```

## Changing the password

Run `npm run set-password` again. This:

1. replaces the hash,
2. records the change time, and
3. **revokes every existing session.** All signed-in browsers must sign in again.

A session created before the password change is rejected even if its database
row somehow survived, so the change takes effect immediately everywhere.

If you think the password leaked, change it. That alone signs out any attacker.

## Signing in and out

- **Sign in** at `/login`. A wrong password always returns the same message,
  `Invalid password.`, whether or not a password has been configured.
- **Sign out** with the button at the bottom of the sidebar, or the icon in the
  top bar on mobile. Sign-out deletes the session on the server, so the old
  cookie is useless even if it were copied, then clears the cookie and reloads
  the page so no signed-in page can be shown from the browser cache.

## How sessions behave

| Property | Value |
|---|---|
| Token | 256 random bits from the operating system's CSPRNG |
| Stored in the database | Only a SHA-256 hash of the token (`sessions.tokenHash`) |
| Cookie name | `__Host-ft_session` in production, `ft_session` in development |
| Cookie flags | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production |
| Lifetime | 30 days (`SESSION_TTL_DAYS`), **sliding**: each use extends it |
| Renewal | The database expiry is renewed at most once an hour while you use the app |
| Expiry | Expired sessions are rejected and deleted. Leftovers are purged (in batches of 500) on every sign-in attempt, successful or not |
| Browser cookie | Its expiry is extended by `/api/auth/session` on page loads, only for a valid session. A forged or expired cookie is never renewed |
| `/login` when signed in | Redirects to the app (or the safe `?next=` page) |
| Validation | Every page and every API request checks the session in the database |

In practice you stay signed in as long as you open the app at least once every
30 days on that device. Each device has its own session.

## Login rate limits and lockout

| Limit | Value |
|---|---|
| Failed attempts per client IP | 5 per 15 minutes |
| Failed attempts across all clients | 50 per 15 minutes |
| Response when limited | HTTP 429, "Too many login attempts. Try again in 15 minutes." |

Attempts are counted in PostgreSQL, so the limit holds across server
restarts and serverless instances. A successful sign-in clears that client's
failures. How the "client IP" is determined depends on `TRUST_PROXY`; see
[security](security.md#rate-limiting-and-trusted-proxies).

### If you lock yourself out

You can wait 15 minutes, or clear the lockout immediately:

```bash
npm run unlock-login
# production:
DATABASE_URL="postgresql://…production…" npm run unlock-login
```

This deletes recorded failed attempts only. It doesn't change the password or
sessions. It needs database access, so only someone who already controls the
database can use it.

Attempts over the limit are refused but not stored, so hammering neither fills
the database nor extends the lockout: it ends 15 minutes after the failures that
caused it. The global limit does mean someone could lock you out for up to 15
minutes at a time. `unlock-login` is the recovery path. If it
happens repeatedly, check your hosting logs and consider putting the app
behind Vercel Deployment Protection or another access gate (see
[security](security.md#known-limitations)).

## Forgotten password

There is no email reset, because there is no email. Set a new password with
`npm run set-password` against the same database. Access to the database *is*
the recovery mechanism.
