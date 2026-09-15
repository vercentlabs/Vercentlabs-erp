"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ConflictBanner, ErrorState, PermissionState, RecordFormPage, Select, TextField, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { ContactApiError, createContact, updateContact } from "../api/contacts-api";
import type { Contact } from "../types";

type FormValues = {
  accountId: string;
  firstName: string;
  lastName: string;
  designation: string;
  email: string;
  phone: string;
  mobile: string;
  isPrimary: boolean;
};

const EMPTY: FormValues = { accountId: "", firstName: "", lastName: "", designation: "", email: "", phone: "", mobile: "", isPrimary: false };

function contactToForm(contact: Contact): FormValues {
  return {
    accountId: contact.accountId ?? "",
    firstName: contact.firstName,
    lastName: contact.lastName ?? "",
    designation: contact.designation ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    mobile: contact.mobile ?? "",
    isPrimary: contact.isPrimary,
  };
}

export function ContactFormScreen({
  mode,
  contact,
  defaultAccountId,
  canManage = true,
  notFound = false,
}: {
  mode: "create" | "edit";
  contact?: Contact;
  defaultAccountId?: string;
  canManage?: boolean;
  notFound?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [values, setValues] = useState<FormValues>(contact ? contactToForm(contact) : { ...EMPTY, accountId: defaultAccountId ?? "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const accountOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.parties ?? [];
    return [{ value: "", label: "No account" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.name || row.id) }))];
  }, [optionsQuery.data]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!values.firstName.trim()) {
        setFieldErrors({ firstName: "First name is required." });
        throw new Error("Review the highlighted fields.");
      }
      setFieldErrors({});
      const input: Record<string, unknown> = { ...values };
      for (const key of Object.keys(input)) if (input[key] === "") input[key] = null;
      if (mode === "create") return createContact(input);
      return updateContact(contact!.id, input, contact!.updatedAt);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contacts") });
      router.push(`/crm/contacts/${result.record.id}`);
    },
    onError: (error: Error) => {
      if (error instanceof ContactApiError && error.code === "CRM_STALE_WRITE") {
        setConflict(true);
        return;
      }
      setServerError(error.message);
    },
  });

  if (!canManage) return <PermissionState title={`You don't have access to ${mode === "create" ? "create" : "edit"} Contacts`} />;
  if (mode === "edit" && notFound) return <ErrorState title="Contact not found" action={{ label: "Back to Contacts", onPress: () => router.push("/crm/contacts") }} />;
  if (mode === "edit" && contact && contact.status !== "active") {
    return <ErrorState title="This Contact is inactive" description="Reactivate it before editing." action={{ label: "Back to Contact", onPress: () => router.push(`/crm/contacts/${contact.id}`) }} />;
  }

  return (
    <RecordFormPage
      header={{ title: mode === "create" ? "New contact" : `Edit ${contact?.firstName} ${contact?.lastName || ""}`.trim() }}
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
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>{mode === "create" ? "Create contact" : "Save changes"}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select label="Account" options={accountOptions} selectedKey={values.accountId} onSelectionChange={(key) => set("accountId", String(key ?? ""))} className="sm:col-span-2" />
        <TextField label="First name" isRequired value={values.firstName} onChange={(v) => set("firstName", v)} errorMessage={fieldErrors.firstName} />
        <TextField label="Last name" value={values.lastName} onChange={(v) => set("lastName", v)} />
        <TextField label="Designation" value={values.designation} onChange={(v) => set("designation", v)} />
        <TextField label="Email" value={values.email} onChange={(v) => set("email", v)} />
        <TextField label="Phone" value={values.phone} onChange={(v) => set("phone", v)} />
        <TextField label="Mobile" value={values.mobile} onChange={(v) => set("mobile", v)} />
      </div>
      <Checkbox isSelected={values.isPrimary} onChange={(v) => set("isPrimary", v)}>Primary contact for this account</Checkbox>
    </RecordFormPage>
  );
}
