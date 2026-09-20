"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, NumberField, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { ProcApiError } from "@/features/procurement/shared/http";
import { createRecord, listRecords, updateRecord, type ProcRecord } from "@/features/procurement/shared/api";
import { ProcAlert, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { useCan } from "@/features/procurement/shared/use-can";

// The rules the system applies to supplier invoices. The tolerance is how far an
// invoice line may differ from the order (in %) before it becomes a match
// exception. Nothing is applied until it is saved; the default is exact (0%).
export function ProcurementSettingsScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "policies"), queryFn: () => listRecords("policies", { limit: 100 }).then((r) => r.rows) });
  if (query.isError) {
    if (query.error instanceof ProcApiError && query.error.status === 403) return <PermissionState title="You don't have access to Procurement" description="Ask an administrator to grant procurement.view." />;
    return <ErrorState title="Could not load procurement settings" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }
  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading settings…</p>;
  const current = (query.data ?? []).find((policy) => policy.policyType === "matching_tolerance" && policy.status === "active") ?? null;
  return <ToleranceForm key={current?.id ?? "none"} current={current} />;
}

function ToleranceForm({ current }: { current: ProcRecord | null }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const canManage = can("procurement.settings.manage");
  const [tolerance, setTolerance] = useState(Number(current?.tolerancePercent ?? 0));
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const payload = { policyType: "matching_tolerance", name: "Invoice matching tolerance", tolerancePercent: tolerance };
      return current ? updateRecord("policies", current.id, { ...payload, expectedVersion: current.version }) : createRecord("policies", payload);
    },
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") });
    },
  });
  const error = save.error ? (save.error instanceof ProcApiError ? save.error.message : "Settings could not be saved.") : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Procurement settings"
        description="How strictly supplier invoices are matched to orders."
        primaryAction={
          canManage ? (
            <Button variant="primary" onPress={() => save.mutate()} isLoading={save.isPending}>
              Save settings
            </Button>
          ) : undefined
        }
      />
      {!canManage && <ProcAlert tone="info">You can view these settings. Changing them needs the Procurement settings permission.</ProcAlert>}
      {error && <ProcAlert>{error}</ProcAlert>}
      {saved && <ProcAlert tone="success">Saved. It applies to invoices matched from now on.</ProcAlert>}
      <ProcPanel title="Invoice matching" description="An invoice line within this percentage of the order value is accepted; outside it, a match exception is opened. Widening it for a single invoice needs the override permission and a reason.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField label="Price tolerance (%)" value={tolerance} onChange={(value) => { setSaved(false); setTolerance(value); }} minValue={0} maxValue={100} step={0.5} isDisabled={!canManage} />
        </div>
      </ProcPanel>
    </div>
  );
}
