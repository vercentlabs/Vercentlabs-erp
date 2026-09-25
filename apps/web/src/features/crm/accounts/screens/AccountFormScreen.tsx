"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ConflictBanner, ErrorState, PermissionState, RecordFormPage, Select, TextField } from "@vercentlabs/design-system";
import type { SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { FormSection } from "@/features/crm/shared/ui/FormSection";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { CountrySelect } from "@/features/crm/shared/ui/CountrySelect";
import { emailProblem, gstinPanMismatch, gstinProblem, panProblem } from "@/features/crm/shared/validators";
import { AccountApiError, createAccount, updateAccount } from "../api/accounts-api";
import type { Account } from "../types";

type FormValues = {
  displayName: string;
  legalName: string;
  industry: string;
  website: string;
  phone: string;
  email: string;
  gstin: string;
  pan: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  ownerUserId: string;
};

const EMPTY: FormValues = { displayName: "", legalName: "", industry: "", website: "", phone: "", email: "", gstin: "", pan: "", addressLine1: "", city: "", state: "", postalCode: "", countryCode: "", ownerUserId: "" };

function accountToForm(account: Account): FormValues {
  return {
    displayName: account.displayName,
    legalName: account.legalName ?? "",
    industry: account.industry ?? "",
    website: account.website ?? "",
    phone: account.phone ?? "",
    email: account.email ?? "",
    gstin: account.gstin ?? "",
    pan: account.pan ?? "",
    addressLine1: account.addressLine1 ?? "",
    city: account.city ?? "",
    state: account.state ?? "",
    postalCode: account.postalCode ?? "",
    countryCode: account.countryCode ?? "",
    ownerUserId: account.ownerUserId ?? "",
  };
}

export function AccountFormScreen({
  mode,
  account,
  canManage = true,
  notFound = false,
}: {
  mode: "create" | "edit";
  account?: Account;
  canManage?: boolean;
  notFound?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [values, setValues] = useState<FormValues>(account ? accountToForm(account) : EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Account owner (optional; empty = shared with everyone who can see the
  // company's Accounts). Offers only people the server accepts
  // (assignableOwnerIds: null = anyone eligible, else self + managed team).
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const ownerOptions: SelectOption[] = useMemo(() => {
    const assignable = optionsQuery.data?.options?.assignableOwnerIds as string[] | null | undefined;
    const rows = ((optionsQuery.data?.options?.users ?? []) as Array<{ id: string; fullName?: string; name?: string }>)
      .filter((row) => assignable === null || (assignable ?? []).includes(String(row.id)));
    const options = [{ value: "", label: "Shared (no owner)" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }))];
    if (account?.ownerUserId && !options.some((option) => option.value === account.ownerUserId))
      options.push({ value: account.ownerUserId, label: account.ownerName ?? "Current owner" });
    return options;
  }, [optionsQuery.data, account]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!values.displayName.trim()) {
        setFieldErrors({ displayName: "Account name is required." });
        throw new Error("Review the highlighted fields.");
      }
      const problems: Record<string, string> = {};
      const email = emailProblem(values.email); if (email) problems.email = email;
      const gst = gstinProblem(values.gstin) ?? gstinPanMismatch(values.gstin, values.pan); if (gst) problems.gstin = gst;
      const pan = panProblem(values.pan); if (pan) problems.pan = pan;
      if (Object.keys(problems).length) {
        setFieldErrors(problems);
        throw new Error("Review the highlighted fields.");
      }
      setFieldErrors({});
      const input: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(values)) input[key] = value === "" ? null : value;
      if (mode === "edit" && values.ownerUserId === (account?.ownerUserId ?? "")) delete input.ownerUserId;
      if (mode === "create") return createAccount(input);
      return updateAccount(account!.id, input, account!.updatedAt);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "accounts") });
      router.push(`/crm/accounts/${result.record.id}`);
    },
    onError: (error: Error) => {
      if (error instanceof AccountApiError && error.code === "CRM_STALE_WRITE") {
        setConflict(true);
        return;
      }
      setServerError(error.message);
    },
  });

  if (!canManage) return <PermissionState title={`You don't have access to ${mode === "create" ? "create" : "edit"} Accounts`} />;
  if (mode === "edit" && notFound) return <ErrorState title="Account not found" action={{ label: "Back to Accounts", onPress: () => router.push("/crm/accounts") }} />;
  if (mode === "edit" && account && account.status !== "active") {
    return <ErrorState title="This Account is inactive" description="Reactivate it before editing." action={{ label: "Back to Account", onPress: () => router.push(`/crm/accounts/${account.id}`) }} />;
  }

  return (
    <RecordFormPage
      header={{ title: mode === "create" ? "New account" : `Edit ${account?.displayName}` }}
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
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>{mode === "create" ? "Create account" : "Save changes"}</Button>
        </>
      }
    >
      <FormSection title="Company">
        <TextField label="Account name" isRequired value={values.displayName} onChange={(v) => set("displayName", v)} errorMessage={fieldErrors.displayName} />
        <TextField label="Legal name" description="As registered, if different from the account name." value={values.legalName} onChange={(v) => set("legalName", v)} />
      </FormSection>
      <FormSection title="Business">
        <TextField label="Industry" value={values.industry} onChange={(v) => set("industry", v)} />
        <Select
          label="Owner"
          description="Who looks after this account. Shared accounts are visible to everyone who works with this company's accounts."
          options={ownerOptions}
          selectedKey={values.ownerUserId}
          onSelectionChange={(key) => set("ownerUserId", String(key ?? ""))}
          errorMessage={fieldErrors.ownerUserId}
        />
        <TextField label="Website" placeholder="www.company.com" value={values.website} onChange={(v) => set("website", v)} />
      </FormSection>
      <FormSection title="Contact details">
        <TextField label="Email" type="email" value={values.email} onChange={(v) => set("email", v)} errorMessage={fieldErrors.email} />
        <TextField label="Phone" value={values.phone} onChange={(v) => set("phone", v)} />
      </FormSection>
      <FormSection title="Address">
        <TextField label="Street address" value={values.addressLine1} onChange={(v) => set("addressLine1", v)} className="sm:col-span-2" />
        <TextField label="City" value={values.city} onChange={(v) => set("city", v)} />
        <TextField label="State" value={values.state} onChange={(v) => set("state", v)} />
        <TextField label="Postal code" value={values.postalCode} onChange={(v) => set("postalCode", v)} />
        <CountrySelect value={values.countryCode} onChange={(code) => set("countryCode", code)} />
      </FormSection>
      <FormSection title="Tax" description="Optional. Entered in capitals and checked for the correct shape.">
        <TextField label="GSTIN" placeholder="27AAPFU0939F1ZV" value={values.gstin} onChange={(v) => set("gstin", v.toUpperCase().replace(/s/g, ""))} errorMessage={fieldErrors.gstin} />
        <TextField label="PAN" placeholder="ABCDE1234F" value={values.pan} onChange={(v) => set("pan", v.toUpperCase().replace(/s/g, ""))} errorMessage={fieldErrors.pan} />
      </FormSection>
    </RecordFormPage>
  );
}
