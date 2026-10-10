"use client";

// Create or edit a store / outlet: who and where it is, the warehouse it sells from, the GST registration it sells under, its sales defaults
// and its hours. A new outlet is saved Inactive; the record page activates it once its setup is complete. Fields the person may not change
// (stock source, tax, accounts) are shown but locked.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ComboBox, ErrorState, RecordFormPage, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { ErrorBanner, NONE, orNull, withNone } from "@/features/items/item-format";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  OUTLETS_BASE, createOutlet, errorMessage, fieldErrors, getOutlet, getOutletOptions, updateOutlet, type BusinessHours, type OutletDetail, type OutletOptions,
} from "../api/outlets-api";

type Hours = Record<string, { opens: string; closes: string; closed: boolean }>;
type Draft = {
  code: string; name: string; type: string; managerUserId: string; phone: string; email: string;
  line1: string; line2: string; city: string; state: string; stateCode: string; postalCode: string; countryCode: string; timezone: string;
  warehouseId: string; sellingLocationId: string; returnsLocationId: string; taxRegistrationId: string; receiptMessage: string;
  priceListId: string; cashAccountId: string; hours: Hours; notes: string; reason: string;
  allowWalkInSales: boolean; allowOptionalBuyerName: boolean; allowReceiptContactCapture: boolean;
};

const DAY_LABEL: Record<string, string> = { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday" };

function hoursOf(saved: BusinessHours | undefined, weekdays: string[]): Hours {
  return Object.fromEntries(weekdays.map((day) => [day, { opens: saved?.[day]?.opens ?? "", closes: saved?.[day]?.closes ?? "", closed: Boolean(saved?.[day]?.closed) }]));
}

function draftOf(outlet: OutletDetail | null, options: OutletOptions): Draft {
  return {
    code: outlet?.code ?? "", name: outlet?.name ?? "", type: outlet?.type ?? "retail_store", managerUserId: outlet?.managerUserId ?? NONE, phone: outlet?.phone ?? "",
    email: outlet?.email ?? "", line1: outlet?.address.line1 ?? "", line2: outlet?.address.line2 ?? "", city: outlet?.address.city ?? "", state: outlet?.address.state ?? "",
    stateCode: outlet?.address.stateCode ?? "", postalCode: outlet?.address.postalCode ?? "", countryCode: outlet?.address.countryCode ?? options.defaults.countryCode,
    timezone: outlet?.timezone ?? options.defaults.timezone, warehouseId: outlet?.warehouseId ?? options.warehouses[0]?.id ?? "",
    sellingLocationId: outlet?.sellingLocationId ?? NONE, returnsLocationId: outlet?.returnsLocationId ?? NONE,
    taxRegistrationId: outlet?.taxRegistrationId ?? options.registrations[0]?.id ?? NONE, receiptMessage: outlet?.receiptMessage ?? "",
    priceListId: outlet?.priceListId ?? NONE, cashAccountId: outlet?.cashAccountId ?? NONE,
    allowWalkInSales: outlet?.walkIn?.allowWalkInSales ?? true, allowOptionalBuyerName: outlet?.walkIn?.allowOptionalBuyerName ?? true,
    allowReceiptContactCapture: outlet?.walkIn?.allowReceiptContactCapture ?? true,
    hours: hoursOf(outlet?.businessHours, options.weekdays), notes: outlet?.notes ?? "", reason: "",
  };
}

export function OutletFormScreen({ outletId }: { outletId?: string }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "pos-outlets", "options"), queryFn: getOutletOptions, staleTime: 60_000 });
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "pos-outlets", "one", outletId), queryFn: () => getOutlet(outletId!), enabled: Boolean(outletId) });
  if (options.isLoading || existing.isLoading) return <LoadingState label="Loading outlet" rows={5} />;
  if (!options.data || (outletId && !existing.data)) return <ErrorState title="Could not load the outlet" description={errorMessage(options.error ?? existing.error)} />;
  return <Form options={options.data} outlet={existing.data ?? null} />;
}

