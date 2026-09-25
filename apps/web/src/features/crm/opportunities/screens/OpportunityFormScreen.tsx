"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ConflictBanner, ErrorState, MoneyField, PermissionState, RecordFormPage, Select, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { FormSection } from "@/features/crm/shared/ui/FormSection";
import { CurrencySelect } from "@/features/crm/shared/ui/CurrencySelect";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { createOpportunity, OpportunityApiError, updateOpportunity } from "../api/opportunities-api";
import type { Opportunity } from "../types";
import { toNumber } from "@/features/crm/shared/format";

type FormValues = {
  name: string;
  partyId: string;
  contactId: string;
  pipelineId: string;
  ownerUserId: string;
  amount: number | null;
  currencyCode: string;
  expectedCloseDate: string;
  nextStep: string;
  description: string;
};

const EMPTY: FormValues = { name: "", partyId: "", contactId: "", pipelineId: "", ownerUserId: "", amount: null, currencyCode: "", expectedCloseDate: "", nextStep: "", description: "" };

function toForm(opportunity: Opportunity): FormValues {
  return {
    name: opportunity.name,
    partyId: opportunity.partyId ?? "",
    contactId: opportunity.contactId ?? "",
    pipelineId: opportunity.pipelineId,
    ownerUserId: opportunity.ownerUserId ?? "",
    // opportunity.amount is typed number but numeric(18,2) columns come
    // back from node-postgres as strings — NumberField would render the
    // raw string wrong. Coerce at the form boundary (same fix as Lead's
    // estimatedValue and Opportunity's probability NumberField).
    amount: opportunity.amount === null ? null : toNumber(opportunity.amount),
    currencyCode: opportunity.currencyCode ?? "",
    expectedCloseDate: opportunity.expectedCloseDate ?? "",
    nextStep: opportunity.nextStep ?? "",
    description: opportunity.description ?? "",
  };
}

