/** Mail captured by the mocked mailer (see setup.ts). */
export type SentMail = { kind: "otp"; to: string; code: string } | { kind: "exists"; to: string };
export const sentMail: SentMail[] = [];
/** Milliseconds the fake SMTP server takes to accept a message. */
export const mailControl = { delayMs: 0 };

/** The latest 6-digit code sent to an address. */
export function lastCode(to: string): string {
  const mail = [...sentMail].reverse().find((m): m is Extract<SentMail, { kind: "otp" }> => m.kind === "otp" && m.to === to);
  if (!mail) throw new Error(`no code was sent to ${to}`);
  return mail.code;
}
