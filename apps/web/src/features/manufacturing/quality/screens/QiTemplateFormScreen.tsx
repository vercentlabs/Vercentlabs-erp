"use client";

// A new inspection checklist: its name, the product it is for (or every product), final inspection or in-process check, and its checks. Saving
// puts revision 1 in force at once; the checklist's page revises it.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ComboBox, PageHeader, Select, TextField } from "@vercentlabs/design-system";

import { useSubmitKey } from "@/shared/http/submit-once";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, orderOptions } from "@/features/manufacturing/orders/api/mo-api";
import { QI_TEMPLATES_BASE, createTemplate } from "../api/qi-api";
import { CriteriaEditor, blankCriterion, toInput, type CriterionDraft } from "../components/CriteriaEditor";

export function QiTemplateFormScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "order-options"), queryFn: orderOptions, staleTime: 60_000 });
  const [name, setName] = useState("");
  const [itemId, setItemId] = useState<string | null>(null);
  const [stage, setStage] = useState<"FINAL" | "IN_PROCESS">("FINAL");
  const [rows, setRows] = useState<CriterionDraft[]>([blankCriterion()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitKey = useSubmitKey();
  const criteria = toInput(rows);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const created = await submitKey.run(() => createTemplate({ name: name.trim(), finishedItemId: itemId, inspectionStage: stage, criteria }));
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      router.replace(`${QI_TEMPLATES_BASE}/${created.id}`);
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="New inspection checklist" description="Revision 1 is in force as soon as it is saved: inspections started from then on use it." />
      {error && <Notice tone="danger">{error}</Notice>}
      <Panel title="Checklist">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Name" isRequired value={name} onChange={setName} placeholder="Office chair final inspection" />
          <ComboBox label="Product" placeholder="Every product" selectedKey={itemId} onSelectionChange={(value) => setItemId(value ? String(value) : null)}
            options={(options.data?.products ?? []).map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` }))} description="Leave empty for a company-wide checklist; a product's own checklist comes first." />
          <Select label="Stage" selectedKey={stage} onSelectionChange={(value) => setStage(String(value) as "FINAL" | "IN_PROCESS")}
            options={[{ value: "FINAL", label: "Final inspection" }, { value: "IN_PROCESS", label: "In-process check" }]} />
        </div>
      </Panel>
      <Panel title="Checks">
        <CriteriaEditor rows={rows} onChange={setRows} />
      </Panel>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onPress={() => router.replace(QI_TEMPLATES_BASE)}>Cancel</Button>
        <Button variant="primary" isLoading={busy} isDisabled={busy || name.trim().length < 2 || !criteria.length} onPress={save}>Save checklist</Button>
      </div>
    </div>
  );
}
