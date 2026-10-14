"use client";

// The Material Consumption Note, A4, printed (or saved as PDF) from the browser. Opening it records one copy (a reprint after the first);
// printing changes nothing. A note that is not posted prints as DRAFT (or CANCELLED). Value only for those who may see cost.
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, PermissionState } from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { consumptionAction, type Consumption } from "../api/mc-api";

const cell = "border border-border px-2 py-1 text-left align-top";

export function MaterialConsumptionPrintScreen({ consumptionId }: { consumptionId: string }) {
  const workspace = useWorkspaceContext();
  const printed = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "material-consumption-print", consumptionId),
    queryFn: () => consumptionAction(consumptionId, "print").then((r) => r.consumption), staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false });
  if (printed.isLoading) return <LoadingState label="Preparing the consumption note" rows={5} />;
  if (printed.isError || !printed.data) {
    if (errorStatus(printed.error) === 403) return <PermissionState title="You may not print consumption notes" description="Ask an administrator for the print permission." />;
    return <ErrorState title="Could not prepare the consumption note" description={errorMessage(printed.error)} />;
  }
  return <Note note={printed.data} />;
}

function Note({ note }: { note: Consumption }) {
  const workspace = useWorkspaceContext();
  return (
    <div className="relative mx-auto flex w-full max-w-[210mm] flex-col gap-4 bg-surface p-4 text-sm print:max-w-none print:p-0 print:text-xs">
      {note.print.watermark && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-bold text-text-muted opacity-20 [transform:rotate(-24deg)]">{note.print.watermark}</div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">{workspace.organizationName ?? ""}</p>
          <h1 className="text-lg font-semibold">Material Consumption Note · {note.number}</h1>
          <p className="text-text-muted">{note.statusLabel}{note.print.count > 1 ? ` · copy ${note.print.count}` : ""} · printed {formatDateTime(new Date().toISOString())}</p>
        </div>
        <Button variant="secondary" className="print:hidden" onPress={() => window.print()}>Print</Button>
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {[
            ["Manufacturing order", `${note.order.number} · ${note.order.finishedItem.code} ${note.order.finishedItem.name}${note.order.revisionNumber ? ` · BOM rev ${note.order.revisionNumber}` : ""}`],
            ["Production", `${note.production.warehouse.code} ${note.production.warehouse.name}${note.production.location ? ` / ${note.production.location.code}` : ""}`],
            ["Recorded against", `${note.production.entry ? `${note.production.entry.number} · ` : ""}${note.production.batchReference ?? ""}${note.production.outputBasis ? ` · ${qty(note.production.outputBasis)} made` : ""}` || "—"],
            ["Used on", note.consumedAt ? formatDateTime(note.consumedAt) : formatDate(note.consumptionDate)],
            ["Approval", note.approval.status === "APPROVED" ? `Usage variance approved by ${note.approval.decidedBy} (${note.approval.reason})` : note.approval.status.toLowerCase().replace(/_/g, " ")],
            ["Posting", note.posting ? `${note.posting.key} · ${note.posting.financeNote}` : "Not posted"],
          ].map(([label, value]) => <tr key={label}><th className={`${cell} w-44 font-medium`}>{label}</th><td className={cell}>{value}</td></tr>)}
        </tbody>
      </table>
      <table className="w-full border-collapse">
        <thead><tr>{["#", "Material", "Used", "BOM expects", "Variance", "From issued stock", ...(note.can.viewCost ? ["Value"] : [])].map((label) => <th key={label} className={`${cell} font-medium`}>{label}</th>)}</tr></thead>
        <tbody>
          {note.lines.map((line) => (
            <tr key={line.id}>
              <td className={cell}>{line.lineNumber}</td>
              <td className={cell}>{line.code} · {line.name}</td>
              <td className={cell}>{qty(line.quantity)} {line.uom}{Number(line.corrected) ? ` (${qty(line.corrected)} corrected)` : ""}</td>
              <td className={cell}>{line.expected === null ? "—" : qty(line.expected)}</td>
              <td className={cell}>{line.variance === null ? "" : `${Number(line.variance) > 0 ? "+" : ""}${qty(line.variance)}${line.variancePct === null ? "" : ` (${line.variancePct}%)`} ${line.bandLabel}`}</td>
              <td className={cell}>{line.allocations.length ? line.allocations.map((part) => `${qty(part.quantity)} ${part.issueNumber ?? ""}${part.batch ? ` ${part.batch}` : ""}${part.serial ? ` ${part.serial}` : ""}`).join("; ")
                : line.batch?.number ?? (line.serials.map((serial) => serial.number).join(", ") || "")}</td>
              {note.can.viewCost && <td className={cell}>{line.totalCost ? inr(line.totalCost) : ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {note.notes && <p>Notes: {note.notes}</p>}
      <div className="mt-8 grid grid-cols-3 gap-6">
        {[["Recorded by", note.createdBy ?? ""], ["Supervisor", note.supervisor ?? note.approval.decidedBy ?? ""], ["Posted by", note.postedBy ?? ""]].map(([label, name]) => (
          <div key={label} className="flex flex-col gap-1"><span className="h-10 border-b border-text-muted">{name}</span><span className="text-xs text-text-muted">{label}</span></div>
        ))}
      </div>
    </div>
  );
}
