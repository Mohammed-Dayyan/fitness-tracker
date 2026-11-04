import "server-only";
import { sendAccountExistsEmail, sendOtpEmail } from "@/lib/server/auth/mailer";
import { issueOtp, OTP_TTL_MS } from "@/lib/server/auth/otp";
import { errorFields, type Logger } from "@/lib/server/log";

type Kind = "otp" | "account_exists";

/** Sends one email, logging how long it took and whether the SMTP server accepted it. Never throws. */
async function deliver(log: Logger, kind: Kind, email: string, send: () => Promise<{ messageId?: string } | void>): Promise<boolean> {
  const started = Date.now();
  try {
    const result = await send();
    log.info("auth.mail.sent", { kind, email, ms: Date.now() - started, messageId: result?.messageId });
    return true;
  } catch (e) {
    log.error("auth.mail.failed", { kind, email, ms: Date.now() - started, ...errorFields(e) });
    return false;
  }
}

/**
 * Creates a fresh confirmation code for the owner (replacing any earlier one)
 * and emails it. Runs in the background after the response, so every step is
 * logged with the request id of the call that started it.
 */
export async function sendConfirmationCode(log: Logger, owner: { id: string; email: string }): Promise<boolean> {
  const code = await issueOtp(owner.id);
  log.info("auth.otp.issued", { ownerId: owner.id, email: owner.email, expiresInSec: OTP_TTL_MS / 1000 });
  return deliver(log, "otp", owner.email, () => sendOtpEmail(owner.email, code));
}

/** Tells the holder of a confirmed account that someone tried to sign up with their address. */
export function sendAccountExistsNotice(log: Logger, email: string): Promise<boolean> {
  return deliver(log, "account_exists", email, () => sendAccountExistsEmail(email));
}
