"use client";

// Cash differences: shortages and overages kept apart (never only a net figure), by context, outlet and cashier, with the open cases. A
// manager investigates and resolves a case; Finance records how it was accounted for. Nothing here changes a count, a closed shift or the
// cash in a drawer — a correction for cash that really moved is its own authorized cash movement, linked by reference.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import {
  CONTEXT_LABEL, RESOLUTION_LABEL, TREATMENT_LABEL, differenceSummary, investigateDifference, listDifferences, recordFinance, resolveDifference, type CashDifference,
} from "@/features/pos/cash-differences/api/cash-differences-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosAlert, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function CashDifferencesPanel() {
  const workspace = useWorkspaceContext();
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "cash-differences", "summary"), queryFn: differenceSummary, retry: false });
  const [status, setStatus] = useState("open");
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "cash-differences", status), queryFn: () => listDifferences({ status, limit: "25" }), retry: false });
  const data = summary.data;
  if (!data) return null;
  const t = data.totals;
  return (
    <PosPanel title="Cash differences" description={`${data.from} to ${data.to}. A difference is a reconciliation result, never a cash movement.`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Shortages", `${money("INR", t.shortages)} (${t.shortageCount})`], ["Overages", `${money("INR", t.overages)} (${t.overageCount})`], ["Net", money("INR", t.net)],
          ["Shifts with a difference", String(t.discrepantShifts)], ["Average difference", money("INR", t.average)], ["Approved exceptions", String(t.approvedExceptions)],
          ["Unresolved", String(t.unresolved)], ["Finance pending", String(t.financePending)], ["Recounts", String(t.recounts)]].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {([["By context", data.byContext.map((row) => ({ ...row, label: CONTEXT_LABEL[row.label] ?? row.label }))], ["By outlet", data.byOutlet], ["By cashier", data.byCashier]] as const).map(([title, rows]) => (
          <table key={title} className="w-full text-sm">
            <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">{title}</th><th className="pb-1 text-right">Short</th><th className="pb-1 text-right">Over</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.key ?? row.label} className="border-t border-border"><td className="py-1">{row.label}</td>
                <td className="text-right tabular-nums">{money("", row.shortages)}</td><td className="text-right tabular-nums">{money("", row.overages)}</td></tr>
            ))}</tbody>
          </table>
        ))}
      </div>
      <div className="flex items-end gap-2 border-t border-border pt-3">
        <Select label="Cases" size="compact" selectedKey={status} onSelectionChange={(value) => setStatus(String(value))}
          options={[{ value: "open", label: "Open and investigating" }, { value: "RESOLVED", label: "Resolved" }, { value: "all", label: "All" }]} />
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {(list.data?.rows ?? []).map((row) => <DifferenceRow key={row.id} row={row} />)}
        {list.data && !list.data.rows.length && <li className="py-2 text-sm text-text-muted">No cases.</li>}
      </ul>
    </PosPanel>
  );
}

