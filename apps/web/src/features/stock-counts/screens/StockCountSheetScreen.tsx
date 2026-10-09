"use client";

// The printable count sheet: every line (serial numbers one per row) with a blank Counted column; the system quantity only on a count that is
// not blind. Print it from the browser.
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { formatDateTime } from "@/shared/format/human";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, getCount } from "../api/stock-counts-api";

export function StockCountSheetScreen({ countId }: { countId: string }) {
  const workspace = useWorkspaceContext();
  const detail = useQuery({ queryKey: scopedQueryKey(workspace, "stock-counts", "detail", countId), queryFn: () => getCount(countId) });
  if (detail.isLoading) return <LoadingState label="Loading count sheet" rows={5} />;
  if (detail.isError) return <ErrorState title="Could not load the count sheet" description={errorMessage(detail.error)} />;
  const data = detail.data!;
  const withSystem = !data.count.blindCount;
  const rows = data.lines.flatMap((line) => (line.trackingType === "serial" && line.serials.some((serial) => serial.expected)
    ? line.serials.filter((serial) => serial.expected).map((serial) => ({ line, serial: serial.serialNumber, system: 1 }))
    : [{ line, serial: "", system: line.system ?? null }]));
  return (
    <div className="flex flex-col gap-3 print:text-xs">
      <div className="flex items-start justify-between gap-3">
        <div><h1 className="text-lg font-semibold">Count sheet · {data.count.number}</h1>
          <p className="text-sm text-text-muted">{data.count.warehouse} · {data.count.warehouseName} · {data.count.countTypeLabel}{data.count.snapshotAt ? ` · snapshot ${formatDateTime(data.count.snapshotAt)}` : ""}{data.count.blindCount ? " · blind" : ""}</p></div>
        <Button variant="secondary" className="print:hidden" onPress={() => window.print()}>Print</Button>
      </div>
      <table className="w-full border-collapse text-sm">
        <thead><tr>{["#", "Location", "SKU", "Item", "Batch", "Expiry", "Serial", "UOM", ...(withSystem ? ["System"] : []), "Counted", "Counted by"]
          .map((label) => <th key={label} className="border border-border px-2 py-1 text-left font-medium">{label}</th>)}</tr></thead>
        <tbody>
          {rows.map(({ line, serial, system }, index) => (
            <tr key={`${line.id}-${index}`}>
              <td className="border border-border px-2 py-1">{line.lineNumber}</td><td className="border border-border px-2 py-1">{line.location}</td><td className="border border-border px-2 py-1">{line.sku}</td>
              <td className="border border-border px-2 py-1">{line.itemName}</td><td className="border border-border px-2 py-1">{line.batch ?? ""}</td><td className="border border-border px-2 py-1">{line.expiresOn ?? ""}</td>
              <td className="border border-border px-2 py-1">{serial}</td><td className="border border-border px-2 py-1">{line.baseUom ?? ""}</td>
              {withSystem && <td className="border border-border px-2 py-1 tabular-nums">{system ?? ""}</td>}
              <td className="border border-border px-2 py-1 w-24" /><td className="border border-border px-2 py-1 w-28" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
