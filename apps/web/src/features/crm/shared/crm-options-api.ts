"use client";

import { readJsonResponse } from "../../../shared/http/request-json.ts";

// Shape mirrors services/api's getCrmOptions (resource-options.js) — over
// 30 differently-shaped reference lists (pipelines/leadStages/users/tags/
// parties/...), so this is intentionally left as loose per-key rows
// rather than asserting one shared row shape across all of them. Shared
// across every CRM feature area (Leads/Accounts/Contacts/Opportunities/...)
// so there is one fetch per page load, not one per feature.
export async function getCrmOptions(): Promise<{
  options: Record<string, Array<Record<string, unknown>>>;
}> {
  // Deliberately a plain Error with its own fallback message (callers show it
  // as-is); only the JSON response contract is shared.
  return readJsonResponse(
    await fetch("/api/crm/options"),
    (payload) =>
      new Error(payload.message || "Could not load CRM reference data."),
  );
}
