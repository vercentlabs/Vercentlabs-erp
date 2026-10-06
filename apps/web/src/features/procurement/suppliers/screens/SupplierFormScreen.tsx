"use client";

// New Supplier and Edit Supplier. Identity, tax details and commercial
// defaults are separate sections because separate permissions change them;
// a section the person may not change is shown read-only. While a new
// supplier is typed, possible existing suppliers are shown; a save the
// server refuses as a duplicate shows its matches and how to go on.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PermissionState, RecordFormPage, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { useSubmitKey } from "@/shared/http/submit-once";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { ProcAlert, ProcPanel } from "@/features/procurement/shared/ProcUi";

import {
  checkDuplicates, createSupplier, duplicateMatchesOf, errorCode, errorMessage, fieldIssuesOf, getSupplier, getSupplierOptions, updateSupplier,
  type DuplicateMatch, type Supplier, type SupplierOptions,
} from "../api/suppliers-api";
import { DuplicateWarning } from "../components/DuplicateWarning";

type Values = Record<
  | "supplierName" | "legalName" | "supplierType" | "category" | "primaryEmail" | "primaryPhone" | "website" | "countryCode" | "notes" | "gstRegistrationType" | "gstin" | "pan"
  | "registeredStateCode" | "defaultCurrency" | "paymentTermId" | "assignedBuyerId" | "line1" | "line2" | "city" | "state" | "postalCode" | "contactFirstName" | "contactLastName"
  | "contactEmail" | "contactPhone",
  string
>;
const IDENTITY = ["supplierName", "legalName", "supplierType", "category", "primaryEmail", "primaryPhone", "website", "countryCode", "notes"] as const;
const TAX = ["gstRegistrationType", "gstin", "pan", "registeredStateCode"] as const;
const COMMERCIAL = ["defaultCurrency", "paymentTermId", "assignedBuyerId"] as const;

function valuesOf(supplier: Supplier | null, options: SupplierOptions): Values {
  return {
    supplierName: supplier?.supplierName ?? "", legalName: supplier?.legalName ?? "", supplierType: supplier?.supplierType ?? "business", category: supplier?.category ?? "",
    primaryEmail: supplier?.primaryEmail ?? "", primaryPhone: supplier?.primaryPhone ?? "", website: supplier?.website ?? "", countryCode: supplier?.countryCode ?? options.countryCode ?? "IN",
    notes: supplier?.notes ?? "", gstRegistrationType: supplier?.gstRegistrationType ?? "", gstin: supplier?.gstin ?? "", pan: supplier?.pan ?? "",
    registeredStateCode: supplier?.registeredStateCode ?? "", defaultCurrency: supplier?.defaultCurrency ?? options.baseCurrency ?? "",
    paymentTermId: supplier?.paymentTermId ?? "", assignedBuyerId: supplier?.assignedBuyerId ?? "", line1: "", line2: "", city: "", state: "", postalCode: "", contactFirstName: "",
    contactLastName: "", contactEmail: "", contactPhone: "",
  };
}

