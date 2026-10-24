"use client";

// Receipt reminders (Procurement report Phase 2): a few days before an order's expected date the supplier is asked to confirm, and after
// it a follow-up — by email, with the link to their page. Preview logs what would be sent without sending, to try it first.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, TextField } from "@vercentlabs/design-system";

import { Notice, Panel } from "@/shared/ui/Panel";
import { patch, request } from "@/features/procurement/shared/http";

type Settings = { mode: "off" | "preview" | "sending"; daysBefore: number; daysAfter: number };

export function ReceiptRemindersPanel({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["procurement", "receipt-reminders"], queryFn: () => request<{ settings: Settings }>("/settings/receipt-reminders").then((result) => result.settings) });
  const [draft, setDraft] = useState<Settings | null>(null);
  const values = draft ?? query.data ?? null;
  const save = useMutation({ mutationFn: () => patch<{ settings: Settings }>("/settings/receipt-reminders", values ?? {}).then((result) => result.settings),
    onSuccess: (settings) => { setDraft(null); queryClient.setQueryData(["procurement", "receipt-reminders"], settings); } });
  if (!values) return null;
  const set = (change: Partial<Settings>) => setDraft({ ...values, ...change });
  return (
    <Panel title="Reminders to suppliers" description="Emails asking about goods still to come, with the link to answer.">
      <div className="flex flex-col gap-3">
        {save.error && <Notice>{save.error instanceof Error ? save.error.message : "Could not save."}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Reminders" isDisabled={!canManage} selectedKey={values.mode} onSelectionChange={(key) => set({ mode: String(key) as Settings["mode"] })}
            options={[{ value: "off", label: "Off" }, { value: "preview", label: "Preview: log only" }, { value: "sending", label: "Send to suppliers" }]} />
          <TextField label="Days before the expected date" isDisabled={!canManage || values.mode === "off"} inputMode="numeric" value={String(values.daysBefore)}
            onChange={(value) => set({ daysBefore: Number(value.replace(/\D/g, "") || 0) })} />
          <TextField label="Days after, if not received" isDisabled={!canManage || values.mode === "off"} inputMode="numeric" value={String(values.daysAfter)}
            onChange={(value) => set({ daysAfter: Number(value.replace(/\D/g, "") || 0) })} />
        </div>
        {canManage && draft && <Button className="w-fit" variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save reminders</Button>}
      </div>
    </Panel>
  );
}
