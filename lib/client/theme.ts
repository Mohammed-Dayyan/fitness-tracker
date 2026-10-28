/**
 * Theme handling shared by the inline pre-paint script (app/layout.tsx) and the
 * switcher. The preference is stored per device in localStorage; the page gets
 * data-theme ("light" | "dark" | "aurora") before first paint so it never
 * flashes the wrong theme. "system" is resolved to light or dark here, which is
 * why the stylesheet only has three theme blocks.
 *
 * (A cookie read in the root layout would be the alternative, but with Cache
 * Components a request-time read outside <Suspense> blocks prerendering.)
 */

export const THEME_KEY = "ft-theme";
export const THEME_PREFS = ["light", "dark", "aurora", "system"] as const;
export type ThemePref = (typeof THEME_PREFS)[number];
export type Theme = "light" | "dark" | "aurora";

/** Browser UI colour (address bar) for each theme. */
export const THEME_COLORS: Record<Theme, string> = { light: "#eef3ff", dark: "#070a12", aurora: "#1a0f4a" };

const CHANGE_EVENT = "ft-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export const isThemePref = (v: unknown): v is ThemePref => typeof v === "string" && (THEME_PREFS as readonly string[]).includes(v);

export const resolveTheme = (pref: ThemePref, prefersDark: boolean): Theme => (pref === "system" ? (prefersDark ? "dark" : "light") : pref);

/** Runs before first paint (inline in <head>). Must stay tiny, dependency-free ES5. */
export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement;try{var p=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(${JSON.stringify(THEME_PREFS)}.indexOf(p)<0)p="system";var t=p==="system"?(matchMedia(${JSON.stringify(DARK_QUERY)}).matches?"dark":"light"):p;d.setAttribute("data-theme",t);d.setAttribute("data-theme-pref",p)}catch(e){d.setAttribute("data-theme","light");d.setAttribute("data-theme-pref","system")}})()`;

export function readPref(): ThemePref {
  const p = document.documentElement.getAttribute("data-theme-pref");
  return isThemePref(p) ? p : "system";
}

/** Points the browser UI colour at the active theme (the static tags only know light/dark). */
export function syncThemeColor(theme: Theme = document.documentElement.getAttribute("data-theme") as Theme) {
  const color = THEME_COLORS[theme] ?? THEME_COLORS.light;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute("content", color);
    m.removeAttribute("media");
  });
}

export function applyTheme(pref: ThemePref) {
  const theme = resolveTheme(pref, matchMedia(DARK_QUERY).matches);
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-theme-pref", pref);
  syncThemeColor(theme);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function savePref(pref: ThemePref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* storage blocked: the choice still applies for this page view */
  }
  applyTheme(pref);
}

/** For useSyncExternalStore: re-renders on a theme change here, in another tab, or in the OS setting. */
export function subscribeTheme(onChange: () => void) {
  const mq = matchMedia(DARK_QUERY);
  const onSystem = () => readPref() === "system" && applyTheme("system");
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY) applyTheme(isThemePref(e.newValue) ? e.newValue : "system");
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  mq.addEventListener("change", onSystem);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    mq.removeEventListener("change", onSystem);
  };
}
