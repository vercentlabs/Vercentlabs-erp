"use client";

// An order's quality (its Quality tab): output by production entry — awaiting inspection, held, accepted, rejected, received — with the way to
// inspect or hold it; the order's inspections, each opening its page; holds, released or reinspected; and quality corrections after review or
// rework. Every action is checked again on the server.
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, LinkButton, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, qty } from "@/features/manufacturing/orders/api/mo-api";
import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { DISPOSITION_LABEL, QI_BASE, QI_TONE, correctQuality, holdAction, orderQuality, placeHold, type QualityInspection } from "../api/qi-api";

const DISPOSITIONS = [{ value: "QUARANTINE", label: "Quarantine" }, { value: "REWORK", label: "Rework" }, { value: "SCRAP", label: "Scrap" }];

export function OrderQualityPanel({ orderId }: { orderId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const key = scopedQueryKey(workspace, "manufacturing", "order-quality", orderId);
  const query = useQuery({ queryKey: key, queryFn: () => orderQuality(orderId) });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (query.isLoading) return <p className="text-sm text-text-muted">Loading quality…</p>;
  if (query.isError || !query.data) return <Notice tone="danger">{errorMessage(query.error)}</Notice>;
  const quality = query.data;
  const can = quality.can;
  const done = async (text: string) => {
    await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
    setMessage(text);
  };
  const hold = (entry: (typeof quality.entries)[number]) => setAsk({
    title: `Hold output of ${entry.number}`, confirm: "Place hold", tone: "danger",
    description: `${qty(entry.available)} awaits inspection and is not held. Held output can be neither decided nor received until it is released or reinspected.`,
    fields: [{ name: "quantity", label: "Quantity to hold", kind: "quantity", required: true, initial: entry.available }, { name: "reason", label: "Why", kind: "textarea", required: true }],
    run: async (values, requestKey) => { await placeHold(orderId, { productionEntryId: entry.id, quantity: values.quantity, uomId: null, reason: values.reason, idempotencyKey: requestKey }); await done("Hold placed."); },
  });
  const correct = (entry: (typeof quality.entries)[number], direction: "ACCEPTED_TO_REJECTED" | "REJECTED_TO_ACCEPTED") => setAsk({
    title: direction === "ACCEPTED_TO_REJECTED" ? `Reject accepted output of ${entry.number}` : `Accept rejected output of ${entry.number}`,
    confirm: "Record correction", tone: "danger",
    description: direction === "ACCEPTED_TO_REJECTED"
      ? `Only accepted output not yet received can be rejected here: ${qty(entry.receivable)}. Received stock is corrected in Inventory.`
      : `Only rejected output not yet scrapped can be accepted: ${qty(entry.undisposed)}. The original decision stays on record.`,
    fields: [{ name: "quantity", label: "Quantity", kind: "quantity", required: true }, { name: "reason", label: "Why", kind: "textarea", required: true },
      ...(direction === "REJECTED_TO_ACCEPTED" ? [{ name: "kind", label: "Basis", kind: "select" as const, initial: "REVIEW", options: [{ value: "REVIEW", label: "Quality review" }, { value: "REWORK", label: "After documented rework" }] }]
        : [{ name: "rejectionDisposition", label: "What happens to it", kind: "select" as const, required: true, initial: "QUARANTINE", options: DISPOSITIONS }]),
      { name: "evidence", label: "Evidence (rework card, test report)", kind: "text" }],
    run: async (values, requestKey) => {
      await correctQuality(orderId, { productionEntryId: entry.id, direction, quantity: values.quantity, uomId: null, reason: values.reason, kind: values.kind || undefined,
        rejectionDisposition: values.rejectionDisposition || undefined, evidence: values.evidence || undefined, idempotencyKey: requestKey });
      await done("Quality corrected.");
    },
  });
  const release = (holdId: string) => setAsk({
    title: "Release the hold", confirm: "Release", fields: [{ name: "note", label: "Why it is released", kind: "textarea", required: true }],
    run: async (values, requestKey) => { await holdAction(holdId, "release", { note: values.note, idempotencyKey: requestKey }); await done("Released: the output awaits inspection again."); },
  });
  const reinspect = (holdId: string) => setAsk({
    title: "Reinspect the held output", confirm: "Start reinspection", description: "Releases the hold and opens a new inspection over exactly that output. The earlier inspection stays as it was.",
    fields: [{ name: "notes", label: "Notes", kind: "textarea" }],
    run: async (values, requestKey) => {
      const result = await holdAction<{ inspection: QualityInspection }>(holdId, "reinspect", { notes: values.notes || undefined, idempotencyKey: requestKey });
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      router.push(`${QI_BASE}/${result.inspection.id}`);
    },
  });
  const t = quality.totals;
  return (
    <div className="flex flex-col gap-4">
      {message && <Notice tone="success">{message}</Notice>}
      <p className="text-sm text-text-secondary">
        Reported {qty(t.reported)} · awaiting inspection {qty(t.pending)}{Number(t.held) ? ` (${qty(t.held)} on hold)` : ""} · accepted {qty(t.accepted)} · rejected {qty(t.rejected)}
        {t.rejectionRatePct ? ` (${t.rejectionRatePct}% rejected)` : ""} · received {qty(t.received)}. Each unit is decided once.
        {quality.hasChecklist ? " This product is inspected against its checklist." : quality.templateRequired ? " The company requires a checklist: set one up before inspecting." : ""}
      </p>
      <Panel title="Output by production entry">
        {quality.entries.length ? (
          <LinesTable columns={["Entry", { label: "Awaiting", numeric: true }, { label: "Held", numeric: true }, { label: "Accepted", numeric: true }, { label: "Rejected", numeric: true },
            { label: "Received", numeric: true }, ""]}>
            {quality.entries.map((entry) => (
              <tr key={entry.id}>
                <Cell>{entry.number}{entry.batch ? ` · ${entry.batch}` : ""}</Cell>
                <Cell numeric>{qty(entry.pending)}</Cell><Cell numeric>{Number(entry.held) ? qty(entry.held) : ""}</Cell><Cell numeric>{qty(entry.accepted)}</Cell>
                <Cell numeric>{qty(entry.rejected)}</Cell><Cell numeric>{qty(entry.received)}</Cell>
                <Cell>
                  <span className="flex flex-wrap justify-end gap-1">
                    {can.inspect && Number(entry.available) > 0 && (
                      <LinkButton size="compact" variant="primary" href={`${QI_BASE}/new?orderId=${orderId}&entryId=${entry.id}`}>Inspect</LinkButton>
                    )}
                    {can.hold && Number(entry.available) > 0 && <Button size="compact" variant="secondary" onPress={() => hold(entry)}>Hold</Button>}
                    {can.correct && Number(entry.receivable) > 0 && <Button size="compact" variant="ghost" onPress={() => correct(entry, "ACCEPTED_TO_REJECTED")}>Reject accepted</Button>}
                    {can.correct && Number(entry.undisposed) > 0 && <Button size="compact" variant="ghost" onPress={() => correct(entry, "REJECTED_TO_ACCEPTED")}>Accept rejected</Button>}
                  </span>
                </Cell>
              </tr>
            ))}
          </LinesTable>
        ) : <p className="text-sm text-text-muted">No production reported yet: output is inspected once it is reported.</p>}
      </Panel>
      <Panel title="Inspections">
        {quality.inspections.length ? (
          <LinesTable columns={["Inspection", "Status", "Entry", { label: "Covered", numeric: true }, { label: "Accepted", numeric: true }, { label: "Rejected", numeric: true },
            { label: "Held", numeric: true }, "Inspector", "When"]}>
            {quality.inspections.map((row) => (
              <tr key={row.id}>
                <Cell><Link className="text-brand underline" href={`${QI_BASE}/${row.id}`}>{row.number}</Link>{row.stage === "IN_PROCESS" ? <span className="text-xs text-text-muted"> · in-process</span> : null}</Cell>
                <Cell><StatusBadge tone={QI_TONE[row.status]}>{row.statusLabel}</StatusBadge></Cell><Cell>{row.entryNumber}</Cell><Cell numeric>{qty(row.scope)}</Cell>
                <Cell numeric>{qty(row.accepted)}</Cell><Cell numeric>{Number(row.rejected) ? `${qty(row.rejected)}${row.disposition ? ` · ${DISPOSITION_LABEL[row.disposition].toLowerCase()}` : ""}` : "0"}</Cell>
                <Cell numeric>{qty(row.held)}</Cell><Cell>{row.inspector ?? ""}</Cell><Cell>{formatDateTime(row.finalizedAt ?? row.inspectedAt)}</Cell>
              </tr>
            ))}
          </LinesTable>
        ) : <p className="text-sm text-text-muted">No inspections yet.</p>}
      </Panel>
      {quality.holds.length > 0 && (
        <Panel title="Quality holds">
          <LinesTable columns={["Entry", { label: "Held", numeric: true }, "Why", "Status", "Placed", "Released", ""]}>
            {quality.holds.map((row) => (
              <tr key={row.id}>
                <Cell>{row.entryNumber}{row.inspectionNumber ? ` · ${row.inspectionNumber}` : ""}</Cell><Cell numeric>{qty(row.quantity)}</Cell><Cell>{row.reason}</Cell>
                <Cell><StatusBadge tone={row.status === "ACTIVE" ? "warning" : "neutral"}>{row.status === "ACTIVE" ? "On hold" : "Released"}</StatusBadge></Cell>
                <Cell>{row.placedBy}, {formatDateTime(row.placedAt)}</Cell><Cell>{row.releasedAt ? `${row.releasedBy}, ${formatDateTime(row.releasedAt)}${row.note ? ` — ${row.note}` : ""}` : ""}</Cell>
                <Cell>{row.status === "ACTIVE" && (
                  <span className="flex flex-wrap justify-end gap-1">
                    {can.reinspect && <Button size="compact" variant="primary" onPress={() => reinspect(row.id)}>Reinspect</Button>}
                    {can.releaseHold && <Button size="compact" variant="secondary" onPress={() => release(row.id)}>Release</Button>}
                  </span>
                )}</Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
      )}
      {quality.corrections.length > 0 && (
        <Panel title="Quality corrections" description="Output moved between accepted and rejected after finalization; the original decisions stay on record.">
          <LinesTable columns={["Correction", "Entry", "Change", { label: "Quantity", numeric: true }, "Why", "By"]}>
            {quality.corrections.map((row) => (
              <tr key={row.id}>
                <Cell>{row.number}</Cell><Cell>{row.entryNumber}</Cell>
                <Cell>{row.direction === "ACCEPTED_TO_REJECTED" ? `Accepted → rejected${row.disposition ? ` (${DISPOSITION_LABEL[row.disposition].toLowerCase()})` : ""}` : `Rejected → accepted${row.kind === "REWORK" ? " after rework" : ""}`}</Cell>
                <Cell numeric>{qty(row.quantity)}</Cell><Cell>{row.reason}</Cell><Cell>{row.by}, {formatDateTime(row.at)}</Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
      )}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
