"use client";

// New BOM: the first draft revision of a product's recipe. Saved as a draft, or saved and submitted for approval in one step.
import { useState } from "react";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@vercentlabs/design-system";

import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useSubmitKey } from "@/shared/http/submit-once";

import { createBom, errorIssues, errorMessage, revisionAction, type BomIssue } from "../api/bom-api";
import { BomEditor, blankLine, payloadOf, type EditorState } from "../components/BomEditor";
import { BOM_BASE } from "./BomListScreen";

export function BomNewScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, setState] = useState<EditorState>({ finishedItemId: null, name: "", outputQuantity: "1", outputUomId: null, expectedYieldPct: "100", batchSize: "", defaultWarehouseId: null,
    description: "", changeReason: "", lines: [blankLine()] });
  const [issues, setIssues] = useState<BomIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitKey = useSubmitKey();
  const save = async (submit: boolean) => {
    setSaving(true);
    setError(null);
    setIssues([]);
    try {
      const bom = await submitKey.run(() => createBom({ finishedItemId: state.finishedItemId, ...payloadOf(state) }));
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      if (submit && bom.revision) {
        try { await revisionAction(bom.id, bom.revision.id, "submit", { expectedVersion: bom.revision.version }); }
        catch (failure) { router.replace(`${BOM_BASE}/${bom.id}?submitError=${encodeURIComponent(errorMessage(failure))}`); return; }
      }
      router.replace(`${BOM_BASE}/${bom.id}`);
    } catch (failure) { setError(errorMessage(failure)); setIssues(errorIssues(failure)); setSaving(false); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="New bill of materials" description="Manufacturing › Bills of Materials › New. The recipe starts as revision 1, a draft; it is used for production only once approved and active." />
      {error && <Notice tone="danger">{error}</Notice>}
      <BomEditor state={state} onChange={setState} productLocked={false} issues={issues} saving={saving} onSave={() => save(false)} onSubmit={() => save(true)} />
    </div>
  );
}
