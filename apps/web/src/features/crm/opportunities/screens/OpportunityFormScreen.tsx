"use client";

// New and edit deal: the name, company, primary contact, value, close date and (when creating) stage first; currency, priority, source,
// product interest and description under More details; "The deal" and Next step folded until opened, as they are filled while the deal
// moves; then — when creating — who owns it. Save and Cancel are at the top and the bottom.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, RecordFormPage, Select, TextArea, TextField } from "@vercentlabs/design-system";

import type { CustomValues } from "@/features/crm/shared/fields-api";
import { CustomFieldInputs } from "@/features/crm/shared/ui/CustomFields";

import { campaignChoices } from "@/features/crm/shared/marketing-api";
import { getAccount } from "@/features/crm/accounts/api/accounts-api";
import { AccountPicker } from "@/features/crm/accounts/components/AccountPicker";
import { ContactPicker } from "@/features/crm/contacts/components/ContactPicker";
import { listContacts } from "@/features/crm/contacts/api/contacts-api";
import { DateInput, DateTimeInput } from "@/features/crm/shared/ui/DateTimeInput";
import { FormSection } from "@/shared/ui/FormSection";
import { formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  createOpportunity, errorMessage, findDuplicateOpportunities, getOpportunity, getOpportunityOptions, updateOpportunity,
  type Opportunity, type OpportunityDuplicate, type OpportunityOptions,
} from "../api/opportunities-api";
import { ErrorBanner, PRIORITY_OPTIONS } from "../opportunity-format";
import { useSubmitKey } from "@/shared/http/submit-once";
import { MoreDetails } from "@/features/crm/shared/ui/MoreDetails";

const NONE = "";
const UNASSIGNED = "__unassigned__";

type FormValues = {
  name: string; accountId: string; accountName: string; contactId: string; pipelineId: string; stageId: string; ownerUserId: string; teamId: string; amount: string;
  currencyCode: string; expectedCloseDate: string; priority: string; sourceId: string; campaignId: string; medium: string; productInterest: string; description: string;
  businessProblem: string; requirements: string; proposedSolution: string; commercialNotes: string; nextStep: string; nextStepDueAt: string;
};

function valuesFrom(opportunity: Opportunity | undefined, options: OpportunityOptions, account?: { id: string; name: string }): FormValues {
  return {
    name: opportunity?.name ?? "", accountId: opportunity?.accountId ?? account?.id ?? "", accountName: opportunity?.accountName ?? account?.name ?? "",
    contactId: opportunity?.contactId ?? NONE, pipelineId: NONE, stageId: NONE, ownerUserId: options.currentUserId, teamId: NONE,
    amount: opportunity?.amount ? String(opportunity.amount) : "", currencyCode: opportunity?.currencyCode ?? options.baseCurrency,
    expectedCloseDate: opportunity?.expectedCloseDate ?? "", priority: opportunity?.priority ?? "medium", sourceId: opportunity?.sourceId ?? NONE,
    campaignId: opportunity?.campaignId ?? NONE, medium: opportunity?.medium ?? NONE,
    productInterest: opportunity?.productInterest ?? "", description: opportunity?.description ?? "", businessProblem: opportunity?.businessProblem ?? "",
    requirements: opportunity?.requirements ?? "", proposedSolution: opportunity?.proposedSolution ?? "", commercialNotes: opportunity?.commercialNotes ?? "",
    nextStep: opportunity?.nextStep ?? "", nextStepDueAt: opportunity?.nextStepDueAt ?? "",
  };
}

// Pipeline, stage, owner and team are set here only when creating; afterwards they
// change through Change stage, Move to another pipeline and Assign, so each change is recorded.
// No pipeline chosen: the team's (or owner's team's) pipeline, else the default. No stage: the pipeline's first.
function toInput(values: FormValues, mode: "create" | "edit") {
  const { pipelineId, stageId, ownerUserId, teamId, ...fields } = values;
  const input: Record<string, unknown> = { ...fields, accountName: undefined, contactId: fields.contactId || null, sourceId: fields.sourceId || null,
    campaignId: fields.campaignId || null, medium: fields.medium || null, nextStepDueAt: fields.nextStepDueAt || null };
  if (mode === "create") {
    if (pipelineId) input.pipelineId = pipelineId;
    if (stageId) input.stageId = stageId;
    input.ownerUserId = ownerUserId === UNASSIGNED ? null : ownerUserId;
    if (teamId) input.teamId = teamId;
  }
  return input;
}

