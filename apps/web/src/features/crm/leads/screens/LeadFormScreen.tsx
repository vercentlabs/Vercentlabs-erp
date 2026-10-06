"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, MultiSelect, RecordFormPage, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { CountrySelect } from "@/features/crm/shared/ui/CountrySelect";
import { CurrencySelect } from "@/features/crm/shared/ui/CurrencySelect";
import { FormSection } from "@/features/crm/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  checkLeadDuplicates, createLead, duplicateMatchesOf, errorMessage, getLead, getLeadOptions, updateLead, type Lead, type LeadDuplicateMatch, type LeadOptions,
} from "../api/leads-api";
import { DuplicateOverride } from "@/features/crm/duplicates/DuplicateParts";
import { DuplicateWarning } from "../components/DuplicateWarning";
import { ErrorBanner, PRIORITY_OPTIONS, RATING_OPTIONS } from "../lead-format";
import { useSubmitKey } from "@/shared/http/submit-once";

const NONE = "";
const AUTO = "__auto__";
const UNASSIGNED = "__unassigned__";

type FormValues = {
  firstName: string; lastName: string; companyName: string; jobTitle: string; email: string; phone: string; mobile: string; website: string;
  city: string; state: string; countryCode: string; sourceId: string; sourceDetail: string; industry: string; productInterest: string;
  estimatedValue: string; currencyCode: string; purchaseTimeframe: string; priority: string; rating: string; description: string;
  tagIds: string[]; ownerUserId: string; teamId: string;
};

const EMPTY: FormValues = {
  firstName: "", lastName: "", companyName: "", jobTitle: "", email: "", phone: "", mobile: "", website: "", city: "", state: "", countryCode: "",
  sourceId: NONE, sourceDetail: "", industry: "", productInterest: "", estimatedValue: "", currencyCode: "", purchaseTimeframe: NONE,
  priority: "medium", rating: "warm", description: "", tagIds: [], ownerUserId: AUTO, teamId: NONE,
};

function valuesFromLead(lead: Lead): FormValues {
  return {
    ...EMPTY,
    firstName: lead.firstName ?? "", lastName: lead.lastName ?? "", companyName: lead.companyName ?? "", jobTitle: lead.jobTitle ?? "",
    email: lead.email ?? "", phone: lead.phone ?? "", mobile: lead.mobile ?? "", website: lead.website ?? "", city: lead.city ?? "",
    state: lead.state ?? "", countryCode: lead.countryCode ?? "", sourceId: lead.sourceId ?? NONE, sourceDetail: lead.sourceDetail ?? "",
    industry: lead.industry ?? "", productInterest: lead.productInterest ?? "", estimatedValue: lead.estimatedValue ? String(lead.estimatedValue) : "",
    currencyCode: lead.currencyCode ?? "", purchaseTimeframe: lead.purchaseTimeframe ?? NONE, priority: lead.priority, rating: lead.rating,
    description: lead.description ?? "", tagIds: lead.tags.map((tag) => tag.id),
  };
}

// Owner and team are set here only when creating; afterwards they change
// through Assign so the change is recorded and notified.
function toInput(values: FormValues, mode: "create" | "edit") {
  const { ownerUserId, teamId, ...fields } = values;
  const input: Record<string, unknown> = { ...fields, sourceId: fields.sourceId || null, purchaseTimeframe: fields.purchaseTimeframe || null };
  if (mode === "create") {
    if (ownerUserId !== AUTO) input.ownerUserId = ownerUserId === UNASSIGNED ? null : ownerUserId;
    if (teamId) input.teamId = teamId;
    if (ownerUserId === AUTO && teamId) input.ownerUserId = null;
  }
  return input;
}

