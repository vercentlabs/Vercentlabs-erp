"use client";

// New and edit lead: the seven fields a lead starts with (name, company, mobile, email, source, interest), then everything else under More
// details, then — when creating — who owns it. Only a name or a company is required. The live duplicate check sits under the mobile and email
// fields. Save and Cancel are at the top and the bottom.
import { campaignChoices } from "@/features/crm/shared/marketing-api";
import { StateField } from "@/features/crm/shared/ui/StateField";
import { useEffect, useState } from "react";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, RecordFormPage, Select, TextArea, TextField } from "@vercentlabs/design-system";

import type { CustomValues } from "@/features/crm/shared/fields-api";
import { CustomFieldInputs } from "@/features/crm/shared/ui/CustomFields";
import { LANGUAGES } from "@/features/crm/shared/languages";

import { CountrySelect } from "@/features/crm/shared/ui/CountrySelect";
import { CurrencySelect } from "@/features/crm/shared/ui/CurrencySelect";
import { FormSection } from "@/shared/ui/FormSection";
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
import { MoreDetails } from "@/features/crm/shared/ui/MoreDetails";

const NONE = "";
const AUTO = "__auto__";
const UNASSIGNED = "__unassigned__";

type FormValues = {
  firstName: string; lastName: string; companyName: string; jobTitle: string; email: string; phone: string; mobile: string; website: string;
  city: string; state: string; countryCode: string; sourceId: string; sourceDetail: string; campaignId: string; medium: string; industry: string; productInterest: string; languageCode: string;
  estimatedValue: string; currencyCode: string; purchaseTimeframe: string; priority: string; rating: string; description: string;
  ownerUserId: string; teamId: string;
  consentEmail: boolean; consentSms: boolean; consentWhatsapp: boolean; doNotContact: boolean;
};

const EMPTY: FormValues = {
  firstName: "", lastName: "", companyName: "", jobTitle: "", email: "", phone: "", mobile: "", website: "", city: "", state: "", countryCode: "",
  sourceId: NONE, sourceDetail: "", campaignId: NONE, medium: NONE, industry: "", productInterest: "", languageCode: NONE, estimatedValue: "", currencyCode: "", purchaseTimeframe: NONE,
  priority: "medium", rating: "cold", description: "", ownerUserId: AUTO, teamId: NONE,
  consentEmail: false, consentSms: false, consentWhatsapp: false, doNotContact: false,
};

function valuesFromLead(lead: Lead): FormValues {
  return {
    ...EMPTY,
    firstName: lead.firstName ?? "", lastName: lead.lastName ?? "", companyName: lead.companyName ?? "", jobTitle: lead.jobTitle ?? "",
    email: lead.email ?? "", phone: lead.phone ?? "", mobile: lead.mobile ?? "", website: lead.website ?? "", city: lead.city ?? "",
    state: lead.state ?? "", countryCode: lead.countryCode ?? "", sourceId: lead.sourceId ?? NONE, sourceDetail: lead.sourceDetail ?? "",
    campaignId: lead.campaignId ?? NONE, medium: lead.medium ?? NONE,
    industry: lead.industry ?? "", productInterest: lead.productInterest ?? "", languageCode: lead.languageCode ?? NONE, estimatedValue: lead.estimatedValue ? String(lead.estimatedValue) : "",
    currencyCode: lead.currencyCode ?? "", purchaseTimeframe: lead.purchaseTimeframe ?? NONE, priority: lead.priority, rating: lead.rating,
    description: lead.description ?? "",
    consentEmail: lead.consentEmail, consentSms: lead.consentSms, consentWhatsapp: lead.consentWhatsapp, doNotContact: lead.doNotContact,
  };
}

