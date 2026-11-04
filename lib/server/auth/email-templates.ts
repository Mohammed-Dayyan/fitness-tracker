// Email bodies. Pure functions (no I/O) so they can be tested and previewed.
//
// Email clients run no JavaScript and block most CSS, so this is old-school on
// purpose: tables, inline styles, system fonts, no images (many clients hide
// them by default), and the brand's day ring drawn with a bordered circle. The
// code is one unbroken run of digits (spacing is CSS letter-spacing), so
// double-clicking or long-pressing it copies exactly the six digits.

const C = {
  paper: "#f6f1ea",
  surface: "#fffdf9",
  hero: "#1e1915",
  heroInk: "#f6efe8",
  heroInk2: "#c9bfb4",
  ink: "#1e1915",
  ink2: "#4a423a",
  muted: "#675d53",
  line: "#e6dfd3",
  accent: "#e2542a",
  track: "#4a423a",
};

const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const MONO = `'SF Mono',SFMono-Regular,ui-monospace,Menlo,Consolas,'Liberation Mono',monospace`;

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export type RenderedEmail = { subject: string; text: string; html: string };

/** The brand's day ring: a bordered circle with a gap, plus the centre dot. */
const RING = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="30" height="30" style="width:30px;height:30px;border-radius:19px;border:4px solid ${C.accent};border-top-color:${C.track};border-right-color:${C.accent};border-bottom-color:${C.accent};border-left-color:${C.accent};font-size:0;line-height:0;text-align:center;vertical-align:middle">
<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${C.accent};font-size:0;line-height:0">&nbsp;</span></td></tr></table>`;

function layout(opts: { preheader: string; title: string; body: string; footer: string }): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:${C.paper};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.paper};font-size:1px;line-height:1px">${escapeHtml(opts.preheader)}${"&nbsp;&zwnj;".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">
<tr><td style="background:${C.hero};border-radius:18px 18px 0 0;padding:22px 28px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle">${RING}</td>
<td style="vertical-align:middle;padding-left:12px;font-family:${SANS};font-size:18px;font-weight:700;letter-spacing:-0.2px;color:${C.heroInk}">Fitness Tracker</td>
</tr></table>
<p style="margin:14px 0 0;font-family:${SANS};font-size:13px;line-height:1.5;color:${C.heroInk2}">See where the day stands before it&#39;s over.</p>
</td></tr>
<tr><td style="background:${C.surface};border:1px solid ${C.line};border-top:0;border-radius:0 0 18px 18px;padding:32px 28px 28px;font-family:${SANS};color:${C.ink}">
${opts.body}
</td></tr>
<tr><td style="padding:18px 8px 0;text-align:center;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted}">${opts.footer}</td></tr>
</table></td></tr></table></body></html>`;
}

export function renderOtpEmail(opts: { code: string; ttlMinutes: number }): RenderedEmail {
  const code = escapeHtml(opts.code);
  const minutes = `${opts.ttlMinutes} minutes`;
  const body = `
<h1 style="margin:0;font-family:${SANS};font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.3px;color:${C.ink}">Confirm your email</h1>
<p style="margin:10px 0 24px;font-size:15px;line-height:1.6;color:${C.ink2}">Enter this code to finish creating your account.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" style="background:${C.paper};border:1px solid ${C.line};border-radius:14px;padding:20px 8px">
<div style="font-family:${MONO};font-size:40px;line-height:1.1;font-weight:700;color:${C.ink};letter-spacing:12px;padding-left:12px;-webkit-user-select:all;user-select:all">${code}</div>
</td></tr></table>
<p style="margin:12px 0 0;text-align:center;font-size:13px;line-height:1.5;color:${C.muted}">Double-click or press and hold the code to copy it.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:22px auto 0"><tr>
<td style="background:${C.paper};border-radius:999px;padding:7px 14px;font-size:13px;font-weight:600;color:${C.ink2}">Expires in ${minutes}</td>
</tr></table>
<hr style="border:0;border-top:1px solid ${C.line};margin:28px 0 20px">
<p style="margin:0;font-size:13px;line-height:1.6;color:${C.muted}">Didn&#39;t sign up? Ignore this email. Nothing happens unless the code is entered, and an unconfirmed sign-up is removed on its own after a day. Never share this code with anyone.</p>`;
  return {
    subject: `${opts.code} is your Fitness Tracker confirmation code`,
    text: [
      "Fitness Tracker",
      "",
      "Confirm your email",
      "Your confirmation code is:",
      "",
      opts.code,
      "",
      `It expires in ${minutes}.`,
      "",
      "Didn't sign up? Ignore this email. Nothing happens unless the code is entered, and an unconfirmed sign-up is removed on its own after a day. Never share this code with anyone.",
    ].join("\n"),
    html: layout({
      preheader: `Your code is ${opts.code}. It expires in ${minutes}.`,
      title: "Confirm your email",
      body,
      footer: "Sent by Fitness Tracker because this address was used to sign up.<br>If that wasn&#39;t you, no action is needed.",
    }),
  };
}

export function renderAccountExistsEmail(): RenderedEmail {
  const body = `
<h1 style="margin:0;font-family:${SANS};font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.3px;color:${C.ink}">You already have an account</h1>
<p style="margin:10px 0 0;font-size:15px;line-height:1.6;color:${C.ink2}">Someone, hopefully you, tried to sign up with this address, but it already has a Fitness Tracker account. Nothing was changed.</p>
<p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:${C.ink2}">Just sign in with your email and password instead.</p>
<hr style="border:0;border-top:1px solid ${C.line};margin:28px 0 20px">
<p style="margin:0;font-size:13px;line-height:1.6;color:${C.muted}">Wasn&#39;t you? You can ignore this email. Your account and password are untouched.</p>`;
  return {
    subject: "You already have a Fitness Tracker account",
    text: [
      "Fitness Tracker",
      "",
      "You already have an account",
      "Someone, hopefully you, tried to sign up with this address, but it already has a Fitness Tracker account. Nothing was changed.",
      "",
      "Just sign in with your email and password instead.",
      "",
      "Wasn't you? You can ignore this email. Your account and password are untouched.",
    ].join("\n"),
    html: layout({
      preheader: "Someone tried to sign up with this address. Nothing was changed.",
      title: "You already have an account",
      body,
      footer: "Sent by Fitness Tracker because this address was used to sign up.",
    }),
  };
}
