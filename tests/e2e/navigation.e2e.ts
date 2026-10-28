import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDays, msUntilNextDay, todayInTimeZone } from "@/lib/shared/dates";
import { createOwner, importOk, PASSWORD } from "../helpers/factory";
import { chromeAvailable, CHROME, fakeClockPreload, startServer } from "./server";

const TZ = "Asia/Kolkata";
let browser: Browser;
let server: Awaited<ReturnType<typeof startServer>>;

async function signIn(page: Page, base: string) {
  await page.goto(`${base}/login`);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${base}/`);
}

/** What the visible Today page claims: kicker, date, picker value, and which test meals are visible. */
async function dayState(page: Page) {
  await page.waitForLoadState("networkidle");
  const heading = page.locator('[data-testid="day-heading"]:visible');
  await heading.waitFor();
  return page.evaluate(() => {
    const visible = (e: Element) => (e as HTMLElement).offsetParent !== null;
    const h = [...document.querySelectorAll('[data-testid="day-heading"]')].find(visible) as HTMLElement;
    const k = [...document.querySelectorAll('[data-testid="day-kicker"]')].find(visible);
    const picker = [...document.querySelectorAll("#date-picker")].find(visible) as HTMLInputElement;
    const meals = [...document.querySelectorAll('[data-testid="food-name"]')].filter(visible).map((e) => e.textContent);
    return { url: location.pathname + location.search, kicker: k?.textContent, date: h.dataset.date, picker: picker.value, meals };
  });
}

async function seed(today: string) {
  const owner = await createOwner();
  await importOk(owner, {
    schema_version: "1.0",
    food_entries: [
      { id: "y", date: addDays(today, -1), name: "YESTERDAY-MEAL", calories: 1996 },
      { id: "t", date: today, name: "TODAY-MEAL", calories: 400 },
    ],
  });
  return owner;
}

describe.skipIf(!chromeAvailable)("Today and date navigation (real browser)", () => {
  beforeAll(async () => {
    server = await startServer(3210);
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    server?.stop();
  });
  let today: string;
  beforeEach(async () => {
    today = todayInTimeZone(TZ);
    await seed(today);
  });

  it("Today shortcut always returns to the current date, not a previously selected one", async () => {
    const page = await browser.newPage();
    await signIn(page, server.url);
    expect(await dayState(page)).toMatchObject({ url: "/", kicker: "Today", date: today, picker: today, meals: ["TODAY-MEAL"] });

    await page.click('a[aria-label="Previous day"]');
    await page.waitForURL(`${server.url}/?date=${addDays(today, -1)}`);
    expect(await dayState(page)).toMatchObject({ kicker: "Past day", date: addDays(today, -1), picker: addDays(today, -1), meals: ["YESTERDAY-MEAL"] });

    await page.locator('nav[aria-label="Main"]:visible a[href="/"]').click();
    await page.waitForURL(`${server.url}/`);
    expect(await dayState(page)).toMatchObject({ kicker: "Today", date: today, picker: today, meals: ["TODAY-MEAL"] });
    await page.close();
  });

  it("a historical URL opens that date; heading, picker and records agree", async () => {
    const page = await browser.newPage();
    await signIn(page, server.url);
    const yesterday = addDays(today, -1);
    await page.goto(`${server.url}/?date=${yesterday}`);
    expect(await dayState(page)).toMatchObject({ url: `/?date=${yesterday}`, kicker: "Past day", date: yesterday, picker: yesterday, meals: ["YESTERDAY-MEAL"] });

    // The date picker updates the URL and the content together.
    await page.locator("#date-picker:visible").fill(today);
    await page.waitForURL(`${server.url}/`);
    expect(await dayState(page)).toMatchObject({ date: today, picker: today, meals: ["TODAY-MEAL"] });

    await page.goBack();
    await page.waitForURL(`${server.url}/?date=${yesterday}`);
    expect(await dayState(page)).toMatchObject({ date: yesterday, meals: ["YESTERDAY-MEAL"] });
    await page.close();
  });
});

describe.skipIf(!chromeAvailable)("Midnight rollover in Asia/Kolkata (real browser, shifted server clock)", () => {
  it("an open Today page moves to the new day at local midnight without any navigation", async () => {
    // Server clock starts 20 s before the next IST midnight (ahead of real time,
    // so sessions stay newer than the password change).
    const fakeStart = new Date(Date.now() + msUntilNextDay(TZ) - 20_000);
    const evening = todayInTimeZone(TZ, fakeStart);
    const morning = addDays(evening, 1);
    await createOwner();
    const fake = await startServer(3211, { FAKE_START: fakeStart.toISOString(), NODE_OPTIONS: `--require ${fakeClockPreload}` });
    const b = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
      const page = await b.newPage();
      await signIn(page, fake.url);
      expect(await dayState(page)).toMatchObject({ kicker: "Today", date: evening });
      // Wait past the server's midnight; the page must refresh itself.
      await page.locator(`[data-testid="day-heading"][data-date="${morning}"]:visible`).waitFor({ timeout: 45_000 });
      expect(await dayState(page)).toMatchObject({ url: "/", kicker: "Today", date: morning, picker: morning });
    } finally {
      await b.close();
      fake.stop();
    }
  });
});

describe.skipIf(!chromeAvailable)("Mobile layout (real browser)", () => {
  beforeAll(async () => {
    server = await startServer(3212);
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    server?.stop();
  });

  for (const width of [375, 390]) {
    it(`at ${width}px the bottom navigation never covers the end of any page, and nothing overflows sideways`, async () => {
      await seed(todayInTimeZone(TZ));
      const ctx = await browser.newContext({ viewport: { width, height: 740 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await signIn(page, server.url);
      for (const path of ["/", "/history", "/trends", "/exercises", "/data", "/settings"]) {
        await page.goto(`${server.url}${path}`, { waitUntil: "networkidle" });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(200);
        const m = await page.evaluate(() => {
          const nav = document.querySelector('nav[aria-label="Main"].fixed')!.getBoundingClientRect();
          const main = document.querySelector("main")!;
          const last = [...main.querySelectorAll("*")].filter((e) => (e as HTMLElement).offsetParent !== null).at(-1)!;
          const widest = Math.max(
            ...[...document.querySelectorAll("body *")]
              .filter((e) => !e.closest(".overflow-auto, .overflow-x-auto"))
              .map((e) => e.getBoundingClientRect().right),
          );
          return { lastBottom: last.getBoundingClientRect().bottom, navTop: nav.top, overflow: Math.ceil(widest) - window.innerWidth };
        });
        expect(m.lastBottom, `${path}: content end hidden behind nav`).toBeLessThanOrEqual(m.navTop);
        expect(m.overflow, `${path}: horizontal overflow`).toBeLessThanOrEqual(0);
      }
      await ctx.close();
    });
  }
});
