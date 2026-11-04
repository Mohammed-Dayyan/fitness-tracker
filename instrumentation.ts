import type { Instrumentation } from "next";

/**
 * Runs once per server start (a cold start on Vercel). Logs the settings that
 * most often explain "it works locally but not in production", as yes/no only:
 * no secret values are ever printed.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { log } = await import("@/lib/server/log");
  const { smtpConfigured } = await import("@/lib/server/auth/mailer");
  const secret = process.env.JWT_ACCESS_SECRET ?? "";
  const production = process.env.NODE_ENV === "production";
  log.info("server.start", {
    env: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    region: process.env.VERCEL_REGION,
    logLevel: process.env.LOG_LEVEL ?? "info",
    jwtSecretOk: secret.length >= 32,
    smtpConfigured: smtpConfigured(),
    appOriginSet: Boolean(process.env.APP_ORIGIN),
    trustProxy: process.env.TRUST_PROXY === "true",
  });
  if (secret.length < 32) log.error("server.config", { problem: "JWT_ACCESS_SECRET is missing or shorter than 32 characters: sign-in will fail" });
  if (production && !smtpConfigured()) log.error("server.config", { problem: "SMTP_USER / SMTP_PASSWORD are not set: confirmation emails cannot be sent" });
}

/** Any uncaught server error (a route handler throwing, a render failing), with where it happened. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { log, errorFields } = await import("@/lib/server/log");
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  log.error("server.error", {
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    digest,
    ...errorFields(err, { stack: true }),
  });
};
