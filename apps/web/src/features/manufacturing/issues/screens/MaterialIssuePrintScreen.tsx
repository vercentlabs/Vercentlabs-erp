"use client";

// The Material Issue Note, A4, printed (or saved as PDF) from the browser. Opening it records one copy (a reprint after the first); printing
// never posts anything. A note that is not posted prints as DRAFT (or CANCELLED). Value appears only for those who may see cost.
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, PermissionState } from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { issueAction, type MaterialIssue } from "../api/mi-api";

const cell = "border border-border px-2 py-1 text-left align-top";

export function MaterialIssuePrintScreen({ issueId }: { issueId: string }) {
  const workspace = useWorkspaceContext();
  // One copy counted per opening of the note (never on a refetch).
  const printed = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "material-issue-print", issueId), queryFn: () => issueAction(issueId, "print").then((r) => r.issue),
    staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false });
  if (printed.isLoading) return <LoadingState label="Preparing the issue note" rows={5} />;
  if (printed.isError || !printed.data) {
    if (errorStatus(printed.error) === 403) return <PermissionState title="You may not print material issue notes" description="Ask an administrator for the print permission." />;
    return <ErrorState title="Could not prepare the issue note" description={errorMessage(printed.error)} />;
  }
  return <Note issue={printed.data} />;
}

function Note({ issue }: { issue: MaterialIssue }) {
  const workspace = useWorkspaceContext();
  return (
    <div className="relative mx-auto flex w-full max-w-[210mm] flex-col gap-4 bg-surface p-4 text-sm print:max-w-none print:p-0 print:text-xs">
      {issue.print.watermark && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-bold text-text-muted opacity-20 [transform:rotate(-24deg)]">{issue.print.watermark}</div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">{workspace.organizationName ?? ""}</p>
          <h1 className="text-lg font-semibold">Material Issue Note · {issue.number}</h1>
          <p className="text-text-muted">{issue.statusLabel}{issue.print.count > 1 ? ` · copy ${issue.print.count}` : ""} · printed {formatDateTime(new Date().toISOString())}</p>
        </div>
        <Button variant="secondary" className="print:hidden" onPress={() => window.print()}>Print</Button>
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {[
            ["Manufacturing order", `${issue.order.number} · ${issue.order.finishedItem.code} ${issue.order.finishedItem.name}${issue.order.revisionNumber ? ` · BOM rev ${issue.order.revisionNumber}` : ""}`],
            ["From", `${issue.source.warehouse?.code ?? ""} ${issue.source.warehouse?.name ?? ""}${issue.source.location ? ` / ${issue.source.location.code}` : ""}`],
            ["To", `Production · ${issue.production.warehouse?.code ?? ""} ${issue.production.warehouse?.name ?? ""}${issue.production.location ? ` / ${issue.production.location.code}` : ""}`],
            ["Issue date", `${formatDate(issue.issueDate)}${issue.postedAt ? ` · posted ${formatDateTime(issue.postedAt)}` : ""}`],
            ["Reason", issue.issueReason.toLowerCase().replace(/_/g, " ") + (issue.approval.status === "APPROVED" ? ` · additional material approved by ${issue.approval.decidedBy} (${issue.approval.reason})` : "")],
            ["Posting", issue.posting ? `${issue.posting.key} · Inventory ${issue.posting.inventoryStatus.toLowerCase()} · Finance ${issue.posting.financeStatus.toLowerCase().replace(/_/g, " ")}` : "Not posted"],
          ].map(([label, value]) => <tr key={label}><th className={`${cell} w-44 font-medium`}>{label}</th><td className={cell}>{value}</td></tr>)}
        </tbody>
      </table>
      <table className="w-full border-collapse">
        <thead><tr>{["#", "Material", "Quantity", "Batch / serial / location", ...(issue.can.viewCost ? ["Value"] : [])].map((label) => <th key={label} className={`${cell} font-medium`}>{label}</th>)}</tr></thead>
        <tbody>
          {issue.lines.map((line) => (
            <tr key={line.id}>
              <td className={cell}>{line.lineNumber}</td>
              <td className={cell}>{line.code} · {line.name}</td>
              <td className={cell}>{qty(line.quantity)} {line.uom}{line.uom !== line.baseUom ? ` (${qty(line.baseQuantity)} ${line.baseUom})` : ""}{Number(line.reversed) ? ` · ${qty(line.reversed)} reversed` : ""}</td>
              <td className={cell}>{line.allocations.length
                ? line.allocations.map((part) => `${qty(part.quantity)}${part.batch ? ` ${part.batch}` : ""}${part.expiresOn ? ` (exp ${formatDate(part.expiresOn)})` : ""}${part.serial ? ` ${part.serial}` : ""}${part.location ? ` @ ${part.location}` : ""}`).join("; ")
                : line.batch?.number ?? (line.serials.map((serial) => serial.number).join(", ") || "")}</td>
              {issue.can.viewCost && <td className={cell}>{line.posted?.totalCost ? inr(line.posted.totalCost) : ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {issue.notes && <p>Notes: {issue.notes}</p>}
      <div className="mt-8 grid grid-cols-3 gap-6">
        {[["Issued by", issue.postedBy ?? ""], ["Received by (production)", issue.receivedBy ?? ""], ["Checked by", ""]].map(([label, name]) => (
          <div key={label} className="flex flex-col gap-1"><span className="h-10 border-b border-text-muted">{name}</span><span className="text-xs text-text-muted">{label}</span></div>
        ))}
      </div>
    </div>
  );
}
