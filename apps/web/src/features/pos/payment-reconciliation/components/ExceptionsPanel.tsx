"use client";

// The exception queue: filter, open a case, assign it, investigate, add evidence or a note, ask for approval, and resolve with evidence — a
// note alone never closes a case, and accepting a difference needs someone other than the person who asked.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { CODE_LABEL, exceptionDetail, exceptions, resolveException, updateException, type ReconException } from "@/features/pos/payment-reconciliation/api/reconciliation-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosAlert, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const RESOLUTIONS = [["MATCHED_WITH_EVIDENCE", "Matched with evidence"], ["CHECKOUT_RECOVERED", "Checkout recovered"], ["CUSTOMER_REFUNDED", "Customer refunded"],
  ["FINANCE_CORRECTION_POSTED", "Finance correction posted"], ["PROVIDER_CORRECTED", "Provider corrected it"], ["ACCEPTED_DIFFERENCE", "Accept the difference (approval)"],
  ["DUPLICATE_IGNORED", "Ignore as duplicate (approval)"], ["OTHER", "Other (approval)"]] as const;

export function ExceptionsPanel() {
  const workspace = useWorkspaceContext();
  const [status, setStatus] = useState("open");
  const [code, setCode] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "payment-reconciliation", "exceptions", status, code), queryFn: () => exceptions({ status, code: code ?? undefined, limit: "100" }), retry: false });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Select label="Status" size="compact" selectedKey={status} onSelectionChange={(value) => setStatus(String(value))}
          options={[["open", "Open (all stages)"], ["OPEN", "New"], ["ASSIGNED", "Assigned"], ["INVESTIGATING", "Investigating"], ["AWAITING_EXTERNAL_EVIDENCE", "Awaiting evidence"], ["ESCALATED", "Escalated"], ["RESOLVED", "Resolved"]]
            .map(([value, label]) => ({ value, label }))} />
        <Select label="Type" size="compact" selectedKey={code ?? "all"} onSelectionChange={(value) => setCode(value === "all" ? null : String(value))}
          options={[{ value: "all", label: "All types" }, ...Object.entries(CODE_LABEL).map(([value, label]) => ({ value, label }))]} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Case</th><th className="pb-1 text-left">Issue</th><th className="pb-1 text-left">Outlet / account</th>
            <th className="pb-1 text-right">Exposure</th><th className="pb-1 text-left">Status</th><th className="pb-1 text-right">Age</th></tr></thead>
          <tbody>{(query.data?.rows ?? []).map((row) => (
            <tr key={row.id} className={`cursor-pointer border-t border-border ${selected === row.id ? "bg-surface-muted" : ""}`} onClick={() => setSelected(row.id)}>
              <td className="py-1.5 font-medium">{row.number}</td><td>{CODE_LABEL[row.code] ?? row.code}</td><td>{row.outlet ?? row.merchant ?? "—"}</td>
              <td className="text-right tabular-nums">{row.exposure ? money(row.currency, row.exposure) : "—"}</td><td>{row.status.toLowerCase().replace(/_/g, " ")}</td><td className="text-right">{row.ageDays}d</td>
            </tr>
          ))}</tbody>
        </table>
        {query.data && !query.data.rows.length && <p className="py-2 text-sm text-text-muted">No exceptions.</p>}
      </div>
      {selected && <ExceptionDetail id={selected} />}
    </div>
  );
}

