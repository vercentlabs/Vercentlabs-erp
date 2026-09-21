"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  ErrorState,
  MoneyField,
  PermissionState,
  RecordFormPage,
  Select,
  TextField,
  ConflictBanner,
  type SelectOption,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { createLead, getCrmOptions, LeadApiError, updateLead } from "../api/leads-api";
import { leadFormDefaults, leadFormSchema, leadFormValuesToInput, type LeadFormValues } from "../schemas/lead-schema";
import type { Lead } from "../types";
import { toNumber } from "@/features/crm/shared/format";
import { FormSection } from "@/features/crm/shared/ui/FormSection";
import { CountrySelect } from "@/features/crm/shared/ui/CountrySelect";
import { CurrencySelect } from "@/features/crm/shared/ui/CurrencySelect";

const PRIORITY_OPTIONS: SelectOption[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const RATING_OPTIONS: SelectOption[] = [
  { value: "", label: "Not rated" },
  { value: "cold", label: "Cold" },
  { value: "warm", label: "Warm" },
  { value: "hot", label: "Hot" },
];

function leadToFormValues(lead: Lead): LeadFormValues {
  return {
    firstName: lead.firstName,
    lastName: lead.lastName ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    mobile: lead.mobile ?? "",
    companyName: lead.companyName ?? "",
    jobTitle: lead.jobTitle ?? "",
    website: lead.website ?? "",
    industry: lead.industry ?? "",
    sourceId: lead.sourceId ?? "",
    campaignId: lead.campaignId ?? "",
    priority: lead.priority,
    rating: lead.rating ?? "",
    // lead.estimatedValue is typed number but numeric(18,2) columns come
    // back from node-postgres as strings — z.number() in leadFormSchema
    // would reject the raw value untouched, and NumberField would render
    // it wrong. Coerce at the form boundary, the same pattern as
    // Opportunity/Dashboard/Forecast's money()/toNumber() fixes.
    estimatedValue: lead.estimatedValue === null ? null : toNumber(lead.estimatedValue),
    currencyCode: lead.currencyCode ?? "",
    city: lead.city ?? "",
    state: lead.state ?? "",
    countryCode: lead.countryCode ?? "",
    productInterest: lead.productInterest ?? "",
    consentEmail: lead.consentEmail,
    consentSms: lead.consentSms,
    consentWhatsapp: lead.consentWhatsapp,
    doNotContact: lead.doNotContact,
  };
}

export function LeadFormScreen({
  mode,
  lead,
  canManage = true,
  notFound = false,
}: {
  mode: "create" | "edit";
  lead?: Lead;
  canManage?: boolean;
  notFound?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [values, setValues] = useState<LeadFormValues>(lead ? leadToFormValues(lead) : leadFormDefaults);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const optionsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "options"),
    queryFn: getCrmOptions,
  });

  const sourceOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.sources ?? [];
    return [
      { value: "", label: "No source" },
      ...rows.map((row) => ({ value: String(row.id), label: String(row.name || row.id) })),
    ];
  }, [optionsQuery.data]);

  function set<K extends keyof LeadFormValues>(key: K, value: LeadFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = leadFormSchema.safeParse(values);
      if (!parsed.success) {
        const errors: Record<string, string> = {};
        for (const issue of parsed.error.issues) errors[String(issue.path[0])] = issue.message;
        setFieldErrors(errors);
        throw new Error("Review the highlighted fields.");
      }
      setFieldErrors({});
      const input = leadFormValuesToInput(parsed.data);
      if (mode === "create") return createLead(input);
      return updateLead(lead!.id, input, lead!.updatedAt);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
      router.push(`/crm/leads/${result.record.id}`);
    },
    onError: (error: Error) => {
      if (error instanceof LeadApiError && error.code === "CRM_STALE_WRITE") {
        setConflict(true);
        return;
      }
      setServerError(error.message);
    },
  });

  if (!canManage) {
    return <PermissionState title={`You don't have access to ${mode === "create" ? "create" : "edit"} Leads`} description="Ask an administrator to grant CRM lead management access." />;
  }
  if (mode === "edit" && notFound) {
    return <ErrorState title="Lead not found" description="This Lead may have been merged, converted, or removed." action={{ label: "Back to Leads", onPress: () => router.push("/crm/leads") }} />;
  }
  if (mode === "edit" && lead && (lead.recordStatus === "converted" || lead.recordStatus === "archived")) {
    const converted = lead.recordStatus === "converted";
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
        <p className="text-base font-semibold text-text">{converted ? "This lead was converted" : "This lead is archived"}</p>
        <p className="max-w-md text-sm text-text-secondary">{converted ? "It is now read-only. Continue the relationship from the records it created." : "An archived lead is read-only."}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {converted && lead.convertedOpportunityId && <Button variant="primary" onPress={() => router.push(`/crm/opportunities/${lead.convertedOpportunityId}`)}>Open the opportunity</Button>}
          {converted && lead.convertedPartyId && <Button variant="secondary" onPress={() => router.push(`/crm/accounts/${lead.convertedPartyId}`)}>Open the account</Button>}
          {converted && lead.convertedContactId && <Button variant="secondary" onPress={() => router.push(`/crm/contacts/${lead.convertedContactId}`)}>Open the contact</Button>}
          <Button variant="secondary" onPress={() => router.push(`/crm/leads/${lead.id}`)}>Back to the lead</Button>
        </div>
      </div>
    );
  }

  return (
    <RecordFormPage
      header={{
        title: mode === "create" ? "New lead" : `Edit ${lead?.fullName || lead?.firstName}`,
        description: mode === "create" ? "Capture a new prospect for qualification and follow-up." : "Changes are saved with an optimistic-concurrency check against the last loaded version.",
      }}
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
          <Button variant="secondary" onPress={() => router.back()} isDisabled={mutation.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>
            {mode === "create" ? "Create lead" : "Save changes"}
          </Button>
        </>
      }
    >
      <FormSection title="Person">
        <TextField label="First name" isRequired value={values.firstName} onChange={(v) => set("firstName", v)} errorMessage={fieldErrors.firstName} />
        <TextField label="Last name" value={values.lastName} onChange={(v) => set("lastName", v)} errorMessage={fieldErrors.lastName} />
        <TextField label="Email" type="email" value={values.email} onChange={(v) => set("email", v)} errorMessage={fieldErrors.email} />
        <TextField label="Mobile" value={values.mobile} onChange={(v) => set("mobile", v)} errorMessage={fieldErrors.mobile} />
      </FormSection>
      <FormSection title="Company">
        <TextField label="Company name" value={values.companyName} onChange={(v) => set("companyName", v)} errorMessage={fieldErrors.companyName} />
        <TextField label="Job title" value={values.jobTitle} onChange={(v) => set("jobTitle", v)} errorMessage={fieldErrors.jobTitle} />
      </FormSection>
      <FormSection title="Sales">
        <Select label="Source" options={sourceOptions} selectedKey={values.sourceId || ""} onSelectionChange={(key) => set("sourceId", String(key ?? ""))} />
        <Select label="Priority" options={PRIORITY_OPTIONS} selectedKey={values.priority} onSelectionChange={(key) => set("priority", String(key) as LeadFormValues["priority"])} />
        <MoneyField label="Estimated value" currency={values.currencyCode || "INR"} value={values.estimatedValue ?? NaN} onChange={(v) => set("estimatedValue", Number.isNaN(v) ? null : v)} errorMessage={fieldErrors.estimatedValue} />
        <CurrencySelect value={values.currencyCode || "INR"} onChange={(code) => set("currencyCode", code)} />
        <TextField label="Product interest" value={values.productInterest} onChange={(v) => set("productInterest", v)} className="sm:col-span-2" />
      </FormSection>
      <details className="rounded-[var(--radius-card)] border border-border px-4 py-3" open={mode === "edit" && Boolean(values.phone || values.website || values.industry || values.city || values.state || values.countryCode || values.rating)}>
        <summary className="cursor-pointer text-sm font-medium text-text">More details (optional)</summary>
        <div className="mt-4 flex flex-col gap-5">
          <FormSection title="Additional contact and company details">
            <TextField label="Phone" value={values.phone} onChange={(v) => set("phone", v)} errorMessage={fieldErrors.phone} />
            <TextField label="Website" value={values.website} onChange={(v) => set("website", v)} errorMessage={fieldErrors.website} />
            <TextField label="Industry" value={values.industry} onChange={(v) => set("industry", v)} errorMessage={fieldErrors.industry} />
            <Select label="Rating" options={RATING_OPTIONS} selectedKey={values.rating || ""} onSelectionChange={(key) => set("rating", String(key ?? "") as LeadFormValues["rating"])} />
          </FormSection>
          <FormSection title="Location">
            <TextField label="City" value={values.city} onChange={(v) => set("city", v)} />
            <TextField label="State" value={values.state} onChange={(v) => set("state", v)} />
            <CountrySelect value={values.countryCode ?? ""} onChange={(code) => set("countryCode", code)} />
          </FormSection>
        </div>
      </details>
      <FormSection title="Consent" description="Record what this person has agreed to. Do not contact overrides everything else." columns={1}>
        <Checkbox isSelected={values.consentEmail} onChange={(v) => set("consentEmail", v)}>Email consent given</Checkbox>
        <Checkbox isSelected={values.consentSms} onChange={(v) => set("consentSms", v)}>SMS consent given</Checkbox>
        <Checkbox isSelected={values.consentWhatsapp} onChange={(v) => set("consentWhatsapp", v)}>WhatsApp consent given</Checkbox>
        <Checkbox isSelected={values.doNotContact} onChange={(v) => set("doNotContact", v)}>Do not contact</Checkbox>
      </FormSection>
    </RecordFormPage>
  );
}
