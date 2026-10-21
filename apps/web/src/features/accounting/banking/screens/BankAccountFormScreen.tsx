"use client";

// A new bank or cash account. A bank account records its bank, branch code (IFSC) and account number (only the last four digits are kept);
// a cash account names the person responsible for the cash. Its ledger account is created under Cash and bank unless an existing free one
// is chosen.
import { useState } from "react";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Breadcrumb, Button, ComboBox, ErrorState, PermissionState, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useFormChangesWarning } from "@/features/procurement/shared/navigation";
import { useSubmitKey } from "@/shared/http/submit-once";
import { DocumentFormPage } from "@/shared/ui/DocumentFormPage";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { BANK_TYPES, bankAccountOptions, createBankAccount, errorMessage, errorStatus } from "../api/banking-api";

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function BankAccountFormScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "bank-account-options"), queryFn: bankAccountOptions, retry: false });
  const [kind, setKind] = useState<"bank" | "cash">("bank");
  const [form, setForm] = useState({ name: "", bankName: "", accountNumber: "", ifsc: "", type: "current", ledgerAccountId: "new", custodianUserId: "", notes: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  useFormChangesWarning({ kind, form });
  const ifsc = form.ifsc.trim().toUpperCase();
  const ifscBad = kind === "bank" && ifsc !== "" && !IFSC.test(ifsc);
  const numberBad = /[^0-9 ]/.test(form.accountNumber);
  const ready = form.name.trim() !== "" && (kind === "cash" ? form.custodianUserId !== "" : form.bankName.trim() !== "" && !ifscBad && !numberBad);
  const submitKey = useSubmitKey();
  const save = useMutation({
    mutationFn: () => submitKey.run(() => createBankAccount({
      kind, name: form.name.trim(), bankName: kind === "bank" ? form.bankName.trim() : null, accountNumber: kind === "bank" ? form.accountNumber.trim() || null : null,
      ifsc: kind === "bank" ? ifsc || null : null, type: kind === "bank" ? form.type : undefined, ledgerAccountId: form.ledgerAccountId === "new" ? null : form.ledgerAccountId,
      custodianUserId: form.custodianUserId || null, notes: form.notes.trim() || null,
    })),
    onSuccess: (account) => router.replace(`/accounting/bank-accounts/${account.id}`),
  });
  const busy = save.isPending || save.isSuccess;

  if (options.isLoading) return <LoadingState label="Loading the account form" rows={6} />;
  if (errorStatus(options.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  if (!options.data) return <ErrorState title="Could not load the account form" description={errorMessage(options.error)} />;
  const ledgerChoices = options.data.ledgerAccounts.filter((entry) => entry.kind === kind);

  return (
    <DocumentFormPage
      header={{
        breadcrumbs: [<Breadcrumb key="list" href="/accounting/bank-accounts">Bank &amp; cash accounts</Breadcrumb>, <Breadcrumb key="this" isCurrent>New</Breadcrumb>],
        title: kind === "cash" ? "New cash account" : "New bank account",
        description: "Receipts, payments and transfers are recorded against it, and a bank account's statements are reconciled on it.",
      }}
      banner={Boolean(save.error) && <Notice>{errorMessage(save.error)}</Notice>}
      formActions={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={() => router.replace("/accounting/bank-accounts")}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !ready} onPress={() => save.mutate()}>Save account</Button>
        </>
      }
    >
      <FormSection columns={1} title="Account">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Kind" selectedKey={kind} onSelectionChange={(key) => { setKind(key === "cash" ? "cash" : "bank"); set("ledgerAccountId")("new"); }}
            options={[{ value: "bank", label: "Bank account" }, { value: "cash", label: "Cash (petty cash, cash box)" }]} />
          <TextField label="Name" isRequired value={form.name} onChange={set("name")} maxLength={200}
            placeholder={kind === "cash" ? "Petty cash — office" : "Current account"} description={kind === "cash" ? "Where the cash is kept." : "How your team calls this account."} />
          {kind === "bank" && <>
            <TextField label="Bank" isRequired value={form.bankName} onChange={set("bankName")} maxLength={200} placeholder="HDFC Bank" />
            <Select label="Type" selectedKey={form.type} onSelectionChange={(key) => set("type")(String(key))} options={BANK_TYPES.map(([value, label]) => ({ value, label }))} />
            <TextField label="Account number" inputMode="numeric" value={form.accountNumber} onChange={set("accountNumber")} maxLength={40}
              errorMessage={numberBad ? "Digits only" : undefined} description="Only the last four digits are kept, to recognise the account." />
            <TextField label="IFSC" value={form.ifsc} onChange={(value) => set("ifsc")(value.toUpperCase())} maxLength={11} placeholder="HDFC0001234"
              errorMessage={ifscBad ? "An IFSC is 11 characters, like HDFC0001234" : undefined} />
          </>}
          <ComboBox label={kind === "cash" ? "Person responsible" : "Contact person (optional)"} isRequired={kind === "cash"} placeholder="Choose a person"
            selectedKey={form.custodianUserId || null} onSelectionChange={(key) => set("custodianUserId")(key ? String(key) : "")}
            options={options.data.people.map((person) => ({ value: person.id, label: person.name }))}
            description={kind === "cash" ? "Answers for the cash in this box; can be handed over later." : undefined} />
          <Select label="Ledger account" selectedKey={form.ledgerAccountId} onSelectionChange={(key) => set("ledgerAccountId")(String(key))}
            options={[{ value: "new", label: "Create one under Cash and bank" }, ...ledgerChoices.map((entry) => ({ value: entry.id, label: entry.label }))]}
            description="Its balance is this account's balance in the books." />
          <div className="sm:col-span-2"><TextArea label="Notes" value={form.notes} onChange={set("notes")} maxLength={2000} /></div>
        </div>
      </FormSection>
    </DocumentFormPage>
  );
}
