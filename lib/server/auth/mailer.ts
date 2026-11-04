import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { renderAccountExistsEmail, renderOtpEmail } from "@/lib/server/auth/email-templates";
import { OTP_TTL_MS } from "@/lib/server/auth/otp";

/**
 * SMTP delivery (Gmail by default: use an App Password, not the account
 * password). Without SMTP_USER/SMTP_PASSWORD, development and tests print the
 * message to the server console instead; production refuses to start sending.
 */
function configured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

let transport: Transporter | undefined;
function getTransport() {
  const port = Number(process.env.SMTP_PORT ?? 465);
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    // A stalled SMTP server must not pin a connection (or a serverless
    // invocation) for minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transport;
}

/** What the SMTP server told us; the message id is what to look for in the mailbox's Sent folder. */
export type SendResult = { messageId?: string } | void;

export async function sendMail(message: { to: string; subject: string; text: string; html: string }): Promise<SendResult> {
  if (!configured()) {
    if (process.env.NODE_ENV === "production") throw new Error("SMTP_USER and SMTP_PASSWORD must be set to send email.");
    // Development only: this is how you read the code without SMTP. Never runs in production.
    console.log(`[mail:dev] to=${message.to} subject=${message.subject}\n${message.text}`);
    return;
  }
  const info = await getTransport().sendMail({
    from: process.env.MAIL_FROM ?? `Fitness Tracker <${process.env.SMTP_USER}>`,
    ...message,
  });
  return { messageId: info.messageId };
}

export const smtpConfigured = configured;

export function sendOtpEmail(to: string, code: string): Promise<SendResult> {
  return sendMail({ to, ...renderOtpEmail({ code, ttlMinutes: OTP_TTL_MS / 60_000 }) });
}

/** Sent instead of a code when someone signs up with an address that already has an account. */
export function sendAccountExistsEmail(to: string): Promise<SendResult> {
  return sendMail({ to, ...renderAccountExistsEmail() });
}
