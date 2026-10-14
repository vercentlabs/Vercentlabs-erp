"use client";

// The Production Entry, A4, printed (or saved as PDF) from the browser. Opening it records one copy; printing changes nothing. An entry not
// yet reported prints as DRAFT (or CANCELLED).
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, PermissionState } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, qty } from "@/features/manufacturing/orders/api/mo-api";
import { INSPECTION_LABEL, RECEIPT_LABEL, entryAction, type Entry } from "../api/pp-api";

const cell = "border border-border px-2 py-1 text-left align-top";

export function ProductionEntryPrintScreen({ entryId }: { entryId: string }) {
  const workspace = useWorkspaceContext();
  const printed = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "production-entry-print", entryId), queryFn: () => entryAction(entryId, "print"),
    staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false });
  if (printed.isLoading) return <LoadingState label="Preparing the production entry" rows={4} />;
  if (printed.isError || !printed.data) {
    if (errorStatus(printed.error) === 403) return <PermissionState title="You may not print production entries" description="Ask an administrator for the print permission." />;
    return <ErrorState title="Could not prepare the production entry" description={errorMessage(printed.error)} />;
  }
  return <Sheet entry={printed.data} />;
}

function Sheet({ entry }: { entry: Entry }) {
  const workspace = useWorkspaceContext();
  return (
    <div className="relative mx-auto flex w-full max-w-[210mm] flex-col gap-4 bg-surface p-4 text-sm print:max-w-none print:p-0 print:text-xs">
      {entry.print.watermark && <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-bold text-text-muted opacity-20 [transform:rotate(-24deg)]">{entry.print.watermark}</div>}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">{workspace.organizationName ?? ""}</p>
          <h1 className="text-lg font-semibold">Production Entry · {entry.number}</h1>
          <p className="text-text-muted">{entry.statusLabel}{entry.print.count > 1 ? ` · copy ${entry.print.count}` : ""} · printed {formatDateTime(new Date().toISOString())}</p>
        </div>
        <Button variant="secondary" className="print:hidden" onPress={() => window.print()}>Print</Button>
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {[
            ["Manufacturing order", `${entry.order.number} · ${entry.order.finishedItem.code} ${entry.order.finishedItem.name} · target ${qty(entry.order.planned)}`],
            ["Production batch", `${entry.batch ?? "—"}${entry.batch && entry.location ? ` · ${entry.location.code}` : ""}`],
            ["Produced", entry.producedAt ? formatDateTime(entry.producedAt) : "—"],
            ["Reported", `${entry.entered ? `${qty(entry.entered)} ${entry.uom ?? ""} = ` : ""}${qty(entry.reported)}`],
            ["Accepted / rejected / awaiting", `${qty(entry.accepted)} / ${qty(entry.rejected)} / ${qty(entry.pending)} · ${INSPECTION_LABEL[entry.inspection] ?? entry.inspection}`],
            ["Received into stock", `${qty(entry.received)} · ${RECEIPT_LABEL[entry.receipt] ?? entry.receipt}`],
            ["Recorded by", `${entry.recordedBy ?? ""}${entry.postedBy ? ` · posted by ${entry.postedBy}` : ""}`],
          ].map(([label, value]) => <tr key={label}><th className={`${cell} w-52 font-medium`}>{label}</th><td className={cell}>{value}</td></tr>)}
        </tbody>
      </table>
      {entry.decisions.length > 0 && (
        <table className="w-full border-collapse">
          <thead><tr>{["Accepted", "Rejected", "Reason", "Disposition", "Inspector"].map((label) => <th key={label} className={`${cell} font-medium`}>{label}</th>)}</tr></thead>
          <tbody>{entry.decisions.map((row) => <tr key={row.id}><td className={cell}>{qty(row.accepted)}</td><td className={cell}>{qty(row.rejected)}</td><td className={cell}>{[row.reasonCode, row.reason].filter(Boolean).join(" · ")}</td>
            <td className={cell}>{row.disposition?.toLowerCase() ?? ""}</td><td className={cell}>{row.by}, {formatDateTime(row.at)}</td></tr>)}</tbody>
        </table>
      )}
      {entry.notes && <p>Notes: {entry.notes}</p>}
      <div className="mt-8 grid grid-cols-3 gap-6">
        {[["Operator", entry.recordedBy ?? ""], ["Supervisor", ""], ["Inspector", entry.decisions[0]?.by ?? ""]].map(([label, name]) => (
          <div key={label} className="flex flex-col gap-1"><span className="h-10 border-b border-text-muted">{name}</span><span className="text-xs text-text-muted">{label}</span></div>
        ))}
      </div>
    </div>
  );
}
