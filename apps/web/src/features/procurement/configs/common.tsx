import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@vercentlabs/design-system";

import type { ProcRecord } from "@/features/procurement/shared/api";
import { statusLabel, statusTone } from "@/features/procurement/shared/format";

export type Col = ColumnDef<ProcRecord, unknown>;
export const col = (
  id: string,
  header: string,
  get: (record: ProcRecord) => string | number,
): Col => ({ id, header, accessorFn: (record) => get(record) });
export const statusCol = (): Col => ({
  id: "status",
  header: "Status",
  accessorKey: "status",
  cell: ({ row }) => (
    <StatusBadge tone={statusTone(row.original.status)}>
      {statusLabel(row.original.status)}
    </StatusBadge>
  ),
});
export const boldCol = (
  id: string,
  header: string,
  get: (record: ProcRecord) => string,
): Col => ({
  id,
  header,
  accessorFn: (record) => get(record),
  cell: ({ row }) => (
    <span className="font-medium text-text">{get(row.original)}</span>
  ),
});
