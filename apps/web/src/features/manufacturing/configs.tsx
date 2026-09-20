"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { StatusBadge } from "@vercentlabs/design-system";

import { act, type Row } from "@/features/manufacturing/shared/client";
import { calendarDate, dateTime, label, quantity, tone } from "@/features/manufacturing/shared/format";
import type { RegisterConfig } from "@/features/manufacturing/shared/Register";

type Col = ColumnDef<Row, unknown>;
// `cell` is only set when given: an explicit undefined would replace the grid's default renderer with nothing.
export const col = (id: string, header: string, accessorFn: (row: Row) => string, cell?: Col["cell"]): Col => (cell ? { id, header, accessorFn, cell } : { id, header, accessorFn }) as Col;
export const badge = (id: string, header: string, value: (row: Row) => unknown): Col => ({ id, header, accessorFn: (row) => label(value(row)), cell: ({ row }) => <StatusBadge tone={tone(value(row.original))}>{label(value(row.original))}</StatusBadge> }) as Col;
export const strong = (id: string, header: string, value: (row: Row) => string): Col => col(id, header, value, ({ row }) => <span className="font-medium text-text">{value(row.original)}</span>);
export const link = (id: string, header: string, value: (row: Row) => string, href: (row: Row) => string): Col => col(id, header, value, ({ row }) => <Link className="font-medium text-brand hover:underline" href={href(row.original)}>{value(row.original)}</Link>);
export const text = (row: Row, keys: string[]) => keys.map((key) => String(row[key] ?? "")).join(" ");

const BOM_STATUSES = ["draft", "pending_approval", "active", "inactive", "obsolete"].map((value) => ({ value, label: label(value) }));

const boms: RegisterConfig = {
  key: "boms",
  title: "Bills of materials",
  description: "What goes into each product, with quantities, scrap allowance and issue method. A structure is approved by a second person before it can be used.",
  searchLabel: "Search BOMs",
  emptyTitle: "No BOMs yet",
  emptyDescription: "Create a BOM to define what a product is made of.",
  source: { kind: "view", view: "boms" },
  filters: [{ name: "status", label: "Status", options: BOM_STATUSES }],
  createLabel: "New BOM",
  createPermission: "manufacturing.bom.manage",
  newHref: "/manufacturing/bom/new",
  columns: () => [
    link("code", "BOM", (r) => `${r.code} v${r.version}`, (r) => `/manufacturing/bom/${r.id}`),
    col("product", "Product", (r) => `${r.item_name} (${r.item_code})`),
    badge("status", "Status", (r) => r.status),
    col("kind", "Kind", (r) => (r.is_alternate ? `Alternate ${r.alternate_priority}` : r.is_default ? "Default" : "—")),
    col("out", "Output", (r) => quantity(r.output_quantity)),
    col("components", "Components", (r) => String(r.component_count)),
    col("from", "Effective from", (r) => calendarDate(r.effective_from)),
    col("to", "Effective to", (r) => calendarDate(r.effective_to)),
  ],
  searchText: (r) => text(r, ["code", "name", "item_name", "item_code", "status"]),
};

const bomVersions: RegisterConfig = {
  ...boms,
  key: "bom-versions",
  title: "BOM versions",
  description: "Every version and revision of every BOM. A change is a new version that goes through approval; the version it replaces is retired but kept.",
  createLabel: undefined,
  createPermission: undefined,
  columns: () => [
    link("code", "BOM", (r) => String(r.code), (r) => `/manufacturing/bom/${r.id}`),
    col("version", "Version", (r) => `v${r.version}`),
    col("revision", "Revision", (r) => String(r.revision ?? "—")),
    badge("status", "Status", (r) => r.status),
    col("product", "Product", (r) => `${r.item_name} (${r.item_code})`),
    col("created", "Created", (r) => dateTime(r.created_at)),
    col("approved", "Approved", (r) => dateTime(r.approved_at)),
  ],
};

const CHANGE_STATUSES = ["draft", "submitted", "approved", "rejected", "implemented", "cancelled"].map((value) => ({ value, label: label(value) }));
const engineeringChanges: RegisterConfig = {
  key: "engineering-changes",
  title: "Engineering changes",
  description: "A controlled change to a released BOM: proposed, approved by someone other than the requester, then implemented into a new active version. Open work orders keep the BOM they started with. Propose a change from an active BOM.",
  searchLabel: "Search changes",
  emptyTitle: "No engineering changes",
  emptyDescription: "Open an active BOM and choose Propose change.",
  source: { kind: "view", view: "changes" },
  filters: [{ name: "status", label: "Status", options: CHANGE_STATUSES }],
  columns: () => [
    strong("no", "Change", (r) => String(r.change_number)),
    col("title", "Title", (r) => String(r.title)),
    badge("status", "Status", (r) => r.status),
    col("bom", "BOM", (r) => `${r.bom_code} v${r.bom_version}`),
    col("product", "Product", (r) => `${r.item_name} (${r.item_code})`),
    col("components", "Proposed lines", (r) => String(r.component_count)),
    col("effective", "Effective from", (r) => calendarDate(r.effective_from)),
    col("result", "Result", (r) => "", ({ row }) => (row.original.resulting_bom_id ? <Link className="text-brand hover:underline" href={`/manufacturing/bom/${row.original.resulting_bom_id}`}>New version</Link> : <span>—</span>)),
  ],
  searchText: (r) => text(r, ["change_number", "title", "bom_code", "item_name", "status"]),
  rowActions: [
    { label: "Submit", permission: "manufacturing.bom.manage", show: (r) => r.status === "draft", success: "Change submitted.", run: (r) => act("change-submit", { id: r.id }) },
    { label: "Approve", permission: "manufacturing.manage", show: (r) => r.status === "submitted", success: "Change approved.", run: (r) => act("change-decide", { id: r.id, approve: true }) },
    { label: "Reject", permission: "manufacturing.manage", show: (r) => r.status === "submitted", note: { label: "Reason", required: true }, success: "Change rejected.", run: (r, note) => act("change-decide", { id: r.id, approve: false, note }) },
    { label: "Implement", permission: "manufacturing.bom.manage", show: (r) => r.status === "approved", success: "Change implemented — a new BOM version is active.", run: (r) => act("change-implement", { id: r.id }) },
    { label: "Cancel", permission: "manufacturing.bom.manage", show: (r) => ["draft", "submitted", "approved"].includes(String(r.status)), note: { label: "Reason", required: true }, success: "Change cancelled.", run: (r, note) => act("change-cancel", { id: r.id, reason: note }) },
  ],
};

export const REGISTERS: Record<string, RegisterConfig> = {
  boms,
  "bom-versions": bomVersions,
  "engineering-changes": engineeringChanges,
};
