"use client";

import { act } from "@/features/quality/shared/client";
import type { RegisterConfig } from "@/features/quality/shared/Register";
import { badge, calendarDate, col, opts, quantity, strong, text } from "@/features/quality/shared/helpers";

// ---------------------------------------------------------------- F334: supplier quality
const supplierRecords: RegisterConfig = {
  key: "supplier-records",
  title: "Supplier quality",
  description: "A scorecard per supplier per period, computed from real inspection and non-conformance records -- never entered by hand.",
  searchLabel: "Search supplier records",
  emptyTitle: "No supplier scorecards yet",
  emptyDescription: "Compute one for a supplier and period.",
  source: { kind: "view", view: "supplier-records" },
  createLabel: "Compute scorecard",
  createPermission: "quality.supplier.manage",
  save: { action: "supplier-record-recompute", success: "Computed." },
  fields: [
    { name: "supplierId", label: "Supplier", kind: "select", options: "suppliers", required: true },
    { name: "periodStart", label: "Period start", kind: "date", required: true },
    { name: "periodEnd", label: "Period end", kind: "date", required: true },
  ],
  columns: () => [
    col("supplier", "Supplier", (r) => String(r.supplier_name ?? r.supplier_id)),
    col("period", "Period", (r) => `${calendarDate(r.period_start)} – ${calendarDate(r.period_end)}`),
    col("inspected", "Inspected", (r) => quantity(r.inspected_count)),
    col("nc", "Non-conformances", (r) => quantity(r.nonconformance_count)),
    col("score", "Score", (r) => quantity(r.quality_score)),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["supplier_name", "status"]),
};

// ---------------------------------------------------------------- F337: audits and findings
const audits: RegisterConfig = {
  key: "audits",
  title: "Quality audits",
  description: "Internal, supplier, process, product, system or compliance audits. Cannot complete with an open major finding unless forced with a reason.",
  searchLabel: "Search audits",
  emptyTitle: "No audits yet",
  emptyDescription: "Plan an audit.",
  source: { kind: "view", view: "audits" },
  filters: [{ name: "status", label: "Status", options: opts("planned", "in_progress", "completed", "cancelled") }],
  createLabel: "Plan an audit",
  createPermission: "quality.audit.manage",
  save: { action: "audit-save", success: "Planned." },
  edit: { action: "audit-save", permission: "quality.audit.manage", show: (r) => r.status === "planned" },
  fields: [
    { name: "title", label: "Title", kind: "text", required: true, wide: true },
    { name: "scope", label: "Scope", kind: "textarea", required: true, wide: true },
    { name: "auditType", label: "Type", kind: "select", defaultValue: "internal", options: opts("internal", "supplier", "process", "product", "system", "compliance") },
    { name: "plannedDate", label: "Planned date", kind: "date" },
  ],
  columns: () => [strong("number", "Number", (r) => String(r.audit_number)), col("title", "Title", (r) => String(r.title)), badge("type", "Type", (r) => r.audit_type), col("planned", "Planned", (r) => calendarDate(r.planned_date)), col("findings", "Findings", (r) => `${quantity(r.major_findings_count)} major / ${quantity(r.finding_total)} total`), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["audit_number", "title", "audit_type", "status"]),
  rowActions: [
    { label: "Start", permission: "quality.audit.manage", show: (r) => r.status === "planned", run: (r) => act("audit-start", { id: r.id }), success: "Started." },
    { label: "Add finding", permission: "quality.audit.manage", show: (r) => r.status === "in_progress", fields: [{ name: "findingType", label: "Type", kind: "select", defaultValue: "observation", options: opts("observation", "minor", "major", "opportunity") }, { name: "clauseReference", label: "Clause reference", kind: "text" }, { name: "description", label: "Description", kind: "textarea", required: true, wide: true }, { name: "dueDate", label: "Due date", kind: "date" }], run: (r, _n, v) => act("audit-finding-add", { auditId: r.id, findingType: v.findingType, clauseReference: v.clauseReference, description: v.description, dueDate: v.dueDate }), success: "Finding added." },
    { label: "Complete", permission: "quality.audit.manage", show: (r) => r.status === "in_progress", fields: [{ name: "summary", label: "Summary", kind: "textarea", wide: true }, { name: "force", label: "Force (even with open major findings)", kind: "bool", defaultValue: "false" }], run: (r, _n, v) => act("audit-complete", { id: r.id, summary: v.summary, force: v.force === "true" }), success: "Completed." },
  ],
};

