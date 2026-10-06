"use client";

// On a purchase order: which of the supplier's people and locations it is
// addressed to. Choosing a supplier fills in that supplier's defaults; any
// other active location or person of the same supplier may be chosen, and a
// missing one can be added here — it is saved to the Supplier Master, not just
// to this order. The order keeps a snapshot of what was chosen.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Select } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { ProcAlert, ProcPanel } from "@/features/procurement/shared/ProcUi";
import type { ProcOptions } from "@/features/procurement/shared/api";
import type { FieldValue } from "@/features/procurement/shared/FieldInput";

import { errorMessage, getSupplier, getSupplierOptions, getTransactionDefaults } from "../api/suppliers-api";
import { AddressDialog, ContactDialog } from "./LocationContactDialogs";

const NONE = "none";
const FIELDS = { contact: "supplierContactId", address: "supplierAddressId", shipFrom: "supplierShipFromId" } as const;

export function SupplierContextFields({ values, setValue, options, reloadOptions, editing }: {
  values: Record<string, FieldValue>; setValue: (name: string, value: FieldValue) => void; options: ProcOptions; reloadOptions: () => Promise<unknown>; editing: boolean;
}) {
  const workspace = useWorkspaceContext();
  const supplierId = String(values.supplierId ?? "");
  const [adding, setAdding] = useState<"contact" | "address" | "shipFrom" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<string | null>(editing ? supplierId : null);

  // A newly chosen supplier brings its own defaults; ids of the previous supplier are never kept.
  useEffect(() => {
    if (!supplierId || seen.current === supplierId) return;
    seen.current = supplierId;
    for (const name of Object.values(FIELDS)) setValue(name, "");
    let cancelled = false;
    getTransactionDefaults(supplierId, "purchase_order").then((defaults) => {
      if (cancelled) return;
      setError(null);
      setValue(FIELDS.contact, defaults.contact?.relationshipId ?? "");
      setValue(FIELDS.address, defaults.address?.addressId ?? "");
      setValue(FIELDS.shipFrom, defaults.shipFrom?.addressId ?? "");
    }).catch((failure) => { if (!cancelled) setError(errorMessage(failure)); });
    return () => { cancelled = true; };
  }, [supplierId, setValue]);

  const detail = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier", supplierId), queryFn: () => getSupplier(supplierId), enabled: Boolean(adding && supplierId) });
  const supplierOptions = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier-options"), queryFn: getSupplierOptions, enabled: Boolean(adding), staleTime: 60_000 });

  if (!supplierId) return null;
  const addresses = (options.supplierAddresses ?? []).filter((entry) => entry.supplier_id === supplierId);
  const contacts = (options.supplierContacts ?? []).filter((entry) => entry.supplier_id === supplierId);
  const addressOptions = (purpose: string) => [
    { value: NONE, label: "None" },
    ...addresses.map((entry) => ({
      value: entry.id,
      label: `${entry.label} · ${entry.city}${entry.gstin ? ` · ${entry.gstin}` : ""}`,
      description: entry.purposes.includes(purpose) ? undefined : "Not marked for this purpose",
    })),
  ];
  const pick = (key: unknown) => (key && key !== NONE ? String(key) : "");
  const actions = detail.data?.actions;
  const added = (name: string) => async (_message: string, id: string) => {
    setAdding(null);
    await reloadOptions();
    setValue(name, id);
  };

  return (
    <ProcPanel title="Supplier contact & locations" description="Filled from the supplier's defaults. The order keeps what is chosen here, even if the supplier changes later.">
      {error && <ProcAlert>{error}</ProcAlert>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Select label="Supplier contact" selectedKey={String(values[FIELDS.contact] || NONE)} onSelectionChange={(key) => setValue(FIELDS.contact, pick(key))}
            options={[{ value: NONE, label: "None" }, ...contacts.map((entry) => ({ value: entry.id, label: `${entry.name}${entry.designation ? ` · ${entry.designation}` : ""}`, description: entry.email ?? undefined }))]} />
          <Button size="compact" variant="ghost" onPress={() => setAdding("contact")}>Add contact</Button>
        </div>
        <div className="flex flex-col gap-1">
          <Select label="Ordering address" selectedKey={String(values[FIELDS.address] || NONE)} onSelectionChange={(key) => setValue(FIELDS.address, pick(key))} options={addressOptions("ordering")} />
          <Button size="compact" variant="ghost" onPress={() => setAdding("address")}>Add address</Button>
        </div>
        <div className="flex flex-col gap-1">
          <Select label="Ship-from location" selectedKey={String(values[FIELDS.shipFrom] || NONE)} onSelectionChange={(key) => setValue(FIELDS.shipFrom, pick(key))} options={addressOptions("ship_from")} />
          <Button size="compact" variant="ghost" onPress={() => setAdding("shipFrom")}>Add location</Button>
        </div>
      </div>
      {adding && (detail.isLoading || supplierOptions.isLoading) && <p className="text-sm text-text-muted">Loading…</p>}
      {adding && (detail.isError || supplierOptions.isError) && <ProcAlert>{errorMessage(detail.error ?? supplierOptions.error)}</ProcAlert>}
      {adding && detail.data && supplierOptions.data && actions && (adding === "contact" ? (
        actions.manageContacts ? (
          <ContactDialog supplierId={supplierId} contact={null} addresses={detail.data.addresses} options={supplierOptions.data}
            access={{ setDefaults: actions.setDefaults, manageTax: actions.manageTaxRegistrations }} presetRoles={["procurement"]}
            onClose={() => setAdding(null)} onDone={added(FIELDS.contact)} />
        ) : <ProcAlert>You may not add contacts to this supplier.</ProcAlert>
      ) : actions.manageAddresses ? (
        <AddressDialog supplierId={supplierId} countryCode={detail.data.supplier.countryCode} address={null} registrations={detail.data.taxRegistrations} options={supplierOptions.data}
          access={{ setDefaults: actions.setDefaults, manageTax: actions.manageTaxRegistrations }} presetPurposes={adding === "address" ? ["ordering"] : ["ship_from"]}
          onClose={() => setAdding(null)} onDone={added(adding === "address" ? FIELDS.address : FIELDS.shipFrom)} />
      ) : <ProcAlert>You may not add addresses to this supplier.</ProcAlert>)}
    </ProcPanel>
  );
}
