"use client";

// New / edit warehouse. Code (changed only with Change Code), name, type, address (required for a physical warehouse), contact, manager,
// GST registration and which operations it allows. A new warehouse gets its MAIN storage location; documents already made keep the
// warehouse details they were made with.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Checkbox, ComboBox, Dialog, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { ErrorBanner, NONE, orNull, withNone } from "@/features/items/item-format";

import { createWarehouse, errorMessage, fieldErrors, updateWarehouse, type WarehouseDetail, type WarehouseOptions } from "../api/warehouses-api";

type Draft = {
  code: string; name: string; description: string; type: "stores" | "transit"; line1: string; line2: string; city: string; state: string; stateCode: string; postalCode: string;
  countryCode: string; timezone: string; managerUserId: string; contactName: string; phone: string; email: string; taxRegistrationId: string; receivingEnabled: boolean;
  shippingEnabled: boolean; transferEnabled: boolean; returnsEnabled: boolean; isDefault: boolean; reason: string;
};
const blank = (options?: WarehouseOptions): Draft => ({
  code: "", name: "", description: "", type: "stores", line1: "", line2: "", city: "", state: "", stateCode: "", postalCode: "", countryCode: options?.defaults.countryCode ?? "IN",
  timezone: options?.defaults.timezone ?? "Asia/Kolkata", managerUserId: NONE, contactName: "", phone: "", email: "", taxRegistrationId: NONE, receivingEnabled: true,
  shippingEnabled: true, transferEnabled: true, returnsEnabled: true, isDefault: false, reason: "",
});
const draftOf = (warehouse: WarehouseDetail): Draft => ({
  code: warehouse.code, name: warehouse.name, description: warehouse.description ?? "", type: warehouse.type, line1: warehouse.address.line1 ?? "", line2: warehouse.address.line2 ?? "",
  city: warehouse.address.city ?? "", state: warehouse.address.state ?? "", stateCode: warehouse.address.stateCode ?? "", postalCode: warehouse.address.postalCode ?? "",
  countryCode: warehouse.address.countryCode ?? "", timezone: warehouse.timezone ?? "", managerUserId: warehouse.managerUserId ?? NONE, contactName: warehouse.contactName ?? "",
  phone: warehouse.phone ?? "", email: warehouse.email ?? "", taxRegistrationId: warehouse.taxRegistrationId ?? NONE, receivingEnabled: warehouse.receivingEnabled,
  shippingEnabled: warehouse.shippingEnabled, transferEnabled: warehouse.transferEnabled, returnsEnabled: warehouse.returnsEnabled, isDefault: warehouse.isDefault, reason: "",
});

export type WarehouseFormTarget = { mode: "new" } | { mode: "edit"; warehouse: WarehouseDetail };