// ---------------------------------------------------------------- F336: calibration
const calibration: RegisterConfig = {
  key: "calibration",
  title: "Calibration",
  description: "Measuring and test equipment calibration, with a due date. Recording a new calibration for the same equipment automatically supersedes its last valid record.",
  searchLabel: "Search calibration records",
  emptyTitle: "No calibration records yet",
  emptyDescription: "Record a calibration.",
  source: { kind: "view", view: "calibration" },
  filters: [{ name: "status", label: "Status", options: opts("valid", "expired", "superseded") }],
  createLabel: "Record calibration",
  createPermission: "quality.manage",
  save: { action: "calibration-record", success: "Recorded." },
  fields: [
    { name: "equipmentName", label: "Equipment name", kind: "text", required: true },
    { name: "equipmentIdentifier", label: "Equipment identifier / asset tag", kind: "text" },
    { name: "calibrationDate", label: "Calibration date", kind: "date", required: true },
    { name: "dueDate", label: "Next due date", kind: "date", required: true },
    { name: "standardUsed", label: "Standard used", kind: "text" },
    { name: "performedByText", label: "Performed by", kind: "text" },
    { name: "result", label: "Result", kind: "select", defaultValue: "pass", options: opts("pass", "fail", "adjusted") },
    { name: "certificateReference", label: "Certificate reference", kind: "text" },
  ],
  columns: () => [strong("number", "Number", (r) => String(r.calibration_number)), col("equipment", "Equipment", (r) => `${r.equipment_name}${r.equipment_identifier ? ` (${r.equipment_identifier})` : ""}`), col("date", "Calibrated", (r) => calendarDate(r.calibration_date)), col("due", "Due", (r) => calendarDate(r.due_date)), badge("result", "Result", (r) => r.result), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["calibration_number", "equipment_name", "equipment_identifier", "status"]),
};

// ---------------------------------------------------------------- F338: certificates of analysis
const certificates: RegisterConfig = {
  key: "certificates",
  title: "Certificates of analysis",
  description: "Draft, then issue. An issued certificate can be voided with a reason.",
  searchLabel: "Search certificates",
  emptyTitle: "No certificates yet",
  emptyDescription: "Draft a certificate of analysis.",
  source: { kind: "view", view: "certificates" },
  filters: [{ name: "status", label: "Status", options: opts("draft", "issued", "void") }],
  createLabel: "New certificate",
  createPermission: "quality.manage",
  save: { action: "certificate-save", success: "Saved." },
  edit: { action: "certificate-save", permission: "quality.manage", show: (r) => r.status === "draft" },
  fields: [
    { name: "summary", label: "Summary", kind: "text", required: true, wide: true },
    { name: "content", label: "Content", kind: "textarea", wide: true },
    { name: "itemId", label: "Item", kind: "select", options: "items" },
    { name: "partyId", label: "Customer / supplier", kind: "select", options: "customers" },
  ],
  columns: () => [strong("number", "Number", (r) => String(r.certificate_number)), col("summary", "Summary", (r) => String(r.summary)), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["certificate_number", "summary", "status"]),
  rowActions: [
    { label: "Issue", permission: "quality.manage", show: (r) => r.status === "draft", run: (r) => act("certificate-issue", { id: r.id }), success: "Issued." },
    { label: "Void", permission: "quality.manage", show: (r) => r.status === "issued", note: { label: "Reason", required: true }, run: (r, note) => act("certificate-void", { id: r.id, reason: note }), success: "Voided." },
  ],
};