// Owner and team are set here only when creating; afterwards they change
// through Assign so the change is recorded and notified.
// Contact details the person may not see are never sent: an empty field would otherwise clear them.
function toInput(values: FormValues, mode: "create" | "edit", contactHidden = false) {
  const { ownerUserId, teamId, ...fields } = values;
  const input: Record<string, unknown> = { ...fields, sourceId: fields.sourceId || null, purchaseTimeframe: fields.purchaseTimeframe || null, campaignId: fields.campaignId || null, medium: fields.medium || null, languageCode: fields.languageCode || null };
  if (contactHidden) { delete input.email; delete input.mobile; delete input.phone; }
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
    return <ErrorState title="This lead is converted" description="A converted lead is read-only. Work on its deal instead." action={{ label: "Open lead", onPress: () => router.push(`/crm/leads/${lead.id}`) }} />;
  return <LeadForm key={lead?.id ?? "new"} lead={lead} options={optionsQuery.data} />;
}

function LeadForm({ lead, options }: { lead?: Lead; options: LeadOptions }) {
  const mode = lead ? "edit" : "create";
  const leadId = lead?.id;
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<FormValues>(() => (lead ? valuesFromLead(lead) : { ...EMPTY, currencyCode: options.baseCurrency }));
  // the organization's own fields (CRM plan 5.3)
  const customFields = options.customFields ?? [];
  const [customValues, setCustomValues] = useState<CustomValues>(() => ({ ...(lead?.customFields ?? {}) }));
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

  const submit = useSubmitKey();
  const contactHidden = mode === "edit" && Boolean(lead?.sensitiveDataRestricted);
  // Changing a field clears its error, and the banner of a failed save (it described what was typed before).
  const set = <K extends keyof FormValues>(key: K) => (value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
    setError(null);
  };
  const mutation = useMutation({
    mutationFn: (allowDuplicate: boolean) => submit.run(async () => {
      const input = { ...toInput(values, mode, contactHidden), ...(customFields.length ? { customFields: Object.fromEntries(customFields.map((field) => [field.key, customValues[field.key] ?? null])) } : {}), allowDuplicate, ...(allowDuplicate ? { duplicateReason } : {}) };
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
      repeatActions
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
      <FormSection title="Lead" description="Enter the person, the company, or both.">
        <TextField label="First name" value={values.firstName} onChange={set("firstName")} errorMessage={fieldErrors.firstName} />
        <TextField label="Last name" value={values.lastName} onChange={set("lastName")} errorMessage={fieldErrors.lastName} />
        <TextField label="Company" value={values.companyName} onChange={set("companyName")} errorMessage={fieldErrors.companyName} />
        {contactHidden ? <p className="text-sm text-text-secondary sm:col-span-2">This lead&apos;s email and phone numbers are hidden from you; saving keeps them as they are.</p> : <>
          <TextField label="Mobile" type="tel" value={values.mobile} onChange={set("mobile")} errorMessage={fieldErrors.mobile} />
          <TextField label="Email" type="email" value={values.email} onChange={set("email")} errorMessage={fieldErrors.email} />
        </>}
        <Select
          label="Lead source"
          selectedKey={values.sourceId}
          onSelectionChange={(key) => set("sourceId")(String(key ?? NONE))}
          options={[{ value: NONE, label: "Not set" }, ...options.sources.map((source) => ({ value: source.id, label: source.name }))]}
        />
        <TextArea label="Product / service interest" className="sm:col-span-2" value={values.productInterest} onChange={set("productInterest")} />
      </FormSection>

      {customFields.length > 0 && (
        <FormSection title="More about this lead" description="Your organization's own fields.">
          <CustomFieldInputs fields={customFields} values={customValues} onChange={setCustomValues} />
        </FormSection>
      )}

      <MoreDetails description="Job title, industry, website, phone, location, value, timeframe, priority, rating and description."
        hasContent={Boolean(values.jobTitle || values.industry || values.website || values.phone || values.city || values.state || values.sourceDetail || values.campaignId || values.medium || values.estimatedValue
          || values.purchaseTimeframe || values.description || values.consentEmail || values.consentSms || values.consentWhatsapp || values.doNotContact || (mode === "edit" && (values.priority !== "medium" || values.rating !== "cold"))
          || Object.entries(fieldErrors).some(([key, message]) => message && !["firstName", "lastName", "companyName", "mobile", "email"].includes(key)))}>
        <TextField label="Job title" value={values.jobTitle} onChange={set("jobTitle")} />
        <TextField label="Industry" value={values.industry} onChange={set("industry")} />
        <Select label="Language" description="The language they prefer to be spoken to in." selectedKey={values.languageCode || "none"}
          onSelectionChange={(key) => set("languageCode")(String(key) === "none" ? NONE : String(key))} options={[{ value: "none", label: "Not set" }, ...LANGUAGES]} />
        <TextField label="Website" value={values.website} onChange={set("website")} placeholder="https://" />
        {!contactHidden && <TextField label="Phone" type="tel" value={values.phone} onChange={set("phone")} errorMessage={fieldErrors.phone} />}
        <TextField label="City" value={values.city} onChange={set("city")} />
        <StateField countryCode={values.countryCode} value={values.state} onChange={set("state")} errorMessage={fieldErrors.state} />
        <CountrySelect value={values.countryCode} onChange={set("countryCode")} errorMessage={fieldErrors.countryCode} />
        <Select label="Campaign" selectedKey={values.campaignId} errorMessage={fieldErrors.campaignId}
          onSelectionChange={(key) => {
            const campaignId = String(key ?? NONE);
            set("campaignId")(campaignId);
            const medium = options.campaigns?.find((entry) => entry.id === campaignId)?.medium;
            if (medium && !values.medium) set("medium")(medium);
          }}
          options={[{ value: NONE, label: "None" }, ...campaignChoices(options.campaigns ?? [], lead?.campaignId ?? null, lead?.campaignName ?? null)]} />
        <Select label="Medium" description="How they reached you." selectedKey={values.medium} onSelectionChange={(key) => set("medium")(String(key ?? NONE))} errorMessage={fieldErrors.medium}
          options={[{ value: NONE, label: "Not set" }, ...(options.mediums ?? []).map((entry) => ({ value: entry.code, label: entry.label }))]} />
        <TextField label="Source detail" description="The event, or the person who referred them." value={values.sourceDetail} onChange={set("sourceDetail")} />
        <TextField label="Estimated value" inputMode="decimal" value={values.estimatedValue} onChange={set("estimatedValue")} errorMessage={fieldErrors.estimatedValue} />
        <CurrencySelect value={values.currencyCode} onChange={set("currencyCode")} />
        <Select
          label="Purchase timeframe"
          selectedKey={values.purchaseTimeframe}
          onSelectionChange={(key) => set("purchaseTimeframe")(String(key ?? NONE))}
          options={[{ value: NONE, label: "Not set" }, ...options.purchaseTimeframes.map((entry) => ({ value: entry.code, label: entry.label }))]}
        />
        <Select label="Priority" selectedKey={values.priority} onSelectionChange={(key) => set("priority")(String(key))} options={PRIORITY_OPTIONS} />
        <Select label="Rating" selectedKey={values.rating} onSelectionChange={(key) => set("rating")(String(key))} options={RATING_OPTIONS} />
        <TextArea label="Description" className="sm:col-span-2" value={values.description} onChange={set("description")} />
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">Contact preferences</legend>
          <p className="text-xs text-text-muted">Agreed to receive messages by:</p>
          <div className="flex flex-wrap gap-4">
            <Checkbox isSelected={values.consentEmail && !values.doNotContact} isDisabled={values.doNotContact} onChange={set("consentEmail")}>Email</Checkbox>
            <Checkbox isSelected={values.consentSms && !values.doNotContact} isDisabled={values.doNotContact} onChange={set("consentSms")}>SMS</Checkbox>
            <Checkbox isSelected={values.consentWhatsapp && !values.doNotContact} isDisabled={values.doNotContact} onChange={set("consentWhatsapp")}>WhatsApp</Checkbox>
          </div>
          <Checkbox isSelected={values.doNotContact} onChange={set("doNotContact")}>Do not contact — they asked not to be contacted at all</Checkbox>
        </fieldset>
      </MoreDetails>

      {mode === "create" && (
        <FormSection title="Ownership" description="Automatic (assignment rules): a rule decides who owns the lead; if none matches, the lead is yours.">
          <Select
            label="Lead owner"
            selectedKey={values.ownerUserId}
            onSelectionChange={(key) => set("ownerUserId")(String(key))}
            options={[
              { value: AUTO, label: "Automatic (assignment rules)" },
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
