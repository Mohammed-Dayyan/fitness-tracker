import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readOtp } from "../helpers/otp";
import { CHROME, chromeAvailable, startServer } from "./server";

let browser: Browser;
let server: Awaited<ReturnType<typeof startServer>>;
const PASSWORD = "a long enough password";

const newContext = (): Promise<BrowserContext> =>
  browser.newContext({ viewport: { width: 1100, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });

/** Fills the sign-up form and waits for the code screen. */
async function signUp(page: Page, email: string) {
  await page.goto(`${server.url}/register`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.fill("#confirm", PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.locator("#otp").waitFor({ timeout: 10_000 });
}

/** Waits for the code field to hold focus (React applies it just after the screen appears). */
const expectCodeFieldFocused = (page: Page) => page.waitForFunction(() => document.activeElement?.id === "otp", undefined, { timeout: 4000 });

describe.skipIf(!chromeAvailable)("the code screen, in a real browser", () => {
  beforeAll(async () => {
    server = await startServer(3260);
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    server?.stop();
  });

  it("keeps the field focused after a wrong code, so the next digits can be typed straight away", async () => {
    const page = await (await newContext()).newPage();
    await signUp(page, "focus@example.com");
    await expectCodeFieldFocused(page);

    await page.keyboard.type("000000");
    await page.getByText(/incorrect or has expired/i).waitFor();
    await expectCodeFieldFocused(page); // used to fall to <body>, so the next digits went nowhere

    // No click: type the right code and get signed in.
    await page.keyboard.type(await readOtp("focus@example.com"));
    await page.waitForURL(`${server.url}/`);
  });

  it("accepts a pasted code that has a space or dash in it", async () => {
    const ctx = await newContext();
    const page = await ctx.newPage();
    await signUp(page, "paste@example.com");
    const code = await readOtp("paste@example.com");
    await page.evaluate((t) => navigator.clipboard.writeText(t), `${code.slice(0, 3)} ${code.slice(3)}`);
    await page.locator("#otp").click();
    await page.keyboard.press("Control+V");
    await page.waitForURL(`${server.url}/`); // all six digits arrived and it submitted itself
  });

  it("pasting a run of digits with dashes and text around them also works", async () => {
    const page = await (await newContext()).newPage();
    await signUp(page, "paste2@example.com");
    const code = await readOtp("paste2@example.com");
    await page.evaluate((t) => navigator.clipboard.writeText(t), `Code: ${code.slice(0, 3)}-${code.slice(3)}`);
    await page.locator("#otp").click();
    await page.keyboard.press("Control+V");
    await page.waitForURL(`${server.url}/`);
  });

  it("lets the person go back and fix a mistyped address", async () => {
    const page = await (await newContext()).newPage();
    await signUp(page, "typo@gmial.com");
    await page.getByText("Step 2 of 2").waitFor({ state: "visible", timeout: 5000 });
    await page.getByRole("button", { name: /wrong email/i }).click();

    await page.getByText("Step 1 of 2").waitFor({ state: "visible", timeout: 5000 });
    expect(await page.inputValue("#email")).toBe("typo@gmial.com"); // nothing to retype
    expect(await page.inputValue("#password")).toBe(PASSWORD);
    await page.fill("#email", "typo@gmail.com");
    await page.getByRole("button", { name: /create account/i }).click();
    await page.locator("#otp").waitFor();
    await page.getByText("typo@gmail.com", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
    await page.keyboard.type(await readOtp("typo@gmail.com"));
    await page.waitForURL(`${server.url}/`);
  });

  it("sign-in then 'Create an account' for the same unconfirmed address shows the code screen, not an error", async () => {
    // Someone signed up earlier and never confirmed.
    const first = await (await newContext()).newPage();
    await signUp(first, "again@example.com");
    await readOtp("again@example.com");
    await first.context().close();

    // They try to sign in: the code screen, with a code that was just sent.
    const page = await (await newContext()).newPage();
    await page.goto(`${server.url}/login`, { waitUntil: "networkidle" });
    await page.fill("#email", "again@example.com");
    await page.fill("#password", PASSWORD);
    await page.click("button[type=submit]");
    await page.locator("#otp").waitFor();
    await page.getByText(/Code expires in/).waitFor({ state: "visible", timeout: 5000 });

    // "Back to sign in" works, and so does going to Create an account straight away.
    await page.getByRole("button", { name: /back to sign in/i }).click();
    await page.getByRole("heading", { name: "Welcome back" }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByRole("link", { name: "Create an account" }).click();
    await page.waitForURL(`${server.url}/register`);
    await page.fill("#email", "again@example.com");
    await page.fill("#password", PASSWORD);
    await page.fill("#confirm", PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();

    await page.locator("#otp").waitFor({ timeout: 10_000 });
    await page.getByText(/A code was sent a moment ago/).waitFor({ state: "visible", timeout: 5000 });
    expect(await page.getByText(/wait before asking/i).count()).toBe(0); // no error
    await page.keyboard.type(await readOtp("again@example.com"));
    await page.waitForURL(`${server.url}/`);
  });
});
