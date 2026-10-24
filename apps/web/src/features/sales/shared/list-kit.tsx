"use client";

// What every Sales list carries, as every CRM list does (CRM parity): Columns (which columns show, kept per list on this device),
// Export (the list as filtered, or the ticked rows) and the URL to export with. Lists keep their own views, filters and bulk actions.
import { Download } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { buttonVariants } from "@vercentlabs/design-system";

import { ColumnsMenu, useColumnVisibility, type OptionalColumn } from "@/shared/ui/list";

// The columns a person may hide: every column with a text header except the first (what the row is).
export function useListColumns<T>(storageKey: string, columns: ColumnDef<T, unknown>[]) {
  const optional: OptionalColumn[] = columns.slice(1)
    .filter((column) => typeof column.header === "string" && column.header && column.id && column.enableHiding !== false)
    .map((column) => ({ id: String(column.id), label: String(column.header) }));
  const { visibility, setVisibility } = useColumnVisibility(storageKey, optional);
  return { visibility, setVisibility, menu: optional.length ? <ColumnsMenu columns={optional} visibility={visibility} onChange={setVisibility} /> : null };
}

// The query string for an export: the list's filters (empty and "any" left out) and, for Export selected, the ticked ids.
export function exportHref(base: string, filters: Record<string, unknown>, ids?: string[]) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "" || value === "any" || key === "limit" || key === "offset") continue;
    params.set(key, String(value));
  }
  if (ids?.length) params.set("ids", ids.join(","));
  const query = params.toString();
  return `${base}${query ? `?${query}` : ""}`;
}

export function ExportLink({ href, label = "Export", compact = false }: { href: string; label?: string; compact?: boolean }) {
  return (
    <a className={buttonVariants({ variant: compact ? "secondary" : "outline", size: compact ? "compact" : undefined })} href={href} download>
      {!compact && <Download className="size-4" aria-hidden="true" />}<span>{label}</span>
    </a>
  );
}
