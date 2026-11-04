# Authentication

Anyone can create an account with an email address and a password. Each account
sees only its own data (every record carries the account's `ownerId`; see
[security](security.md#authorization-and-data-ownership)). Email addresses must
be confirmed before the first sign-in. There is no username, no social login
and no Supabase Auth.

## How it fits together

| Piece | What it is |
|---|---|
| Access token | A signed JWT (HS256), valid **15 minutes**, holding the account id. Checked by verifying the signature, with no database lookup |
| Refresh token | 256 random bits, valid **30 days** (`SESSION_TTL_DAYS`), stored in the database only as a SHA-256 hash (`refresh_tokens`). **Rotated** on every use |
| Cookies | Both live in `HttpOnly`, `SameSite=Lax`, `Path=/` cookies, `Secure` in production. Production names: `__Host-ft_access` and `__Host-ft_refresh`; development: `ft_access` and `ft_refresh` |
| Passwords | Argon2id (19 MiB, 2 iterations, 1 lane). 8–128 characters. Only the hash is stored |
| Email confirmation | A 6-digit code emailed over SMTP, valid **10 minutes**, 5 wrong guesses allowed. Stored only as a keyed hash (`email_otps`) |

## Configuration

```bash
JWT_ACCESS_SECRET="…at least 32 random characters…"   # openssl rand -base64 48
SMTP_USER="you@gmail.com"
SMTP_PASSWORD="xxxx xxxx xxxx xxxx"                   # a Google App Password
# optional: SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 465), MAIL_FROM
```

- **Gmail App Password:** turn on 2-step verification for the Google account,
  then create one at <https://myaccount.google.com/apppasswords>. Use that, not
  the account password.
- Without `SMTP_USER`/`SMTP_PASSWORD`, development **prints the email
  (including the code) to the server console** instead of sending it. Production
  refuses to send. Emails are sent after the response, so a send failure is
  logged on the server and the person simply taps **Resend code**.
- Changing `JWT_ACCESS_SECRET` invalidates every access token; browsers just
  fetch a new one with their refresh token.

## Signing up

1. `/register` (step 1 of 2): email, password, confirmation. `8–128 characters`
   is shown under the password and turns green when met; the button stays disabled
   until it is met and both passwords match.
2. Step 2 of 2: the page switches to **Check your email**, with six code cells. The server has stored the
   account as **unconfirmed** and emailed the code.
3. A correct code confirms the address **and signs the person in**.

Timers on the code screen:

| Timer | Value |
|---|---|
| Code lifetime | 10 minutes (counted down on screen) |
| Resend | Not before 60 seconds after the last code (counted down on the button) |
| Codes per address | 3 per 15 minutes. After the third, the button shows the time left until another is allowed |
| Wrong guesses | 5 per code, then it is burned and a new one is needed |
| Code submissions | 10 per address and 20 per client IP per 15 minutes; the wait is shown |

Details worth knowing:

- A new code replaces the old one. Codes are stored only as an HMAC (keyed with
  the server secret and bound to the account), so a database copy cannot reveal
  them.
- Signing up with an address that already has a **confirmed** account gives the
  same reply and takes the same time as a new one, changes nothing, and emails the
  owner "you already have an account" instead of a code.
- Signing up again with an **unconfirmed** address replaces the stored password
  with the new one and sends a fresh code. Someone who pre-registered another
  person's address therefore cannot keep their password once the real owner signs
  up.
- Trying to sign in before confirming (with the right password) sends a fresh
  code and opens the same code screen.
- Accounts still unconfirmed after **24 hours** are deleted automatically (with
  their profile and code), as part of the same cleanup that runs on auth requests.

## Password rules

Length 8–128 characters. Nothing else is required: no symbols, digits or
"complexity" rules. The sign-up form shows `8–128 characters` under the field and
ticks it when it is met; the server checks the same rule
(`lib/shared/password-rules.ts`).

## Signing in and out

- **Sign in** at `/login` with email and password. A wrong password and an
  unknown email give the same message, `Invalid email or password.`, and cost the
  same hashing time. Email addresses are case-insensitive.
- **Sign out** deletes the whole refresh-token family on the server and clears
  both cookies, then reloads the page so nothing signed-in is shown from the
  browser cache. The access token already issued stops being accepted when its
  cookie is cleared; a copy someone saved would work for at most 15 minutes.

## How tokens behave

1. Every page (`requireOwner`) and API route (`withOwner`) verifies the access
   token's signature and expiry.
2. When it has expired, the refresh token is exchanged for a **new pair**:
   - for an API request, `withOwner` does it in place and the new cookies ride
     on the response;
   - for a page request, `proxy.ts` redirects through `GET /api/auth/refresh`,
     which rotates the pair and sends the browser back to the page it asked for.
     (Server Components can't set cookies, a Route Handler can.)
3. Each refresh token is **single use**. Presenting an already-used one more than
   10 seconds later is treated as theft: the whole token family (that one
   sign-in) is deleted and the user must sign in again. Within the 10 seconds a
   parallel request from the same browser (two tabs, a page load plus the
   keep-alive ping) simply gets a new access token.
4. The refresh token's 30 days slide: each rotation issues a fresh 30 days. Open
   the app at least once every 30 days on a device to stay signed in. Each
   device has its own family.

## Rate limits and lockout

| Limit | Value |
|---|---|
| Failed sign-ins per client IP | 20 per 15 minutes |
| Failed sign-ins per email address | 5 per 15 minutes, from any client |
| Response when limited | HTTP 429 with the minutes left and a `Retry-After` header. The sign-in page shows a live countdown and disables the button |

Attempts are counted in PostgreSQL, so the limits hold across restarts and
serverless instances. A successful sign-in clears that account's failures but not
the client's, so signing in to your own account doesn't reset the budget for
guessing others. How the "client IP" is determined depends on `TRUST_PROXY`; see
[security](security.md#rate-limiting-and-trusted-proxies).

The per-account limit means someone who knows your address can lock that one
account out for up to 15 minutes at a time. Other accounts are unaffected.

### If someone is locked out

Wait 15 minutes, or clear the lockout now:

```bash
npm run unlock-login
# production:
DATABASE_URL="postgresql://…production…" npm run unlock-login
```

This deletes recorded failed attempts only. It changes no password and signs
nobody out. It needs database access.

Attempts over the limit are refused but not stored, so hammering neither fills
the database nor extends the lockout.

## Administration from the command line

```bash
npm run set-password -- user@example.com
```

Creates an account that is **already confirmed** (no code), or changes an existing
account's password and revokes all of its refresh tokens. Reads the password
from a hidden prompt (or the first line of stdin when piped). Use it to create
the first account without email, or to reset a password; there is no
self-service password reset yet.

## Forgotten password

There is no email reset. An administrator with database access runs
`npm run set-password -- <email>` for that account.
