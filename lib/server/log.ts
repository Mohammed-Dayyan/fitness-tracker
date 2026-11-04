import "server-only";

/**
 * Structured logging: one JSON line per event, through console.log / warn /
 * error. That is deliberate: Vercel (and most hosts) derive the Info / Warning /
 * Error level from which console method was called, so the level filters work.
 *
 *   {"ts":"2026-11-04T12:24:46.390Z","level":"info","event":"auth.login.ok","rid":"k2x9f","ownerId":"…","email":"a***@gmail.com"}
 *
 * Rules (enforced here, not left to callers):
 *  - email addresses are masked wherever they appear, even inside error text;
 *  - secrets (passwords, tokens, cookies, hashes, connection strings, JWTs) are
 *    redacted by key name and by shape;
 *  - strings and nesting are capped, so one bad value cannot flood the log.
 * LOG_LEVEL = debug | info (default) | warn | error | silent.
 */

export type Level = "debug" | "info" | "warn" | "error";
export type Fields = Record<string, unknown>;
export type LogEntry = { ts: string; level: Level; event: string } & Fields;

export interface Logger {
  debug(event: string, fields?: Fields): void;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
  /** A logger that adds these fields to every line (e.g. the request id). */
  child(fields: Fields): Logger;
}

const RANK: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function threshold(): number {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return raw in RANK ? RANK[raw as keyof typeof RANK] : RANK.info;
}

// ---------- redaction ----------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const DB_URL_RE = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/\S+/gi;
const SECRET_KEY_RE = /^(pass(word)?|passwd|secret|token|otp|cookie|set-cookie|authorization|auth|.*hash|.*token|.*secret|.*password)$/i;
/** Fields that are identifiers, not people: a Message-ID looks like an address but must stay searchable. */
const VERBATIM_KEYS = new Set(["messageId"]);
const MAX_STRING = 300;
const MAX_DEPTH = 3;

/** `ada@gmail.com` → `a***@gmail.com`. The domain stays: it exposes typos like gmial.com. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "[invalid-email]";
  return `${email[0]}***${email.slice(at)}`;
}

function scrubString(s: string): string {
  const out = s
    .replace(DB_URL_RE, "[redacted-url]")
    .replace(JWT_RE, "[redacted-jwt]")
    .replace(EMAIL_RE, (m) => maskEmail(m));
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…` : out;
}

function scrub(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return scrubString(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return errorFields(value);
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    const out: Fields = {};
    for (const [k, v] of Object.entries(value as Fields).slice(0, 30)) {
      out[k] = SECRET_KEY_RE.test(k)
        ? "[redacted]"
        : VERBATIM_KEYS.has(k) && typeof v === "string"
          ? v.slice(0, 200)
          : scrub(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** A safe summary of an error: its name, code and (scrubbed) message. No stack unless asked. */
export function errorFields(e: unknown, opts: { stack?: boolean } = {}): Fields {
  if (!(e instanceof Error)) return { err: "NonError", msg: scrubString(String(e)) };
  const code = (e as { code?: unknown }).code;
  const out: Fields = { err: e.name, msg: scrubString(e.message) };
  if (typeof code === "string" || typeof code === "number") out.code = code;
  if (opts.stack && e.stack) out.stack = scrubString(e.stack.split("\n").slice(1, 7).join(" | "));
  return out;
}

// ---------- output ----------

type Sink = (entry: LogEntry) => void;

const consoleSink: Sink = (entry) => {
  const line = JSON.stringify(entry);
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.log(line);
};

let sink: Sink = consoleSink;

/** For tests: capture entries instead of printing them. Pass null to restore console output. */
export function setLogSink(next: Sink | null): void {
  sink = next ?? consoleSink;
}

function make(base: Fields): Logger {
  const emit = (level: Level, event: string, fields?: Fields) => {
    if (RANK[level] < threshold()) return;
    const body = scrub({ ...base, ...fields }) as Fields;
    // ts / level / event come first and can never be overwritten by a field.
    delete body.ts;
    delete body.level;
    delete body.event;
    sink({ ts: new Date().toISOString(), level, event, ...body });
  };
  return {
    debug: (e, f) => emit("debug", e, f),
    info: (e, f) => emit("info", e, f),
    warn: (e, f) => emit("warn", e, f),
    error: (e, f) => emit("error", e, f),
    child: (fields) => make({ ...base, ...fields }),
  };
}

export const log: Logger = make({});

/**
 * A logger tagged with the request id (Vercel's, or a short random one), so every
 * line of one request, including work that continues after the response (the
 * confirmation email), can be found with a single search.
 */
export function requestLogger(req: Request): Logger {
  const vercelId = req.headers.get("x-vercel-id");
  const rid = vercelId?.split("::").at(-1)?.slice(0, 24) ?? req.headers.get("x-request-id")?.slice(0, 24) ?? crypto.randomUUID().slice(0, 8);
  let path = "";
  try {
    path = new URL(req.url).pathname;
  } catch {
    /* keep empty */
  }
  return log.child({ rid, method: req.method, path });
}
