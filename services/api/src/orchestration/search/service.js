// Global record search: one server-side entry point over the registered
// providers. A provider runs only when its module is released, enabled and
// entitled for the organisation and the caller holds its permission
// (accessibleModules comes from the request's WorkspaceAccessSnapshot); the
// provider's own domain function then applies record-level scope.
//
// Each provider runs in its own SAVEPOINT, so one failure is reported as
// "unavailable" for that source and never breaks the others (or aborts the
// surrounding tenant transaction).
import { createLogger, redact } from "@vercentlabs/observability";

import { hasSessionPermission } from "../../core/access/index.js";
import { SEARCH_PROVIDERS } from "./providers.js";

const logger = createLogger("global-search");

export const SEARCH_LIMITS = Object.freeze({ minLength: 2, maxLength: 100, perProvider: 6, total: 36 });

export class SearchError extends Error {
  constructor(status, message, code = "SEARCH_INVALID") {
    super(message);
    this.name = "SearchError";
    this.status = status;
    this.code = code;
  }
}

// Wildcards and escape characters are removed so a query can never widen a
// LIKE pattern; everything is passed to SQL as a parameter by the providers.
export function normalizeSearchQuery(raw) {
  const cleaned = String(raw ?? "").replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < SEARCH_LIMITS.minLength) return null;
  return cleaned.slice(0, SEARCH_LIMITS.maxLength);
}

function moduleContext(session) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies: session.roleSlugs.includes("organization_owner") || session.roleSlugs.includes("system_administrator"),
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}

export function searchableProviders(session, accessibleModules, providers = SEARCH_PROVIDERS) {
  const modules = new Set(accessibleModules || []);
  return providers.filter((provider) => modules.has(provider.moduleKey) && hasSessionPermission(session, provider.requiredPermission));
}

// `providers` defaults to the registry; it is a seam for tests only.
export async function searchRecords(client, session, { query, accessibleModules = [], providers = SEARCH_PROVIDERS }) {
  const term = normalizeSearchQuery(query);
  if (!term) throw new SearchError(400, `Type at least ${SEARCH_LIMITS.minLength} characters to search.`, "SEARCH_QUERY_TOO_SHORT");
  const context = moduleContext(session);
  const groups = [];
  let total = 0;
  for (const provider of searchableProviders(session, accessibleModules, providers)) {
    const remaining = SEARCH_LIMITS.total - total;
    if (remaining <= 0) break;
    await client.query("SAVEPOINT global_search_provider");
    try {
      const hits = (await provider.execute(client, context, term, Math.min(SEARCH_LIMITS.perProvider, remaining))).slice(0, Math.min(SEARCH_LIMITS.perProvider, remaining));
      await client.query("RELEASE SAVEPOINT global_search_provider");
      total += hits.length;
      groups.push({
        sourceKey: provider.key,
        sourceLabel: provider.label,
        moduleKey: provider.moduleKey,
        status: "ok",
        results: hits.map((hit) => ({ sourceKey: provider.key, sourceLabel: provider.label, moduleKey: provider.moduleKey, ...hit })),
      });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT global_search_provider");
      logger.warn("search provider failed", { provider: provider.key, moduleKey: provider.moduleKey, error: redact(String(error?.message || error)).slice(0, 300) });
      groups.push({ sourceKey: provider.key, sourceLabel: provider.label, moduleKey: provider.moduleKey, status: "unavailable", results: [] });
    }
  }
  return { query: term, groups };
}