function Form({ options, outlet }: { options: OutletOptions; outlet: OutletDetail | null }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftOf(outlet, options));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const can = outlet?.capabilities ?? options.capabilities;
  // Creating sets everything the creator may set; editing locks what needs a permission the person lacks.
  const editable = { general: outlet ? can.edit : can.create, inventory: outlet ? can.manageInventory : can.create, tax: outlet ? can.manageTax : can.create, cash: can.managePayments };
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => { setDraft((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "" })); };
  const setHours = (day: string, change: Partial<Hours[string]>) => setDraft((current) => ({ ...current, hours: { ...current.hours, [day]: { ...current.hours[day], ...change } } }));
  const locations = options.locations.filter((entry) => entry.warehouseId === draft.warehouseId).map((entry) => ({ value: entry.id, label: entry.label }));
  const codeChanged = Boolean(outlet && draft.code.trim().toUpperCase() !== outlet.code);
  const registration = options.registrations.find((entry) => entry.id === draft.taxRegistrationId);
  const stateMismatch = Boolean(registration?.stateCode && draft.stateCode.trim() && registration.stateCode !== draft.stateCode.trim());

  const save = useMutation({
    mutationFn: () => {
      const businessHours = Object.fromEntries(Object.entries(draft.hours).map(([day, entry]) => [day, entry.closed ? { closed: true } : { opens: entry.opens, closes: entry.closes }]));
      const input: Record<string, unknown> = {
        name: draft.name.trim(), type: draft.type, managerUserId: orNull(draft.managerUserId), phone: draft.phone, email: draft.email,
        address: { line1: draft.line1, line2: draft.line2, city: draft.city, state: draft.state, stateCode: draft.stateCode, postalCode: draft.postalCode, countryCode: draft.countryCode },
        timezone: draft.timezone.trim() || null, priceListId: orNull(draft.priceListId), businessHours, notes: draft.notes,
        allowWalkInSales: draft.allowWalkInSales, allowOptionalBuyerName: draft.allowOptionalBuyerName, allowReceiptContactCapture: draft.allowReceiptContactCapture,
      };
      if (editable.inventory) Object.assign(input, { warehouseId: draft.warehouseId, sellingLocationId: orNull(draft.sellingLocationId), returnsLocationId: orNull(draft.returnsLocationId) });
      if (editable.tax) Object.assign(input, { taxRegistrationId: orNull(draft.taxRegistrationId), receiptMessage: draft.receiptMessage });
      if (editable.cash) input.cashAccountId = orNull(draft.cashAccountId);
      if (!outlet || codeChanged) input.code = draft.code.trim();
      return outlet ? updateOutlet(outlet.id, { ...input, expectedVersion: outlet.version, reason: draft.reason.trim() || undefined }) : createOutlet(input);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-outlets") });
      router.push(`${OUTLETS_BASE}/${saved.id}`);
    },
    onError: (failure) => { setErrors(fieldErrors(failure)); setError(errorMessage(failure)); window.scrollTo({ top: 0, behavior: "smooth" }); },
  });

  return (
    <RecordFormPage
      header={{
        title: outlet ? `Edit ${outlet.name}` : "New store / outlet",
        description: outlet ? "New sales and receipts use the changes; completed sales, returns and receipts keep what they were made with."
          : "Saved inactive. Activate it from its page once its address, selling warehouse, GST registration and payment methods are set.",
      }}
      banner={<ErrorBanner message={error} />}
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.push(outlet ? `${OUTLETS_BASE}/${outlet.id}` : OUTLETS_BASE)}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => { setError(null); save.mutate(); }}>{outlet ? "Save changes" : "Create outlet"}</Button>
        </>
      }
    >
      <FormSection title="Outlet">
        <TextField label="Code" isRequired value={draft.code} onChange={(value) => set("code")(value.toUpperCase().replace(/\s/g, ""))} errorMessage={errors.code}
          isDisabled={!editable.general} description={outlet ? "Changing it keeps every sale and receipt linked." : "Unique in the company, such as PUN-FC."} />
        <TextField label="Name" isRequired value={draft.name} onChange={set("name")} errorMessage={errors.name} isDisabled={!editable.general} description="Shown on receipts." />
        {codeChanged && <TextField label="Reason for the new code" value={draft.reason} onChange={set("reason")} />}
        <Select label="Type" selectedKey={draft.type} onSelectionChange={(key) => set("type")(String(key))} isDisabled={!editable.general} errorMessage={errors.type}
          options={options.types.map((entry) => ({ value: entry.code, label: entry.label }))} />
        <ComboBox label="Manager" selectedKey={draft.managerUserId} placeholder="Search people" errorMessage={errors.managerUserId} isDisabled={!editable.general}
          options={withNone(options.members.map((entry) => ({ value: entry.id, label: entry.name })), "No manager")} onSelectionChange={(key) => key !== null && set("managerUserId")(String(key))}
          description="For accountability and alerts. Being manager grants no permissions." />
        <TextField label="Phone" value={draft.phone} onChange={set("phone")} isDisabled={!editable.general} />
        <TextField label="Email" value={draft.email} onChange={set("email")} errorMessage={errors.email} isDisabled={!editable.general} />
      </FormSection>

      <FormSection title="Address" description="Printed on receipts and tax invoices. A new address is used from now on; issued receipts keep theirs.">
        <TextField label="Address line 1" isRequired value={draft.line1} onChange={set("line1")} errorMessage={errors.line1} isDisabled={!editable.general} />
        <TextField label="Address line 2" value={draft.line2} onChange={set("line2")} isDisabled={!editable.general} />
        <TextField label="City" isRequired value={draft.city} onChange={set("city")} errorMessage={errors.city} isDisabled={!editable.general} />
        <TextField label="State" isRequired value={draft.state} onChange={set("state")} errorMessage={errors.state} isDisabled={!editable.general} />
        <TextField label="State code (GST)" value={draft.stateCode} onChange={set("stateCode")} errorMessage={errors.stateCode} isDisabled={!editable.general} description="Such as 27 for Maharashtra." />
        <TextField label="Postal code" isRequired value={draft.postalCode} onChange={set("postalCode")} errorMessage={errors.postalCode} isDisabled={!editable.general} />
        <TextField label="Country" isRequired value={draft.countryCode} onChange={(value) => set("countryCode")(value.toUpperCase().slice(0, 2))} errorMessage={errors.countryCode}
          isDisabled={!editable.general} description="Two letters, such as IN." />
        <TextField label="Time zone" isRequired value={draft.timezone} onChange={set("timezone")} errorMessage={errors.timezone} isDisabled={!editable.general}
          description="Sets the outlet's business day, such as Asia/Kolkata." />
      </FormSection>

      <FormSection title="Stock" description="The warehouse whose stock this outlet sells. Quantities stay in Inventory; several outlets may share one warehouse.">
        <Select label="Selling warehouse" isRequired selectedKey={draft.warehouseId} isDisabled={!editable.inventory} errorMessage={errors.warehouseId}
          onSelectionChange={(key) => setDraft((current) => ({ ...current, warehouseId: String(key), sellingLocationId: NONE, returnsLocationId: NONE }))}
          options={options.warehouses.map((entry) => ({ value: entry.id, label: entry.label }))}
          description={outlet ? "Cannot change while a POS session is open here. New sales take stock from it." : undefined} />
        <Select label="Selling location" selectedKey={draft.sellingLocationId} isDisabled={!editable.inventory} errorMessage={errors.sellingLocationId}
          onSelectionChange={(key) => set("sellingLocationId")(String(key))} options={withNone(locations, "Warehouse default")} description="Where sold stock is issued from, such as SHOP-FLOOR." />
        <Select label="Returns location" selectedKey={draft.returnsLocationId} isDisabled={!editable.inventory} errorMessage={errors.returnsLocationId}
          onSelectionChange={(key) => set("returnsLocationId")(String(key))} options={withNone(locations, "Warehouse default")}
          description="Where returned goods are received; a quality-hold location keeps them out of Available." />
      </FormSection>

      <FormSection title="Tax and receipt" description="The company GST registration the outlet sells under; its GSTIN and legal name come from that registration.">
        <Select label="GST registration" selectedKey={draft.taxRegistrationId} isDisabled={!editable.tax} errorMessage={errors.taxRegistrationId}
          onSelectionChange={(key) => set("taxRegistrationId")(String(key))}
          options={withNone(options.registrations.map((entry) => ({ value: entry.id, label: `${entry.label}${entry.gstin ? ` · ${entry.gstin}` : ""}` })), "None")}
          description={stateMismatch ? `This registration is for state ${registration?.stateCode}; the outlet is in state ${draft.stateCode}.` : "Choose the registration for the outlet's state."} />
        <TextField label="Receipt message" value={draft.receiptMessage} onChange={set("receiptMessage")} isDisabled={!editable.tax} description="Printed at the foot of every receipt." />
      </FormSection>

      <FormSection title="Sales defaults" description="Used for new carts at this outlet. A customer's own price list comes first.">
        <Select label="Default price list" selectedKey={draft.priceListId} isDisabled={!editable.general} errorMessage={errors.priceListId}
          onSelectionChange={(key) => set("priceListId")(String(key))} options={withNone(options.priceLists.map((entry) => ({ value: entry.id, label: entry.label })), "Company default")} />
        {/* Walk-in sales are a mode of the bill, never a placeholder customer record. */}
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Checkbox isSelected={draft.allowWalkInSales} isDisabled={!editable.general} onChange={(value) => set("allowWalkInSales")(value)}>
            Sell to walk-in customers (no customer record needed)
          </Checkbox>
          <Checkbox isSelected={draft.allowOptionalBuyerName} isDisabled={!editable.general} onChange={(value) => set("allowOptionalBuyerName")(value)}>
            Let cashiers add an optional buyer name and address to walk-in invoices
          </Checkbox>
          <Checkbox isSelected={draft.allowReceiptContactCapture} isDisabled={!editable.general} onChange={(value) => set("allowReceiptContactCapture")(value)}>
            Collect a phone or email for digital receipts (with the customer&apos;s agreement)
          </Checkbox>
        </div>
        {editable.cash && (
          <Select label="Default cash account" selectedKey={draft.cashAccountId} errorMessage={errors.cashAccountId} onSelectionChange={(key) => set("cashAccountId")(String(key))}
            options={withNone(options.accounts.filter((entry) => entry.type === "cash").map((entry) => ({ value: entry.id, label: entry.label })), "Company default")}
            description="Cash taken here posts to this account unless a terminal has its own." />
        )}
        <div className="flex items-end text-sm text-text-muted">Currency: {outlet?.currencyCode ?? options.defaults.currencyCode} (the company&apos;s)</div>
      </FormSection>

      <FormSection title="Business hours" columns={1} description="For information. Sales are not blocked outside these hours.">
        <div className="flex flex-col gap-2">
          {options.weekdays.map((day) => (
            <div key={day} className="grid grid-cols-[7rem_1fr_1fr_auto] items-center gap-2">
              <span className="text-sm">{DAY_LABEL[day] ?? day}</span>
              <TextField aria-label={`${DAY_LABEL[day]} opens`} placeholder="09:00" value={draft.hours[day]?.opens ?? ""} isDisabled={!editable.general || draft.hours[day]?.closed}
                onChange={(value) => setHours(day, { opens: value })} />
              <TextField aria-label={`${DAY_LABEL[day]} closes`} placeholder="21:00" value={draft.hours[day]?.closes ?? ""} isDisabled={!editable.general || draft.hours[day]?.closed}
                onChange={(value) => setHours(day, { closes: value })} />
              <Checkbox isSelected={draft.hours[day]?.closed ?? false} isDisabled={!editable.general} onChange={(closed) => setHours(day, { closed })}>Closed</Checkbox>
            </div>
          ))}
          {errors.businessHours && <p className="text-sm text-danger">{errors.businessHours}</p>}
        </div>
      </FormSection>

      <FormSection title="Notes" columns={1}>
        <TextArea aria-label="Notes" rows={3} value={draft.notes} onChange={set("notes")} isDisabled={!editable.general} />
      </FormSection>
    </RecordFormPage>
  );
}
