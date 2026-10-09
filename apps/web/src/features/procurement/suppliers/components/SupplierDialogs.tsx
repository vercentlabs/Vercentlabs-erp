"use client";

// The supplier's dialogs: status changes (each its own action, with a reason
// where one is needed) and a bank account (locations and people: LocationContactDialogs). The server
// checks every rule again and its message is shown as-is.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useSubmitKey } from "@/shared/http/submit-once";

import {
  addBankAccount, changeSupplierStatus, errorMessage, fieldIssuesOf, updateBankAccount, type BankAccount, type Supplier, type SupplierOptions,
} from "../api/suppliers-api";
import { Notice } from "@/shared/ui/Panel";

function Actions({ onCancel, onConfirm, label, busy, disabled, danger }: { onCancel: () => void; onConfirm: () => void; label: string; busy: boolean; disabled?: boolean; danger?: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button variant="secondary" onPress={onCancel}>Cancel</Button>
      <Button variant={danger ? "danger" : "primary"} isLoading={busy} isDisabled={disabled} onPress={onConfirm}>{label}</Button>
    </div>
  );
}

export type StatusAction = "deactivate" | "activate" | "block" | "unblock";
const STATUS_TEXT: Record<StatusAction, { title: string; description: string; label: string; reason: "required" | "optional" }> = {
  deactivate: { title: "Deactivate supplier", description: "It will not be offered for new RFQs or purchase orders. Everything it was used on stays as it is.", label: "Deactivate", reason: "optional" },
  activate: { title: "Activate supplier", description: "It can be used for new RFQs and purchase orders again.", label: "Activate", reason: "optional" },
  block: {
    title: "Block supplier",
    description: "A procurement hold: no new purchase orders, and draft orders cannot go forward. Goods already received stay received, and Finance can still pay bills already owed.",
    label: "Block", reason: "required",
  },
  unblock: { title: "Unblock supplier", description: "The hold is lifted and the supplier can be used again.", label: "Unblock", reason: "required" },
};

export function StatusDialog({ supplier, action, onClose, onDone }: { supplier: Supplier; action: StatusAction; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [stayInactive, setStayInactive] = useState(false);
  const text = STATUS_TEXT[action];
  const change = useMutation({
    mutationFn: () => changeSupplierStatus(supplier.id, action, { reason: reason.trim() || undefined, ...(action === "unblock" && stayInactive ? { inactive: true } : {}) }),
    onSuccess: (saved) => onDone(`${saved.supplier.supplierNumber} is ${saved.supplier.statusLabel.toLowerCase()}.`),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`${text.title}: ${supplier.supplierNumber}`} description={text.description}>
      <div className="flex flex-col gap-3">
        {change.error && <Notice>{errorMessage(change.error)}</Notice>}
        <TextArea label={text.reason === "required" ? "Reason" : "Reason (optional)"} isRequired={text.reason === "required"} value={reason} onChange={setReason}
          description={action === "block" ? "For example: quality dispute, fraud concern, contract issue, management hold." : undefined} />
        {action === "unblock" && <Checkbox isSelected={stayInactive} onChange={setStayInactive}>Leave it inactive (not for new business)</Checkbox>}
        <Actions onCancel={onClose} onConfirm={() => change.mutate()} label={text.label} busy={change.isPending} danger={action === "block"}
          disabled={text.reason === "required" && reason.trim().length < 3} />
      </div>
    </Dialog>
  );
}

export function BankAccountDialog({ supplier, account, options, onClose, onDone }: {
  supplier: Supplier; account: BankAccount | null; options: SupplierOptions; onClose: () => void; onDone: (message: string) => void;
}) {
  const [values, setValues] = useState({
    accountHolder: account?.accountHolder ?? supplier.legalName ?? supplier.supplierName, bankName: account?.bankName ?? "", accountNumber: account?.accountNumber ?? "",
    ifscCode: account?.ifscCode ?? "", swiftCode: account?.swiftCode ?? "", currencyCode: account?.currencyCode ?? supplier.defaultCurrency, isPrimary: account?.isPrimary ?? false,
  });
  const set = (key: keyof typeof values) => (value: string | boolean) => setValues((current) => ({ ...current, [key]: value }));
  const submit = useSubmitKey();
  const save = useMutation({
    mutationFn: () => submit.run(async () => {
      const body = { ...values, ifscCode: values.ifscCode || null, swiftCode: values.swiftCode || null };
      return account ? updateBankAccount(supplier.id, account.id, body) : addBankAccount(supplier.id, body);
    }),
    onSuccess: () => onDone(account ? "The bank account was saved. The change is in the supplier's history." : "The bank account was added. The change is in the supplier's history."),
  });
  const issues = fieldIssuesOf(save.error);
  const field = (key: keyof typeof values, label: string, props: Record<string, unknown> = {}) => (
    <TextField label={label} value={String(values[key])} onChange={set(key)} errorMessage={issues[key]} isInvalid={Boolean(issues[key])} {...props} />
  );
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={account ? "Change bank account" : "Add bank account"}
      description="Where this supplier is paid. Check the details against the supplier's own written confirmation before saving.">
      <div className="flex flex-col gap-3">
        {save.error && <Notice>{errorMessage(save.error)}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("accountHolder", "Account holder", { isRequired: true })}
          {field("bankName", "Bank", { isRequired: true })}
          {field("accountNumber", "Account number", { isRequired: true })}
          {field("ifscCode", "IFSC")}
          {field("swiftCode", "SWIFT / BIC")}
          <Select label="Currency" options={options.currencies.map((currency) => ({ value: currency.code, label: currency.code }))} selectedKey={values.currencyCode}
            onSelectionChange={(value) => set("currencyCode")(String(value))} />
        </div>
        {!account?.isPrimary && <Checkbox isSelected={values.isPrimary} onChange={(value) => set("isPrimary")(value)}>Pay to this account by default</Checkbox>}
        <Actions onCancel={onClose} onConfirm={() => save.mutate()} label="Save" busy={save.isPending}
          disabled={!values.accountHolder.trim() || !values.bankName.trim() || !values.accountNumber.trim()} />
      </div>
    </Dialog>
  );
}