// Loads what the form needs, then shows it. `initialAccountId` is set when the
// form is opened from an account ("New opportunity" on the account page).
export function OpportunityFormScreen({ opportunityId, initialAccountId }: { opportunityId?: string; initialAccountId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options"), queryFn: getOpportunityOptions, staleTime: 60_000 });
  const opportunityQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunity", opportunityId), queryFn: () => getOpportunity(opportunityId as string), enabled: Boolean(opportunityId),
  });
  const accountQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "account", initialAccountId), queryFn: () => getAccount(initialAccountId as string), enabled: Boolean(initialAccountId) && !opportunityId,
  });
  const opportunity = opportunityQuery.data;
  const back = { label: "Back to deals", onPress: () => router.push("/crm/opportunities") };

  if (optionsQuery.isLoading || (opportunityId && opportunityQuery.isLoading) || accountQuery.isLoading) return <LoadingState label={opportunityId ? "Loading deal" : "Loading"} />;
  if (opportunityId && (opportunityQuery.isError || !opportunity)) return <ErrorState title="Could not load this deal" description={errorMessage(opportunityQuery.error)} action={back} />;
  if (!optionsQuery.data) return <ErrorState title="Could not load this page" description="Refresh to try again." />;
  if (opportunity && (opportunity.status !== "open" || opportunity.archivedAt))
    return <ErrorState title={`This deal is ${opportunity.archivedAt ? "archived" : opportunity.status}`} description="Reopen or restore it before changing its details."
      action={{ label: "Open deal", onPress: () => router.push(`/crm/opportunities/${opportunity.id}`) }} />;
  const account = accountQuery.data ? { id: accountQuery.data.id, name: accountQuery.data.displayName } : undefined;
  return <OpportunityForm key={opportunity?.id ?? account?.id ?? "new"} opportunity={opportunity} options={optionsQuery.data} account={account} />;
}