function ExceptionDetail({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "payment-reconciliation", "exception", id);
  const query = useQuery({ queryKey: key, queryFn: () => exceptionDetail(id), retry: false });
  const [note, setNote] = useState("");
  const [evidence, setEvidence] = useState("");
  const [resolution, setResolution] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const row: ReconException | undefined = query.data;
  if (!row) return null;
  const run = async (work: () => Promise<ReconException>) => {
    setBusy(true);
    setError(null);
    try { queryClient.setQueryData(key, await work()); setNote(""); setEvidence(""); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "payment-reconciliation", "exceptions") }); }
    catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Something went wrong."); } finally { setBusy(false); }
  };
  const open = row.status !== "RESOLVED";
  return (
    <PosPanel title={`${row.number} · ${CODE_LABEL[row.code] ?? row.code}`} description={`${row.layer.toLowerCase()} · detected ${dateTime(row.detectedAt)} · ${row.status.toLowerCase().replace(/_/g, " ")}${row.assignedTo ? ` · ${row.assignedTo}` : ""}`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Expected", row.expected], ["Actual", row.actual], ["Difference", row.difference], ["Exposure", row.exposure]].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2"><p className="text-xs text-text-muted">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value ? money(row.currency, value) : "—"}</p></div>
        ))}
      </div>
      <p className="break-all text-xs text-text-muted">{Object.entries(row.references).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : String(value)}`).join(" · ")}</p>
      {(row.matches ?? []).length > 0 && <ul className="text-sm">{row.matches!.map((match) => <li key={match.id}>Match {match.rule} · {match.amount} · {match.status.toLowerCase()}</li>)}</ul>}
      {row.evidence.length > 0 && <ul className="text-sm">{row.evidence.map((item, index) => <li key={index}>Evidence: {String(item.kind ?? "")} {String(item.reference ?? item.note ?? "")}</li>)}</ul>}
      {row.notes.length > 0 && <ul className="text-sm text-text-muted">{row.notes.map((item, index) => <li key={index}>{String(item.kind)}{item.note ? `: ${String(item.note)}` : ""}</li>)}</ul>}
      {row.status === "RESOLVED" && <p className="text-sm">Resolved — {row.resolutionType?.toLowerCase().replace(/_/g, " ")}: {row.resolutionNote}{row.resolutionReference ? ` (${row.resolutionReference})` : ""} · {row.resolvedBy}</p>}
      {open && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="flex flex-wrap gap-2">
            <Button size="compact" variant="secondary" isLoading={busy} onPress={() => run(() => updateException(id, { action: "assign", expectedVersion: row.version }))}>Take it</Button>
            <Button size="compact" variant="secondary" isLoading={busy} onPress={() => run(() => updateException(id, { action: "investigate", note: note || undefined }))}>Investigating</Button>
            <Button size="compact" variant="secondary" isLoading={busy} onPress={() => run(() => updateException(id, { action: "await_evidence", note: note || undefined }))}>Awaiting evidence</Button>
            <Button size="compact" variant="secondary" isLoading={busy} onPress={() => run(() => updateException(id, { action: "escalate", note: note || undefined }))}>Escalate</Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <TextField label="Note" size="compact" value={note} onChange={setNote} maxLength={500} className="sm:min-w-[18rem]" />
            <Button size="compact" variant="ghost" isDisabled={!note.trim()} onPress={() => run(() => updateException(id, { action: "note", note }))}>Add note</Button>
            <Button size="compact" variant="ghost" isDisabled={!note.trim()} onPress={() => run(() => updateException(id, { action: "request_approval", note }))}>Ask for approval</Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <TextField label="Evidence reference" size="compact" value={evidence} onChange={setEvidence} maxLength={200} description="Statement line, provider ticket, document number…" />
            <Button size="compact" variant="ghost" isDisabled={!evidence.trim()} onPress={() => run(() => updateException(id, { action: "evidence", evidence: { reference: evidence } }))}>Add evidence</Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Select label="Resolution" size="compact" selectedKey={resolution} placeholder="How it was resolved" onSelectionChange={(value) => setResolution(value ? String(value) : null)}
              options={RESOLUTIONS.map(([value, label]) => ({ value, label }))} />
            <TextField label="Reference" size="compact" value={reference} onChange={setReference} maxLength={200} />
            <Button size="compact" variant="primary" isLoading={busy} isDisabled={!resolution || !note.trim()}
              onPress={() => run(() => resolveException(id, { resolutionType: resolution!, resolutionNote: note, resolutionReference: reference.trim() || undefined,
                evidence: evidence.trim() ? { reference: evidence.trim() } : undefined, expectedVersion: row.version }))}>Resolve (note + evidence)</Button>
          </div>
        </div>
      )}
      {error && <PosAlert>{error}</PosAlert>}
      <StatusBadge tone="neutral">{`Version ${row.version}`}</StatusBadge>
    </PosPanel>
  );
}
