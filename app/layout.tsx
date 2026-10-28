import type { Metadata, Viewport } from "next";
import { THEME_INIT_SCRIPT } from "@/lib/client/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Fitness Tracker", template: "%s · Fitness Tracker" },
  description: "Personal fitness and nutrition tracker",
};

export const viewport: Viewport = {
  // Lets env(safe-area-inset-*) report the notch/home-indicator areas.
  viewportFit: "cover",
  themeColor: [
    // Fallbacks; the theme switcher points these at the active theme's colour.
    { media: "(prefers-color-scheme: light)", color: "#eef3ff" },
    { media: "(prefers-color-scheme: dark)", color: "#070a12" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set on <html> by the inline script before hydration, so React is told to expect it.
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/* Browser extensions inject attributes on <body> (e.g. style="z-index: 0")
          before hydration. This ignores attribute differences on <body> only;
          mismatches inside the page are still reported. */}
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
