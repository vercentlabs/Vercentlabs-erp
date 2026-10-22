"use client";

// Moving returned goods (Procurement plan Phase 2): the delivery challan (rule 55) they travel under, and — at ₹50,000 or more — the e-way
// bill: what is still missing for one, its JSON for the portal's bulk upload, and its number and validity once generated.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye } from "lucide-react";
import { Button, StatusBadge, TextField, buttonVariants } from "@vercentlabs/design-system";

import { Facts, Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { patch, request } from "@/features/procurement/shared/http";
import { calendarDate, money } from "@/features/procurement/shared/format";

type Transport = {
  value: number; taxable: number; required: boolean; threshold: number; missing: string[]; vehicleNumber: string | null; transporterId: string | null; transporterName: string | null;
  distanceKm: number | null; ewbNumber: string | null; ewbValidUntil: string | null; canEdit: boolean;
};

export function ReturnTransportPanel({ returnId }: { returnId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "procurement", "return-transport", returnId);
  const query = useQuery({ queryKey: key, queryFn: () => request<{ transport: Transport }>(`/purchase-returns/${returnId}/transport`).then((result) => result.transport) });
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({ vehicleNumber: "", transporterName: "", transporterId: "", distanceKm: "", ewbNumber: "", ewbValidUntil: "" });
  const save = useMutation({
    mutationFn: () => patch<{ transport: Transport }>(`/purchase-returns/${returnId}/transport`, { vehicleNumber: values.vehicleNumber || null, transporterName: values.transporterName || null,
      transporterId: values.transporterId || null, distanceKm: values.distanceKm === "" ? null : Number(values.distanceKm), ewbNumber: values.ewbNumber || null,
      ewbValidUntil: values.ewbValidUntil ? `${values.ewbValidUntil}T23:59:00+05:30` : null }),
    onSuccess: () => { setEditing(false); void queryClient.invalidateQueries({ queryKey: key }); },
  });
  const transport = query.data;
  if (!transport) return null;
  const set = (field: keyof typeof values) => (value: string) => setValues((state) => ({ ...state, [field]: value }));
  const start = () => {
    setValues({ vehicleNumber: transport.vehicleNumber ?? "", transporterName: transport.transporterName ?? "", transporterId: transport.transporterId ?? "",
      distanceKm: transport.distanceKm != null ? String(transport.distanceKm) : "", ewbNumber: transport.ewbNumber ?? "", ewbValidUntil: transport.ewbValidUntil ? String(transport.ewbValidUntil).slice(0, 10) : "" });
    setEditing(true);
  };
  return (
    <Panel title="Transport and e-way bill"
      description={`Goods worth ${money("INR", String(transport.value))} (with GST). ${transport.required ? "An e-way bill is needed: ₹50,000 or more." : "Under ₹50,000: no e-way bill is needed."}`}
      actions={
        <div className="flex flex-wrap gap-2">
          <a className={buttonVariants({ variant: "secondary", size: "compact" })} href={`/api/documents/procurement.return_challan/${returnId}/pdf?disposition=inline`} target="_blank" rel="noreferrer">
            <Eye className="size-3.5" aria-hidden="true" />Delivery challan</a>
          {transport.required && <a className={buttonVariants({ variant: "ghost", size: "compact" })} href={`/api/procurement/purchase-returns/${returnId}/eway-json`} download>
            <Download className="size-3.5" aria-hidden="true" />E-way bill JSON</a>}
          {transport.canEdit && !editing && <Button size="compact" variant="ghost" onPress={start}>Edit transport</Button>}
        </div>
      }>
      {save.error && <Notice>{save.error instanceof Error ? save.error.message : "Could not save."}</Notice>}
      {transport.required && !transport.ewbNumber && transport.missing.length > 0 && (
        <Notice tone="warning">Before the e-way bill: {transport.missing.join("; ")}.</Notice>
      )}
      {editing ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <TextField label="Vehicle number" value={values.vehicleNumber} onChange={set("vehicleNumber")} placeholder="MH12AB1234" />
            <TextField label="Transporter" value={values.transporterName} onChange={set("transporterName")} />
            <TextField label="Transporter ID (GSTIN / TRANSIN)" value={values.transporterId} onChange={set("transporterId")} />
            <TextField label="Distance (km)" inputMode="numeric" value={values.distanceKm} onChange={set("distanceKm")} />
            <TextField label="E-way bill no." inputMode="numeric" value={values.ewbNumber} onChange={set("ewbNumber")} description="From the portal, once generated." />
            <TextField label="Valid until" type="date" value={values.ewbValidUntil} onChange={set("ewbValidUntil")} />
          </div>
          <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button></div>
        </div>
      ) : (
        <Facts items={[
          { label: "Vehicle", value: transport.vehicleNumber ?? "—" },
          { label: "Transporter", value: [transport.transporterName, transport.transporterId].filter(Boolean).join(" · ") || "—" },
          { label: "Distance", value: transport.distanceKm != null ? `${transport.distanceKm} km` : "—" },
          { label: "E-way bill", value: transport.ewbNumber ? <span className="flex items-center gap-1">{transport.ewbNumber}
            {transport.ewbValidUntil && <StatusBadge tone={new Date(transport.ewbValidUntil) < new Date() ? "danger" : "success"}>{`valid till ${calendarDate(String(transport.ewbValidUntil).slice(0, 10))}`}</StatusBadge>}</span>
            : transport.required ? "Not generated yet" : "Not needed" },
        ]} />
      )}
    </Panel>
  );
}