// Loads what the form needs, then shows it. The form itself starts from the
// loaded lead (edit) or from the defaults (create).
export function LeadFormScreen({ leadId }: { leadId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-options"), queryFn: getLeadOptions, staleTime: 60_000 });
  const leadQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead", leadId), queryFn: () => getLead(leadId as string), enabled: Boolean(leadId) });
  const lead = leadQuery.data;

  if (optionsQuery.isLoading || (leadId && leadQuery.isLoading)) return <LoadingState label={leadId ? "Loading lead" : "Loading"} />;
  if (leadId && (leadQuery.isError || !lead))
    return <ErrorState title="Could not load this lead" description={errorMessage(leadQuery.error)} action={{ label: "Back to leads", onPress: () => router.push("/crm/leads") }} />;
  if (!optionsQuery.data) return <ErrorState title="Could not load this page" description="Refresh to try again." />;
  if (lead?.status === "converted")
    return <ErrorState title="This lead is converted" description="A converted lead is read-only. Work on its opportunity instead." action={{ label: "Open lead", onPress: () => router.push(`/crm/leads/${lead.id}`) }} />;
  return <LeadForm key={lead?.id ?? "new"} lead={lead} options={optionsQuery.data} />;
}

function LeadForm({ lead, options }: { lead?: Lead; options: LeadOptions }) {
  const mode = lead ? "edit" : "create";
  const leadId = lead?.id;
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<FormValues>(() => (lead ? valuesFromLead(lead) : { ...EMPTY, currencyCode: options.baseCurrency }));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [blockingMatches, setBlockingMatches] = useState<LeadDuplicateMatch[] | null>(null);
  const [duplicateReason, setDuplicateReason] = useState("");
  const [liveMatches, setLiveMatches] = useState<LeadDuplicateMatch[]>([]);

  // Warn about likely duplicates while the identifying fields are typed.
  const identity = [values.email, values.mobile, values.phone, values.firstName, values.lastName, values.companyName].join("|");
  const canCheckDuplicates = Boolean(values.email || values.mobile || values.phone || values.firstName || values.lastName);
  const similarMatches = canCheckDuplicates ? liveMatches : [];
  useEffect(() => {
    if (!canCheckDuplicates) return;
    const timer = setTimeout(() => {
      checkLeadDuplicates({
        email: values.email, mobile: values.mobile, phone: values.phone, firstName: values.firstName, lastName: values.lastName,
        companyName: values.companyName, website: values.website, excludeLeadId: leadId,
      }).then((result) => setLiveMatches(result.matches)).catch(() => setLiveMatches([]));
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `identity` stands for the fields read above
  }, [identity, leadId, canCheckDuplicates]);

  const set = <K extends keyof FormValues>(key: K) => (value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  const submit = useSubmitKey();
  const mutation = useMutation({
    mutationFn: (allowDuplicate: boolean) => submit.run(async () => {
      const input = { ...toInput(values, mode), allowDuplicate, ...(allowDuplicate ? { duplicateReason } : {}) };
      return mode === "edit" ? updateLead(leadId as string, { ...input, expectedUpdatedAt: lead?.updatedAt }) : createLead(input);
    }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead", saved.id) });
      // Replace the form in the browser history, so Back from the saved lead
      // returns to where the user came from instead of reopening the form.
      router.replace(`/crm/leads/${saved.id}`);
    },
    onError: (failure) => {
      const matches = duplicateMatchesOf(failure);
      if (matches) {
        setBlockingMatches(matches);
        setError(null);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const issues = (failure as { details?: { issues?: Array<{ field: string; message: string }> } }).details?.issues ?? [];
      setFieldErrors(Object.fromEntries(issues.map((issue) => [issue.field, issue.message])));
      setError(errorMessage(failure));
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });

  const canAssignOthers = options.capabilities.assign;
  const hasIdentity = Boolean(values.firstName.trim() || values.lastName.trim() || values.companyName.trim());
  const cancelHref = mode === "edit" ? `/crm/leads/${leadId}` : "/crm/leads";

  return (
    <RecordFormPage
      header={{
        title: mode === "edit" ? `Edit ${lead?.code ?? "lead"}` : "New lead",
        description: mode === "edit" ? undefined : "Only a name or a company is needed to start. Add the rest as you learn it.",
      }}
      banner={
        <div className="flex flex-col gap-3">
          <ErrorBanner message={error} />
          {blockingMatches ? (
            <DuplicateWarning matches={blockingMatches} blocking>
              <DuplicateOverride subject="person" reason={duplicateReason} onReasonChange={setDuplicateReason}
                onConfirm={() => mutation.mutate(true)} onCancel={() => setBlockingMatches(null)} isLoading={mutation.isPending || mutation.isSuccess} />
            </DuplicateWarning>
          ) : (
            <DuplicateWarning matches={similarMatches} blocking={similarMatches.some((match) => match.strength === "exact")} />
          )}
        </div>
      }
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.replace(cancelHref)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate(false)} isLoading={mutation.isPending || mutation.isSuccess} isDisabled={!hasIdentity}>
            {mode === "edit" ? "Save changes" : "Create lead"}
          </Button>
        </>
      }
    >
      <FormSection title="Person and company" description="Enter the person, the company, or both.">
        <TextField label="First name" value={values.firstName} onChange={set("firstName")} errorMessage={fieldErrors.firstName} />
        <TextField label="Last name" value={values.lastName} onChange={set("lastName")} errorMessage={fieldErrors.lastName} />
        <TextField label="Company / organization" value={values.companyName} onChange={set("companyName")} errorMessage={fieldErrors.companyName} />
        <TextField label="Job title" value={values.jobTitle} onChange={set("jobTitle")} />
        <TextField label="Industry" value={values.industry} onChange={set("industry")} />
        <TextField label="Website" value={values.website} onChange={set("website")} placeholder="https://" />
      </FormSection>

      <FormSection title="Contact details">
        <TextField label="Email" type="email" value={values.email} onChange={set("email")} errorMessage={fieldErrors.email} />
        <TextField label="Mobile" type="tel" value={values.mobile} onChange={set("mobile")} errorMessage={fieldErrors.mobile} />
        <TextField label="Phone" type="tel" value={values.phone} onChange={set("phone")} errorMessage={fieldErrors.phone} />
      </FormSection>

      <FormSection title="Location">
        <TextField label="City" value={values.city} onChange={set("city")} />
        <TextField label="State" value={values.state} onChange={set("state")} />
        <CountrySelect value={values.countryCode} onChange={set("countryCode")} errorMessage={fieldErrors.countryCode} />
      </FormSection>

      <FormSection title="Source and interest" description="Where the lead came from and what they want.">
        <Select
          label="Lead source"
          selectedKey={values.sourceId}
          onSelectionChange={(key) => set("sourceId")(String(key ?? NONE))}
          options={[{ value: NONE, label: "Not set" }, ...options.sources.map((source) => ({ value: source.id, label: source.name }))]}
        />
        <TextField label="Source detail" description="Campaign, event or the person who referred them." value={values.sourceDetail} onChange={set("sourceDetail")} />
        <TextArea label="Product / service interest" className="sm:col-span-2" value={values.productInterest} onChange={set("productInterest")} />
        <TextField label="Estimated deal value" inputMode="decimal" value={values.estimatedValue} onChange={set("estimatedValue")} errorMessage={fieldErrors.estimatedValue} />
        <CurrencySelect value={values.currencyCode} onChange={set("currencyCode")} />
        <Select
          label="Purchase timeframe"
          selectedKey={values.purchaseTimeframe}
          onSelectionChange={(key) => set("purchaseTimeframe")(String(key ?? NONE))}
          options={[{ value: NONE, label: "Not set" }, ...options.purchaseTimeframes.map((entry) => ({ value: entry.code, label: entry.label }))]}
        />
      </FormSection>

      <FormSection title="Classification">
        <Select label="Priority" selectedKey={values.priority} onSelectionChange={(key) => set("priority")(String(key))} options={PRIORITY_OPTIONS} />
        <Select label="Rating" selectedKey={values.rating} onSelectionChange={(key) => set("rating")(String(key))} options={RATING_OPTIONS} />
        <MultiSelect
          label="Tags"
          className="sm:col-span-2"
          placeholder={options.tags.length ? "Choose tags" : "No tags have been set up"}
          value={values.tagIds}
          onChange={set("tagIds")}
          options={options.tags.map((tag) => ({ value: tag.id, label: tag.name }))}
        />
        <TextArea label="Description" className="sm:col-span-2" value={values.description} onChange={set("description")} />
      </FormSection>

      {mode === "create" && (
        <FormSection title="Ownership" description="Left on automatic, an assignment rule decides; if none matches, the lead is yours.">
          <Select
            label="Lead owner"
            selectedKey={values.ownerUserId}
            onSelectionChange={(key) => set("ownerUserId")(String(key))}
            options={[
              { value: AUTO, label: "Automatic" },
              { value: UNASSIGNED, label: "Leave unassigned" },
              ...options.users
                .filter((user) => canAssignOthers || user.id === options.currentUserId)
                .map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name })),
            ]}
          />
          <Select
            label="Assigned team"
            selectedKey={values.teamId}
            onSelectionChange={(key) => set("teamId")(String(key ?? NONE))}
            options={[{ value: NONE, label: "No team" }, ...options.teams.map((team) => ({ value: team.id, label: team.name }))]}
          />
        </FormSection>
      )}
    </RecordFormPage>
  );
}
