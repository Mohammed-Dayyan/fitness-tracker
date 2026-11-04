import type { LogEntry } from "@/lib/server/log";

/** Every log entry emitted during the current test (see setup.ts). */
export const logs: LogEntry[] = [];

/** Entries for one event name, or all of them. */
export const events = (name?: string): LogEntry[] => (name ? logs.filter((l) => l.event === name) : logs);

/** The event names emitted so far, in order. */
export const eventNames = (): string[] => logs.map((l) => l.event);
