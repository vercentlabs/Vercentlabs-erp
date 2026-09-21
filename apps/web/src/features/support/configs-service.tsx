"use client";

import { act } from "@/features/support/shared/client";
import type { RegisterConfig } from "@/features/support/shared/Register";
import { badge, calendarDate, col, opts, quantity, strong, text } from "@/features/support/shared/helpers";

// ---------------------------------------------------------------- F375: entitlements
const entitlements: RegisterConfig = {
  key: "entitlements",
  title: "Entitlements",
  description: "A customer's (and optionally one product's) service plan or warranty: which SLA policy applies, and an optional cap on how many tickets it covers.",
  searchLabel: "Search entitlements",
  emptyTitle: "No entitlements yet",
  emptyDescription: "Add an entitlement for a customer's service plan or warranty.",
  source: { kind: "view", view: "entitlements" },
  createLabel: "New entitlement",
  createPermission: "support.manage",
  save: { action: "entitlement-save", success: "Saved." },
  edit: { action: "entitlement-save", permission: "support.manage" },
  fields: [
    { name: "partyId", label: "Customer", kind: "select", options: "customers", required: true, createOnly: true },
    { name: "productId", label: "Product (optional)", kind: "select", options: "products" },
    { name: "tier", label: "Tier", kind: "select", defaultValue: "standard", options: opts("standard", "premium", "enterprise") },
    { name: "source", label: "Source", kind: "select", defaultValue: "manual", options: opts("manual", "warranty", "subscription"), createOnly: true },
    { name: "slaPolicyId", label: "SLA policy", kind: "select", options: "slaPolicies", rowKey: "sla_policy_id" },
    { name: "startsOn", label: "Start date", kind: "date", required: true, rowKey: "starts_on" },
    { name: "endsOn", label: "End date (blank = open-ended)", kind: "date", rowKey: "ends_on" },
    { name: "ticketQuota", label: "Ticket quota (blank = unlimited)", kind: "number", step: 1, min: 1, rowKey: "ticket_quota" },
    { name: "notes", label: "Notes", kind: "textarea", wide: true },
  ],
  columns: () => [
    strong("number", "Number", (r) => String(r.entitlement_number)),
    col("customer", "Customer", (r) => String(r.party_name)),
    col("product", "Product", (r) => String(r.product_name ?? "All products")),
    badge("tier", "Tier", (r) => r.tier),
    col("period", "Period", (r) => `${calendarDate(r.starts_on)} – ${r.ends_on ? calendarDate(r.ends_on) : "open"}`),
    col("used", "Tickets used", (r) => (r.ticket_quota === null ? `${quantity(r.tickets_used)} (unlimited)` : `${quantity(r.tickets_used)} / ${quantity(r.ticket_quota)}`)),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["entitlement_number", "party_name", "product_name", "tier", "status"]),
  rowActions: [
    { label: "Suspend", permission: "support.manage", show: (r) => r.status === "active", run: (r) => act("entitlement-status", { id: r.id, status: "suspended" }), success: "Suspended." },
    { label: "Reactivate", permission: "support.manage", show: (r) => r.status === "suspended", run: (r) => act("entitlement-status", { id: r.id, status: "active" }), success: "Reactivated." },
    { label: "Cancel", permission: "support.manage", show: (r) => ["active", "suspended"].includes(String(r.status)), run: (r) => act("entitlement-status", { id: r.id, status: "cancelled" }), success: "Cancelled." },
  ],
};

// ---------------------------------------------------------------- F371: portal user administration
const portalUsers: RegisterConfig = {
  key: "portal-users",
  title: "Portal access",
  description: "Which of a customer's contacts can sign in to the support portal and act for that customer -- create their own tickets, reply, see their tickets and rate the service.",
  searchLabel: "Search portal users",
  emptyTitle: "No portal users yet",
  emptyDescription: "Invite a customer contact who already has a user account.",
  source: { kind: "view", view: "portal-users" },
  createLabel: "Invite portal user",
  createPermission: "support.manage",
  save: { action: "portal-user-invite", success: "Invited." },
  fields: [
    { name: "partyId", label: "Customer", kind: "select", options: "customers", required: true },
    { name: "userId", label: "User (their platform account id)", kind: "text", required: true },
    { name: "contactId", label: "Contact (optional)", kind: "text" },
  ],
  columns: () => [col("customer", "Customer", (r) => String(r.party_name ?? r.party_id)), col("user", "User id", (r) => String(r.user_id)), badge("status", "Status", (r) => r.status), col("invited", "Invited", (r) => calendarDate(r.created_at))],
  searchText: (r) => text(r, ["party_id", "user_id", "status"]),
  rowActions: [
    { label: "Suspend", permission: "support.manage", show: (r) => r.status === "active", run: (r) => act("portal-user-status", { id: r.id, status: "suspended" }), success: "Suspended." },
    { label: "Reactivate", permission: "support.manage", show: (r) => r.status === "suspended", run: (r) => act("portal-user-status", { id: r.id, status: "active" }), success: "Reactivated." },
  ],
};

export const SERVICE_REGISTERS: Record<string, RegisterConfig> = {
  entitlements,
  "portal-users": portalUsers,
};
