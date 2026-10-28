"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Database, Dumbbell, LayoutDashboard, Settings, TrendingUp } from "lucide-react";

const ITEMS = [
  { href: "/", label: "Today", icon: LayoutDashboard },
  { href: "/history", label: "History", icon: CalendarDays },
  { href: "/trends", label: "Trends", icon: TrendingUp },
  { href: "/exercises", label: "Exercises", icon: Dumbbell },
  { href: "/data", label: "Data", icon: Database },
  { href: "/settings", label: "Settings", icon: Settings },
];

function useActive() {
  const pathname = usePathname();
  return (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
}

export function SideNav() {
  const isActive = useActive();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? "page" : undefined}
          className="flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium text-ink-2 hover:bg-[var(--nav-active-bg)] hover:text-ink aria-[current=page]:bg-[var(--nav-active-bg)] aria-[current=page]:text-ink"
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function BottomNav() {
  const isActive = useActive();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {ITEMS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? "page" : undefined}
          className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted aria-[current=page]:text-accent-ink"
        >
          <Icon aria-hidden className="size-5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
