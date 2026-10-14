"use client";

// The Manufacturing Scrap Note, A4, printed (or saved as PDF) from the browser. Opening it records one copy; printing never posts anything.
// A note that is not posted prints as DRAFT (or CANCELLED); a reversed one as REVERSED. Value only for those who may see cost.
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, PermissionState } from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { TYPE_LABEL, scrapAction, type ManufacturingScrap } from "../api/scrap-api";

const cell = "border border-border px-2 py-1 text-left align-top";

export function ScrapPrintScreen({ scrapId }: { scrapId: string }) {
  const workspace = useWorkspaceContext();
  const printed = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "scrap-print", scrapId), queryFn: () => scrapAction(scrapId, "print").then((r) => r.scrap),
    staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false });
  if (printed.isLoading) return <LoadingState label="Preparing the scrap note" rows={5} />;
  if (printed.isError || !printed.data) {
    if (errorStatus(printed.error) === 403) return <PermissionState title="You may not print scrap notes" description="Ask an administrator for the print permission." />;
    return <ErrorState title="Could not prepare the scrap note" description={errorMessage(printed.error)} />;
  }
  return <Note scrap={printed.data} />;
}

function Note({ scrap }: { scrap: ManufacturingScrap }) {
  const workspace = useWorkspaceContext();
  return (
    <div className="relative mx-auto flex w-full max-w-[210mm] flex-col gap-4 bg-surface p-4 text-sm print:max-w-none print:p-0 print:text-xs">
      {scrap.print.watermark && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-bold text-text-muted opacity-20 [transform:rotate(-24deg)]">{scrap.print.watermark}</div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">{workspace.organizationName ?? ""}</p>
          <h1 className="text-lg font-semibold">Manufacturing Scrap Note · {scrap.number}</h1>
          <p className="text-text-muted">{scrap.statusLabel}{scrap.print.count > 1 ? ` · copy ${scrap.print.count}` : ""} · printed {formatDateTime(new Date().toISOString())}</p>
        </div>
        <Button variant="secondary" className="print:hidden" onPress={() => window.print()}>Print</Button>
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {[
            ["Manufacturing order", `${scrap.order.number} · ${scrap.order.finishedItem.code} ${scrap.order.finishedItem.name}`],
            ["What", TYPE_LABEL[scrap.scrapType]],
            ["Reason", `${scrap.reasonLabel}${scrap.description ? ` — ${scrap.description}` : ""}`],
            ["Disposition", scrap.disposition === "RECOVERABLE" ? `Recoverable · ${scrap.destination?.warehouse?.code ?? ""} / ${scrap.destination?.location?.code ?? ""}` : "Irrecoverable (disposed of)"],
            ["Loss", scrap.lossClass === "ABNORMAL" ? "Abnormal (written off)" : "Normal (in the order's cost)"],
            ["Scrap date", `${scrap.scrapDate ? formatDate(scrap.scrapDate) : ""}${scrap.postedAt ? ` · posted ${formatDateTime(scrap.postedAt)}` : ""}`],
            ...(scrap.approval.status === "APPROVED" ? [["Approved", `${scrap.approval.decidedBy} (${scrap.approval.reasons.join(", ")})`]] : []),
          ].map(([label, value]) => <tr key={label}><th className={`${cell} w-44 font-medium`}>{label}</th><td className={cell}>{value}</td></tr>)}
        </tbody>
      </table>
      <table className="w-full border-collapse">
        <thead><tr>{["#", "Item / source", "Quantity", "Batch / serial", ...(scrap.can.viewCost ? ["Value"] : [])].map((label) => <th key={label} className={`${cell} font-medium`}>{label}</th>)}</tr></thead>
        <tbody>
          {scrap.lines.map((line) => (
            <tr key={line.id}>
              <td className={cell}>{line.lineNumber}</td>
              <td className={cell}>{line.code} · {line.name}{line.entryNumber ? ` (${line.entryNumber}${line.productionBatch ? ` · ${line.productionBatch}` : ""})` : ""}</td>
              <td className={cell}>{qty(line.quantity)} {line.uom}</td>
              <td className={cell}>{line.batch?.number ?? line.serials.map((serial) => serial.number).join(", ")}</td>
              {scrap.can.viewCost && <td className={cell}>{line.totalCost ? inr(line.totalCost) : ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-8 grid grid-cols-3 gap-6">
        {[["Recorded by", scrap.createdBy ?? ""], ["Approved by", scrap.approval.decidedBy ?? ""], ["Posted by", scrap.postedBy ?? ""]].map(([label, name]) => (
          <div key={label} className="flex flex-col gap-1"><span className="h-10 border-b border-text-muted">{name}</span><span className="text-xs text-text-muted">{label}</span></div>
        ))}
      </div>
    </div>
  );
}
