"use client";

// Attention badges for module sidebars: per module, a reader that returns { badgeKey: label } for the items that declare a `badge`.
// Badges are for counts that need action (alerts, holds, counts in progress) — never ordinary totals. A module without a reader shows none.
type BadgeReader = () => Promise<Record<string, string>>;

async function readInventoryAttention(): Promise<Record<string, string>> {
  const response = await fetch("/api/inventory/attention", { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (!response.ok) return {};
  const payload = await response.json().catch(() => ({}));
  const badges = (payload?.badges ?? {}) as Record<string, string | number | null>;
  return Object.fromEntries(Object.entries(badges).filter(([, value]) => value !== null && value !== 0 && value !== "0").map(([key, value]) => [key, String(value)]));
}

export const SIDEBAR_BADGES: Record<string, BadgeReader> = {
  stock: readInventoryAttention,
};
