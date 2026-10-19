"use client";

// e-invoice (IRN) and e-way bill panels (Shared Platform plan 7): shown on a posted invoice, and on a delivery, transfer or purchase
// return. Everything goes through the company's GSP; without one, the panel says so.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { Notice, Panel } from "@/shared/ui/Panel";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message ?? "That did not work.");
  return payload as T;
}
const when = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN") : "");
const TONE = { generated: "success", cancelled: "neutral", failed: "danger" } as const;

type EInvoice = { irn: string | null; ackNumber: string | null; ackDate: string | null; status: "generated" | "cancelled" | "failed"; error: string | null; cancelReason: string | null };
export function EInvoicePanel({ invoiceId }: { invoiceId: string }) {
  const queryClient = useQueryClient();
  const url = `/api/sales/invoices/${invoiceId}/einvoice`;
  const key = ["sales", "einvoice", invoiceId];
  const query = useQuery({ queryKey: key, queryFn: () => call<{ einvoice: EInvoice | null; configured: boolean }>(url) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const generate = useMutation({ mutationFn: () => call(url, { method: "POST", body: "{}" }), onSuccess: refresh });
  const [reason, setReason] = useState("data_entry_mistake");
  const cancel = useMutation({ mutationFn: () => call(url, { method: "PATCH", body: JSON.stringify({ reason }) }), onSuccess: refresh });
  if (!query.data) return null;
  const { einvoice, configured } = query.data;
  const error = (generate.error ?? cancel.error) as Error | null;
  return (
    <Panel title="e-Invoice" description="The IRN from the Invoice Registration Portal, for a B2B invoice of a GSTIN under the e-invoice mandate. It can be cancelled within 24 hours.">
      {error && <Notice>{error.message}</Notice>}
      {!configured && !einvoice && <p className="text-sm text-text-muted">No GSP is configured for this installation, so e-invoices cannot be generated yet.</p>}
      {einvoice && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-2"><StatusBadge tone={TONE[einvoice.status]}>{einvoice.status}</StatusBadge>{einvoice.ackNumber ? `Ack ${einvoice.ackNumber} · ${when(einvoice.ackDate)}` : ""}</span>
          {einvoice.irn && <code className="break-all text-xs">{einvoice.irn}</code>}
          {einvoice.error && <span className="text-xs text-danger">{einvoice.error}</span>}
          {einvoice.cancelReason && <span className="text-xs text-text-muted">Cancelled: {einvoice.cancelReason}</span>}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        {configured && einvoice?.status !== "generated" && <Button variant="primary" isLoading={generate.isPending} onPress={() => generate.mutate()}>Generate IRN</Button>}
        {einvoice?.status === "generated" && (
          <>
            <Select label="Cancel because" selectedKey={reason} onSelectionChange={(value) => setReason(String(value))}
              options={[{ value: "data_entry_mistake", label: "Data entry mistake" }, { value: "duplicate", label: "Duplicate" }, { value: "order_cancelled", label: "Order cancelled" }, { value: "other", label: "Other" }]} />
            <Button variant="secondary" isLoading={cancel.isPending} onPress={() => cancel.mutate()}>Cancel IRN</Button>
          </>
        )}
      </div>
    </Panel>
  );
}

type EwayBill = { id: string; ewbNumber: string | null; ewbDate: string | null; validUntil: string | null; status: "generated" | "cancelled" | "failed"; vehicleNumber: string | null; error: string | null };
export function EwayBillPanel({ sourceType, sourceId }: { sourceType: "sales_delivery" | "stock_transfer" | "purchase_return"; sourceId: string }) {
  const queryClient = useQueryClient();
  const key = ["compliance", "eway-bill", sourceType, sourceId];
  const query = useQuery({ queryKey: key, queryFn: () => call<{ ewayBill: EwayBill | null; configured: boolean }>(`/api/compliance/eway-bills?sourceType=${sourceType}&sourceId=${sourceId}`) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const [form, setForm] = useState({ distanceKm: "", vehicleNumber: "", transportMode: "road", transporterId: "" });
  const [voluntary, setVoluntary] = useState(false);
  const generate = useMutation({
    mutationFn: () => call("/api/compliance/eway-bills", { method: "POST", body: JSON.stringify({ sourceType, sourceId, distanceKm: Number(form.distanceKm || 0), transportMode: form.transportMode,
      vehicleNumber: form.vehicleNumber || undefined, transporterId: form.transporterId || undefined, voluntary }) }),
    onSuccess: refresh,
    onError: (failure) => { if (/under ₹50,000/.test((failure as Error).message)) setVoluntary(true); },
  });
  const [vehicle, setVehicle] = useState("");
  const partB = useMutation({ mutationFn: (id: string) => call(`/api/compliance/eway-bills/${id}`, { method: "PATCH", body: JSON.stringify({ vehicleNumber: vehicle, reason: "first_time" }) }), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: (id: string) => call(`/api/compliance/eway-bills/${id}`, { method: "POST", body: JSON.stringify({ reason: "data_entry_mistake" }) }), onSuccess: refresh });
  if (!query.data) return null;
  const { ewayBill, configured } = query.data;
  const error = (generate.error ?? partB.error ?? cancel.error) as Error | null;
  const set = (field: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [field]: value }));
  return (
    <Panel title="e-Way bill" description="Needed for goods worth over ₹50,000 on the move. Generate it before the goods leave; add the vehicle (Part B) when it is known.">
      {error && <Notice tone={voluntary ? "warning" : undefined}>{error.message}</Notice>}
      {!configured && !ewayBill && <p className="text-sm text-text-muted">No GSP is configured for this installation, so e-way bills cannot be generated yet.</p>}
      {ewayBill && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-2"><StatusBadge tone={TONE[ewayBill.status]}>{ewayBill.status}</StatusBadge>{ewayBill.ewbNumber ? `EWB ${ewayBill.ewbNumber}` : ""}</span>
          {ewayBill.validUntil && <span className="text-xs text-text-muted">Valid until {when(ewayBill.validUntil)}{ewayBill.vehicleNumber ? ` · vehicle ${ewayBill.vehicleNumber}` : " · no vehicle yet"}</span>}
          {ewayBill.error && <span className="text-xs text-danger">{ewayBill.error}</span>}
        </div>
      )}
      {configured && ewayBill?.status !== "generated" && (
        <div className="grid gap-2 sm:grid-cols-4">
          <TextField label="Distance (km)" inputMode="numeric" value={form.distanceKm} onChange={set("distanceKm")} />
          <Select label="Mode" selectedKey={form.transportMode} onSelectionChange={(value) => set("transportMode")(String(value))}
            options={[{ value: "road", label: "Road" }, { value: "rail", label: "Rail" }, { value: "air", label: "Air" }, { value: "ship", label: "Ship" }]} />
          <TextField label="Vehicle (optional)" value={form.vehicleNumber} onChange={set("vehicleNumber")} placeholder="MH12AB1234" />
          <TextField label="Transporter ID (optional)" value={form.transporterId} onChange={set("transporterId")} />
          <div className="sm:col-span-4"><Button variant="primary" isLoading={generate.isPending} onPress={() => generate.mutate()}>{voluntary ? "Generate anyway" : "Generate e-way bill"}</Button></div>
        </div>
      )}
      {ewayBill?.status === "generated" && (
        <div className="flex flex-wrap items-end gap-2">
          <TextField label="Vehicle number" value={vehicle} onChange={setVehicle} placeholder="MH12AB1234" />
          <Button variant="secondary" isLoading={partB.isPending} isDisabled={vehicle.length < 6} onPress={() => partB.mutate(ewayBill.id)}>Update Part B</Button>
          <Button variant="ghost" isLoading={cancel.isPending} onPress={() => cancel.mutate(ewayBill.id)}>Cancel e-way bill</Button>
        </div>
      )}
    </Panel>
  );
}
