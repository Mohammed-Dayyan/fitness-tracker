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
  await importOk(owner, {
    schema_version: "1.0",
    targets: [{ effective_from: addDays(today, -30), calories: 2000, protein_g: 120, carbs_g: 220, fat_g: 65, fiber_g: 30, steps: 9000 }],
    food_entries: [
      { id: "f1", date: today, name: "Oats", time: "08:00", meal: "Breakfast", calories: 450, protein_g: 20, carbs_g: 70, fat_g: 9, fiber_g: 8 },
      { id: "f2", date: today, name: "Chicken rice", time: "13:30", meal: "Lunch", calories: 720, protein_g: 48, carbs_g: 80, fat_g: 18, fiber_g: 6 },
      { id: "f3", date: today, name: "Mystery curry", time: "20:00", meal: "Dinner", protein_g: 25 },
      ...[-1, -2, -3, -4].map((d) => ({ id: `h${-d}`, date: addDays(today, d), name: "Day food", calories: 1900 + d * 40, protein_g: 110, carbs_g: 210, fat_g: 60, fiber_g: 28 })),
    ],
    workouts: [{ id: "w1", date: today, name: "Push day", duration_min: 55, estimated_calories: 300, sets: [{ id: "s1", exercise: "Bench Press", set_number: 1, reps: 8, weight_kg: 60 }] }],
    daily_activity: [{ date: today, steps: 7400, weight_kg: 79.2 }, { date: addDays(today, -1), steps: 10100, weight_kg: 79.5 }],
  });
  return { owner, today };
}

describe.skipIf(!chromeAvailable)("Today page", () => {
  beforeAll(async () => {
    server = await startServer(3251);
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    server?.stop();
  });

  it("fits every width in every theme with no console errors, and its rows close on both edges", async () => {
    await seed();
    const problems: string[] = [];
    for (const theme of ["light", "dark", "ember"]) {
      for (const [view, width, height, mobile] of [["desk", 1440, 900, false], ["tab", 768, 1024, false], ["phone", 390, 844, true]] as const) {
        const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, colorScheme: "light" });
        await ctx.addInitScript((t) => localStorage.setItem("ft-theme", t), theme);
        const page = await ctx.newPage();
        page.on("console", (m) => (m.type() === "error" || /hydrat/i.test(m.text())) && problems.push(`${theme}/${view}: ${m.text().slice(0, 120)}`));
        await signIn(page);
        await page.waitForLoadState("networkidle");
        const m = await page.evaluate(() => {
          const right = Math.max(...[...document.querySelectorAll("body *")].filter((e) => !e.closest(".overflow-auto,.overflow-x-auto")).map((e) => Math.ceil(e.getBoundingClientRect().right)));
          const main = document.querySelector("main")!.getBoundingClientRect();
          // Panels directly under a grid row: the widest ones must end at the content's right edge.
          const edges = [...document.querySelectorAll("main section, main header")].map((e) => Math.round(e.getBoundingClientRect().right));
          return { overflow: right - innerWidth, mainRight: Math.round(main.right - parseFloat(getComputedStyle(document.querySelector("main")!).paddingRight)), maxEdge: Math.max(...edges) };
        });
        if (m.overflow > 0) problems.push(`${theme}/${view}: overflows by ${m.overflow}px`);
        if (Math.abs(m.maxEdge - m.mainRight) > 1) problems.push(`${theme}/${view}: panels end at ${m.maxEdge}, content edge is ${m.mainRight}`);
        if (SHOTS && ((view === "desk" && theme !== "dark") || (view === "phone" && theme === "ember"))) {
          await page.screenshot({ path: `${SHOTS}/today-${view}-${theme}.png`, fullPage: true });
        }
        await ctx.close();
      }
    }
    expect(problems).toEqual([]);
  }, 240_000);

  it("keeps the verdict detail behind a disclosure, and logs steps for yesterday", async () => {
    const { today } = await seed();
    const yesterday = addDays(today, -1);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
    const page = await ctx.newPage();
    await signIn(page);

    // The finding and the confidence note are on the page; the per-measure rows are collapsed until opened.
    const main = page.locator("main");
    await page.locator('[data-testid="day-heading"]:visible').waitFor();
    expect(await main.innerText()).toContain("Partial: calories");
    const details = page.locator("details", { hasText: "Why this status" });
    expect(await details.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    await details.locator("summary").click();
    expect(await details.getByRole("list", { name: "Checks against targets" }).isVisible()).toBe(true);

    // Steps quick log on a past day replaces that day's count and keeps its weight.
    await page.goto(`${server.url}/?date=${yesterday}`, { waitUntil: "networkidle" });
    await page.fill("#quick-steps", "12,345");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText(`12,345 steps recorded for ${yesterday}.`).waitFor();
    await expect.poll(async () => main.innerText(), { timeout: 15_000 }).toContain("12,345");
    expect(await main.innerText()).toContain("79.5 kg");
    expect(await page.locator("#quick-steps").inputValue()).toBe("");

    // A bad value shows an inline error and saves nothing.
    await page.fill("#quick-steps", "12.5");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText("Enter a whole number").waitFor();

    // Future days can't be logged.
    await page.goto(`${server.url}/?date=${addDays(today, 2)}`, { waitUntil: "networkidle" });
    expect(await page.locator("#quick-steps").count()).toBe(0);
    await page.getByText("Nothing can be logged for a day that hasn't happened yet.").waitFor();
    await ctx.close();
  }, 120_000);
});