function DifferenceRow({ row }: { row: CashDifference }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState<string | null>(null);
  const [movementId, setMovementId] = useState("");
  const [treatment, setTreatment] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await work(); setNote(""); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "cash-differences") }); }
    catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Something went wrong."); } finally { setBusy(false); }
  };
  return (
    <li className="flex flex-col gap-2 py-2 text-sm">
      <button type="button" className="flex flex-wrap items-center gap-2 text-left" onClick={() => setOpen((value) => !value)}>
        <StatusBadge tone={row.type === "SHORTAGE" ? "danger" : "warning"}>{row.type === "SHORTAGE" ? "Shortage" : "Overage"}</StatusBadge>
        <span className="font-medium tabular-nums">{money(row.currency, row.differenceAmount)}</span>
        <span>{row.number} · {CONTEXT_LABEL[row.context]} · {row.shiftNumber} · {row.cashier ?? "—"} · {row.outlet}</span>
        <StatusBadge tone={row.caseStatus === "RESOLVED" ? "success" : row.caseStatus === "INVESTIGATING" ? "info" : "neutral"}>{row.caseStatus.toLowerCase()}</StatusBadge>
        <StatusBadge tone={row.financeStatus === "PENDING" ? "warning" : "neutral"}>{`Finance ${row.financeStatus.toLowerCase().replace("_", " ")}`}</StatusBadge>
      </button>
      {open && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
          <p>{row.referenceAmount !== null ? `Reference ${money(row.currency, row.referenceAmount)} · ` : ""}counted {money(row.currency, row.countedAmount)}
            {row.recounts ? ` · ${row.recounts} recount(s)` : ""}{row.reasonLabel ? ` · ${row.reasonLabel}` : ""}{row.reasonNote ? ` — ${row.reasonNote}` : ""}
            {row.approvedBy ? ` · approved by ${row.approvedBy}` : ""}{row.relatedNumber ? ` · linked to ${row.relatedNumber}` : ""} · {dateTime(row.createdAt)}</p>
          {row.notes.map((entry, index) => <p key={index} className="text-text-muted">{dateTime(entry.at)}: {entry.note}</p>)}
          {row.caseStatus === "RESOLVED" && <p>Resolved: {RESOLUTION_LABEL[row.resolutionType ?? ""] ?? row.resolutionType} — {row.resolutionNote} ({row.resolvedBy ?? "—"})</p>}
          {row.financeStatus === "RECORDED" && <p>Finance: {TREATMENT_LABEL[row.financeTreatment ?? ""]} · {row.financeReference ?? "—"}</p>}
          {row.caseStatus !== "RESOLVED" && (
            <div className="flex flex-wrap items-end gap-2">
              <TextField label="Note" size="compact" value={note} onChange={setNote} maxLength={500} className="sm:min-w-[18rem]" />
              <Button size="compact" variant="secondary" isLoading={busy} isDisabled={!note.trim()} onPress={() => run(() => investigateDifference(row.id, { note: note.trim() }))}>Add note / investigate</Button>
              <Select label="Resolution" size="compact" selectedKey={resolution} placeholder="How it was resolved" onSelectionChange={(value) => setResolution(value ? String(value) : null)}
                options={Object.entries(RESOLUTION_LABEL).filter(([key]) => !(row.type === "SHORTAGE" ? key === "OVERAGE_ACCEPTED" : key === "SHORTAGE_ACCEPTED"))
                  .filter(([key]) => key !== "SAME_AS_LINKED_DIFFERENCE" || row.relatedDifferenceId).map(([value, label]) => ({ value, label }))} />
              {resolution === "CASH_MOVEMENT_CORRECTION" && <TextField label="Cash movement ID" size="compact" value={movementId} onChange={setMovementId} description="The authorized movement that recorded the cash that really moved." />}
              <Button size="compact" variant="secondary" isLoading={busy} isDisabled={!resolution || !note.trim()}
                onPress={() => run(() => resolveDifference(row.id, { resolutionType: resolution!, resolutionNote: note.trim(), ...(movementId.trim() ? { movementId: movementId.trim() } : {}) }))}>Resolve</Button>
            </div>
          )}
          {row.financeStatus === "PENDING" && (
            <div className="flex flex-wrap items-end gap-2">
              <Select label="Finance treatment" size="compact" selectedKey={treatment} placeholder="Choose" onSelectionChange={(value) => setTreatment(value ? String(value) : null)}
                options={Object.entries(TREATMENT_LABEL).filter(([key]) => !(row.type === "SHORTAGE" ? key === "OVERAGE_INCOME" : key === "SHORTAGE_EXPENSE")).map(([value, label]) => ({ value, label }))} />
              <TextField label="Journal reference" size="compact" value={reference} onChange={setReference} maxLength={120} />
              <Button size="compact" variant="secondary" isLoading={busy} isDisabled={!treatment || (treatment !== "NO_ENTRY" && !reference.trim())}
                onPress={() => run(() => recordFinance(row.id, { treatment: treatment!, reference: reference.trim() || undefined }))}>Record treatment</Button>
            </div>
          )}
          {error && <PosAlert>{error}</PosAlert>}
        </div>
      )}
    </li>
  );
}
