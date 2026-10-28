import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/server/db";
import { addDays, msUntilNextDay, todayInTimeZone } from "@/lib/shared/dates";
import { COPY_FAILED_MESSAGE } from "@/lib/client/clipboard";
import { createOwner, importOk, PASSWORD } from "../helpers/factory";
import { CHROME, chromeAvailable, fakeClockPreload, startServer } from "./server";

const TZ = "Asia/Kolkata";
let browser: Browser;
let server: Awaited<ReturnType<typeof startServer>>;

/** A context whose clipboard we control: set window.__clipMode to "deny" to make copying fail everywhere. */
async function newContext(opts: { locale?: string } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ locale: opts.locale ?? "en-US", viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    const w = window as unknown as { __clipMode: string; __copied?: string };
    w.__clipMode = "ok";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (w.__clipMode === "deny") throw new Error("denied");
          w.__copied = text;
        },
      },
    });
    document.execCommand = () => w.__clipMode !== "deny";
  });
  return ctx;
}

async function signIn(page: Page, base = server.url) {
  await page.goto(`${base}/login`);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${base}/`);
}

async function ready(page: Page) {
  await page.waitForLoadState("networkidle");
}

describe.skipIf(!chromeAvailable)("audit fixes in a real browser", () => {
  beforeAll(async () => {
    server = await startServer(3220);
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    server?.stop();
  });

  const today = () => todayInTimeZone(TZ);

  it("audit #2: typing a date into the picker never navigates to an invalid year", async () => {
    await createOwner();
    const ctx = await newContext();
    const page = await ctx.newPage();
    await signIn(page);
    const visited: string[] = [];
    page.on("framenavigated", (f) => f === page.mainFrame() && visited.push(new URL(f.url()).search));

    // Click the left edge so the month segment has focus, then type mm dd yyyy one digit at a time.
    await page.locator("#date-picker:visible").click({ position: { x: 14, y: 12 } });
    await page.keyboard.type("10202025", { delay: 120 });
    await page.locator('[data-testid="day-heading"][data-date="2025-10-20"]:visible').waitFor({ timeout: 10_000 });

    // Every navigation that happened was to a real date (never 0001-… 0202-…).
    expect(visited.filter((q) => q.includes("date=")).every((q) => /date=(19|20|21|22)\d\d-/.test(q))).toBe(true);
    expect(await page.locator("#date-picker:visible").inputValue()).toBe("2025-10-20");
    expect(await page.locator('[data-testid="day-kicker"]:visible').textContent()).toBe("Past day");
    await ctx.close();
  });

  it("audit #14: a signed-in user visiting /login goes to the app; a forged or expired cookie does not", async () => {
    await createOwner();
    const ctx = await newContext();
    const page = await ctx.newPage();
    await signIn(page);

    await page.goto(`${server.url}/login`);
    await page.waitForURL(`${server.url}/`);
    await page.goto(`${server.url}/login?next=%2Fhistory`);
    await page.waitForURL(`${server.url}/history`);
    await page.goto(`${server.url}/login?next=//evil.example`);
    await page.waitForURL(`${server.url}/`); // unsafe destinations fall back to the app home

    // Expire the session server-side: the same cookie no longer counts.
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await page.goto(`${server.url}/login`);
    await ready(page);
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe("/login");
    await page.locator("#password").waitFor();

    // A forged cookie value is not a session either.
    const name = (await ctx.cookies()).find((c) => c.name.endsWith("ft_session"))!.name;
    await ctx.clearCookies();
    await ctx.addCookies([{ name, value: "forged-value", domain: "localhost", path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
    await page.goto(`${server.url}/login`);
    await ready(page);
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe("/login");
    await ctx.close();
  });

  it("audit #24: a forged session cookie is never given a fresh expiry", async () => {
    await createOwner();
    const ctx = await newContext();
    const page = await ctx.newPage();
    await page.goto(`${server.url}/login`);
    const soon = Math.floor(Date.now() / 1000) + 3600;
    await ctx.addCookies([{ name: "__Host-ft_session", value: "forged-value", domain: "localhost", path: "/", httpOnly: true, secure: true, sameSite: "Lax", expires: soon }]);
    for (const path of ["/", "/history", "/trends"]) {
      await page.goto(`${server.url}${path}`);
      await ready(page);
    }
    const cookie = (await ctx.cookies()).find((c) => c.name === "__Host-ft_session");
    // Unchanged: still ~1 hour out, not renewed to 30 days.
    expect(cookie ? cookie.expires : soon).toBeLessThan(soon + 120);
    await ctx.close();
  });

  it("audit #24: a live session's cookie expiry is kept in step (extended on page loads)", async () => {
    await createOwner();
    const ctx = await newContext();
    const page = await ctx.newPage();
    await signIn(page);
    const first = (await ctx.cookies()).find((c) => c.name.endsWith("ft_session"))!;
    // Pretend the cookie is nearly expired (the server-side session is still fine).
    await ctx.addCookies([
      { name: first.name, value: first.value, domain: first.domain, path: first.path, httpOnly: first.httpOnly, secure: first.secure, sameSite: first.sameSite, expires: Math.floor(Date.now() / 1000) + 3600 },
    ]);
    await page.goto(`${server.url}/history`);
    await ready(page);
    await page.waitForTimeout(800);
    const renewed = (await ctx.cookies()).find((c) => c.name.endsWith("ft_session"))!;
    expect(renewed.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 86_400);
    await ctx.close();
  });

  it("audit #16: copy failures are reported, and 'Copied' only appears when copying worked", async () => {
    await createOwner();
    const ctx = await newContext();
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${server.url}/data`);
    await ready(page);

    // 1. Copy context.
    await page.evaluate(() => ((window as unknown as { __clipMode: string }).__clipMode = "deny"));
    await page.getByRole("button", { name: "Copy context" }).click();
    await page.getByText(COPY_FAILED_MESSAGE).waitFor();
    expect(await page.getByRole("button", { name: "Copy context" }).isVisible()).toBe(true); // never flipped to "Copied"
    await page.evaluate(() => ((window as unknown as { __clipMode: string }).__clipMode = "ok"));
    await page.getByRole("button", { name: "Copy context" }).click();
    await page.getByRole("button", { name: "Copied" }).waitFor();

    // 2. Copy the IDs of a freshly imported record.
    await page.locator("#import-json").fill(JSON.stringify({ schema_version: "1.0", date: today(), food_entries: [{ name: "Apple" }] }));
    await page.getByRole("button", { name: "Validate & preview" }).click();
    await page.getByRole("button", { name: /Confirm import/ }).click();
    await page.getByText("Import applied").waitFor();
    await page.evaluate(() => ((window as unknown as { __clipMode: string }).__clipMode = "deny"));
    await page.getByRole("button", { name: "Copy IDs for ChatGPT" }).click();
    await page.getByText(COPY_FAILED_MESSAGE).last().waitFor();
    expect(await page.getByRole("button", { name: "Copy IDs for ChatGPT" }).isVisible()).toBe(true); // never flipped to "Copied"
    await page.evaluate(() => ((window as unknown as { __clipMode: string }).__clipMode = "ok"));
    await page.getByRole("button", { name: "Copy IDs for ChatGPT" }).click();
    // Scoped to the Import card: "Copy context" can still be showing "Copied" from a moment ago.
    const importCard = page.locator("section", { has: page.getByRole("heading", { name: "Import", exact: true }) });
    await importCard.getByRole("button", { name: "Copied" }).waitFor();
    expect(JSON.parse(await page.evaluate(() => (window as unknown as { __copied: string }).__copied))).toHaveProperty("assigned_ids");
    await ctx.close();
  });

  it("audit #17: choosing the same import file twice works both times", async () => {
    await createOwner();
    const file = join(tmpdir(), `import-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify({ schema_version: "1.0", date: today(), food_entries: [{ name: "From file" }] }));
    const ctx = await newContext();
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${server.url}/data`);
    await ready(page);

    await page.locator('input[type="file"]').setInputFiles(file);
    await expect.poll(() => page.locator("#import-json").inputValue()).toContain("From file");
    await page.locator("#import-json").fill(""); // discard it...
    await page.locator('input[type="file"]').setInputFiles(file); // ...and choose the very same file again
    await expect.poll(() => page.locator("#import-json").inputValue()).toContain("From file");
    await ctx.close();
  });

  it("audit #22: the month export works through selects (no <input type=month>)", async () => {
    await createOwner();
    const ctx = await newContext();
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${server.url}/data`);
    await ready(page);
    expect(await page.locator('input[type="month"]').count()).toBe(0);

    const year = String(Number(today().slice(0, 4)) - 1);
    await page.selectOption("#export-month", "03");
    await page.selectOption("#export-year", year);
    await page.getByRole("button", { name: "Copy month" }).click();
    await page.getByRole("button", { name: "Copied" }).waitFor();
    const copied = JSON.parse(await page.evaluate(() => (window as unknown as { __copied: string }).__copied));
    expect(copied.export_meta).toMatchObject({ scope: "month", range: { from: `${year}-03-01`, to: `${year}-03-31` } });

    // A half-typed day disables the action instead of sending a bad request.
    await page.locator("#export-day").fill("");
    await page.waitForTimeout(100);
    expect(await page.getByRole("button", { name: "Copy day" }).isDisabled()).toBe(true);
    await ctx.close();
  });

  it("audit #9: the exercise page opens by display name, odd spacing or case", async () => {
    const owner = await createOwner();
    await importOk(owner, {
      schema_version: "1.0",
      workouts: [{ id: "w", date: addDays(today(), -1), sets: [{ id: "s", exercise: "Bench Press", set_number: 1, reps: 5, weight_kg: 80 }] }],
    });
    const ctx = await newContext();
    const page = await ctx.newPage();
    await signIn(page);
    for (const q of ["Bench%20Press", "bench%20press", "%20BENCH-press%20"]) {
      await page.goto(`${server.url}/exercises?exercise=${q}`);
      await ready(page);
      expect(await page.locator("main h1").textContent(), q).toBe("Bench Press");
    }
    await page.goto(`${server.url}/exercises?exercise=Deadlift`);
    await ready(page);
    await page.getByText("No sets found for this exercise").waitFor();
    await ctx.close();
  });

  it("audit #18: History's toggle is a plain link with no aria-pressed", async () => {
    const owner = await createOwner();
    await importOk(owner, { schema_version: "1.0", daily_activity: [{ date: today(), steps: 1000 }] });
    const ctx = await newContext();
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${server.url}/history`);
    await ready(page);
    // The page content has no aria-pressed (the theme buttons in the sidebar legitimately use it: they are buttons).
    expect(await page.locator("main [aria-pressed]").count()).toBe(0);
    const toggle = page.getByRole("link", { name: "Show all dates" });
    expect(await toggle.getAttribute("aria-pressed")).toBeNull();
    await toggle.focus();
    await page.keyboard.press("Enter"); // keyboard operable
    await page.waitForURL(/all=1/);
    await page.getByRole("link", { name: "Show logged days only" }).waitFor();
    await ctx.close();
  });

  it("audit #8: a Trends range ending in the future is cut at today, and says so", async () => {
    await createOwner();
    const ctx = await newContext();
    const page = await ctx.newPage();
    await signIn(page);
    const from = addDays(today(), -9);
    await page.goto(`${server.url}/trends?range=custom&from=${from}&to=2099-12-31`);
    await ready(page);
    await page.getByText(`Future dates are not included: the range ends today (${today()}).`).waitFor();
    expect(await page.locator("main").innerText()).toContain("· 10 days");
    await ctx.close();
  });

  it("audit #5/#6/#15: no-food days, partial nutrients and the steps message in the UI", async () => {
    const owner = await createOwner();
    const noFood = addDays(today(), -2);
    const noFiber = addDays(today(), -3);
    await importOk(owner, {
      schema_version: "1.0",
      targets: [{ effective_from: addDays(today(), -30), calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60, fiber_g: 30, steps: 8000 }],
      daily_activity: [{ date: noFood, weight_kg: 80 }],
      food_entries: [{ date: noFiber, name: "Meal", calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 }],
    });
    const ctx = await newContext();
    const page = await ctx.newPage();
    await signIn(page);

    await page.goto(`${server.url}/?date=${noFood}`);
    await ready(page);
    const text = await page.locator("main").innerText();
    expect(text).toContain("No food logged");
    expect(text).not.toContain("All nutrients complete");
    // Nutrition meters say there is no food, not "Not recorded".
    expect((text.match(/No food logged/g) ?? []).length).toBeGreaterThanOrEqual(5);
    // Steps aren't recorded: that message appears once in the activity card, not twice.
    const activity = page.locator("section", { has: page.getByRole("heading", { name: "Activity & body" }) });
    expect(((await activity.innerText()).match(/Not recorded/g) ?? []).length).toBe(1);

    await page.goto(`${server.url}/?date=${noFiber}`);
    await ready(page);
    const partial = await page.locator("main").innerText();
    expect(partial).toContain("Partial: fiber");
    expect(partial).toContain("Fiber total is incomplete because 1 food is missing fiber.");
    // Calories are exact: no "+" and no "Partial" note on the calories card.
    expect(partial).toContain("2,000");
    expect(partial).not.toMatch(/2,000\s*\+/);
    expect(partial).not.toContain("have no calories yet");
    await ctx.close();
  });

  it("audit #19: partial weeks in the weekly table show the dates actually in range", async () => {
    const owner = await createOwner();
    await importOk(owner, { schema_version: "1.0", food_entries: [{ date: addDays(today(), -1), name: "x", calories: 500 }] }); // so the table is shown
    const ctx = await newContext();
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${server.url}/trends?range=custom&from=${addDays(today(), -10)}&to=${today()}`);
    await ready(page);
    await page.getByText("(partial week)").first().waitFor();
    expect(await page.locator("main").innerText()).toContain("Weeks run Monday to Sunday and show only the dates inside your range");
    await ctx.close();
  });
});

