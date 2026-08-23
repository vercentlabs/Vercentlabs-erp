// Unified record-search orchestrator (Part 7) — a narrow endpoint that fans
// out to EXISTING, already-secured domain list functions (Part 32's
// "adapter" pattern) rather than any new SQL. Every adapter below calls the
// exact same service-layer function its own module's list route already
// calls (listCrmRecords, listBusinessDataRecords, listProcurementRecords,
// listSalesOrders/listSalesQuotations, listJournalEntries) with
// `{ search: q, limit }` — so every existing security control those
// functions already apply (Prompt 3's CRM recordScope() owner-scoping,
// procurement's applySupplierFieldVisibility() banking-field redaction,
// sales's redactMargin(), company/branch scoping, permission checks) is
// inherited automatically, not reimplemented here. This route never writes
// raw SQL and never returns a full record — only the minimal safe fields
// mapped into a SearchResult (Part 5/6).
import { requireApiWorkspace, type WorkspaceSessionContext } from "@/core/auth";
import { hasPermission } from "@/core/authorization";
import { requireCrmResourceView } from "@/modules/crm/api";
import { crmApiContext } from "@/modules/crm";
import { businessDataContext } from "@/core/master-data";
import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { accountingSession } from "@/modules/accounting/server";
import { procurementSession } from "@/modules/procurement/server";
import { salesSession } from "@/modules/sales/server";
import { PERMISSIONS } from "@/core/permissions";
import { enforceRateLimit } from "@/core/security";
import type { SearchResult } from "@/core/search/types";
import {
  listCrmRecords,
  listBusinessDataRecords,
  listProcurementRecords,
  listSalesOrders,
  listQuotations,
  listJournalEntries,
} from "@vercentlabs/api";

// Query-safety bounds (Part 31) — this is an authenticated-only, internal
// ERP endpoint (requireApiWorkspace below), not the public lead-capture
// surface, so it deliberately does NOT reuse that endpoint's rate limiter
// (Part 31: "do not reuse public lead-form rate limiting blindly") — the
// session requirement plus these bounds are the right-sized protection for
// an internal search box.
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const PER_ADAPTER_LIMIT = 5;
const TOTAL_RESULT_LIMIT = 20;

function safeLabel(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "Untitled record";
}

function safeDescription(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return undefined;
}

type Row = Record<string, unknown>;

async function searchCrm(session: WorkspaceSessionContext, q: string, limit: number): Promise<SearchResult[]> {
  const resources: Array<{ resource: "leads" | "opportunities" | "activities"; label: string; href: (row: Row) => string }> = [
    { resource: "leads", label: "Lead", href: (row) => `/crm/leads/${String(row.id)}` },
    { resource: "opportunities", label: "Opportunity", href: (row) => `/crm/opportunities/${String(row.id)}` },
    { resource: "activities", label: "Activity", href: (row) => `/crm/activities/${String(row.id)}` },
  ];
  const results: SearchResult[] = [];
  for (const { resource, label, href } of resources) {
    try {
      if (!hasPermission(session, PERMISSIONS.crmView)) return [];
      requireCrmResourceView(session, resource);
      const context = await crmApiContext(session);
      const perAdapterRemaining = limit - results.length;
      if (perAdapterRemaining <= 0) break;
      const { rows } = await tenantTransaction(context.organizationId, (client) =>
        listCrmRecords(client, context, resource, { search: q, limit: Math.min(perAdapterRemaining, PER_ADAPTER_LIMIT) }),
      );
      for (const row of rows as Row[]) {
        results.push({
          id: `crm:${resource}:${String(row.id)}`,
          type: "record",
          label: safeLabel(
            row.name,
            row.subject,
            [row.firstName, row.lastName].filter(Boolean).join(" "),
            row.companyName,
            row.code,
          ),
          description: safeDescription(label, row.companyName !== row.name ? row.companyName : undefined, row.city, row.status),
          href: href(row),
          icon: "crm",
          moduleId: "crm",
        });
      }
    } catch {
      // Module disabled / not entitled / no permission for this resource —
      // skip this resource, never fail the whole search (Part 24).
    }
  }
  return results;
}

async function searchBusinessData(session: WorkspaceSessionContext, q: string, limit: number): Promise<SearchResult[]> {
  if (!hasPermission(session, PERMISSIONS.businessDataView)) return [];
  const resources: Array<{ resource: "parties" | "items"; label: string; icon: SearchResult["icon"]; href: (row: Row) => string }> = [
    { resource: "parties", label: "Party", icon: "companies", href: (row) => `/crm/accounts/${String(row.id)}` },
    { resource: "items", label: "Item", icon: "modules", href: () => `/master-data/items` },
  ];
  const results: SearchResult[] = [];
  for (const { resource, label, icon, href } of resources) {
    try {
      const context = businessDataContext(session);
      const perAdapterRemaining = limit - results.length;
      if (perAdapterRemaining <= 0) break;
      const { rows } = await tenantTransaction(context.organizationId, (client) =>
        listBusinessDataRecords(client, context, resource, { search: q, limit: Math.min(perAdapterRemaining, PER_ADAPTER_LIMIT) }),
      );
      for (const row of rows as Row[]) {
        results.push({
          id: `business-data:${resource}:${String(row.id)}`,
          type: "record",
          label: safeLabel(row.displayName, row.name, row.legalName, row.code),
          description: safeDescription(label, row.code, row.city),
          href: href(row),
          icon,
        });
      }
    } catch {
      // Business-data is permission-gated, not module-gated — a thrown
      // error here means the query itself failed; skip, don't fail search.
    }
  }
  return results;
}

