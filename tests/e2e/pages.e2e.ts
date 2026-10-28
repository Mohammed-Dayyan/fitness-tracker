import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayInTimeZone } from "@/lib/shared/dates";
import { createOwner, importOk, PASSWORD } from "../helpers/factory";
import { CHROME, chromeAvailable, startServer } from "./server";

let browser: Browser;
let server: Awaited<ReturnType<typeof startServer>>;
// Set SHOTS_DIR to also save screenshots (used when reviewing the design by eye).
const SHOTS = process.env.SHOTS_DIR;

async function signIn(page: Page) {
  await page.goto(`${server.url}/login`);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${server.url}/`);
}

async function seed() {
  const owner = await createOwner();
  const today = todayInTimeZone("Asia/Kolkata");
  const days = [-1, -2, -3, -4, -5, -6, -8, -9, -10];
  await importOk(owner, {
    schema_version: "1.0",
    targets: [{ effective_from: addDays(today, -60), calories: 2000, protein_g: 120, carbs_g: 220, fat_g: 65, fiber_g: 30, steps: 9000 }],
    food_entries: days.map((d) => ({ id: `f${-d}`, date: addDays(today, d), name: "Day food", calories: 1700 + (-d % 4) * 150, protein_g: 100 + (-d % 3) * 12, carbs_g: 210, fat_g: 60, fiber_g: 28 })),
    daily_activity: days.map((d) => ({ date: addDays(today, d), steps: 6000 + (-d % 5) * 1500, weight_kg: 80 - (-d % 5) * 0.2 })),
    workouts: [
      { id: "w1", date: addDays(today, -2), name: "Push day", sets: [{ id: "s1", exercise: "Bench Press", set_number: 1, reps: 8, weight_kg: 60 }, { id: "s2", exercise: "Squat", set_number: 1, reps: 5, weight_kg: 90 }] },
      { id: "w2", date: addDays(today, -9), name: "Push day", sets: [{ id: "s3", exercise: "Bench Press", set_number: 1, reps: 8, weight_kg: 57.5 }] },
    ],
    cardio_sessions: [
      { id: "c1", date: addDays(today, -3), activity: "Run", duration_min: 32, distance_km: 5.2 },
      { id: "c2", date: addDays(today, -10), activity: "run", duration_min: 30, distance_km: 5 },
    ],
  });
  return today;
}

describe.skipIf(!chromeAvailable)("History, Trends, Exercises, Data and Settings", () => {
  beforeAll(async () => {
    server = await startServer(3252);
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    server?.stop();
  });

  it("fit every width in every theme with no console errors; figure strips close on both edges", async () => {
    await seed();
    const problems: string[] = [];
    const pages = [["history", "/history"], ["trends", "/trends?range=30"], ["exercises", "/exercises"], ["cardio", "/exercises?mode=cardio"], ["data", "/data"], ["settings", "/settings"]];
    for (const theme of ["light", "dark", "ember"]) {
      for (const [view, width, height, mobile] of [["desk", 1440, 900, false], ["tab", 768, 1024, false], ["phone", 390, 844, true], ["small", 375, 667, true]] as const) {
        const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, colorScheme: "light" });
        await ctx.addInitScript((t) => localStorage.setItem("ft-theme", t), theme);
        const page = await ctx.newPage();
        const where = (name: string) => `${theme}/${view}/${name}`;
        let current = "";
        page.on("console", (m) => (m.type() === "error" || /hydrat/i.test(m.text())) && problems.push(`${where(current)}: ${m.text().slice(0, 120)}`));
        await signIn(page);
        for (const [name, url] of pages) {
          current = name;
          await page.goto(server.url + url, { waitUntil: "networkidle" });
          const m = await page.evaluate(() => {
            const main = document.querySelector("main")!;
            const contentRight = Math.round(main.getBoundingClientRect().right - parseFloat(getComputedStyle(main).paddingRight));
            const right = Math.max(...[...document.querySelectorAll("body *")].filter((e) => !e.closest(".overflow-auto,.overflow-x-auto")).map((e) => Math.ceil(e.getBoundingClientRect().right)));
            // A figure strip is the element that holds the grid of big numbers: it must end on the content edge.
            const strips = [...document.querySelectorAll("main div.grid.gap-px")].map((e) => Math.round(e.getBoundingClientRect().right));
            return { overflow: right - innerWidth, contentRight, strips, h1: document.querySelectorAll("h1").length };
          });
          if (m.overflow > 0) problems.push(`${where(name)}: overflows by ${m.overflow}px`);
          for (const r of m.strips) if (Math.abs(r - m.contentRight) > 1) problems.push(`${where(name)}: strip ends at ${r}, content edge ${m.contentRight}`);
          if (mobile) {
            // Six bottom-nav labels must fit their cells at the narrowest phone width.
            const cut = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Main"].fixed a')].filter((a) => a.scrollWidth > a.clientWidth).map((a) => a.textContent));
            if (cut.length) problems.push(`${where(name)}: bottom nav labels cut off: ${cut.join(", ")}`);
          }
          if (m.h1 !== 1) problems.push(`${where(name)}: ${m.h1} h1 elements`);
          if (SHOTS && ((view === "desk" && theme === "ember" && ["data", "settings"].includes(name)) || (view === "small" && theme === "dark" && name === "settings"))) {
            await page.screenshot({ path: `${SHOTS}/${name}-${view}-${theme}.png`, fullPage: true });
          }
        }
        await ctx.close();
      }
    }
    expect(problems).toEqual([]);
  }, 400_000);

  it("History rows open the day from anywhere on the row; Trends and Exercises mark the current choice", async () => {
    const today = await seed();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
    const page = await ctx.newPage();
    await signIn(page);

    await page.goto(`${server.url}/history`, { waitUntil: "networkidle" });
    const row = page.locator("tbody tr").first();
    const box = (await row.boundingBox())!;
    await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2); // far right of the row, not on the date
    await page.waitForURL(new RegExp(`/\\?date=${addDays(today, -1)}`));

    await page.goto(`${server.url}/trends?range=30`, { waitUntil: "networkidle" });
    expect(await page.getByRole("link", { name: "30 days" }).getAttribute("aria-current")).toBe("true");
    expect(await page.getByRole("link", { name: "7 days" }).getAttribute("aria-current")).toBeNull();

    await page.goto(`${server.url}/exercises?mode=cardio`, { waitUntil: "networkidle" });
    expect(await page.getByRole("link", { name: "Cardio" }).getAttribute("aria-current")).toBe("page");
    expect(await page.getByRole("link", { name: "Strength" }).getAttribute("aria-current")).toBeNull();
    await ctx.close();
  }, 120_000);
});
