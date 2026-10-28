import { BrandMark } from "@/components/brand-mark";
import { BottomNav, SideNav } from "@/components/nav";
import { LogoutButton } from "@/components/logout-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { SessionKeepAlive } from "@/components/session-keepalive";

// The shell is static (no session read), so it prerenders. Every page below
// validates the session itself inside its own <Suspense> boundary.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1">
      {/* Open plane: the sidebar sits on the page ground, separated by nothing. 224 px wide. */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col justify-between px-3 py-5 md:flex">
        <div>
          <p className="mb-6 flex items-center gap-2.5 px-3 font-display text-base font-semibold tracking-tight text-ink">
            <BrandMark />
            Fitness Tracker
          </p>
          <SideNav />
        </div>
        <div className="space-y-3">
          <ThemeSwitcher />
          <LogoutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 md:hidden">
          <p className="flex items-center gap-2 font-display text-base font-semibold tracking-tight text-ink">
            <BrandMark className="size-5" />
            Fitness Tracker
          </p>
          <div className="flex items-center gap-1">
            <ThemeSwitcher compact />
            <LogoutButton compact />
          </div>
        </header>
        {/* Mobile: bottom padding = tab bar height + safe area, so the fixed bar
            never covers the end of the page. */}
        <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-8 md:pb-10">
          {children}
        </main>
      </div>
      <BottomNav />
      <SessionKeepAlive />
    </div>
  );
}
