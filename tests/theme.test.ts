import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { THEME_COLORS, THEME_INIT_SCRIPT, THEME_KEY, THEME_PREFS, isThemePref, normalizePref, resolveTheme } from "@/lib/client/theme";

/** Runs the inline pre-paint script against a fake browser and returns what it set on <html>. */
function runInitScript(opts: { stored?: string | null; prefersDark?: boolean; storageThrows?: boolean }) {
  const attrs: Record<string, string> = {};
  vm.runInNewContext(THEME_INIT_SCRIPT, {
    document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
    localStorage: {
      getItem: (k: string) => {
        if (opts.storageThrows) throw new Error("blocked");
        expect(k).toBe(THEME_KEY);
        return opts.stored ?? null;
      },
    },
    matchMedia: () => ({ matches: Boolean(opts.prefersDark) }),
  });
  return attrs;
}

describe("theme pre-paint script", () => {
  it("applies a stored theme exactly", () => {
    for (const t of ["light", "dark", "ember"]) expect(runInitScript({ stored: t })).toEqual({ "data-theme": t, "data-theme-pref": t });
  });

  it("reads a preference saved as the retired 'aurora' as 'ember'", () => {
    expect(runInitScript({ stored: "aurora", prefersDark: false })).toEqual({ "data-theme": "ember", "data-theme-pref": "ember" });
    expect(normalizePref("aurora")).toBe("ember");
    expect(normalizePref("neon")).toBe("system");
    expect(normalizePref(null)).toBe("system");
    expect(normalizePref("dark")).toBe("dark");
  });

  it("'system' (and nothing stored) follows the operating system", () => {
    expect(runInitScript({ stored: "system", prefersDark: true })).toEqual({ "data-theme": "dark", "data-theme-pref": "system" });
    expect(runInitScript({ stored: "system", prefersDark: false })).toEqual({ "data-theme": "light", "data-theme-pref": "system" });
    expect(runInitScript({ stored: null, prefersDark: true })["data-theme"]).toBe("dark");
    expect(runInitScript({ stored: null, prefersDark: false })["data-theme"]).toBe("light");
  });

  it("ignores an unknown stored value instead of trusting it", () => {
    expect(runInitScript({ stored: "neon", prefersDark: true })).toEqual({ "data-theme": "dark", "data-theme-pref": "system" });
    expect(runInitScript({ stored: "", prefersDark: false })["data-theme-pref"]).toBe("system");
  });

  it("falls back to light when storage is blocked", () => {
    expect(runInitScript({ storageThrows: true })).toEqual({ "data-theme": "light", "data-theme-pref": "system" });
  });

  it("stays small and plain ES5, since it blocks first paint", () => {
    expect(THEME_INIT_SCRIPT.length).toBeLessThan(700);
    expect(THEME_INIT_SCRIPT).not.toMatch(/=>|\blet\b|\bconst\b|`/);
  });
});

describe("theme helpers", () => {
  it("resolves and validates preferences", () => {
    expect(THEME_PREFS).toEqual(["light", "dark", "ember", "system"]);
    expect(resolveTheme("ember", false)).toBe("ember");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(isThemePref("dark")).toBe(true);
    expect(isThemePref("neon")).toBe(false);
    expect(isThemePref(null)).toBe(false);
    expect(Object.keys(THEME_COLORS).sort()).toEqual(["dark", "ember", "light"]);
  });
});

// ---------------------------------------------------------------------------
// The stylesheet: every theme must define every token, keep the validated chart
// palettes, and keep text readable. Changing a colour here should be deliberate.
// ---------------------------------------------------------------------------

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function block(selector: RegExp): Record<string, string> {
  const m = selector.exec(css);
  if (!m) throw new Error(`no CSS block for ${selector}`);
  const body = css.slice(m.index + m[0].length, css.indexOf("\n}", m.index + m[0].length));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].replace(/\s+/g, " ").trim()]));
}

const themes = {
  light: block(/:root,\s*:root\[data-theme="light"\]\s*\{/),
  dark: block(/:root\[data-theme="dark"\]\s*\{/),
  ember: block(/:root\[data-theme="ember"\]\s*\{/),
};

const REQUIRED = [
  "--plane", "--plane-bg", "--surface", "--surface-2", "--ink", "--ink-2", "--muted", "--grid", "--axis", "--line",
  "--card-bg", "--card-border",
  "--accent", "--accent-ink", "--btn-bg", "--btn-ink",
  "--hero-bg", "--hero-ink", "--hero-ink-2", "--nav-active-bg",
  "--s-calories", "--s-protein", "--s-carbs", "--s-fat", "--s-fiber", "--s-steps", "--s-weight",
  "--good", "--good-ink", "--warning", "--warning-ink", "--serious", "--critical", "--critical-ink",
];

const luminance = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("theme stylesheet", () => {
  for (const [name, tokens] of Object.entries(themes)) {
    it(`${name}: defines every token`, () => {
      expect(REQUIRED.filter((t) => !(t in tokens))).toEqual([]);
    });

    it(`${name}: body text is readable (≥ 4.5:1) on its surfaces`, () => {
      for (const surface of ["--surface", "--surface-2", "--plane"]) {
        for (const ink of ["--ink", "--ink-2", "--muted", "--accent-ink", "--good-ink", "--warning-ink", "--critical-ink"]) {
          expect(contrast(tokens[ink], tokens[surface]), `${name} ${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${name}: primary button text is readable on its fill`, () => {
      const stops = tokens["--btn-bg"].match(/#[0-9a-f]{6}/gi) ?? [];
      expect(stops.length).toBeGreaterThanOrEqual(1);
      for (const c of stops) expect(contrast(tokens["--btn-ink"], c), `${name} on ${c}`).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: the accent mark is visible (≥ 3:1) against panels and the page`, () => {
      for (const surface of ["--surface", "--plane"]) expect(contrast(tokens["--accent"], tokens[surface]), `${name} accent on ${surface}`).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: flat by design (solid fills only)`, () => {
      for (const t of ["--plane-bg", "--btn-bg", "--hero-bg", "--card-bg"]) expect(tokens[t], `${name} ${t}`).toMatch(/^#[0-9a-f]{6}$/i);
    });
  }

  it("the stylesheet itself has no gradients, blur, glow or shadows", () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/gradient\(|blur\(|drop-shadow|box-shadow|text-shadow/);
    for (const gone of ["--card-edge", "--card-blur", "--card-shadow", "--accent-grad", "--ring-glow", "--btn-shadow", "--hero-shadow"]) expect(code, gone).not.toContain(gone);
  });

  it("charts use the validated palettes (re-run the dataviz validator before changing these)", () => {
    const series = (t: Record<string, string>) => ["calories", "protein", "carbs", "fat", "fiber", "steps", "weight"].map((k) => t[`--s-${k}`]).join(",");
    expect(series(themes.light)).toBe("#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#6250d6,#008300");
    const dark = "#3987e5,#d95926,#199e70,#c98500,#d55181,#9085e9,#2a9d2a";
    expect(series(themes.dark)).toBe(dark);
    expect(series(themes.ember)).toBe(dark);
  });
});
