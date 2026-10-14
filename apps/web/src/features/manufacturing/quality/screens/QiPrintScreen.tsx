"use client";

// The Production Inspection Report, A4, printed (or saved as PDF) from the browser. Opening it records one copy; printing never decides anything.
// An inspection that is not finalized prints as DRAFT (or CANCELLED).
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, PermissionState } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, qty } from "@/features/manufacturing/orders/api/mo-api";
import { DISPOSITION_LABEL, inspectionAction, reasonLabel, type QualityInspection } from "../api/qi-api";

const cell = "border border-border px-2 py-1 text-left align-top";

export function QiPrintScreen({ inspectionId }: { inspectionId: string }) {
  const workspace = useWorkspaceContext();
  const printed = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "quality-inspection-print", inspectionId), queryFn: () => inspectionAction(inspectionId, "print").then((r) => r.inspection),
    staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false });
  if (printed.isLoading) return <LoadingState label="Preparing the inspection report" rows={5} />;
  if (printed.isError || !printed.data) {
    if (errorStatus(printed.error) === 403) return <PermissionState title="You may not print inspection reports" description="Ask an administrator for the print permission." />;
    return <ErrorState title="Could not prepare the inspection report" description={errorMessage(printed.error)} />;
  }
  return <Report inspection={printed.data} />;
}

function Report({ inspection }: { inspection: QualityInspection }) {
  const workspace = useWorkspaceContext();
  const q = inspection.quantities;
  return (
    <div className="relative mx-auto flex w-full max-w-[210mm] flex-col gap-4 bg-surface p-4 text-sm print:max-w-none print:p-0 print:text-xs">
      {inspection.print.watermark && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-bold text-text-muted opacity-20 [transform:rotate(-24deg)]">{inspection.print.watermark}</div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">{workspace.organizationName ?? ""}</p>
          <h1 className="text-lg font-semibold">Production Inspection Report · {inspection.number}</h1>
          <p className="text-text-muted">{inspection.statusLabel}{inspection.print.count > 1 ? ` · copy ${inspection.print.count}` : ""} · printed {formatDateTime(new Date().toISOString())}</p>
        </div>
        <Button variant="secondary" className="print:hidden" onPress={() => window.print()}>Print</Button>
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {[
            ["Manufacturing order", `${inspection.order.number} · ${inspection.item.code} ${inspection.item.name}`],
            ["Production entry", `${inspection.entry.number ?? ""}${inspection.entry.batch ? ` · batch ${inspection.entry.batch}` : ""}`],
            ["Inspection", `${inspection.stage === "IN_PROCESS" ? "In-process check" : "Final inspection"} · ${inspection.template ? `${inspection.template.number} ${inspection.template.name} rev ${inspection.template.revision}` : "basic"}`],
            ["Covered", `${qty(q.scope)} ${inspection.uom ?? ""} · ${qty(q.examined)} examined${inspection.samplingBasis === "BATCH_POLICY" ? " (sample decides the batch by company policy)" : ""}`],
            ["Decision", `${qty(q.accepted)} accepted · ${qty(q.rejected)} rejected${inspection.decision.rejectionDisposition ? ` (${DISPOSITION_LABEL[inspection.decision.rejectionDisposition].toLowerCase()})` : ""} · ${qty(q.held)} on hold`],
            ...(inspection.decision.rejectionReason ? [["Rejection reason", inspection.decision.rejectionReason]] : []),
            ...(inspection.decision.deviation ? [["Deviation", "Accepted under a documented deviation after a critical failure"]] : []),
            ["Inspected", `${inspection.inspector ?? ""} · ${formatDateTime(inspection.inspectedAt)}`],
            ...(inspection.finalizedAt ? [["Finalized", `${inspection.finalizedBy} · ${formatDateTime(inspection.finalizedAt)}`]] : []),
          ].map(([label, value]) => <tr key={label}><th className={`${cell} w-44 font-medium`}>{label}</th><td className={cell}>{value}</td></tr>)}
        </tbody>
      </table>
      {inspection.checks.length > 0 && (
        <table className="w-full border-collapse">
          <thead><tr>{["Check", "Requirement", "Result", "Evaluation"].map((label) => <th key={label} className={`${cell} font-medium`}>{label}</th>)}</tr></thead>
          <tbody>
            {inspection.checks.map((row) => (
              <tr key={row.key}>
                <td className={cell}>{row.name}{row.critical ? " (critical)" : ""}</td>
                <td className={cell}>{row.type === "NUMERIC" ? `${row.lower ?? "—"} to ${row.upper ?? "—"} ${row.unit ?? ""}` : row.type === "CHOICE" ? row.acceptedChoices.join(", ") || row.choices.join(" / ") : row.type === "PASS_FAIL" ? "Pass" : "—"}</td>
                <td className={cell}>{row.value ?? "—"}{row.notes ? ` — ${row.notes}` : ""}</td>
                <td className={cell}>{row.result === "PASS" ? "Pass" : row.result === "FAIL" ? "FAIL" : row.result === "NA" ? "N/A" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {inspection.defects.length > 0 && (
        <table className="w-full border-collapse">
          <thead><tr>{["Defect", "Severity", "Units affected", "Observation"].map((label) => <th key={label} className={`${cell} font-medium`}>{label}</th>)}</tr></thead>
          <tbody>{inspection.defects.map((row) => <tr key={row.id}><td className={cell}>{reasonLabel(row.reasonCode)}</td><td className={cell}>{row.severity.toLowerCase()}</td><td className={cell}>{qty(row.affectedQuantity)}</td><td className={cell}>{row.observation ?? ""}</td></tr>)}</tbody>
        </table>
      )}
      <div className="mt-8 grid grid-cols-3 gap-6">
        {[["Inspected by", inspection.inspector ?? ""], ["Reviewed by", inspection.review.reviewer ?? ""], ["Finalized by", inspection.finalizedBy ?? ""]].map(([label, name]) => (
          <div key={label} className="flex flex-col gap-1"><span className="h-10 border-b border-text-muted">{name}</span><span className="text-xs text-text-muted">{label}</span></div>
        ))}
      </div>
    </div>
  );
}
