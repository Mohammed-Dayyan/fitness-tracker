import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayInTimeZone } from "@/lib/shared/dates";
import { THEME_COLORS } from "@/lib/client/theme";
import { createOwner, importOk, PASSWORD } from "../helpers/factory";
import { CHROME, chromeAvailable, startServer } from "./server";

let browser: Browser;
let server: Awaited<ReturnType<typeof startServer>>;

async function signIn(page: Page) {
  await page.goto(`${server.url}/login`);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${server.url}/`);
}

const themeOf = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const prefOf = (page: Page) => page.evaluate(() => document.documentElement.dataset.themePref);
/** The theme buttons of whichever switcher is visible (sidebar on desktop, top bar on phones). */
const switcher = (page: Page) => page.locator('[role="group"][aria-label="Theme"]:visible');
const pick = (page: Page, label: "Light" | "Dark" | "Aurora" | "System") => switcher(page).locator(`button[title="${label} theme"]`).click();

describe.skipIf(!chromeAvailable)("themes in a real browser", () => {
  beforeAll(async () => {
    server = await startServer(3240);
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    server?.stop();
  });

  async function seeded() {
    const owner = await createOwner();
    const today = todayInTimeZone("Asia/Kolkata");
    await importOk(owner, {
      schema_version: "1.0",
      targets: [{ effective_from: addDays(today, -30), calories: 2000 }],
      food_entries: [-3, -2, -1].map((d) => ({ date: addDays(today, d), name: "Meal", calories: 1900 })),
    });
  }

  it("switches theme instantly, without a reload, and restyles charts, colours and the browser UI colour", async () => {
    await seeded();
    const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 }, colorScheme: "light" });
    const page = await ctx.newPage();
    const problems: string[] = [];
    page.on("console", (m) => (m.type() === "error" || /hydrat/i.test(m.text())) && problems.push(m.text().slice(0, 200)));
    await signIn(page);
    await page.goto(`${server.url}/trends?range=7`, { waitUntil: "networkidle" });
    await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1)); // survives only if the page is never reloaded

    const look = () =>
      page.evaluate(() => {
        const grid = document.querySelector(".recharts-cartesian-grid line");
        return {
          body: getComputedStyle(document.body).backgroundColor,
          gridStroke: grid ? getComputedStyle(grid).stroke : null,
          color: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
          meta: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("content")),
          marker: (window as unknown as { __marker?: number }).__marker,
        };
      });

    const seen: Record<string, Awaited<ReturnType<typeof look>>> = {};
    for (const [label, theme] of [["Light", "light"], ["Dark", "dark"], ["Aurora", "aurora"]] as const) {
      await pick(page, label);
      expect(await themeOf(page)).toBe(theme);
      expect(await prefOf(page)).toBe(theme);
      expect(await page.evaluate(() => localStorage.getItem("ft-theme"))).toBe(theme);
      seen[theme] = await look();
      expect(seen[theme].marker, "page must not have reloaded").toBe(1);
      expect(seen[theme].meta.every((c) => c === THEME_COLORS[theme])).toBe(true);
      expect(await switcher(page).locator(`button[title="${label} theme"]`).getAttribute("aria-pressed")).toBe("true");
    }
    // Every theme looks different, including inside the Recharts SVG.
    expect(new Set(Object.values(seen).map((s) => s.gridStroke)).size).toBe(3);
    expect(new Set(Object.values(seen).map((s) => s.color)).size).toBe(3);
    expect(new Set(Object.values(seen).map((s) => s.body)).size).toBeGreaterThanOrEqual(2);
    expect(problems).toEqual([]);
    await ctx.close();
  });

  it("remembers the choice across reloads, new tabs and sign-in, with the right theme from the first paint", async () => {
    await seeded();
    const ctx = await browser.newContext({ locale: "en-US", colorScheme: "light" });
    const page = await ctx.newPage();
    await signIn(page);
    await pick(page, "Aurora");

    await page.reload({ waitUntil: "domcontentloaded" });
    // Read straight after DOMContentLoaded, before React has hydrated: the inline script already ran.
    expect(await themeOf(page)).toBe("aurora");

    const second = await ctx.newPage();
    await second.goto(`${server.url}/history`, { waitUntil: "domcontentloaded" });
    expect(await themeOf(second)).toBe("aurora");

    // The sign-in page uses the same theme.
    await ctx.clearCookies();
    await second.goto(`${server.url}/login`, { waitUntil: "domcontentloaded" });
    expect(await themeOf(second)).toBe("aurora");
    await ctx.close();
  });

  it("'System' follows the operating system live; an explicit choice ignores it", async () => {
    await seeded();
    const ctx = await browser.newContext({ locale: "en-US", colorScheme: "dark" });
    const page = await ctx.newPage();
    await signIn(page);
    expect(await prefOf(page)).toBe("system");
    expect(await themeOf(page)).toBe("dark");
    expect(await switcher(page).locator('button[title="System theme"]').getAttribute("aria-pressed")).toBe("true");

    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => themeOf(page)).toBe("light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => themeOf(page)).toBe("dark");

    await pick(page, "Aurora");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(300);
    expect(await themeOf(page)).toBe("aurora");

    await pick(page, "System"); // back to following the OS (currently light)
    expect(await themeOf(page)).toBe("light");
    await ctx.close();
  });

  it("works from the keyboard and on a phone (compact switcher with accessible names)", async () => {
    await seeded();
    const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "light" });
    const page = await ctx.newPage();
    await signIn(page);
    const group = switcher(page);
    expect(await group.count()).toBe(1);
    const dark = group.getByRole("button", { name: "Dark theme" });
    await dark.focus();
    await page.keyboard.press("Enter");
    expect(await themeOf(page)).toBe("dark");
    await group.getByRole("button", { name: "Aurora theme" }).focus();
    await page.keyboard.press("Space");
    expect(await themeOf(page)).toBe("aurora");

    // The bar never covers content or overflows sideways in any theme on a phone.
    for (const label of ["Light", "Dark", "Aurora"] as const) {
      await pick(page, label);
      const widest = await page.evaluate(() => Math.max(...[...document.querySelectorAll("body *")].filter((e) => !e.closest(".overflow-auto,.overflow-x-auto")).map((e) => Math.ceil(e.getBoundingClientRect().right))) - innerWidth);
      expect(widest, label).toBeLessThanOrEqual(0);
    }
    await ctx.close();
  });
});
