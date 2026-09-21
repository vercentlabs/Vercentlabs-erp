"use client";

import { act } from "@/features/quality/shared/client";
import type { RegisterConfig } from "@/features/quality/shared/Register";
import { badge, col, opts, quantity, strong, text } from "@/features/quality/shared/helpers";

const PLAN_TYPES = opts("incoming", "in_process", "final", "stock_audit", "supplier", "customer_return");

// ---------------------------------------------------------------- F308-311/F318: quality plans (list only -- creation is a dedicated builder screen, see PlanBuilderScreen)
const plans: RegisterConfig = {
  key: "plans",
  title: "Quality plans",
  description: "What to check, and against what tolerance, for incoming/in-process/final inspection. A plan is approved by someone other than its author before it governs real inspections.",
  searchLabel: "Search plans",
  emptyTitle: "No quality plans yet",
  emptyDescription: "Build a plan to start inspecting against it.",
  source: { kind: "view", view: "plans" },
  filters: [{ name: "planType", label: "Type", options: PLAN_TYPES }, { name: "status", label: "Status", options: opts("draft", "active", "inactive", "obsolete") }],
  createLabel: "New plan",
  newHref: "/quality/plan-builder",
  createPermission: "quality.plan.manage",
  columns: () => [strong("code", "Code", (r) => `${r.code} v${r.version}`), col("name", "Name", (r) => String(r.name)), badge("type", "Type", (r) => r.plan_type), col("points", "Points", (r) => quantity(r.point_count)), col("sampling", "Sampling", (r) => `${r.sampling_method}${r.sampling_method === "percentage" ? ` (${r.sampling_value}%)` : ""}`), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["code", "name", "plan_type", "status"]),
  rowActions: [
    { label: "Approve", permission: "quality.plan.manage", show: (r) => r.status === "draft", run: (r) => act("plan-approve", { id: r.id }), success: "Approved. It now governs real inspections." },
    { label: "Revise (new version)", permission: "quality.plan.manage", show: (r) => ["active", "obsolete"].includes(String(r.status)), run: (r) => act("plan-revise", { id: r.id }), success: "A new draft version was created." },
    { label: "Retire", permission: "quality.plan.manage", show: (r) => ["active", "inactive"].includes(String(r.status)), note: { label: "Reason", required: true }, run: (r, note) => act("plan-retire", { id: r.id, reason: note }), success: "Retired." },
  ],
};

// ---------------------------------------------------------------- F315: AQL sampling plans
const samplingPlans: RegisterConfig = {
  key: "sampling-plans",
  title: "Sampling plans (AQL)",
  description: "Sample size, and the accept/reject numbers, by lot-size bracket. Several brackets share one code to form a full AQL table -- a plan set to sample by AQL picks the bracket that covers its lot size automatically.",
  searchLabel: "Search sampling plans",
  emptyTitle: "No sampling plans yet",
  emptyDescription: "Add a bracket for a lot-size range.",
  source: { kind: "view", view: "sampling-plans" },
  createLabel: "New bracket",
  createPermission: "quality.sampling.manage",
  save: { action: "sampling-plan-save", success: "Saved." },
  edit: { action: "sampling-plan-save", permission: "quality.sampling.manage" },
  fields: [
    { name: "code", label: "Code (shared by every bracket in this table)", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "aqlLevel", label: "AQL level", kind: "text", defaultValue: "II", rowKey: "aql_level" },
    { name: "lotSizeFrom", label: "Lot size from", kind: "number", step: 1, min: 1, required: true, rowKey: "lot_size_from" },
    { name: "lotSizeTo", label: "Lot size to (blank = no upper limit)", kind: "number", step: 1, rowKey: "lot_size_to" },
    { name: "sampleSize", label: "Sample size", kind: "number", step: 1, min: 1, required: true, rowKey: "sample_size" },
    { name: "acceptanceNumber", label: "Accept if defects ≤", kind: "number", step: 1, rowKey: "acceptance_number" },
    { name: "rejectionNumber", label: "Reject if defects ≥", kind: "number", step: 1, min: 1, required: true, rowKey: "rejection_number" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), col("range", "Lot size", (r) => `${quantity(r.lot_size_from)} – ${r.lot_size_to === null ? "∞" : quantity(r.lot_size_to)}`), col("sample", "Sample", (r) => quantity(r.sample_size)), col("acc", "Accept/Reject", (r) => `${quantity(r.acceptance_number)} / ${quantity(r.rejection_number)}`), badge("status", "Status", (r) => (r.active ? "active" : "inactive"))],
  searchText: (r) => text(r, ["code", "name", "aql_level"]),
};

// ---------------------------------------------------------------- F322-324: quality holds
const holds: RegisterConfig = {
  key: "holds",
  title: "Quality holds",
  description: "A hold blocks Stock from moving the covered quantity of an item until it is released -- enforced inside Stock's own movement check, not just a warning here.",
  searchLabel: "Search holds",
  emptyTitle: "No holds",
  emptyDescription: "A hold appears here once placed, manually or automatically after a failed inspection.",
  source: { kind: "view", view: "holds" },
  filters: [{ name: "status", label: "Status", options: opts("active", "released", "cancelled") }],
  createLabel: "Place a hold",
  createPermission: "quality.hold",
  save: { action: "hold-create", success: "Hold placed. Stock cannot move the held quantity until it is released." },
  fields: [
    { name: "holdType", label: "Type", kind: "select", defaultValue: "inventory", options: opts("inventory", "batch", "serial", "receipt", "work_order", "shipment", "return") },
    { name: "itemId", label: "Item", kind: "select", options: "items" },
    { name: "warehouseId", label: "Warehouse", kind: "select", options: "warehouses" },
    { name: "quantity", label: "Quantity (0 = the whole item/scope)", kind: "number", step: 1 },
    { name: "reason", label: "Reason", kind: "textarea", required: true, wide: true },
  ],
  columns: () => [strong("number", "Hold", (r) => String(r.hold_number)), badge("type", "Type", (r) => r.hold_type), col("qty", "Quantity", (r) => `${quantity(r.released_quantity)} / ${r.quantity === "0" || r.quantity === 0 ? "all" : quantity(r.quantity)} released`), col("reason", "Reason", (r) => String(r.reason)), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["hold_number", "hold_type", "reason", "status"]),
  rowActions: [
    { label: "Release", permission: "quality.release", show: (r) => r.status === "active", fields: [{ name: "quantity", label: "Quantity (blank = release the rest)", kind: "number", step: 1 }], note: { label: "Reason", required: true }, run: (r, note, v) => act("hold-release", { id: r.id, quantity: v.quantity || undefined, reason: note, idempotencyKey: `${r.id}-${Date.now()}` }), success: "Released." },
    { label: "Cancel", permission: "quality.hold", show: (r) => r.status === "active", note: { label: "Reason", required: true }, run: (r, note) => act("hold-cancel", { id: r.id, reason: note }), success: "Cancelled." },
  ],
};

export const CORE_REGISTERS: Record<string, RegisterConfig> = {
  plans,
  "sampling-plans": samplingPlans,
  holds,
};