export function OpportunityFormScreen({
  mode,
  opportunity,
  canManage = true,
  notFound = false,
}: {
  mode: "create" | "edit";
  opportunity?: Opportunity;
  canManage?: boolean;
  notFound?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [values, setValues] = useState<FormValues>(opportunity ? toForm(opportunity) : EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const partyOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.parties ?? [];
    return [{ value: "", label: "No account" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.name || row.id) }))];
  }, [optionsQuery.data]);
  // Filtered to the selected Account's own contacts once one is chosen —
  // every Contact belongs to exactly one Account (party_id is required in
  // the schema), so an unfiltered list previously let a rep pick a Contact
  // from an unrelated Account (the backend still rejected the mismatch on
  // save, but only after a wasted round trip). Left unfiltered with no
  // Account selected, since picking a Contact first is also a valid flow —
  // the Account is then auto-derived from that Contact server-side.
  const contactOptions: SelectOption[] = useMemo(() => {
    const rows = (optionsQuery.data?.options?.contacts ?? []) as Array<{ id: string; name?: string; partyId?: string }>;
    const scoped = values.partyId ? rows.filter((row) => row.partyId === values.partyId) : rows;
    return [{ value: "", label: "No contact" }, ...scoped.map((row) => ({ value: String(row.id), label: String(row.name || row.id) }))];
  }, [optionsQuery.data, values.partyId]);
  const pipelineOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.pipelines ?? [];
    return rows.map((row) => ({ value: String(row.id), label: String(row.name) }));
  }, [optionsQuery.data]);
  // F009 gap-closure — every competitor in the benchmark report lets a rep
  // choose a different owner at creation; Vercentlabs previously always
  // silently assigned the creator, forcing a two-step create-then-reassign
  // workflow. Defaults to "creator" (empty selection), matching the
  // backend's own default when ownerUserId is omitted. The backend
  // (assertCrmOwnerAssignable) allows oneself, members of a sales team the
  // caller manages, or anyone for crm.records.view_all holders — the
  // options endpoint returns exactly that set (assignableOwnerIds, null =
  // anyone), so the picker never offers a choice that would 403.
  const assignableOwnerIds = optionsQuery.data?.options?.assignableOwnerIds as string[] | null | undefined;
  const ownerOptions: SelectOption[] = useMemo(() => {
    const rows = (optionsQuery.data?.options?.users ?? []) as Array<{ id: string; fullName?: string; name?: string }>;
    const allowed = assignableOwnerIds === null ? rows : rows.filter((row) => (assignableOwnerIds ?? []).includes(String(row.id)) && String(row.id) !== workspace.userId);
    if (!allowed.length) return [{ value: "", label: "Me" }];
    return [{ value: "", label: "Me (default)" }, ...allowed.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }))];
  }, [optionsQuery.data, assignableOwnerIds, workspace.userId]);
  const canAssignOthers = ownerOptions.length > 1;

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!values.name.trim()) {
        setFieldErrors({ name: "Opportunity name is required." });
        throw new Error("Review the highlighted fields.");
      }
      if (mode === "create" && !values.pipelineId) {
        setFieldErrors({ pipelineId: "Choose a pipeline." });
        throw new Error("Review the highlighted fields.");
      }
      setFieldErrors({});
      const input: Record<string, unknown> = { ...values };
      for (const key of Object.keys(input)) if (input[key] === "") input[key] = null;
      if (mode === "edit") delete input.pipelineId;
      // Only send ownerUserId on an actual change: the backend rejects a
      // present-but-empty ownerUserId as "leave this unassigned" unless the
      // caller holds broader records-visibility permission, so re-sending
      // an unchanged null (an Opportunity that already has no owner) would
      // wrongly fail an edit that never touched ownership at all.
      if (mode === "edit" && input.ownerUserId === (opportunity!.ownerUserId ?? null)) delete input.ownerUserId;
      if (mode === "create") return createOpportunity(input);
      return updateOpportunity(opportunity!.id, input, opportunity!.updatedAt);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities") });
      router.push(`/crm/opportunities/${result.record.id}`);
    },
    onError: (error: Error) => {
      if (error instanceof OpportunityApiError && error.code === "CRM_STALE_WRITE") {
        setConflict(true);
        return;
      }
      setServerError(error.message);
    },
  });

  if (!canManage) return <PermissionState title={`You don't have access to ${mode === "create" ? "create" : "edit"} Opportunities`} />;
  if (mode === "edit" && notFound) return <ErrorState title="Opportunity not found" action={{ label: "Back to Opportunities", onPress: () => router.push("/crm/opportunities") }} />;
  if (mode === "edit" && opportunity && opportunity.status === "archived") {
    return <ErrorState title="This Opportunity is archived" description="Archived opportunities are read-only." action={{ label: "Back to Opportunity", onPress: () => router.push(`/crm/opportunities/${opportunity.id}`) }} />;
  }

  return (
    <RecordFormPage
      header={{ title: mode === "create" ? "New opportunity" : `Edit ${opportunity?.name}`, description: mode === "create" ? "Stage and probability are set from the pipeline's default once created." : "Stage and probability are governed separately from this form." }}
      banner={
        conflict ? (
          <ConflictBanner onReload={() => router.refresh()} />
        ) : serverError ? (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {serverError}
          </p>
        ) : null
      }
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.back()} isDisabled={mutation.isPending}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>{mode === "create" ? "Create opportunity" : "Save changes"}</Button>
        </>
      }
    >
      <FormSection title="Deal">
        <TextField label="Opportunity name" isRequired value={values.name} onChange={(v) => set("name", v)} errorMessage={fieldErrors.name} className="sm:col-span-2" />
        {mode === "create" && <Select label="Pipeline" isRequired options={pipelineOptions} selectedKey={values.pipelineId} onSelectionChange={(key) => set("pipelineId", String(key ?? ""))} errorMessage={fieldErrors.pipelineId} />}
        <MoneyField label="Amount" currency={values.currencyCode || "INR"} value={values.amount ?? NaN} onChange={(v) => set("amount", Number.isNaN(v) ? null : v)} />
        <CurrencySelect value={values.currencyCode || "INR"} onChange={(code) => set("currencyCode", code)} />
        <TextField label="Next step" value={values.nextStep} onChange={(v) => set("nextStep", v)} className="sm:col-span-2" />
        <Select
          label="Owner"
          description={canAssignOthers ? "Who this deal belongs to." : "Assigned to you. Ask a manager to hand it to someone else."}
          options={ownerOptions}
          selectedKey={values.ownerUserId}
          onSelectionChange={(key) => set("ownerUserId", String(key ?? ""))}
          isDisabled={!canAssignOthers}
        />
      </FormSection>
      <FormSection title="Customer" description="Who this deal is with.">
        <Select label="Account" options={partyOptions} selectedKey={values.partyId} onSelectionChange={(key) => { setValues((c) => ({ ...c, partyId: String(key ?? ""), contactId: "" })); }} />
        <Select label="Contact" options={contactOptions} selectedKey={values.contactId} onSelectionChange={(key) => set("contactId", String(key ?? ""))} />
      </FormSection>
      <FormSection title="Forecast">
        <DateInput label="Expected close date" value={values.expectedCloseDate} onChange={(v) => set("expectedCloseDate", v)} />
      </FormSection>
      <TextArea label="Description" value={values.description} onChange={(v) => set("description", v)} />
    </RecordFormPage>
  );
}
