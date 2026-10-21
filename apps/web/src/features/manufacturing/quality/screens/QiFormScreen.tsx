"use client";

// Start an inspection of one manufacturing order's reported output. It starts from what awaits inspection per production entry (less what is
// held), so the inspector chooses the entry and how much the inspection covers — and, for a sample, how many units are actually examined.
// The product's checklist in force is frozen into the inspection. Saving decides nothing; results and the decision are recorded on its page.
import { useState } from "react";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader, PermissionState, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useSubmitKey } from "@/shared/http/submit-once";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, newKey, qty } from "@/features/manufacturing/orders/api/mo-api";
import { QI_BASE, createInspection, orderQuality, type MoQuality } from "../api/qi-api";

export function QiFormScreen({ orderId, entryId }: { orderId?: string; entryId?: string }) {
  const workspace = useWorkspaceContext();
  const quality = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "order-quality", orderId ?? ""), queryFn: () => orderQuality(orderId!), enabled: Boolean(orderId) });
  if (!orderId) return <ErrorState title="Choose a manufacturing order" description="Start an inspection from the inspection queue or an order's Quality tab." />;
  if (quality.isLoading) return <LoadingState label="Loading the order's output" rows={5} />;
  if (quality.isError || !quality.data) {
    if (errorStatus(quality.error) === 403) return <PermissionState title="You don't have access to production inspections" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the order" description={errorMessage(quality.error)} />;
  }
  return <QiForm quality={quality.data} initialEntryId={entryId} />;
}

function QiForm({ quality, initialEntryId }: { quality: MoQuality; initialEntryId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const entries = quality.entries.filter((entry) => entry.status === "REPORTED" && Number(entry.pending) > 0);
  const [entryId, setEntryId] = useState(entries.find((entry) => entry.id === initialEntryId)?.id ?? entries[0]?.id ?? "");
  const entry = entries.find((row) => row.id === entryId) ?? null;
  const [stage, setStage] = useState<"FINAL" | "IN_PROCESS">("FINAL");
  const [quantity, setQuantity] = useState(entry ? entry.available : "");
  const [examined, setExamined] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey);
  const submitKey = useSubmitKey();
  const choose = (id: string) => { setEntryId(id); setQuantity(entries.find((row) => row.id === id)?.available ?? ""); };
  const limit = entry ? Number(stage === "FINAL" ? entry.available : entry.pending) : 0;
  const valid = Boolean(entry) && Number(quantity) > 0 && Number(quantity) <= limit && (!examined.trim() || (Number(examined) > 0 && Number(examined) <= Number(quantity)));
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const created = await submitKey.run(() => createInspection({ manufacturingOrderId: quality.orderId, productionEntryId: entryId, inspectionStage: stage, quantity, uomId: null,
        examinedQuantity: examined.trim() || null, notes: notes.trim() || null, idempotencyKey: key }));
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      router.replace(`${QI_BASE}/${created.id}`);
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Start an inspection" description={`${quality.orderNumber}. Saving opens the inspection: nothing is accepted or rejected until it is finalized.`} />
      {error && <Notice tone="danger">{error}</Notice>}
      {!quality.can.inspect && <Notice tone="warning">This order is not in production, or you may not inspect: output is inspected while an order is in progress or on hold.</Notice>}
      {quality.templateRequired && !quality.hasChecklist && <Notice tone="warning">The company requires a checklist for every final inspection and this product has none in force.</Notice>}
      <Panel title="What is inspected">
        {entries.length === 0 ? <p className="text-sm text-text-muted">Nothing on this order awaits inspection.</p> : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Production entry" selectedKey={entryId} onSelectionChange={(value) => choose(String(value))}
              options={entries.map((row) => ({ value: row.id, label: `${row.number}${row.batch ? ` · ${row.batch}` : ""} · ${qty(row.available)} awaiting${Number(row.held) ? ` (${qty(row.held)} held)` : ""}` }))} />
            <Select label="Inspection" selectedKey={stage} onSelectionChange={(value) => setStage(String(value) as "FINAL" | "IN_PROCESS")}
              options={[{ value: "FINAL", label: "Final inspection — decides the output" }, { value: "IN_PROCESS", label: "In-process check — records results only" }]} />
            <TextField label="Quantity covered" inputMode="decimal" value={quantity} onChange={setQuantity}
              description={entry ? `Up to ${qty(String(limit))}${entry.reportedByMe ? ". You reported this output: someone else finalizes its decision." : ""}` : undefined} />
            <TextField label="Units examined (for a sample)" inputMode="decimal" value={examined} onChange={setExamined}
              description="Leave empty when every unit covered is examined. A sample decides only the units examined unless the company's policy says otherwise." />
          </div>
        )}
        <TextArea label="Notes" value={notes} onChange={setNotes} maxLength={2000} />
        {quality.hasChecklist ? <p className="text-xs text-text-muted">The product&apos;s checklist in force is frozen into the inspection: later revisions do not change it.</p>
          : <p className="text-xs text-text-muted">No checklist is in force for this product: this is a basic inspection (a decision with its reasons and defects).</p>}
      </Panel>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onPress={() => router.replace(`${MO_BASE}/${quality.orderId}?tab=quality`)}>Cancel</Button>
        <Button variant="primary" isLoading={busy} isDisabled={!valid || busy || !quality.can.inspect} onPress={save}>Start inspection</Button>
      </div>
    </div>
  );
}