function OpportunityForm({ opportunity, options, account }: { opportunity?: Opportunity; options: OpportunityOptions; account?: { id: string; name: string } }) {
  const mode = opportunity ? "edit" : "create";
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<FormValues>(() => valuesFrom(opportunity, options, account));
  // The organization's own fields and recurring revenue (CRM plan 5.3).
  const customFields = options.customFields ?? [];
  const recurringPlans = (options.recurringPlans ?? []).filter((plan) => plan.isActive || plan.id === opportunity?.recurringPlanId);
  const [customValues, setCustomValues] = useState<CustomValues>(() => ({ ...(opportunity?.customFields ?? {}) }));
  const [recurringPlanId, setRecurringPlanId] = useState(opportunity?.recurringPlanId ?? "");
  const [recurringRevenue, setRecurringRevenue] = useState(opportunity?.recurringRevenue === null || opportunity?.recurringRevenue === undefined ? "" : String(opportunity.recurringRevenue));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<OpportunityDuplicate[]>([]);

  const set = <K extends keyof FormValues>(key: K) => (value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  // The people who can be the primary contact: contacts of the chosen account.
  const contactsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "account-contacts", values.accountId),
    queryFn: () => listContacts({ accountId: values.accountId, limit: 100 }),
    enabled: Boolean(values.accountId),
  });
  const contacts = contactsQuery.data?.rows ?? [];

  // Another open deal for the same account with a similar name or product is
  // a warning, never a refusal.
  const similar = values.accountId && values.name.trim().length >= 3 ? duplicates : [];
  useEffect(() => {
    if (!values.accountId || values.name.trim().length < 3) return;
    const timer = setTimeout(() => {
      findDuplicateOpportunities({ accountId: values.accountId, name: values.name, productInterest: values.productInterest, excludeId: opportunity?.id })
        .then(setDuplicates).catch(() => setDuplicates([]));
    }, 500);
    return () => clearTimeout(timer);
  }, [values.accountId, values.name, values.productInterest, opportunity?.id]);

  const submit = useSubmitKey();
  const mutation = useMutation({
    mutationFn: () => submit.run(async () => {
      const input = {
        ...toInput(values, mode),
        ...(customFields.length ? { customFields: Object.fromEntries(customFields.map((field) => [field.key, customValues[field.key] ?? null])) } : {}),
        recurringPlanId: recurringPlanId || null,
        recurringRevenue: recurringPlanId && recurringRevenue.trim() !== "" ? recurringRevenue : null,
      };
      return opportunity ? updateOpportunity(opportunity.id, { ...input, expectedUpdatedAt: opportunity.updatedAt }) : createOpportunity(input);
    }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities") });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunity", saved.id) });
      // Replace the form in the browser history, so Back returns to where the user came from.
      router.replace(`/crm/opportunities/${saved.id}`);
    },
    onError: (failure) => {
      const issues = (failure as { details?: { issues?: Array<{ field: string; message: string }> } }).details?.issues ?? [];
      setFieldErrors(Object.fromEntries(issues.map((issue) => [issue.field, issue.message])));
      setError(errorMessage(failure));
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });

  const canAssignOthers = options.capabilities.assign;
  const chosenTeam = options.teams.find((team) => team.id === values.teamId);
  // The stages offered: the chosen pipeline's, else the default pipeline's (CRM plan 5.1).
  const pipelines = options.pipelines ?? [];
  const stageChoices = pipelines.find((entry) => entry.id === values.pipelineId)?.stages ?? options.stages;
  const stage = stageChoices.find((entry) => entry.id === values.stageId) ?? stageChoices[0];
  const amount = Number(values.amount);
  const cancelHref = opportunity ? `/crm/opportunities/${opportunity.id}` : account ? `/crm/accounts/${account.id}` : "/crm/opportunities";
  // A deal is for a company, or for a person (their company, or an individual customer created for them).
  const ready = Boolean(values.name.trim() && (values.accountId || (mode === "create" && values.contactId && values.contactId !== NONE)));
  // The currency field shows only when the organization works in more than one.
  const singleCurrency = options.currencies.length <= 1 && values.currencyCode === options.baseCurrency;

  return (
    <RecordFormPage
      repeatActions
      header={{
        title: opportunity ? `Edit ${opportunity.code}` : "New deal",
        description: opportunity ? undefined : "A deal with a company. Only the name and the company are needed to start.",
      }}
      banner={
        <div className="flex flex-col gap-3">
          <ErrorBanner message={error} />
          {similar.length > 0 && (
            <div role="status" className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm">
              <p className="font-medium">
                {similar.length === 1 ? "A similar open deal already exists for this company." : `${similar.length} similar open deals already exist for this company.`}
              </p>
              <ul className="flex flex-col gap-1">
                {similar.map((match) => (
                  <li key={match.id} className="flex flex-wrap items-center gap-x-2">
                    {match.canOpen
                      ? <Link className="font-medium text-brand underline-offset-2 hover:underline" href={`/crm/opportunities/${match.id}`} target="_blank">{match.code} · {match.name}</Link>
                      : <span className="font-medium">A deal you cannot open</span>}
                    <span className="text-text-secondary">
                      {[match.stageName, match.amount !== undefined ? formatMoney(match.currencyCode ?? options.baseCurrency, match.amount) : null, match.ownerName, match.reasons.join(", ")].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-text-secondary">Open the existing one to work on it, or continue if this is a separate deal.</p>
            </div>
          )}
        </div>
      }
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.replace(cancelHref)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending || mutation.isSuccess} isDisabled={!ready}>
            {opportunity ? "Save changes" : similar.length ? "Continue anyway" : "Create deal"}
          </Button>
        </>
      }
    >
      <FormSection title="Deal" description="What the deal is, who it is with, and when it should close.">
        <TextField label="Deal name" isRequired className="sm:col-span-2" value={values.name} onChange={set("name")} errorMessage={fieldErrors.name}
          placeholder="For example: Acme – ERP implementation" />
        {account && !opportunity ? (
          <TextField label="Company" isReadOnly value={values.accountName} onChange={() => undefined} description="Opened from this company." />
        ) : (
          <AccountPicker label="Company" isRequired value={values.accountId || null} errorMessage={fieldErrors.accountId || undefined}
            description={values.accountName ? `Chosen: ${values.accountName}` : mode === "create" ? "Leave empty to sell to a person: choose them below." : "Every deal belongs to a company."}
            onChange={(id, name) => setValues((current) => ({ ...current, accountId: id ?? "", accountName: name ?? "", contactId: NONE }))} />
        )}
        {mode === "create" && !values.accountId && !account && (
          <ContactPicker label="Person buying" value={values.contactId && values.contactId !== NONE ? values.contactId : null}
            description="For a sale to a person: the deal is for their company, or for them as an individual customer."
            onChange={(id) => setValues((current) => ({ ...current, contactId: id ?? NONE }))} />
        )}
        {(values.accountId || account) && <Select label="Primary contact" isDisabled={!values.accountId} selectedKey={values.contactId} onSelectionChange={(key) => set("contactId")(String(key ?? NONE))}
          description="More contacts can be added on the deal."
          options={[{ value: NONE, label: !values.accountId ? "Choose a company first" : contacts.length ? "No primary contact" : "This company has no contacts" },
            ...contacts.map((row) => ({ value: row.id, label: row.displayName }))]} />}
        <TextField label="Value" inputMode="decimal" value={values.amount} onChange={set("amount")} errorMessage={fieldErrors.amount}
          description={mode === "create" && stage && Number.isFinite(amount) && amount > 0 ? `Weighted at ${stage.probability}%: ${formatMoney(values.currencyCode, Math.round(amount * stage.probability) / 100)}` : undefined} />
        <DateInput label="Close date" value={values.expectedCloseDate} onChange={set("expectedCloseDate")} errorMessage={fieldErrors.expectedCloseDate} />
        {mode === "create" && pipelines.length > 1 && (
          <Select label="Pipeline" selectedKey={values.pipelineId || "auto"}
            onSelectionChange={(key) => { const next = String(key) === "auto" ? NONE : String(key); setValues((current) => ({ ...current, pipelineId: next, stageId: NONE })); }}
            description="Left automatic, the deal goes to its team's pipeline, else the default one."
            options={[{ value: "auto", label: "Automatic" }, ...pipelines.map((entry) => ({ value: entry.id, label: `${entry.name}${entry.isDefault ? " (default)" : ""}` }))]} />
        )}
        {mode === "create" && (
          <Select label="Sales stage" selectedKey={values.stageId || "first"} onSelectionChange={(key) => set("stageId")(String(key) === "first" ? NONE : String(key))}
            description="The stage sets the starting probability."
            options={[{ value: "first", label: `First stage${stageChoices[0] ? ` (${stageChoices[0].name})` : ""}` },
              ...stageChoices.map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.probability}%` }))]} />
        )}
      </FormSection>

      {(customFields.length > 0 || recurringPlans.length > 0) && (
        <FormSection title="More about this deal" description="Recurring revenue, and your organization's own fields.">
          {recurringPlans.length > 0 && (
            <>
              <Select label="Recurring plan" description="For revenue that repeats: an AMC, a subscription, a rental." selectedKey={recurringPlanId || "none"}
                onSelectionChange={(key) => setRecurringPlanId(String(key) === "none" ? "" : String(key))}
                options={[{ value: "none", label: "Not recurring" }, ...recurringPlans.map((plan) => ({ value: plan.id, label: plan.name }))]} />
              {recurringPlanId && (
                <TextField label="Recurring amount per period" inputMode="decimal" value={recurringRevenue} onChange={setRecurringRevenue}
                  description={(() => {
                    const plan = recurringPlans.find((entry) => entry.id === recurringPlanId);
                    const amount = Number(recurringRevenue);
                    return plan && Number.isFinite(amount) && amount > 0 ? `${formatMoney(values.currencyCode, Math.round((amount / plan.months) * 100) / 100)} a month` : undefined;
                  })()} />
              )}
            </>
          )}
          <CustomFieldInputs fields={customFields} values={customValues} onChange={setCustomValues} />
        </FormSection>
      )}

      <MoreDetails description={`${singleCurrency ? "" : "Currency, "}priority, source, product interest and description.`}
        hasContent={Boolean(values.productInterest || values.description || values.sourceId || values.campaignId || values.medium || values.priority !== "medium" || values.currencyCode !== options.baseCurrency
          || fieldErrors.productInterest || fieldErrors.description || fieldErrors.currencyCode)}>
        {!singleCurrency && (
          <Select label="Currency" selectedKey={values.currencyCode} onSelectionChange={(key) => set("currencyCode")(String(key))}
            options={options.currencies.map((code) => ({ value: code, label: code }))} />
        )}
        <Select label="Priority" selectedKey={values.priority} onSelectionChange={(key) => set("priority")(String(key))} options={PRIORITY_OPTIONS} />
        <Select label="Source" selectedKey={values.sourceId} onSelectionChange={(key) => set("sourceId")(String(key ?? NONE))}
          options={[{ value: NONE, label: "Not set" }, ...options.sources.map((source) => ({ value: source.id, label: source.name }))]} />
        <Select label="Campaign" selectedKey={values.campaignId} errorMessage={fieldErrors.campaignId}
          onSelectionChange={(key) => {
            const campaignId = String(key ?? NONE);
            set("campaignId")(campaignId);
            const medium = options.campaigns?.find((entry) => entry.id === campaignId)?.medium;
            if (medium && !values.medium) set("medium")(medium);
          }}
          options={[{ value: NONE, label: "None" }, ...campaignChoices(options.campaigns ?? [], opportunity?.campaignId ?? null, opportunity?.campaignName ?? null)]} />
        <Select label="Medium" selectedKey={values.medium} onSelectionChange={(key) => set("medium")(String(key ?? NONE))} errorMessage={fieldErrors.medium}
          options={[{ value: NONE, label: "Not set" }, ...(options.mediums ?? []).map((entry) => ({ value: entry.code, label: entry.label }))]} />
        <TextArea label="Product / service interest" className="sm:col-span-2" value={values.productInterest} onChange={set("productInterest")}
          description="In words. Products with quantities and prices are added on the deal." />
        <TextArea label="Description" className="sm:col-span-2" value={values.description} onChange={set("description")} />
      </MoreDetails>

      <MoreDetails title="The deal" description="Business problem, requirements, proposed solution and commercial notes. Fill these in as the deal moves forward."
        hasContent={Boolean(values.businessProblem || values.requirements || values.proposedSolution || values.commercialNotes)}>
        <TextArea label="Business problem" value={values.businessProblem} onChange={set("businessProblem")} />
        <TextArea label="Requirements" value={values.requirements} onChange={set("requirements")} />
        <TextArea label="Proposed solution" value={values.proposedSolution} onChange={set("proposedSolution")} />
        <TextArea label="Commercial notes" description="Budget, terms, discounts discussed." value={values.commercialNotes} onChange={set("commercialNotes")} />
      </MoreDetails>

      <MoreDetails title="Next step" description="What happens next, and by when." hasContent={Boolean(values.nextStep || values.nextStepDueAt)}>
        <TextField label="Next step" value={values.nextStep} onChange={set("nextStep")} placeholder="For example: Send the revised proposal" />
        <DateTimeInput label="Next step due" value={values.nextStepDueAt} onChange={set("nextStepDueAt")} />
      </MoreDetails>

      {mode === "create" && (
        <FormSection title="Ownership" description="The deal is yours unless you give it to someone else.">
          <Select label="Deal owner" selectedKey={values.ownerUserId} onSelectionChange={(key) => set("ownerUserId")(String(key))}
            options={[
              ...(canAssignOthers ? [{ value: UNASSIGNED, label: "Leave unassigned" }] : []),
              ...options.users
                .filter((user) => (canAssignOthers || user.id === options.currentUserId) && (!chosenTeam || chosenTeam.memberIds.includes(user.id) || user.id === options.currentUserId))
                .map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name })),
            ]} />
          <Select label="Sales team" selectedKey={values.teamId} onSelectionChange={(key) => set("teamId")(String(key ?? NONE))}
            options={[{ value: NONE, label: "No team" }, ...options.teams.map((team) => ({ value: team.id, label: team.name }))]} />
        </FormSection>
      )}
    </RecordFormPage>
  );
}
