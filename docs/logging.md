# Logging

The app writes **one JSON line per event** to the console (`console.log`,
`console.warn`, `console.error`). On Vercel these appear under
**Logs → Runtime Logs**, and the level filters (Info / Warning / Error) work
because the level follows the console method. Vercel's **Request Logs** (path,
status, time of every request) are separate and need no code.

```json
{"ts":"2026-11-04T07:20:05.771Z","level":"info","event":"auth.register.accepted","rid":"req7-1700000000000-aaaab","method":"POST","path":"/api/auth/register","email":"l***@example.com"}
```

- `ts`, `level`, `event` always come first. `event` is `area.thing.result`.
- `rid` is Vercel's request id. **Every line caused by one request carries it,
  including the confirmation email sent after the response**, so searching for
  one `rid` shows the whole story.
- Page views and the data routes (food, workouts, import, settings) are not
  logged here; Request Logs already cover them. Only auth, errors and startup are.

## What is never logged

Passwords, confirmation codes, tokens, cookies, hashes, connection strings and
IP addresses (Request Logs already have the IP; use `rid` to link). Email
addresses are masked (`ada@gmail.com` → `a***@gmail.com`, domain kept so typos
show). This is enforced in `lib/server/log.ts` for every value, including text
inside error messages, and covered by tests. The one exception is `messageId`
(an SMTP Message-ID), which is a technical id you can search for in the mailbox.

## Levels

| Level | Meaning | Shown by default |
|---|---|---|
| `error` | Something broke and needs attention (email not sent, uncaught server error, bad config) | yes |
| `warn` | Refused or suspicious: wrong password or code, rate limits, reused refresh token | yes |
| `info` | Normal milestones: sign-up, code issued and sent, sign-in, token rotated | yes |
| `debug` | Routine noise: forged or expired cookies, parallel refreshes, rejected input | no |

Set `LOG_LEVEL` to `debug`, `info` (default), `warn`, `error` or `silent`.
Change it in Vercel's environment variables; it applies on the next deployment.

## Events

**Startup** (once per cold start)

| Event | Fields |
|---|---|
| `server.start` | `env`, `vercelEnv`, `region`, `logLevel`, and yes/no for `jwtSecretOk`, `smtpConfigured`, `appOriginSet`, `trustProxy` |
| `server.config` (error) | `problem`: the secret is missing or short, or SMTP is not set in production |
| `server.error` (error) | `method`, `path`, `routePath`, `routeType`, `digest`, `err`, `msg`, `stack`: any uncaught server error |
| `background.failed` (error) | work that ran after a response threw |

**Sign-up and confirmation code**

| Event | Level | Fields |
|---|---|---|
| `auth.register.accepted` | info | `email`, `codeJustSent` (a code went out within the last minute, so none is sent now). The reply has been sent |
| `auth.register.code_reused` | info | `ownerId`, `email`: the earlier, still-valid code was kept instead of sending another |
| `auth.register.outcome` | info | `outcome`: `created`, `password_replaced` (unconfirmed address signed up again), `already_confirmed`, `race_lost`; `ownerId` |
| `auth.register.rate_limited` | warn | `email`, `retryAfter` (s), `limitedBy` (`code-send` 3 per 15 min, `code-ip` per client). A sign-up inside the 60 s gap is not refused; see `codeJustSent` above |
| `auth.register.rejected` | debug / warn | `reason`: `invalid_email`, `password_rules`; `cross_origin` is warn |
| `auth.resend.accepted` / `.outcome` / `.rate_limited` | info / warn | like sign-up; `outcome`: `sending`, `already_confirmed`, `unknown_email` |
| `auth.otp.issued` | info | `ownerId`, `email`, `expiresInSec` |
| `auth.mail.sent` | info | `kind` (`otp`, `account_exists`), `email`, `ms` (SMTP time), `messageId` |
| `auth.mail.failed` | **error** | `kind`, `email`, `ms`, `err`, `code` (SMTP error code), `msg` |
| `auth.otp.confirmed` | info | `ownerId`, `email`: the address is confirmed and the person is signed in |
| `auth.otp.rejected` | warn | `reason`: `wrong` (with `attemptsUsed`), `burned` (5 wrong guesses), `expired`, `no_code`, `unknown_email`, `already_confirmed`. The person sees one generic message for all |
| `auth.otp.rate_limited` | warn | `email`, `retryAfter`, `limitedBy` |

**Sign-in and tokens**

| Event | Level | Fields |
|---|---|---|
| `auth.login.ok` | info | `ownerId`, `email` |
| `auth.login.failed` | warn | `reason`: `bad_password` or `unknown_email` (the person sees one generic message for both), `ownerId` |
| `auth.login.unconfirmed` | info | `ownerId`, `email`, `codeSent`, `retryAfter` |
| `auth.login.rate_limited` | warn | `email`, `retryAfter`, `limitedBy` (`ip`, `email`) |
| `auth.logout` | info | `ownerId`, `tokensDeleted`, or `signedIn: false` |
| `auth.refresh.rotated` | info | `ownerId`, `familyId`, `via` (`api` or `page`) |
| `auth.refresh.reuse_detected` | **warn** | `ownerId`, `familyId`, `sinceRotationSec`, `tokensDeleted`: a spent refresh token came back after the 10 s grace. Either a lost response (the person is signed out) or a stolen copy |
| `auth.refresh.expired` | info | `ownerId` |
| `auth.refresh.rejected` | debug / warn | `reason`: `unknown_token`, `malformed`, `missing`; `unconfirmed_owner` is warn |
| `auth.refresh.grace` | debug | a parallel request inside the grace window |
| `auth.session.rejected` | debug | a request with no valid sign-in |

**Housekeeping**

| Event | Fields |
|---|---|
| `auth.cleanup` (info, only when something was removed) | `attempts`, `refreshTokens` |
| `auth.cleanup.unconfirmed_accounts` (info) | `deleted`, `olderThanHours` |

## Debugging recipes

- **"I never got my code."** Search the address as `a***@domain.com` (or the
  `ownerId`). Look for `auth.otp.issued` then `auth.mail.sent` (note `ms` and
  `messageId`; search the Gmail Sent folder for that Message-ID). A
  `auth.mail.failed` shows the SMTP error. If neither exists, look for
  `auth.register.rate_limited` (`limitedBy`) or `auth.register.outcome`
  (`already_confirmed` means they got the "you already have an account" email).
- **"My code doesn't work."** `auth.otp.rejected` with `reason`: `expired` (older
  than 10 minutes), `burned` (5 wrong guesses), `wrong`, or `no_code` (a newer
  code replaced it, or the 24 h cleanup removed the account).
- **"I keep getting signed out."** Look for `auth.refresh.reuse_detected` for
  their `ownerId`.
- **Everything is failing after a deploy.** Find the latest `server.start`: are
  `jwtSecretOk` and `smtpConfigured` true? Then `server.config` and `server.error`.
- **Following one request.** Copy its `rid` into the search box.

## Retention

Vercel keeps runtime logs only for a short time (about 1 hour on the Hobby plan;
longer on paid plans), so look soon after an issue, or set up a log drain.
There is deliberately no database audit table.

## For developers

`lib/server/log.ts`: `log` (root), `requestLogger(req)` (adds `rid`, method,
path), `maskEmail`, `errorFields`. Pass the request's logger into background work
(`inBackground(work, log)`). Never log a password, code or token; the redaction is
a safety net, not permission. Tests capture entries through `setLogSink`
(`tests/helpers/logs.ts`); `tests/logging.test.ts` covers the logger and every
event above.
