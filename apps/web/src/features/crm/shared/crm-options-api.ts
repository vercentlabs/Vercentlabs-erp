"use client";

// Shape mirrors services/api's getCrmOptions (resource-options.js) — over
// 30 differently-shaped reference lists (companies/leadStages/users/tags/
// parties/...), so this is intentionally left as loose per-key rows
// rather than asserting one shared row shape across all of them. Shared
// across every CRM feature area (Leads/Accounts/Contacts/Opportunities/...)
// so there is one fetch per page load, not one per feature.
export async function getCrmOptions(): Promise<{ options: Record<string, Array<Record<string, unknown>>> }> {
  const response = await fetch("/api/crm/options");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "Could not load CRM reference data.");
  }
  return payload;
}
