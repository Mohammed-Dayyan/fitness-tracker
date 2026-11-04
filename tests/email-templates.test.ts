import { describe, expect, it } from "vitest";
import { escapeHtml, renderAccountExistsEmail, renderOtpEmail } from "@/lib/server/auth/email-templates";

describe("confirmation code email", () => {
  const mail = renderOtpEmail({ code: "268571", ttlMinutes: 10 });

  it("puts the code in the subject, so it shows in notifications", () => {
    expect(mail.subject).toBe("268571 is your Fitness Tracker confirmation code");
  });

  it("shows the code as one unbroken run of digits, so double-click or long-press copies exactly it", () => {
    // Spacing is CSS letter-spacing, never separate elements or spaces inside the digits.
    const block = /<div[^>]*letter-spacing:12px[^>]*>(\d+)<\/div>/.exec(mail.html);
    expect(block?.[1]).toBe("268571");
    expect(mail.html).toContain("user-select:all");
    expect(mail.html.match(/268571/g)!.length).toBe(2); // the code block and the preview text
  });

  it("has a preview line, the expiry, and a plain-text version with the same facts", () => {
    expect(mail.html).toContain("Your code is 268571. It expires in 10 minutes.");
    expect(mail.html).toContain("Expires in 10 minutes");
    expect(mail.text).toContain("268571");
    expect(mail.text).toContain("expires in 10 minutes");
    expect(mail.text).not.toMatch(/<[a-z]/i);
  });

  it("is email-safe: no scripts, no remote images, no external styles", () => {
    expect(mail.html).not.toMatch(/<script|<link|<img|<iframe|@import|url\(/i);
    expect(mail.html).toMatch(/^<!DOCTYPE html>/);
  });

  it("escapes anything it is given", () => {
    const evil = renderOtpEmail({ code: `<b>"x"</b>`, ttlMinutes: 10 });
    expect(evil.html).not.toContain("<b>");
    expect(escapeHtml(`a&b<c>"d"'e'`)).toBe("a&#38;b&#60;c&#62;&#34;d&#34;&#39;e&#39;");
  });

  it("does not link anywhere: a link into the app could not continue the sign-up and could invalidate the code", () => {
    expect(mail.html).not.toMatch(/<a\s/i);
  });
});

describe("account-exists email", () => {
  const mail = renderAccountExistsEmail();

  it("says nothing was changed and carries no code", () => {
    expect(mail.subject).toBe("You already have a Fitness Tracker account");
    expect(mail.html).toContain("Nothing was changed");
    expect(mail.text).toContain("Nothing was changed");
    expect(mail.html).not.toMatch(/\d{6}/);
  });

  it("is email-safe", () => {
    expect(mail.html).not.toMatch(/<script|<link|<img|<iframe|@import|url\(/i);
  });
});
