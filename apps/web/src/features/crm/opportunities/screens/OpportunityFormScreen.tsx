"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, RecordFormPage, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { getAccount } from "@/features/crm/accounts/api/accounts-api";
import { AccountPicker } from "@/features/crm/accounts/components/AccountPicker";
import { listContacts } from "@/features/crm/contacts/api/contacts-api";
import { DateInput, DateTimeInput } from "@/features/crm/shared/ui/DateTimeInput";
import { FormSection } from "@/features/crm/shared/ui/FormSection";
import { formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  createOpportunity, errorMessage, findDuplicateOpportunities, getOpportunity, getOpportunityOptions, updateOpportunity,
  type Opportunity, type OpportunityDuplicate, type OpportunityOptions,
} from "../api/opportunities-api";
import { ErrorBanner, PRIORITY_OPTIONS } from "../opportunity-format";

const NONE = "";
const UNASSIGNED = "__unassigned__";

type FormValues = {
  name: string; accountId: string; accountName: string; contactId: string; stageId: string; ownerUserId: string; teamId: string; amount: string;
  currencyCode: string; expectedCloseDate: string; priority: string; sourceId: string; productInterest: string; description: string;
  businessProblem: string; requirements: string; proposedSolution: string; commercialNotes: string; nextStep: string; nextStepDueAt: string;
};

function valuesFrom(opportunity: Opportunity | undefined, options: OpportunityOptions, account?: { id: string; name: string }): FormValues {
  return {
    name: opportunity?.name ?? "", accountId: opportunity?.accountId ?? account?.id ?? "", accountName: opportunity?.accountName ?? account?.name ?? "",
    contactId: opportunity?.contactId ?? NONE, stageId: options.stages[0]?.id ?? NONE, ownerUserId: options.currentUserId, teamId: NONE,
    amount: opportunity?.amount ? String(opportunity.amount) : "", currencyCode: opportunity?.currencyCode ?? options.baseCurrency,
    expectedCloseDate: opportunity?.expectedCloseDate ?? "", priority: opportunity?.priority ?? "medium", sourceId: opportunity?.sourceId ?? NONE,
    productInterest: opportunity?.productInterest ?? "", description: opportunity?.description ?? "", businessProblem: opportunity?.businessProblem ?? "",
    requirements: opportunity?.requirements ?? "", proposedSolution: opportunity?.proposedSolution ?? "", commercialNotes: opportunity?.commercialNotes ?? "",
    nextStep: opportunity?.nextStep ?? "", nextStepDueAt: opportunity?.nextStepDueAt ?? "",
  };
}

