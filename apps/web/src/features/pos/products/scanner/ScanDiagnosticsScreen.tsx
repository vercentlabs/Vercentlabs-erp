"use client";

// Failed and slow barcode scans, newest first: unknown, unreadable or inactive barcodes, ambiguous barcodes to correct in the Item Master,
// refused products, serial rejections, permission refusals and slow scans — with where and when. Successful scans are in the sales themselves.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, PageHeader, Select } from "@vercentlabs/design-system";

import { request } from "@/features/pos/shared/http";
import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type ScanEventRow = { id: string; at: string; outlet: string | null; terminal: string | null; user: string | null; barcode: string | null; result: string; errorCode: string | null;
  durationMs: number | null };
const RESULT_LABEL: Record<string, string> = {
  not_found: "Unknown barcode", invalid: "Unreadable", inactive_barcode: "Inactive barcode", ambiguous: "Ambiguous barcode", rejected: "Product refused",
  serial_rejected: "Serial refused", permission_denied: "Permission denied", failed: "Failed", slow: "Slow scan",
};

export function ScanDiagnosticsScreen() {
  const workspace = useWorkspaceContext();
  const [result, setResult] = useState("all");
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos-scan-diagnostics", result),
    queryFn: () => request<{ events: ScanEventRow[] }>(`/scan-diagnostics${result === "all" ? "" : `?result=${result}`}`).then((response) => response.events),
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Scan Diagnostics" description="Scans that failed or were slow. Correct ambiguous and missing barcodes in the Item Master." />
      <Select label="Show" className="w-64" selectedKey={result} onSelectionChange={(value) => setResult(String(value))}
        options={[{ value: "all", label: "Everything" }, ...Object.entries(RESULT_LABEL).map(([value, label]) => ({ value, label }))]} />
      {query.isLoading ? <LoadingState label="Loading scan diagnostics" rows={5} /> : query.isError ? (
        <ErrorState title="Could not load scan diagnostics" description={query.error instanceof Error ? query.error.message : undefined} />
      ) : (
        <LinesTable columns={["When", "Outlet", "Terminal", "Cashier", "Barcode", "Result", "Code", "Time"]} empty={query.data?.length ? undefined : "No failed or slow scans."}>
          {(query.data ?? []).map((row) => (
            <tr key={row.id}>
              <Cell>{formatDateTime(row.at)}</Cell>
              <Cell>{row.outlet}</Cell>
              <Cell>{row.terminal}</Cell>
              <Cell>{row.user}</Cell>
              <Cell><span className="tabular-nums">{row.barcode}</span></Cell>
              <Cell>{RESULT_LABEL[row.result] ?? row.result}</Cell>
              <Cell>{row.errorCode}</Cell>
              <Cell>{row.durationMs !== null ? `${row.durationMs} ms` : null}</Cell>
            </tr>
          ))}
        </LinesTable>
      )}
    </div>
  );
}
