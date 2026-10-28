import { Activity } from "lucide-react";
import { BottomNav, SideNav } from "@/components/nav";
import { LogoutButton } from "@/components/logout-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { SessionKeepAlive } from "@/components/session-keepalive";

// The shell is static (no session read), so it prerenders. Every page below
// validates the session itself inside its own <Suspense> boundary.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col justify-between border-r border-line bg-surface/80 px-3 py-5 backdrop-blur md:flex">
        <div>
          <p className="mb-6 flex items-center gap-2 px-3 text-sm font-semibold text-ink">
            <Activity aria-hidden className="size-5 text-accent" />
            <span className="text-gradient">Fitness Tracker</span>
          </p>
          <SideNav />
        </div>
        <div className="space-y-3">
          <ThemeSwitcher />
          <LogoutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-surface/80 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur md:hidden">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Activity aria-hidden className="size-5 text-accent" />
            <span className="text-gradient">Fitness Tracker</span>
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