async function searchProcurement(session: WorkspaceSessionContext, q: string, limit: number): Promise<SearchResult[]> {
  try {
    const { context } = await procurementSession();
    const resources: Array<{ resource: string; label: string; href: (row: Row) => string }> = [
      { resource: "suppliers", label: "Supplier", href: (row) => `/procurement/suppliers/${String(row.id)}` },
      { resource: "purchase-orders", label: "Purchase order", href: (row) => `/procurement/orders/${String(row.id)}` },
    ];
    const results: SearchResult[] = [];
    for (const { resource, label, href } of resources) {
      const perAdapterRemaining = limit - results.length;
      if (perAdapterRemaining <= 0) break;
      const { rows } = await tenantTransaction(context.organizationId, (client) =>
        listProcurementRecords(client, context, resource, { search: q, limit: Math.min(perAdapterRemaining, PER_ADAPTER_LIMIT) }),
      );
      for (const row of rows as Row[]) {
        results.push({
          id: `procurement:${resource}:${String(row.id)}`,
          type: "record",
          label: safeLabel(row.name, row.displayName, row.legalName, row.orderNumber, row.code),
          description: safeDescription(label, row.code ?? row.status),
          href: href(row),
          icon: "procurement",
          moduleId: "procurement",
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

async function searchSales(session: WorkspaceSessionContext, q: string, limit: number): Promise<SearchResult[]> {
  try {
    const { context } = await salesSession();
    const results: SearchResult[] = [];
    const [orders, quotations] = await Promise.all([
      tenantTransaction(context.organizationId, (client) => listSalesOrders(client, context, { search: q, limit: PER_ADAPTER_LIMIT })),
      tenantTransaction(context.organizationId, (client) => listQuotations(client, context, { search: q, limit: PER_ADAPTER_LIMIT })),
    ]);
    for (const row of orders as Row[]) {
      if (results.length >= limit) break;
      const customer = row.customerSnapshot as { displayName?: string } | undefined;
      results.push({
        id: `sales:orders:${String(row.id)}`,
        type: "record",
        label: safeLabel(row.salesOrderNumber, row.orderNumber),
        description: safeDescription("Sales order", customer?.displayName, row.lifecycleStatus),
        href: `/sales/orders/${String(row.id)}`,
        icon: "sales",
        moduleId: "sales",
      });
    }
    for (const row of quotations as Row[]) {
      if (results.length >= limit) break;
      results.push({
        id: `sales:quotations:${String(row.id)}`,
        type: "record",
        label: safeLabel(row.quotationNumber),
        description: safeDescription("Quotation", row.customerName, row.lifecycleStatus),
        href: `/sales/quotations/${String(row.id)}`,
        icon: "sales",
        moduleId: "sales",
      });
    }
    return results;
  } catch {
    return [];
  }
}

async function searchAccounting(session: WorkspaceSessionContext, q: string, limit: number): Promise<SearchResult[]> {
  try {
    const { context } = await accountingSession();
    const rows = (await tenantTransaction(context.organizationId, (client) =>
      listJournalEntries(client, context, { search: q }),
    )) as Row[];
    return rows.slice(0, limit).map((row) => ({
      id: `accounting:journals:${String(row.id)}`,
      type: "record" as const,
      label: safeLabel(row.entryNumber, row.reference),
      description: safeDescription(row.description, row.journalName, row.status),
      href: `/accounting/journals/${String(row.id)}`,
      icon: "accounting" as const,
      moduleId: "accounting" as const,
    }));
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireApiWorkspace();
    const rawQuery = new URL(request.url).searchParams.get("q") ?? "";
    const q = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
    if (q.length < MIN_QUERY_LENGTH) {
      return ok({ results: [] as SearchResult[] });
    }

    // Part 31 — per-user, not the public lead-capture endpoint's IP/
    // fingerprint-based limiter (that would conflate every user behind the
    // same office/VPN egress IP). Generous enough for normal debounced
    // typing (the client already debounces at 250ms) while still bounding
    // an authenticated client from scripting unbounded direct requests.
    await enforceRateLimit(`search:${session.userId}`, 60, 60);

    const adapters = [searchCrm, searchBusinessData, searchProcurement, searchSales, searchAccounting];
    const settled = await Promise.allSettled(
      adapters.map((adapter) => adapter(session, q, PER_ADAPTER_LIMIT)),
    );
    const results: SearchResult[] = [];
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") results.push(...outcome.value);
      // A rejected adapter (unexpected error) is dropped silently — one
      // module's search failure must never fail the whole response
      // (Part 24), and must never expose its error detail to the client.
    }
    return ok({ results: results.slice(0, TOTAL_RESULT_LIMIT) });
  } catch (error) {
    return errorResponse(error);
  }
}
