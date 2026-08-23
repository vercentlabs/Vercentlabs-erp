// Lightweight client-side "recent destinations" cache (Part 9). Prompt 6
// documented that the target IA's "Recent Records" has no backing page or
// API yet, and Part 9 is explicit: do not build a persisted subsystem for
// it in this prompt. This is the narrow, safe exception it allows —
// localStorage only, storing nothing but label/href/icon metadata the user
// already had authorized access to render (never a record payload, never a
// query string with potentially sensitive search text), capped small, and
// purely additive UX: if it's ever cleared or unavailable (SSR, private
// browsing, storage disabled), the palette simply shows no "Recent" group —
// it never grants navigation or bypasses any authorization check itself,
// since selecting a recent item still goes through the exact same <Link>
// navigation (and therefore the exact same server-side guards) as any other
// result.
import type { SearchResult } from "@/core/search/types";

const STORAGE_KEY = "vercentlabs.recentDestinations.v1";
const MAX_ENTRIES = 8;

type RecentEntry = Pick<SearchResult, "id" | "type" | "label" | "description" | "href" | "icon" | "moduleId">;

function readAll(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RecentEntry =>
        Boolean(entry) && typeof entry === "object" && typeof (entry as RecentEntry).href === "string",
    );
  } catch {
    return [];
  }
}

export function getRecentDestinations(limit = 5): SearchResult[] {
  return readAll()
    .slice(0, limit)
    .map((entry) => ({ ...entry, type: "recent" }));
}

export function recordRecentDestination(result: Pick<SearchResult, "id" | "type" | "label" | "description" | "href" | "icon" | "moduleId">) {
  if (typeof window === "undefined") return;
  try {
    const existing = readAll().filter((entry) => entry.href !== result.href);
    const next = [
      { id: result.id, type: result.type, label: result.label, description: result.description, href: result.href, icon: result.icon, moduleId: result.moduleId },
      ...existing,
    ].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable/full — recent destinations are a convenience,
    // never load-bearing, so failing silently is correct here.
  }
}

export function clearRecentDestinations() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
