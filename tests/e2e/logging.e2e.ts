import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayInTimeZone } from "@/lib/shared/dates";
import { createOwner, importOk, PASSWORD } from "../helpers/factory";
import { CHROME, chromeAvailable, startServer } from "./server";

let browser: Browser;
let server: Awaited<ReturnType<typeof startServer>>;
// Set SHOTS_DIR to also save a screenshot of the toast (used when reviewing the design by eye).
const SHOTS = process.env.SHOTS_DIR;

async function signIn(page: Page) {
  await page.goto(`${server.url}/login`);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${server.url}/`);
}

describe.skipIf(!chromeAvailable)("logging: Log data, toasts, daily weight, weight log", () => {
  beforeAll(async () => {
    server = await startServer(3253);
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    server?.stop();
  });

  it("Today has a Log data button that opens the Data page", async () => {
    await createOwner();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
    const page = await ctx.newPage();
    await signIn(page);
    await page.getByRole("link", { name: "Log data" }).click();
    await page.waitForURL(`${server.url}/data`);
    await ctx.close();
  });

  it("the Log today card saves steps and weight together, with a toast; blank fields keep what is saved", async () => {
    const owner = await createOwner();
    const today = todayInTimeZone("Asia/Kolkata");
    const yesterday = addDays(today, -1);
    await importOk(owner, { schema_version: "1.0", daily_activity: [{ date: yesterday, steps: 5000, weight_kg: 80 }] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${server.url}/?date=${yesterday}`, { waitUntil: "networkidle" });

    await page.fill("#quick-steps", "12,345");
    await page.fill("#quick-weight", "79.2");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText(`12,345 steps and 79.2 kg recorded for ${yesterday}. It replaced 5,000 steps and 80 kg.`).waitFor();
    await expect.poll(async () => page.locator("main").innerText(), { timeout: 15_000 }).toContain("12,345");
    expect(await page.locator("main").innerText()).toContain("79.2 kg");
    expect(await page.locator("#quick-steps").inputValue()).toBe("");
    expect(await page.locator("#quick-weight").inputValue()).toBe("");

    // Weight only: the steps stay.
    await page.fill("#quick-weight", "79.0");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText(`79 kg recorded for ${yesterday}. It replaced 79.2 kg.`).waitFor();
    await expect.poll(async () => page.locator("main").innerText(), { timeout: 15_000 }).toContain("79 kg");
    expect(await page.locator("main").innerText()).toContain("12,345"); // steps untouched

    // A bad value is an inline error, not a toast; an empty save is refused.
    await page.fill("#quick-weight", "abc");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText("Enter a number").waitFor();
    await page.fill("#quick-weight", "");
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByText("Enter steps, weight or both").waitFor();
    await ctx.close();
  }, 120_000);

  it("importing shows a toast, empties the text, hides Clear, and keeps the result record", async () => {
    await createOwner();
    const today = todayInTimeZone("Asia/Kolkata");
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${server.url}/data`, { waitUntil: "networkidle" });

    await page.locator("#import-json").fill(JSON.stringify({ schema_version: "1.0", date: today, food_entries: [{ name: "Apple" }, { name: "Pear" }] }));
    expect(await page.getByRole("button", { name: "Clear" }).count()).toBe(1);
    await page.getByRole("button", { name: "Validate & preview" }).click();
    await page.getByRole("button", { name: /Confirm import/ }).click();

    await page.getByText("Imported: 2 created.").waitFor(); // the toast
    await page.getByText("Import applied").waitFor(); // the record stays on the page
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/data-toast.png` });
    expect(await page.locator("#import-json").inputValue()).toBe("");
    expect(await page.getByRole("button", { name: "Clear" }).count()).toBe(0);
    expect(await page.getByRole("link", { name: today }).count()).toBeGreaterThan(0); // "View:" date links

    // Typing new JSON clears the old result and brings Clear back.
    await page.locator("#import-json").fill("{");
    await page.getByRole("button", { name: "Clear" }).waitFor();
    expect(await page.getByText("Import applied").count()).toBe(0);
    await ctx.close();
  }, 120_000);

  it("Trends lists every weight newest first, with an Add link for a missed day", async () => {
    const owner = await createOwner();
    const today = todayInTimeZone("Asia/Kolkata");
    await importOk(owner, {
      schema_version: "1.0",
      daily_activity: [{ date: addDays(today, -1), weight_kg: 79.5 }, { date: addDays(today, -3), weight_kg: 80 }, { date: addDays(today, -4), weight_kg: 80.4 }],
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${server.url}/trends?range=7`, { waitUntil: "networkidle" });

    const table = page.getByRole("table", { name: "Weight by day, newest first" });
    const rows = await table.locator("tbody tr").allInnerTexts();
    expect(rows.length).toBe(7);
    expect(rows[1]).toContain("79.5 kg"); // yesterday (today, row 0, has no weigh-in)
    expect(rows[1]).toContain("-0.5 kg"); // since the previous weigh-in
    expect(rows[3]).toContain("80 kg");
    expect(rows[3]).toContain("-0.4 kg");
    expect(rows[2]).toContain("Add"); // the missed day between them

    // The Add link opens that day so it can be logged.
    await table.getByRole("link", { name: /^Add weight for/ }).nth(1).click();
    await page.waitForURL(new RegExp(`/\\?date=${addDays(today, -2)}`));
    await page.locator("#quick-weight").waitFor();
    await ctx.close();
  }, 120_000);
});
