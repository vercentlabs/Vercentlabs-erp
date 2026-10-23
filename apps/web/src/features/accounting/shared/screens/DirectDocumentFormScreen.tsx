"use client";

// Accounting's New invoice and New bill: a customer invoice or a supplier's bill raised in Accounting itself, so a business with Accounting
// alone can bill and record what it owes (the buttons stay once Sales or Purchase is on). Each line is a description, quantity, price and
// GST rate; the server splits the GST into CGST + SGST or IGST from the two states. "Save and post" posts it at once (or sends it for
// approval when Finance's policy asks); "Save draft" keeps it to finish later.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Breadcrumb, Button, ComboBox, ErrorState, PermissionState, Select, TextArea, TextField } from "@vercentlabs/design-system";
import { Plus, Trash2 } from "lucide-react";

import { useFormChangesWarning } from "@/features/procurement/shared/navigation";
import { useSubmitKey } from "@/shared/http/submit-once";
import { DocumentFormPage } from "@/shared/ui/DocumentFormPage";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { useQuickCreate } from "@/shell/pickers/useQuickCreate";
import type { PickedRecord } from "@/shell/pickers/types";

import { paymentOptions } from "../../payables/api/payables-api";
import { cents, errorMessage, errorStatus, fromCents, inr, receiptOptions } from "../../receivables/api/receivables-api";
import { AccountingApiError } from "../client";

type Kind = "invoice" | "bill";
type Line = { key: number; description: string; quantity: string; unitPrice: string; gstRate: string };

const RATES = ["0", "0.25", "3", "5", "12", "18", "28", "40"];
const TEXT = {
  invoice: { title: "New invoice", list: "/accounting/customer-invoices", listLabel: "Customer Invoices", party: "Customer", date: "Invoice date",
    description: "An invoice to a customer, raised in Accounting. Posting it records what the customer owes." },
  bill: { title: "New bill", list: "/accounting/supplier-invoices", listLabel: "Supplier Bills", party: "Supplier", date: "Bill date",
    description: "A supplier's bill, recorded in Accounting. Posting it records what you owe the supplier." },
} as const;

let nextKey = 1;
const blankLine = (): Line => ({ key: nextKey++, description: "", quantity: "1", unitPrice: "", gstRate: "18" });

