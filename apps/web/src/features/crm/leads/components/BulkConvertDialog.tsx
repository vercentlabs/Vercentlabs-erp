"use client";

// Convert the selected leads at once (CRM plan 5.4): each with its suggested company, contact and deal, as Convert would; the deals go
// to the leads' owners, to one person, or round-robin among several. Leads that cannot be converted are reported; the rest go ahead.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, Select, TextField } from "@vercentlabs/design-system";

import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";

import { bulkLeadAction, type LeadBulkResult, type LeadOptions } from "../api/leads-api";

export function BulkConvertDialog({ isOpen, onOpenChange, leadIds, options, onDone }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; leadIds: string[]; options: LeadOptions; onDone: (result: LeadBulkResult) => void;
}) {
  const [closeDate, setCloseDate] = useState("");
  const [mode, setMode] = useState<"lead_owner" | "user" | "round_robin">("lead_owner");
  const [userId, setUserId] = useState("");
  const [userIds, setUserIds] = useState<string[]>([]);
  const [override, setOverride] = useState("");
  const [error, setError] = useState<string | null>(null);
  const users = options.users ?? [];
  const convert = useMutation({
    mutationFn: () => bulkLeadAction({
      action: "convert", leadIds, expectedCloseDate: closeDate,
      owner: mode === "user" ? { mode, userId } : mode === "round_robin" ? { mode, userIds } : { mode },
      ...(override.trim() ? { overrideReason: override.trim() } : {}),
    }),
    onSuccess: (result) => { onDone(result); onOpenChange(false); },
    onError: (failure) => setError(failure instanceof Error ? failure.message : "The leads could not be converted."),
  });
  const ready = closeDate && (mode === "lead_owner" || (mode === "user" && userId) || (mode === "round_robin" && userIds.length > 0));
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Convert ${leadIds.length} ${leadIds.length === 1 ? "lead" : "leads"}`} size="lg"
      description="Each lead becomes a company (the matching one when found), a contact and a deal, as Convert suggests. Leads that cannot be converted are listed afterwards.">
      <div className="flex flex-col gap-4">
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <DateInput label="Expected close date of the deals" isRequired value={closeDate} onChange={setCloseDate} />
        <Select label="The deals go to" selectedKey={mode} onSelectionChange={(key) => setMode(String(key) as typeof mode)}
          options={[{ value: "lead_owner", label: "Each lead's owner" }, { value: "user", label: "One person" }, { value: "round_robin", label: "Shared in turn between several people" }]} />
        {mode === "user" && <Select label="Person" isRequired selectedKey={userId || null} onSelectionChange={(key) => setUserId(String(key))} options={users.map((user) => ({ value: user.id, label: user.name }))} />}
        {mode === "round_robin" && (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">People, in turn</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {users.map((user) => (
                <Checkbox key={user.id} isSelected={userIds.includes(user.id)}
                  onChange={(selected) => setUserIds((current) => (selected ? [...current, user.id] : current.filter((id) => id !== user.id)))}>{user.name}</Checkbox>
              ))}
            </div>
          </fieldset>
        )}
        <TextField label="Reason for leads not fully qualified (optional)" description="Given, leads missing qualification are converted too (needs the override permission)."
          value={override} onChange={setOverride} maxLength={500} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" isLoading={convert.isPending} isDisabled={!ready} onPress={() => convert.mutate()}>Convert</Button>
        </div>
      </div>
    </Dialog>
  );
}