describe.skipIf(!chromeAvailable)("audit #21: Settings dates follow midnight, unless the user chose one", () => {
  it("untouched date fields move to the new day; a chosen date is kept", async () => {
    const fakeStart = new Date(Date.now() + msUntilNextDay(TZ) - 20_000);
    const evening = todayInTimeZone(TZ, fakeStart);
    const morning = addDays(evening, 1);
    await createOwner();
    const fake = await startServer(3221, { FAKE_START: fakeStart.toISOString(), NODE_OPTIONS: `--require ${fakeClockPreload}` });
    const b = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
      const untouched = await (await b.newContext({ locale: "en-US" })).newPage();
      await signIn(untouched, fake.url);
      await untouched.goto(`${fake.url}/settings`);
      await untouched.waitForLoadState("networkidle");
      expect(await untouched.locator("#effective_from").inputValue()).toBe(evening);
      expect(await untouched.locator("#weigh-date").inputValue()).toBe(evening);

      const chosen = await (await b.newContext({ locale: "en-US" })).newPage();
      await signIn(chosen, fake.url);
      await chosen.goto(`${fake.url}/settings`);
      await chosen.waitForLoadState("networkidle");
      const picked = addDays(evening, -3);
      await chosen.locator("#effective_from").fill(picked);
      await chosen.locator("#weigh-date").fill(picked);

      // After the server's midnight both pages refresh themselves.
      await untouched.locator(`#effective_from[value="${morning}"]`).waitFor({ timeout: 45_000 });
      expect(await untouched.locator("#effective_from").inputValue()).toBe(morning);
      expect(await untouched.locator("#weigh-date").inputValue()).toBe(morning);
      await chosen.waitForTimeout(1500); // the same refresh has happened on this page too
      expect(await chosen.locator("#effective_from").inputValue()).toBe(picked);
      expect(await chosen.locator("#weigh-date").inputValue()).toBe(picked);
    } finally {
      await b.close();
      fake.stop();
    }
  });
});