export function WarehouseFormDialog({ target, options, onClose, onSaved }: {
  target: WarehouseFormTarget | null; options?: WarehouseOptions; onClose: () => void; onSaved: (warehouse: WarehouseDetail) => void;
}) {
  return (
    <Dialog isOpen={target !== null} onOpenChange={(open) => !open && onClose()} title={target?.mode === "edit" ? `Edit ${target.warehouse.name}` : "New warehouse"}>
      {target && <WarehouseForm key={target.mode === "edit" ? target.warehouse.id : "new"} target={target} options={options} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

function WarehouseForm({ target, options, onClose, onSaved }: { target: WarehouseFormTarget; options?: WarehouseOptions; onClose: () => void; onSaved: (warehouse: WarehouseDetail) => void }) {
  const editing = target.mode === "edit" ? target.warehouse : null;
  const [draft, setDraft] = useState<Draft>(() => (editing ? draftOf(editing) : blank(options)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const can = options?.capabilities;
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => { setDraft((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "" })); };
  const codeChanged = Boolean(editing && draft.code.trim().toUpperCase() !== editing.code);
  const physical = draft.type !== "transit";

  const save = useMutation({
    mutationFn: () => {
      const input: Record<string, unknown> = {
        name: draft.name.trim(), description: draft.description.trim() || null, type: draft.type,
        address: { line1: draft.line1, line2: draft.line2, city: draft.city, state: draft.state, stateCode: draft.stateCode, postalCode: draft.postalCode, countryCode: draft.countryCode },
        timezone: draft.timezone.trim() || null, managerUserId: orNull(draft.managerUserId), contactName: draft.contactName, phone: draft.phone, email: draft.email,
        taxRegistrationId: orNull(draft.taxRegistrationId), receivingEnabled: draft.receivingEnabled, shippingEnabled: draft.shippingEnabled,
        transferEnabled: draft.transferEnabled, returnsEnabled: draft.returnsEnabled,
      };
      if (!editing || codeChanged) input.code = draft.code.trim();
      if (draft.isDefault && !editing?.isDefault) input.isDefault = true;
      return editing ? updateWarehouse(editing.id, { ...input, expectedVersion: editing.version, reason: draft.reason.trim() || undefined }) : createWarehouse(input);
    },
    onSuccess: onSaved,
    onError: (failure) => { setErrors(fieldErrors(failure)); setError(errorMessage(failure)); },
  });

  return (
    <div className="flex flex-col gap-4">
      <ErrorBanner message={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Code" isRequired value={draft.code} onChange={(value) => set("code")(value.toUpperCase().replace(/\s/g, ""))} errorMessage={errors.code}
          isDisabled={Boolean(editing) && !can?.changeCode} description={editing ? (can?.changeCode ? "Changing it keeps every document and movement linked." : "Needs Change Code permission.") : "Unique, such as PUN-01."} />
        <TextField label="Name" isRequired value={draft.name} onChange={set("name")} errorMessage={errors.name} />
        {codeChanged && <TextField className="sm:col-span-2" label="Reason for the new code" value={draft.reason} onChange={set("reason")} />}
        <Select label="Type" selectedKey={draft.type} onSelectionChange={(key) => set("type")(String(key) as Draft["type"])}
          options={(options?.types ?? [{ code: "stores", label: "Standard" }, { code: "transit", label: "Transit" }]).map((entry) => ({ value: entry.code, label: entry.label }))}
          description={draft.type === "transit" ? "Goods on the way between warehouses; no address needed." : "A physical place stock is kept in."} />
        <TextField label="Time zone" value={draft.timezone} onChange={set("timezone")} errorMessage={errors.timezone} description="Such as Asia/Kolkata." />
        <TextArea className="sm:col-span-2" label="Description" rows={2} value={draft.description} onChange={set("description")} />
      </div>
      <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
        <legend className="text-sm font-semibold">Address</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField className="sm:col-span-2" label="Address line 1" isRequired={physical} value={draft.line1} onChange={set("line1")} errorMessage={errors.line1} />
          <TextField className="sm:col-span-2" label="Address line 2" value={draft.line2} onChange={set("line2")} />
          <TextField label="City" isRequired={physical} value={draft.city} onChange={set("city")} errorMessage={errors.city} />
          <TextField label="State" isRequired={physical} value={draft.state} onChange={set("state")} errorMessage={errors.state} />
          <TextField label="State code (GST)" value={draft.stateCode} onChange={set("stateCode")} errorMessage={errors.stateCode} description="Such as 27 for Maharashtra." />
          <TextField label="Postal code" isRequired={physical} value={draft.postalCode} onChange={set("postalCode")} errorMessage={errors.postalCode} />
          <TextField label="Country" isRequired={physical} value={draft.countryCode} onChange={(value) => set("countryCode")(value.toUpperCase().slice(0, 2))} errorMessage={errors.countryCode} description="Two letters, such as IN." />
          <Select label="GST registration" selectedKey={draft.taxRegistrationId} onSelectionChange={(key) => set("taxRegistrationId")(String(key))} errorMessage={errors.taxRegistrationId}
            options={withNone((options?.registrations ?? []).map((entry) => ({ value: entry.id, label: entry.label })), "None")} />
        </div>
        {editing && <p className="text-xs text-text-muted">A new address is used by documents made from now on; posted documents keep the address they were made with.</p>}
      </fieldset>
      <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
        <legend className="text-sm font-semibold">Contact</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ComboBox label="Manager" selectedKey={draft.managerUserId} placeholder="Search people" errorMessage={errors.managerUserId}
            options={withNone((options?.members ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "No manager")} onSelectionChange={(key) => key !== null && set("managerUserId")(String(key))} />
          <TextField label="Contact person" value={draft.contactName} onChange={set("contactName")} />
          <TextField label="Phone" value={draft.phone} onChange={set("phone")} />
          <TextField label="Email" value={draft.email} onChange={set("email")} errorMessage={errors.email} />
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2 border-t border-border pt-4">
        <legend className="text-sm font-semibold">Operations</legend>
        <Checkbox isSelected={draft.receivingEnabled} onChange={set("receivingEnabled")}>Receives goods (purchase receipts)</Checkbox>
        <Checkbox isSelected={draft.shippingEnabled && physical} isDisabled={!physical} onChange={set("shippingEnabled")}>Ships goods (sales deliveries){physical ? "" : " — a transit warehouse never ships to customers"}</Checkbox>
        <Checkbox isSelected={draft.transferEnabled} onChange={set("transferEnabled")}>Transfers to and from other warehouses</Checkbox>
        <Checkbox isSelected={draft.returnsEnabled} onChange={set("returnsEnabled")}>Takes returns (sales and purchase returns)</Checkbox>
        {!editing?.isDefault && <Checkbox isSelected={draft.isDefault} onChange={set("isDefault")}>Make it the company&apos;s default warehouse</Checkbox>}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onPress={onClose}>Cancel</Button>
        <Button variant="primary" isLoading={save.isPending} onPress={() => { setError(null); save.mutate(); }}>{editing ? "Save changes" : "Create warehouse"}</Button>
      </div>
    </div>
  );
}