async function save(kind: Kind, body: Record<string, unknown>) {
  const response = await fetch(kind === "invoice" ? "/api/accounting/receivables/invoices" : "/api/accounting/payables/bills", {
    method: "POST", credentials: "same-origin", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AccountingApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  return (kind === "invoice" ? payload.invoice : payload.bill) as { id: string; status: string };
}

export function DirectDocumentFormScreen({ kind }: { kind: Kind }) {
  const text = TEXT[kind];
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const options = useQuery({
    queryKey: scopedQueryKey(workspace, "accounting", kind === "invoice" ? "receipt-options" : "payment-options"),
    queryFn: async () => {
      if (kind === "invoice") { const data = await receiptOptions(); return { today: data.today, currency: data.baseCurrency, parties: data.customers }; }
      const data = await paymentOptions(); return { today: data.today, currency: data.baseCurrency, parties: data.suppliers };
    },
    staleTime: 60_000, retry: false,
  });
  const [partyId, setPartyId] = useState<string | null>(null);
  // Create where you are (A1): a first-time customer or supplier is created here and chosen.
  const [createdParties, setCreatedParties] = useState<PickedRecord[]>([]);
  const quickCreate = useQuickCreate(kind === "invoice" ? "customer" : "supplier", {
    onCreated: (record) => { setCreatedParties((current) => [...current, record]); setPartyId(record.id); },
  });
  const [form, setForm] = useState({ date: "", dueDate: "", reference: "", notes: "" });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);
  const setLine = (key: number, field: keyof Line) => (value: string) => setLines((current) => current.map((line) => (line.key === key ? { ...line, [field]: value } : line)));
  useFormChangesWarning({ partyId, form, lines });

  const net = lines.reduce((total, line) => total + Math.round(Number(line.quantity || 0) * cents(line.unitPrice)), 0);
  const gst = lines.reduce((total, line) => total + Math.round(Number(line.quantity || 0) * cents(line.unitPrice) * Number(line.gstRate) / 100), 0);
  const ready = Boolean(partyId) && lines.every((line) => line.description.trim() && Number(line.quantity) > 0 && cents(line.unitPrice) > 0);

  const submitKey = useSubmitKey();
  const mutation = useMutation({
    mutationFn: (post: boolean) => submitKey.run(() => save(kind, {
      partyId, [kind === "invoice" ? "invoiceDate" : "billDate"]: form.date || options.data!.today, dueDate: form.dueDate || null, notes: form.notes || null,
      ...(kind === "bill" ? { supplierInvoiceReference: form.reference || null } : {}), post,
      lines: lines.map((line) => ({ description: line.description.trim(), quantity: line.quantity, unitPrice: fromCents(cents(line.unitPrice)), gstRate: Number(line.gstRate) })),
    })),
    onSuccess: () => router.replace(text.list),
  });
  const busy = mutation.isPending || mutation.isSuccess;

  if (options.isLoading) return <LoadingState label={`Loading the ${kind} form`} rows={8} />;
  if (errorStatus(options.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  if (!options.data) return <ErrorState title={`Could not load the ${kind} form`} description={errorMessage(options.error)} />;
  const currency = options.data.currency;

  return (
    <DocumentFormPage
      header={{
        breadcrumbs: [<Breadcrumb key="list" href={text.list}>{text.listLabel}</Breadcrumb>, <Breadcrumb key="this" isCurrent>New</Breadcrumb>],
        title: text.title, description: text.description,
      }}
      banner={Boolean(mutation.error) && <Notice>{errorMessage(mutation.error)}</Notice>}
      aside={
        <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border bg-surface p-4">
          <span className="text-sm font-semibold text-text">Total</span>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
            <dt className="text-text-secondary">Before GST</dt><dd className="text-right">{inr(net / 100, currency)}</dd>
            <dt className="text-text-secondary">GST</dt><dd className="text-right">{inr(gst / 100, currency)}</dd>
            <dt className="font-medium text-text">Total</dt><dd className="text-right font-medium text-text">{inr((net + gst) / 100, currency)}</dd>
          </dl>
          <p className="text-xs text-text-muted">GST is split into CGST and SGST within your state, or charged as IGST across states, when the {kind} is saved.</p>
        </div>
      }
      formActions={
        <>
          <Button variant="secondary" isDisabled={busy} onPress={() => router.replace(text.list)}>Cancel</Button>
          <Button variant="secondary" isDisabled={busy || !ready} onPress={() => mutation.mutate(false)}>Save draft</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !ready} onPress={() => mutation.mutate(true)}>Save and post</Button>
        </>
      }
    >
      <FormSection columns={1} title={kind === "invoice" ? "Invoice" : "Bill"}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ComboBox label={text.party} isRequired placeholder={`Choose a ${text.party.toLowerCase()}`} selectedKey={partyId} onSelectionChange={(key) => setPartyId(key ? String(key) : null)}
            options={[...options.data.parties.map((entry) => ({ value: entry.id, label: entry.number ? `${entry.name} · ${entry.number}` : entry.name })),
              ...createdParties.filter((record) => !options.data!.parties.some((entry) => entry.id === record.id)).map((record) => ({ value: record.id, label: record.label }))]}
            onCreate={quickCreate.canCreate ? quickCreate.open : undefined} createLabel={(typed) => (typed ? `Create ${quickCreate.noun} "${typed}"` : `Create a new ${quickCreate.noun}`)} />
          {quickCreate.drawer}
          <TextField label={text.date} type="date" isRequired value={form.date || options.data.today} onChange={set("date")} description="Posts on this date; its period must be open." />
          <TextField label="Due date" type="date" value={form.dueDate} onChange={set("dueDate")} description={`Left empty, the ${text.party.toLowerCase()}'s payment terms decide.`} />
          {kind === "bill" && <TextField label="Supplier's invoice number" value={form.reference} onChange={set("reference")} maxLength={100} />}
          <div className="sm:col-span-2 lg:col-span-3"><TextArea label="Notes" value={form.notes} onChange={set("notes")} maxLength={2000} /></div>
        </div>
      </FormSection>

      <FormSection columns={1} title="Lines" actions={<Button size="compact" variant="secondary" onPress={() => setLines((current) => [...current, blankLine()])}><Plus className="size-4" aria-hidden="true" />Add line</Button>}>
        <ul className="flex flex-col divide-y divide-border">
          {lines.map((line, index) => (
            <li key={line.key} className="grid grid-cols-1 gap-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_6rem_8rem_7rem_auto] sm:items-end">
              <TextField label={index === 0 ? "Description" : undefined} aria-label={`Line ${index + 1} description`} isRequired value={line.description} onChange={setLine(line.key, "description")} maxLength={1000} />
              <TextField label={index === 0 ? "Quantity" : undefined} aria-label={`Line ${index + 1} quantity`} inputMode="decimal" value={line.quantity} onChange={setLine(line.key, "quantity")} />
              <TextField label={index === 0 ? `Price (${currency})` : undefined} aria-label={`Line ${index + 1} price`} inputMode="decimal" placeholder="0.00" value={line.unitPrice} onChange={setLine(line.key, "unitPrice")} />
              <Select label={index === 0 ? "GST" : undefined} aria-label={`Line ${index + 1} GST rate`} selectedKey={line.gstRate} onSelectionChange={(key) => setLine(line.key, "gstRate")(String(key))}
                options={RATES.map((rate) => ({ value: rate, label: `${rate}%` }))} />
              <Button size="compact" variant="ghost" aria-label={`Remove line ${index + 1}`} isDisabled={lines.length === 1}
                onPress={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}><Trash2 className="size-4" aria-hidden="true" /></Button>
            </li>
          ))}
        </ul>
      </FormSection>
    </DocumentFormPage>
  );
}