// Stage, owner and team are set here only when creating; afterwards they
// change through Change stage and Assign, so each change is recorded.
function toInput(values: FormValues, mode: "create" | "edit") {
  const { stageId, ownerUserId, teamId, ...fields } = values;
  const input: Record<string, unknown> = { ...fields, accountName: undefined, contactId: fields.contactId || null, sourceId: fields.sourceId || null, nextStepDueAt: fields.nextStepDueAt || null };
  if (mode === "create") {
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
  const back = { label: "Back to opportunities", onPress: () => router.push("/crm/opportunities") };

  if (optionsQuery.isLoading || (opportunityId && opportunityQuery.isLoading) || accountQuery.isLoading) return <LoadingState label={opportunityId ? "Loading opportunity" : "Loading"} />;
  if (opportunityId && (opportunityQuery.isError || !opportunity)) return <ErrorState title="Could not load this opportunity" description={errorMessage(opportunityQuery.error)} action={back} />;
  if (!optionsQuery.data) return <ErrorState title="Could not load this page" description="Refresh to try again." />;
  if (opportunity && (opportunity.status !== "open" || opportunity.archivedAt))
    return <ErrorState title={`This opportunity is ${opportunity.archivedAt ? "archived" : opportunity.status}`} description="Reopen or restore it before changing its details."
      action={{ label: "Open opportunity", onPress: () => router.push(`/crm/opportunities/${opportunity.id}`) }} />;
  const account = accountQuery.data ? { id: accountQuery.data.id, name: accountQuery.data.displayName } : undefined;
  return <OpportunityForm key={opportunity?.id ?? account?.id ?? "new"} opportunity={opportunity} options={optionsQuery.data} account={account} />;
}

function OpportunityForm({ opportunity, options, account }: { opportunity?: Opportunity; options: OpportunityOptions; account?: { id: string; name: string } }) {
  const mode = opportunity ? "edit" : "create";
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<FormValues>(() => valuesFrom(opportunity, options, account));
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

  const mutation = useMutation({
    mutationFn: () => {
      const input = toInput(values, mode);
      return opportunity ? updateOpportunity(opportunity.id, { ...input, expectedUpdatedAt: opportunity.updatedAt }) : createOpportunity(input);
    },
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
  const stage = options.stages.find((entry) => entry.id === values.stageId);
  const amount = Number(values.amount);
  const cancelHref = opportunity ? `/crm/opportunities/${opportunity.id}` : account ? `/crm/accounts/${account.id}` : "/crm/opportunities";
  const ready = Boolean(values.name.trim() && values.accountId);

  return (
    <RecordFormPage
      header={{
        title: opportunity ? `Edit ${opportunity.code}` : "New opportunity",
        description: opportunity ? undefined : "A deal with an account. Only the name and the account are needed to start.",
      }}
      banner={
        <div className="flex flex-col gap-3">
          <ErrorBanner message={error} />
          {similar.length > 0 && (
            <div role="status" className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm">
              <p className="font-medium">
                {similar.length === 1 ? "A similar open opportunity already exists for this account." : `${similar.length} similar open opportunities already exist for this account.`}
              </p>
              <ul className="flex flex-col gap-1">
                {similar.map((match) => (
                  <li key={match.id} className="flex flex-wrap items-center gap-x-2">
                    {match.canOpen
                      ? <Link className="font-medium text-brand underline-offset-2 hover:underline" href={`/crm/opportunities/${match.id}`} target="_blank">{match.code} · {match.name}</Link>
                      : <span className="font-medium">An opportunity you cannot open</span>}
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
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!ready}>
            {opportunity ? "Save changes" : similar.length ? "Continue anyway" : "Create opportunity"}
          </Button>
        </>
      }
    >
      <FormSection title="Opportunity" description="What the deal is and who it is with.">
        <TextField label="Opportunity name" isRequired className="sm:col-span-2" value={values.name} onChange={set("name")} errorMessage={fieldErrors.name}
          placeholder="For example: Acme – ERP implementation" />
        {account && !opportunity ? (
          <TextField label="Account" isReadOnly value={values.accountName} onChange={() => undefined} description="Opened from this account." />
        ) : (
          <AccountPicker label="Account *" value={values.accountId || null}
            description={fieldErrors.accountId || (values.accountName ? `Chosen: ${values.accountName}` : "Every opportunity belongs to an account.")}
            onChange={(id, name) => setValues((current) => ({ ...current, accountId: id ?? "", accountName: name ?? "", contactId: NONE }))} />
        )}
        <Select label="Primary contact" isDisabled={!values.accountId} selectedKey={values.contactId} onSelectionChange={(key) => set("contactId")(String(key ?? NONE))}
          description="More contacts can be added on the opportunity."
          options={[{ value: NONE, label: !values.accountId ? "Choose an account first" : contacts.length ? "No primary contact" : "This account has no contacts" },
            ...contacts.map((row) => ({ value: row.id, label: row.displayName }))]} />
        <TextArea label="Product / service interest" className="sm:col-span-2" value={values.productInterest} onChange={set("productInterest")}
          description="In words. Products with quantities and prices are added on the opportunity." />
        <TextArea label="Description" className="sm:col-span-2" value={values.description} onChange={set("description")} />
      </FormSection>

      <FormSection title="Value and timing">
        <TextField label="Estimated value" inputMode="decimal" value={values.amount} onChange={set("amount")} errorMessage={fieldErrors.amount}
          description={mode === "create" && stage && Number.isFinite(amount) && amount > 0 ? `Weighted at ${stage.probability}%: ${formatMoney(values.currencyCode, Math.round(amount * stage.probability) / 100)}` : undefined} />
        <Select label="Currency" selectedKey={values.currencyCode} onSelectionChange={(key) => set("currencyCode")(String(key))}
          options={options.currencies.map((code) => ({ value: code, label: code }))} />
        <DateInput label="Expected close date" value={values.expectedCloseDate} onChange={set("expectedCloseDate")} />
        <Select label="Priority" selectedKey={values.priority} onSelectionChange={(key) => set("priority")(String(key))} options={PRIORITY_OPTIONS} />
        {mode === "create" && (
          <Select label="Sales stage" selectedKey={values.stageId} onSelectionChange={(key) => set("stageId")(String(key))}
            description="The stage sets the starting probability."
            options={options.stages.map((entry) => ({ value: entry.id, label: `${entry.name} · ${entry.probability}%` }))} />
        )}
        <Select label="Source" selectedKey={values.sourceId} onSelectionChange={(key) => set("sourceId")(String(key ?? NONE))}
          options={[{ value: NONE, label: "Not set" }, ...options.sources.map((source) => ({ value: source.id, label: source.name }))]} />
      </FormSection>

      <FormSection title="The deal" description="What the customer needs and what you propose. Fill these in as the deal moves forward.">
        <TextArea label="Business problem" value={values.businessProblem} onChange={set("businessProblem")} />
        <TextArea label="Requirements" value={values.requirements} onChange={set("requirements")} />
        <TextArea label="Proposed solution" value={values.proposedSolution} onChange={set("proposedSolution")} />
        <TextArea label="Commercial notes" description="Budget, terms, discounts discussed." value={values.commercialNotes} onChange={set("commercialNotes")} />
      </FormSection>

      <FormSection title="Next step">
        <TextField label="Next step" value={values.nextStep} onChange={set("nextStep")} placeholder="For example: Send the revised proposal" />
        <DateTimeInput label="Next step due" value={values.nextStepDueAt} onChange={set("nextStepDueAt")} />
      </FormSection>

      {mode === "create" && (
        <FormSection title="Ownership" description="The opportunity is yours unless you give it to someone else.">
          <Select label="Opportunity owner" selectedKey={values.ownerUserId} onSelectionChange={(key) => set("ownerUserId")(String(key))}
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