export function SupplierFormScreen({ supplierId }: { supplierId?: string }) {
  const workspace = useWorkspaceContext();
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier-options"), queryFn: getSupplierOptions, staleTime: 60_000 });
  const supplierQuery = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier", supplierId), queryFn: () => getSupplier(supplierId!), enabled: Boolean(supplierId) });
  if (optionsQuery.isLoading || (supplierId && supplierQuery.isLoading)) return <LoadingState label={supplierId ? "Loading supplier" : "Loading"} />;
  if (optionsQuery.isError || !optionsQuery.data || (supplierId && (supplierQuery.isError || !supplierQuery.data))) {
    const failure = optionsQuery.error ?? supplierQuery.error;
    if (errorCode(failure) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to suppliers" />;
    return <ErrorState title="Could not load the supplier form" description={errorMessage(failure)} />;
  }
  const can = optionsQuery.data.capabilities;
  if (!supplierId && !can.create) return <PermissionState title="You can't create suppliers" description="Ask an administrator for the Create suppliers permission." />;
  return <SupplierForm options={optionsQuery.data} existing={supplierQuery.data?.supplier ?? null} />;
}

function SupplierForm({ options, existing }: { options: SupplierOptions; existing: Supplier | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const can = options.capabilities;
  const editing = Boolean(existing);
  const initial = useMemo(() => valuesOf(existing, options), [existing, options]);
  const [values, setValues] = useState<Values>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [refusedMatches, setRefusedMatches] = useState<DuplicateMatch[] | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [liveMatches, setLiveMatches] = useState<DuplicateMatch[]>([]);
  const set = (key: keyof Values) => (value: string) => { setValues((current) => ({ ...current, [key]: value })); setFieldErrors((current) => ({ ...current, [key]: "" })); };
  const editable = (field: string) => !editing || ((IDENTITY as readonly string[]).includes(field) ? can.edit : (TAX as readonly string[]).includes(field) ? can.tax : can.commercial);

  // Possible existing suppliers, while the identifying fields are typed (new suppliers only).
  const identity = [values.supplierName, values.legalName, values.gstin, values.pan, values.primaryEmail, values.primaryPhone, values.website, values.city].join("|");
  useEffect(() => {
    if (editing || (!values.supplierName.trim() && !values.gstin.trim())) return;
    const timer = setTimeout(() => {
      checkDuplicates({ supplierName: values.supplierName, legalName: values.legalName, gstin: values.gstin, pan: values.pan, primaryEmail: values.primaryEmail,
        primaryPhone: values.primaryPhone, website: values.website, city: values.city }).then(setLiveMatches).catch(() => setLiveMatches([]));
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `identity` stands for the fields read above
  }, [identity, editing]);

  const submit = useSubmitKey();
  const save = useMutation({
    mutationFn: (extra: { allowDuplicate?: boolean; partyId?: string }) => submit.run(async () => {
      if (existing) {
        const changed = Object.fromEntries([...IDENTITY, ...TAX, ...COMMERCIAL].filter((field) => values[field] !== initial[field]).map((field) => [field, values[field] || null]));
        return updateSupplier(existing.id, { ...changed, expectedVersion: existing.version, ...(extra.allowDuplicate ? { allowDuplicate: true, duplicateReason: overrideReason } : {}) });
      }
      const body: Record<string, unknown> = Object.fromEntries([...IDENTITY, ...TAX, ...COMMERCIAL].filter((field) => values[field]).map((field) => [field, values[field]]));
      if (values.line1 || values.city)
        body.address = { addressType: "registered", line1: values.line1, line2: values.line2 || null, city: values.city, state: values.state || null, postalCode: values.postalCode || null,
          countryCode: values.countryCode, gstin: values.gstin || null, stateCode: values.registeredStateCode || null };
      if (values.contactFirstName)
        body.primaryContact = { firstName: values.contactFirstName, lastName: values.contactLastName || null, email: values.contactEmail || null, mobile: values.contactPhone || null };
      if (extra.partyId) body.partyId = extra.partyId;
      if (extra.allowDuplicate) { body.allowDuplicate = true; body.duplicateReason = overrideReason; }
      return createSupplier(body);
    }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") });
      router.replace(`/procurement/suppliers/${saved.supplier.id}`);
    },
    onError: (failure) => {
      const matches = duplicateMatchesOf(failure);
      if (matches) { setRefusedMatches(matches); setError(errorCode(failure) === "SUPPLIER_DUPLICATE" || errorCode(failure) === "SUPPLIER_DUPLICATE_REASON" ? null : errorMessage(failure)); }
      else { setFieldErrors(fieldIssuesOf(failure)); setError(errorMessage(failure)); }
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });
  const busy = save.isPending || save.isSuccess;
  const canOverride = refusedMatches?.some((match) => match.strength === "strong") && !refusedMatches.some((match) => match.reasons.some((reason) => reason.code === "gstin"));

  const text = (key: keyof Values, label: string, props: Record<string, unknown> = {}) => (
    <TextField label={label} value={values[key]} onChange={set(key)} isDisabled={!editable(key)} errorMessage={fieldErrors[key] || undefined} isInvalid={Boolean(fieldErrors[key])} {...props} />
  );
  const select = (key: keyof Values, label: string, list: Array<{ value: string; label: string }>, props: Record<string, unknown> = {}) => (
    <Select label={label} options={list} selectedKey={values[key] || null} onSelectionChange={(value) => set(key)(String(value ?? ""))} isDisabled={!editable(key)}
      errorMessage={fieldErrors[key] || undefined} {...props} />
  );
  const gstType = options.gstRegistrationTypes.find((entry) => entry.code === values.gstRegistrationType);

  return (
    <RecordFormPage
      header={{
        title: editing ? `Edit ${existing!.supplierNumber}` : "New supplier",
        description: editing ? existing!.supplierName : "One supplier per business. The supplier number is given when it is saved.",
      }}
      banner={
        <div className="flex flex-col gap-3">
          <Link href={editing ? `/procurement/suppliers/${existing!.id}` : "/procurement/suppliers"} className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
            <ArrowLeft className="size-3.5" aria-hidden="true" />{editing ? existing!.supplierName : "All suppliers"}
          </Link>
          {error && <ProcAlert>{error}</ProcAlert>}
          {existing?.isCustomer && <ProcAlert tone="info">This company is also customer {existing.customerNumber}: its name, legal name and tax details are shared with that role.</ProcAlert>}
          {refusedMatches ? (
            <DuplicateWarning matches={refusedMatches} refused onUseOrganization={editing ? undefined : (match) => save.mutate({ partyId: match.partyId })}>
              {canOverride && can.create && (
                <div className="flex flex-col gap-2">
                  <TextArea label="Why is this a different supplier?" value={overrideReason} onChange={setOverrideReason} />
                  <div className="flex gap-2">
                    <Button variant="secondary" onPress={() => setRefusedMatches(null)}>Back</Button>
                    <Button variant="primary" isDisabled={overrideReason.trim().length < 5} isLoading={busy} onPress={() => save.mutate({ allowDuplicate: true })}>Create anyway</Button>
                  </div>
                </div>
              )}
            </DuplicateWarning>
          ) : (
            <DuplicateWarning matches={liveMatches} onUseOrganization={editing ? undefined : (match) => save.mutate({ partyId: match.partyId })} />
          )}
        </div>
      }
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.replace(editing ? `/procurement/suppliers/${existing!.id}` : "/procurement/suppliers")}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={!values.supplierName.trim()} onPress={() => save.mutate({})}>{editing ? "Save changes" : "Create supplier"}</Button>
        </>
      }
    >
      <ProcPanel title="Supplier" description={editing && !can.edit ? "You can view these details. Changing them needs the Edit suppliers permission." : undefined}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {text("supplierName", "Supplier name", { isRequired: true, description: "The name people search for, like Tata Steel." })}
          {text("legalName", "Legal name", { description: "As registered, like Tata Steel Limited. Defaults to the supplier name." })}
          {select("supplierType", "Supplier type", options.types.map((entry) => ({ value: entry.code, label: entry.label })), { isRequired: true })}
          {select("category", "Category", options.categories.map((entry) => ({ value: entry.code, label: entry.label })), { isRequired: true })}
          {text("primaryEmail", "Email", { type: "email" })}
          {text("primaryPhone", "Phone")}
          {text("website", "Website")}
          {text("countryCode", "Country code", { description: "Two letters, like IN, DE or US." })}
        </div>
        <TextArea label="Internal notes" description="Never printed on a purchase order." value={values.notes} onChange={set("notes")} isDisabled={!editable("notes")} />
      </ProcPanel>
      <ProcPanel title="Tax" description={editing && !can.tax ? "Changing tax details needs the Manage supplier tax information permission." : "Other GST registrations go on the supplier's locations."}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {select("gstRegistrationType", "GST registration type", options.gstRegistrationTypes.map((entry) => ({ value: entry.code, label: entry.label })))}
          {text("gstin", "GSTIN", { isRequired: Boolean(gstType?.needsGstin), description: "The registered state and PAN are read from it." })}
          {text("pan", "PAN / Tax ID")}
          {select("registeredStateCode", "Registered state", options.states.map((state) => ({ value: state.code, label: `${state.name} (${state.code})` })))}
        </div>
      </ProcPanel>
      <ProcPanel title="Commercial defaults" description={editing && !can.commercial ? "Changing these needs the Manage supplier commercial defaults permission." : "New RFQs and purchase orders start from these; documents keep what they were given."}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {select("defaultCurrency", "Default currency", options.currencies.map((currency) => ({ value: currency.code, label: `${currency.code} · ${currency.name}` })), { isRequired: true })}
          {select("paymentTermId", "Default payment terms", options.paymentTerms.map((term) => ({ value: term.id, label: term.name })), { isRequired: true })}
          {select("assignedBuyerId", "Buyer", [{ value: "", label: "Unassigned" }, ...options.buyers.map((user) => ({ value: user.id, label: user.name }))])}
        </div>
      </ProcPanel>
      {!editing && (
        <>
          <ProcPanel title="Registered address" description="Optional now; more locations can be added on the supplier.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {text("line1", "Address")}
              {text("line2", "Address line 2")}
              {text("city", "City")}
              {text("state", "State")}
              {text("postalCode", "PIN / postal code")}
            </div>
          </ProcPanel>
          <ProcPanel title="Primary contact" description="Optional now; more people can be added on the supplier.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {text("contactFirstName", "First name")}
              {text("contactLastName", "Last name")}
              {text("contactEmail", "Email", { type: "email" })}
              {text("contactPhone", "Phone")}
            </div>
          </ProcPanel>
        </>
      )}
    </RecordFormPage>
  );
}
