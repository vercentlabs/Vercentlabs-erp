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
  checkAccountDuplicates, createAccount, duplicateMatchesOf, errorMessage, getAccount, getAccountOptions, updateAccount,
  type Account, type AccountDuplicateMatch, type AccountOptions,
} from "../api/accounts-api";
import { DuplicateOverride } from "@/features/crm/duplicates/DuplicateParts";
import { AccountDuplicateWarning } from "../components/AccountDuplicateWarning";
import { AccountPicker } from "../components/AccountPicker";
import { ErrorBanner } from "../account-format";
import { useSubmitKey } from "@/shared/http/submit-once";

const NONE = "";
const ME = "__me__";
const UNASSIGNED = "__unassigned__";

type FormValues = {
  displayName: string; legalName: string; accountType: string; industry: string; website: string; email: string; phone: string; secondaryPhone: string;
  employeeRange: string; annualRevenue: string; currencyCode: string; sourceId: string; sourceDetail: string; description: string; tagIds: string[];
  ownerUserId: string; teamId: string; parentPartyId: string | null;
  line1: string; line2: string; city: string; state: string; postalCode: string; countryCode: string;
};

const EMPTY: FormValues = {
  displayName: "", legalName: "", accountType: "prospect", industry: "", website: "", email: "", phone: "", secondaryPhone: "", employeeRange: NONE,
  annualRevenue: "", currencyCode: "", sourceId: NONE, sourceDetail: "", description: "", tagIds: [], ownerUserId: ME, teamId: NONE, parentPartyId: null,
  line1: "", line2: "", city: "", state: "", postalCode: "", countryCode: "IN",
};

const ADDRESS_FIELDS = ["line1", "line2", "city", "state", "postalCode"] as const;

function valuesFromAccount(account: Account): FormValues {
  return {
    ...EMPTY,
    displayName: account.displayName, legalName: account.legalName ?? "", accountType: account.accountType, industry: account.industry ?? "",
    website: account.website ?? "", email: account.email ?? "", phone: account.phone ?? "", secondaryPhone: account.secondaryPhone ?? "",
    employeeRange: account.employeeRange ?? NONE, annualRevenue: account.annualRevenue === null ? "" : String(account.annualRevenue),
    currencyCode: account.currencyCode ?? "", sourceId: account.sourceId ?? NONE, sourceDetail: account.sourceDetail ?? "",
    description: account.description ?? "", tagIds: account.tags.map((tag) => tag.id),
  };
}

// Owner, team, parent and the first address are set here only when creating;
// afterwards they change from the account page, so each change is recorded.
function toInput(values: FormValues, mode: "create" | "edit", sensitiveHidden: boolean, options: AccountOptions) {
  const { ownerUserId, teamId, parentPartyId, line1, line2, city, state, postalCode, countryCode, ...fields } = values;
  const input: Record<string, unknown> = {
    ...fields,
    sourceId: fields.sourceId || null,
    employeeRange: fields.employeeRange || null,
    annualRevenue: fields.annualRevenue.replace(/[,\s]/g, "") || null,
  };
  if (mode === "edit" && input.accountType === "customer") delete input.accountType;
  // Without view-sensitive the contact fields were never loaded; leave them untouched.
  if (sensitiveHidden) for (const key of ["email", "phone", "secondaryPhone"]) delete input[key];
  if (mode === "create") {
    input.ownerUserId = ownerUserId === ME ? options.currentUserId : ownerUserId === UNASSIGNED ? null : ownerUserId;
    if (teamId) input.teamId = teamId;
    if (parentPartyId) input.parentPartyId = parentPartyId;
    if (line1.trim() || city.trim()) input.address = { addressType: "office", line1, line2, city, state, postalCode, countryCode };
  }
  return input;
}

export function AccountFormScreen({ accountId }: { accountId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "account-options"), queryFn: getAccountOptions, staleTime: 60_000 });
  const accountQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "account", accountId), queryFn: () => getAccount(accountId as string), enabled: Boolean(accountId) });
  const account = accountQuery.data;

  if (optionsQuery.isLoading || (accountId && accountQuery.isLoading)) return <LoadingState label={accountId ? "Loading account" : "Loading"} />;
  if (accountId && (accountQuery.isError || !account))
    return <ErrorState title="Could not load this account" description={errorMessage(accountQuery.error)} action={{ label: "Back to accounts", onPress: () => router.push("/crm/accounts") }} />;
  if (!optionsQuery.data) return <ErrorState title="Could not load this page" description="Refresh to try again." />;
  if (account?.status === "archived")
    return <ErrorState title="This account is archived" description="Reactivate it before editing." action={{ label: "Open account", onPress: () => router.push(`/crm/accounts/${account.id}`) }} />;
  return <AccountForm key={account?.id ?? "new"} account={account} options={optionsQuery.data} />;
}

