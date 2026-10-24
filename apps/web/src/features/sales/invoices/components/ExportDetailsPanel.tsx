"use client";

// An export or SEZ invoice's shipping bill and port code (Sales report Phase 3): printed on the invoice and reported in GSTR-1 table 6A.
// Entered once the goods are cleared, also on a final invoice.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, TextField } from "@vercentlabs/design-system";

import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { post, request } from "@/features/sales/shared/http";

type Details = { shippingBillNumber: string | null; shippingBillDate: string | null; portCode: string | null; supplyType: string | null };

export function ExportDetailsPanel({ invoiceId }: { invoiceId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "invoice-export", invoiceId), queryFn: () => request<{ details: Details | null }>(`/invoices/${invoiceId}/export-details`) });
  const details = query.data?.details;
  if (!details || !["export", "sez"].includes(details.supplyType ?? "")) return null;
  return <ExportDetailsForm key={JSON.stringify(details)} invoiceId={invoiceId} details={details} onSaved={() => void query.refetch()} />;
}

function ExportDetailsForm({ invoiceId, details, onSaved }: { invoiceId: string; details: Details; onSaved: () => void }) {
  const [number, setNumber] = useState(details.shippingBillNumber ?? "");
  const [date, setDate] = useState(details.shippingBillDate ?? "");
  const [port, setPort] = useState(details.portCode ?? "");
  const save = useMutation({
    mutationFn: () => post(`/invoices/${invoiceId}/export-details`, { shippingBillNumber: number.trim() || null, shippingBillDate: date || null, portCode: port.trim() || null }),
    onSuccess: onSaved,
  });
  return (
    <Panel title="Export details" description="From the shipping bill. Printed on the invoice and used in GSTR-1.">
      {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
      {save.isSuccess && <Notice tone="success">Saved.</Notice>}
      <form className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <TextField label="Shipping bill no." value={number} onChange={setNumber} inputMode="numeric" />
        <TextField label="Shipping bill date" type="date" value={date} onChange={setDate} />
        <TextField label="Port code" value={port} onChange={(value) => setPort(value.toUpperCase())} placeholder="INNSA1" />
        <Button type="submit" variant="secondary" isLoading={save.isPending}>Save details</Button>
      </form>
    </Panel>
  );
}
