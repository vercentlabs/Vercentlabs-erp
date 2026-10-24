"use client";

// The LUT (Letter of Undertaking) each GSTIN exports under without paying IGST (Sales report Phase 3): printed on its export invoices.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, TextField } from "@vercentlabs/design-system";

import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { post, request } from "@/features/sales/shared/http";

type Registration = { id: string; name: string; gstin: string; lutNumber: string | null; lutDate: string | null };

export function LutPanel({ canManage }: { canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "lut"), queryFn: () => request<{ registrations: Registration[] }>("/settings/lut") });
  if (!query.data?.registrations.length) return null;
  return (
    <Panel title="Exports without IGST (LUT)" description="The Letter of Undertaking filed for the year, printed on export invoices.">
      <div className="flex flex-col divide-y divide-border">
        {query.data.registrations.map((registration) => <LutRow key={registration.id} registration={registration} canManage={canManage} onSaved={() => void query.refetch()} />)}
      </div>
    </Panel>
  );
}

function LutRow({ registration, canManage, onSaved }: { registration: Registration; canManage: boolean; onSaved: () => void }) {
  const [number, setNumber] = useState(registration.lutNumber ?? "");
  const [date, setDate] = useState(registration.lutDate ?? "");
  const save = useMutation({ mutationFn: () => post("/settings/lut", { registrationId: registration.id, lutNumber: number.trim() || null, lutDate: date || null }), onSuccess: onSaved });
  return (
    <form className="flex flex-col gap-2 py-3 first:pt-0" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <span className="text-sm font-medium tabular-nums">{`${registration.gstin} · ${registration.name}`}</span>
      {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_12rem_auto]">
        <TextField label="LUT ARN" value={number} onChange={setNumber} isDisabled={!canManage} />
        <TextField label="Dated" type="date" value={date} onChange={setDate} isDisabled={!canManage} />
        <Button type="submit" variant="secondary" isDisabled={!canManage} isLoading={save.isPending}>Save LUT</Button>
      </div>
    </form>
  );
}