// ---------------------------------------------------------------- F340: quality documents
const documents: RegisterConfig = {
  key: "documents",
  title: "Quality documents",
  description: "Procedures, work instructions, forms and specifications: draft -> review -> approved by a second person -> (later) obsolete, with a new version keeping the history.",
  searchLabel: "Search documents",
  emptyTitle: "No quality documents yet",
  emptyDescription: "Write a procedure or work instruction.",
  source: { kind: "view", view: "documents" },
  filters: [{ name: "status", label: "Status", options: opts("draft", "review", "approved", "obsolete") }],
  createLabel: "New document",
  createPermission: "quality.manage",
  save: { action: "document-save", success: "Saved." },
  edit: { action: "document-save", permission: "quality.manage", show: (r) => r.status !== "approved" },
  fields: [
    { name: "title", label: "Title", kind: "text", required: true, wide: true },
    { name: "documentType", label: "Type", kind: "select", defaultValue: "procedure", options: opts("procedure", "work_instruction", "form", "specification", "policy", "other") },
    { name: "category", label: "Category", kind: "text" },
    { name: "content", label: "Content", kind: "textarea", wide: true },
  ],
  columns: () => [strong("number", "Number", (r) => String(r.document_number)), col("title", "Title", (r) => String(r.title)), badge("type", "Type", (r) => r.document_type), col("version", "Version", (r) => quantity(r.version)), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["document_number", "title", "document_type", "status"]),
  rowActions: [
    { label: "Submit for review", permission: "quality.manage", show: (r) => r.status === "draft", run: (r) => act("document-submit", { id: r.id }), success: "Submitted." },
    { label: "Approve", permission: "quality.manage", show: (r) => r.status === "review", run: (r) => act("document-approve", { id: r.id }), success: "Approved." },
    { label: "New version", permission: "quality.manage", show: (r) => ["approved", "obsolete"].includes(String(r.status)), run: (r) => act("document-revise", { id: r.id }), success: "A new draft version was created." },
    { label: "Make obsolete", permission: "quality.manage", show: (r) => r.status === "approved", note: { label: "Reason", required: true }, run: (r, note) => act("document-obsolete", { id: r.id, reason: note }), success: "Made obsolete." },
  ],
};

// ---------------------------------------------------------------- F335: customer complaints
const complaints: RegisterConfig = {
  key: "complaints",
  title: "Customer complaints",
  description: "Open -> investigating (optionally linked to a non-conformance) -> resolved -> closed.",
  searchLabel: "Search complaints",
  emptyTitle: "No complaints",
  emptyDescription: "Log a customer quality complaint.",
  source: { kind: "view", view: "complaints" },
  filters: [{ name: "status", label: "Status", options: opts("open", "investigating", "resolved", "closed", "cancelled") }],
  createLabel: "Log a complaint",
  createPermission: "quality.nonconformance.manage",
  save: { action: "complaint-create", success: "Logged." },
  fields: [
    { name: "partyId", label: "Customer", kind: "select", options: "customers" },
    { name: "severity", label: "Severity", kind: "select", defaultValue: "minor", options: opts("minor", "major", "critical") },
    { name: "description", label: "Description", kind: "textarea", required: true, wide: true },
    { name: "itemId", label: "Item", kind: "select", options: "items" },
  ],
  columns: () => [strong("number", "Number", (r) => String(r.complaint_number)), col("customer", "Customer", (r) => String(r.party_name ?? "—")), badge("severity", "Severity", (r) => r.severity), col("description", "Description", (r) => String(r.description)), badge("status", "Status", (r) => r.status)],
  searchText: (r) => text(r, ["complaint_number", "party_name", "severity", "description", "status"]),
  rowActions: [
    { label: "Investigate", permission: "quality.nonconformance.manage", show: (r) => r.status === "open", fields: [{ name: "nonconformanceId", label: "Link a non-conformance (optional)", kind: "select", options: "nonconformances" }], run: (r, _n, v) => act("complaint-investigate", { id: r.id, nonconformanceId: v.nonconformanceId }), success: "Investigating." },
    { label: "Resolve", permission: "quality.nonconformance.manage", show: (r) => ["open", "investigating"].includes(String(r.status)), fields: [{ name: "resolution", label: "Resolution", kind: "textarea", required: true, wide: true }], run: (r, _n, v) => act("complaint-resolve", { id: r.id, resolution: v.resolution }), success: "Resolved." },
    { label: "Close", permission: "quality.nonconformance.manage", show: (r) => r.status === "resolved", run: (r) => act("complaint-close", { id: r.id }), success: "Closed." },
  ],
};

export const MANAGEMENT_REGISTERS: Record<string, RegisterConfig> = {
  "supplier-records": supplierRecords,
  audits,
  calibration,
  certificates,
  documents,
  complaints,
};