function AccountForm({ account, options }: { account?: Account; options: AccountOptions }) {
  const mode = account ? "edit" : "create";
  const accountId = account?.id;
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<FormValues>(() => (account ? valuesFromAccount(account) : { ...EMPTY, currencyCode: options.baseCurrency }));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [blockingMatches, setBlockingMatches] = useState<AccountDuplicateMatch[] | null>(null);
  const [duplicateReason, setDuplicateReason] = useState("");
  const [liveMatches, setLiveMatches] = useState<AccountDuplicateMatch[]>([]);
  const sensitiveHidden = Boolean(account?.sensitiveDataRestricted);

  // Warn about likely duplicates while the identifying fields are typed.
  const identity = [values.displayName, values.legalName, values.website, values.email, values.phone, values.city].join("|");
  const canCheckDuplicates = values.displayName.trim().length >= 2 || Boolean(values.website.trim());
  const similarMatches = canCheckDuplicates ? liveMatches : [];
  useEffect(() => {
    if (!canCheckDuplicates) return;
    const timer = setTimeout(() => {
      checkAccountDuplicates({
        displayName: values.displayName, legalName: values.legalName, website: values.website, email: values.email, phone: values.phone,
        city: values.city, excludeId: accountId,
      }).then((result) => setLiveMatches(result.matches)).catch(() => setLiveMatches([]));
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `identity` stands for the fields read above
  }, [identity, accountId, canCheckDuplicates]);

  const set = <K extends keyof FormValues>(key: K) => (value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  const addressStarted = mode === "create" && ADDRESS_FIELDS.some((field) => values[field].trim());
  const addressComplete = !addressStarted || Boolean(values.line1.trim() && values.city.trim() && values.state.trim() && values.postalCode.trim() && values.countryCode);

  const submit = useSubmitKey();
  const mutation = useMutation({
    mutationFn: (allowDuplicate: boolean) => submit.run(async () => {
      const input = { ...toInput(values, mode, sensitiveHidden, options), allowDuplicate, ...(allowDuplicate ? { duplicateReason } : {}) };
      return mode === "edit" ? updateAccount(accountId as string, { ...input, expectedUpdatedAt: account?.updatedAt }) : createAccount(input);
    }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "accounts") });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "account", saved.id) });
      // Replace the form in the history so Back from the account returns to
      // where the user came from instead of reopening the form.
      router.replace(`/crm/accounts/${saved.id}`);
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
  const cancelHref = mode === "edit" ? `/crm/accounts/${accountId}` : "/crm/accounts";
  const typeOptions = options.types.map((type) => ({
    value: type.code, label: type.label, isDisabled: type.code === "customer",
  }));

  return (
    <RecordFormPage
      header={{
        title: mode === "edit" ? `Edit ${account?.displayName ?? "account"}` : "New account",
        description: mode === "edit" ? account?.code : "Only the company name is required. Add the rest as you learn it.",
      }}
      banner={
        <div className="flex flex-col gap-3">
          <ErrorBanner message={error} />
          {blockingMatches ? (
            <AccountDuplicateWarning matches={blockingMatches} blocking>
              <DuplicateOverride subject="company" reason={duplicateReason} onReasonChange={setDuplicateReason}
                onConfirm={() => mutation.mutate(true)} onCancel={() => setBlockingMatches(null)} isLoading={mutation.isPending || mutation.isSuccess} />
            </AccountDuplicateWarning>
          ) : (
            <AccountDuplicateWarning matches={similarMatches} blocking={similarMatches.some((match) => match.strength === "exact")} />
          )}
        </div>
      }
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.replace(cancelHref)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate(false)} isLoading={mutation.isPending || mutation.isSuccess} isDisabled={!values.displayName.trim() || !addressComplete}>
            {mode === "edit" ? "Save changes" : "Create account"}
          </Button>
        </>
      }
    >
      <FormSection title="Company">
        <TextField label="Account name" isRequired value={values.displayName} onChange={set("displayName")} errorMessage={fieldErrors.displayName} />
        <TextField label="Legal name" description="The registered name, if different." value={values.legalName} onChange={set("legalName")} errorMessage={fieldErrors.legalName} />
        {account?.isCustomer ? (
          <TextField label="Account type" value="Customer" isDisabled description="Follows the Customer Master." />
        ) : (
          <Select label="Account type" selectedKey={values.accountType} onSelectionChange={(key) => set("accountType")(String(key))} options={typeOptions}
            description="Use Create customer on the account page to make it a customer." />
        )}
        <TextField label="Industry" value={values.industry} onChange={set("industry")} errorMessage={fieldErrors.industry} />
        <TextField label="Website" value={values.website} onChange={set("website")} placeholder="https://" errorMessage={fieldErrors.website} />
        <Select label="Employees" selectedKey={values.employeeRange} onSelectionChange={(key) => set("employeeRange")(String(key ?? NONE))}
          options={[{ value: NONE, label: "Not set" }, ...options.employeeRanges.map((range) => ({ value: range, label: range }))]} />
        <TextField label="Annual revenue" inputMode="decimal" value={values.annualRevenue} onChange={set("annualRevenue")} errorMessage={fieldErrors.annualRevenue} />
        <CurrencySelect value={values.currencyCode} onChange={set("currencyCode")} />
      </FormSection>

      {!sensitiveHidden && (
        <FormSection title="Contact details" description="The company's general email and phone numbers. People go under Contacts.">
          <TextField label="Email" type="email" value={values.email} onChange={set("email")} errorMessage={fieldErrors.email} />
          <TextField label="Phone" type="tel" value={values.phone} onChange={set("phone")} errorMessage={fieldErrors.phone} />
          <TextField label="Secondary phone" type="tel" value={values.secondaryPhone} onChange={set("secondaryPhone")} errorMessage={fieldErrors.secondaryPhone} />
        </FormSection>
      )}

      {mode === "create" && (
        <FormSection title="Address" description="Optional. It becomes the default billing and shipping address. More addresses can be added later.">
          <TextField label="Address line 1" className="sm:col-span-2" value={values.line1} onChange={set("line1")} errorMessage={fieldErrors.line1} />
          <TextField label="Address line 2" className="sm:col-span-2" value={values.line2} onChange={set("line2")} />
          <TextField label="City" value={values.city} onChange={set("city")} errorMessage={fieldErrors.city} />
          <TextField label="State" value={values.state} onChange={set("state")} errorMessage={fieldErrors.state} />
          <TextField label="Postal code" value={values.postalCode} onChange={set("postalCode")} errorMessage={fieldErrors.postalCode} />
          <CountrySelect value={values.countryCode} onChange={set("countryCode")} errorMessage={fieldErrors.countryCode} />
          {!addressComplete && <p className="text-xs text-warning sm:col-span-2">Complete line 1, city, state, postal code and country, or clear the address.</p>}
        </FormSection>
      )}

      <FormSection title="Source and classification">
        <Select label="Source" selectedKey={values.sourceId} onSelectionChange={(key) => set("sourceId")(String(key ?? NONE))}
          options={[{ value: NONE, label: "Not set" }, ...options.sources.filter((source) => source.isActive || source.id === values.sourceId).map((source) => ({ value: source.id, label: source.name }))]} />
        <TextField label="Source detail" description="Campaign, event or the person who referred them." value={values.sourceDetail} onChange={set("sourceDetail")} />
        <MultiSelect label="Tags" className="sm:col-span-2" placeholder={options.tags.length ? "Choose tags" : "No tags have been set up"}
          value={values.tagIds} onChange={set("tagIds")} options={options.tags.map((tag) => ({ value: tag.id, label: tag.name }))} />
        <TextArea label="Description" className="sm:col-span-2" value={values.description} onChange={set("description")} errorMessage={fieldErrors.description} />
      </FormSection>

      {mode === "create" && (
        <FormSection title="Ownership and structure">
          <Select
            label="Account owner"
            selectedKey={values.ownerUserId}
            onSelectionChange={(key) => set("ownerUserId")(String(key))}
            options={[
              { value: ME, label: "Me" },
              { value: UNASSIGNED, label: "Leave unassigned" },
              ...options.users.filter((user) => canAssignOthers && user.id !== options.currentUserId).map((user) => ({ value: user.id, label: user.name })),
            ]}
          />
          <Select label="Sales team" selectedKey={values.teamId} onSelectionChange={(key) => set("teamId")(String(key ?? NONE))}
            options={[{ value: NONE, label: "No team" }, ...options.teams.map((team) => ({ value: team.id, label: team.name }))]} />
          <AccountPicker label="Parent account" description="For a branch or subsidiary of another account." value={values.parentPartyId}
            onChange={(id) => set("parentPartyId")(id)} />
        </FormSection>
      )}
    </RecordFormPage>
  );
}
