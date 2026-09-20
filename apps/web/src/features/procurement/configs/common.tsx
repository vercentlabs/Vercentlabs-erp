import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@vercentlabs/design-system";

import type { ProcRecord } from "@/features/procurement/shared/api";
import { calendarDate, money, quantity, statusLabel, statusTone } from "@/features/procurement/shared/format";
import type { Lookup } from "@/features/procurement/shared/use-lookup";

export type Col = ColumnDef<ProcRecord, unknown>;
export const col = (id: string, header: string, get: (record: ProcRecord) => string | number): Col => ({ id, header, accessorFn: (record) => get(record) });
export const statusCol = (): Col => ({ id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.status)}>{statusLabel(row.original.status)}</StatusBadge> });
export const boldCol = (id: string, header: string, get: (record: ProcRecord) => string): Col => ({ id, header, accessorFn: (record) => get(record), cell: ({ row }) => <span className="font-medium text-text">{get(row.original)}</span> });
export const total = (record: ProcRecord) => money(record.currencyCode, record.totals?.grandTotal ?? record.totalAmount);
export const dateCol = (id: string, header: string, key: string): Col => col(id, header, (record) => calendarDate(record[key]));

export type LineCol = ColumnDef<Record<string, unknown>, unknown>;
// Standard document line columns. Prices are the server's decimal strings.
export const lineColumns = (lookup: Lookup, opts: { received?: boolean; accepted?: boolean } = {}): LineCol[] => [
  { id: "desc", header: "Description", accessorFn: (line) => String(line.description ?? "—") },
  { id: "item", header: "Item", accessorFn: (line) => (line.itemId ? lookup.item(line.itemId) : "—") },
  { id: "qty", header: "Quantity", accessorFn: (line) => quantity(line.quantity ?? line.acceptedQuantity) },
  ...(opts.received ? [{ id: "recv", header: "Received", accessorFn: (line: Record<string, unknown>) => quantity(line.receivedQuantity) }] : []),
  ...(opts.accepted ? [{ id: "acc", header: "Accepted", accessorFn: (line: Record<string, unknown>) => quantity(line.acceptedQuantity) }, { id: "rej", header: "Rejected", accessorFn: (line: Record<string, unknown>) => quantity(line.rejectedQuantity) }] : []),
  { id: "price", header: "Unit price", accessorFn: (line) => (line.unitPrice !== undefined ? Number(line.unitPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "—") },
  { id: "tax", header: "Tax", accessorFn: (line) => (line.taxAmount !== undefined ? Number(line.taxAmount).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—") },
];

export const currencyField = { name: "currencyCode", label: "Currency", kind: "text" as const, defaultValue: "INR" };
