"use client";

// Lower-deduction certificates (section 197, Shared Platform plan 7): while one is valid, bills from this supplier under its section
// withhold at the certificate's rate, up to its amount.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, TextField } from "@vercentlabs/design-system";

import { Notice, Panel } from "@/shared/ui/Panel";
import { listWithholdingSections } from "@/features/procurement/supplier-bills/api/supplier-bills-api";

type Certificate = { id: string; sectionCode: string | null; certificateNumber: string; rate: string; validFrom: string; validTo: string; amountLimit: string | null };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message ?? "That did not work.");
  return payload as T;
}
const blank = { sectionId: "", certificateNumber: "", rate: "", validFrom: "", validTo: "", amountLimit: "" };

export function TdsCertificatesPanel({ supplierId }: { supplierId: string }) {
  const queryClient = useQueryClient();
  const base = `/api/procurement/suppliers/${supplierId}/tds-certificates`;
  const key = ["procurement", "tds-certificates", supplierId];
  const list = useQuery({ queryKey: key, queryFn: () => call<{ certificates: Certificate[] }>(base).then((data) => data.certificates) });
  const sections = useQuery({ queryKey: ["procurement", "withholding-sections"], queryFn: listWithholdingSections });
  const [draft, setDraft] = useState(blank);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const add = useMutation({ mutationFn: () => call(base, { method: "POST", body: JSON.stringify(draft) }), onSuccess: () => { setDraft(blank); refresh(); } });
  const remove = useMutation({ mutationFn: (id: string) => call(`${base}?certificateId=${id}`, { method: "DELETE", body: "{}" }), onSuccess: refresh });
  const set = (field: keyof typeof blank) => (value: string) => setDraft((current) => ({ ...current, [field]: value }));
  return (
    <Panel title="Lower-deduction certificates" description="Section 197 certificates: while one is valid, bills under its section withhold at its rate, up to its amount.">
      {(add.error ?? remove.error) && <Notice>{((add.error ?? remove.error) as Error).message}</Notice>}
      <ul className="flex flex-col divide-y divide-border text-sm">
        {(list.data ?? []).map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>{entry.sectionCode} · {entry.certificateNumber} · {Number(entry.rate)}% · {entry.validFrom} to {entry.validTo}{entry.amountLimit ? ` · up to ₹${Number(entry.amountLimit).toLocaleString("en-IN")}` : ""}</span>
            <Button size="compact" variant="ghost" onPress={() => remove.mutate(entry.id)}>Remove</Button>
          </li>
        ))}
        {!list.data?.length && <li className="py-2 text-text-muted">No certificates.</li>}
      </ul>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select label="Section" selectedKey={draft.sectionId || null} onSelectionChange={(value) => set("sectionId")(String(value))}
          options={(sections.data ?? []).filter((entry) => entry.status === "active").map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))} />
        <TextField label="Certificate number" value={draft.certificateNumber} onChange={set("certificateNumber")} />
        <TextField label="Rate %" inputMode="decimal" value={draft.rate} onChange={set("rate")} />
        <TextField label="Valid from" type="date" value={draft.validFrom} onChange={set("validFrom")} />
        <TextField label="Valid to" type="date" value={draft.validTo} onChange={set("validTo")} />
        <TextField label="Up to amount (₹)" inputMode="decimal" value={draft.amountLimit} onChange={set("amountLimit")} description="Optional." />
      </div>
      <div className="flex justify-end">
        <Button variant="secondary" isLoading={add.isPending} isDisabled={!draft.sectionId || !draft.certificateNumber || !draft.rate || !draft.validFrom || !draft.validTo} onPress={() => add.mutate()}>Add certificate</Button>
      </div>
    </Panel>
  );
}
