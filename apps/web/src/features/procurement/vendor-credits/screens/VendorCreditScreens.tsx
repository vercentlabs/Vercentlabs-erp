"use client";

// Vendor credits: the form (from the supplier's credit note, an accepted debit note or another authorised basis — lines from posted bills,
// posted returns or on account) and the credit's detail: its lines, sources, taxes, how it was settled (applied to bills, refunded), the
// accounting Finance posted, the supplier's documents and history. Posting never applies it: applying and refunds are their own steps.
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Pencil, Trash2 } from "lucide-react";
import {
  Button, Dialog, ErrorState, LinkButton, PageHeader, RecordDetailsPage, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea, TextField, buttonVariants,
} from "@vercentlabs/design-system";

import { useTabParam, useFormChangesWarning } from "@/features/procurement/shared/navigation";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { calendarDate, dateTime, money, quantity, statusLabel } from "@/features/procurement/shared/format";
import { billFileUrl, getBill, listBillFiles, removeBillFile, uploadBillFile } from "@/features/procurement/supplier-bills/api/supplier-bills-api";
import { getReturn } from "@/features/procurement/purchase-returns/api/purchase-returns-api";

import {
  checkDuplicateCreditNote, createCredit, creditAction, creditVoucherUrl, errorMessage, getCredit, getCreditOptions, issuesOf, previewCredit, reverseRefund, updateCredit,
  type CreditDetail, type CreditOptions, type CreditPreview,
} from "../api/vendor-credits-api";
import { CREDIT_TONE, SETTLEMENT_TONE } from "./DebitNotesCreditsScreens";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";

type Row = {
  key: string; kind: "bill" | "return" | "other"; billLineId: string | null; purchaseReturnLineId: string | null; label: string; hint: string; basis: "quantity" | "amount";
  quantity: string; amount: string; taxAmount: string; reason: string; description: string;
};
let seq = 0;
const nextKey = () => `credit-row-${(seq += 1)}`;

function Errors({ error }: { error: unknown }) {
  if (!error) return null;
  const issues = issuesOf(error);
  return <Notice>{errorMessage(error)}{issues.length > 1 && <ul className="mt-1 list-disc pl-5">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</Notice>;
}

// ---------------------------------------------------------------- form

export function VendorCreditFormScreen({ creditId, billId, returnId, claimId, supplierId }: { creditId?: string; billId?: string; returnId?: string; claimId?: string; supplierId?: string }) {
  const workspace = useWorkspaceContext();
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "vendor-credit", creditId), queryFn: () => getCredit(creditId!), enabled: Boolean(creditId) });
  const bill = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier-bill", billId), queryFn: () => getBill(billId!), enabled: Boolean(billId) && !supplierId });
  const ret = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "purchase-return", returnId), queryFn: () => getReturn(returnId!), enabled: Boolean(returnId) && !supplierId });
  if (existing.isLoading || bill.isLoading || ret.isLoading) return <LoadingState label="Loading vendor credit" />;
  if (creditId && !existing.data) return <ErrorState title="Could not load the vendor credit" description={errorMessage(existing.error)} />;
  if (existing.data && existing.data.credit.status !== "draft") return <ErrorState title="This vendor credit cannot be edited" description="Only a draft is edited; a posted credit is reversed." />;
  const presetSupplier = existing.data?.credit.supplierId ?? supplierId ?? bill.data?.bill.supplierId ?? ret.data?.purchaseReturn.supplierId ?? null;
  return <CreditForm existing={existing.data ?? null} presetSupplierId={presetSupplier} billId={billId ?? null} returnId={returnId ?? null} claimId={claimId ?? null} />;
}

function rowsFromExisting(detail: CreditDetail): Row[] {
  const rows: Row[] = [];
  for (const line of detail.lines) {
    if (line.purchaseReturnLineId) {
      const previous = rows.find((row) => row.kind === "return" && row.purchaseReturnLineId === line.purchaseReturnLineId);
      if (previous) { previous.quantity = String(Number(previous.quantity) + Number(line.quantity)); continue; }
    }
    rows.push({ key: nextKey(), kind: line.purchaseReturnLineId ? "return" : line.billLineId ? "bill" : "other", billLineId: line.purchaseReturnLineId ? null : line.billLineId,
      purchaseReturnLineId: line.purchaseReturnLineId,
      label: line.returnId ? `${line.returnNumber} / line ${line.returnLineNumber}` : line.billId ? `${line.billNumber} / line ${line.billLineSequence}` : "On account", hint: "",
      basis: line.basis, quantity: line.basis === "quantity" ? line.quantity : "", amount: line.basis === "amount" ? line.taxable : "", taxAmount: line.billId ? "" : line.tax,
      reason: line.reason ?? "other", description: line.description });
  }
  return rows;
}

function CreditForm({ existing, presetSupplierId, billId, returnId, claimId }: { existing: CreditDetail | null; presetSupplierId: string | null; billId: string | null; returnId: string | null;
  claimId: string | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [supplierId, setSupplierId] = useState<string | null>(presetSupplierId);
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "credit-options", supplierId, existing?.credit.id), queryFn: () => getCreditOptions(supplierId, existing?.credit.id) });
  const credit = existing?.credit;
  const [header, setHeader] = useState({
    origin: credit?.origin ?? (claimId ? "accepted_claim" : "supplier_credit_note"), supplierCreditNoteNumber: credit?.supplierCreditNoteNumber ?? "", supplierCreditNoteDate: credit?.supplierCreditNoteDate ?? "",
    creditDate: credit?.date ?? "", postingDate: credit?.postingDate ?? "", taxTreatment: credit?.taxTreatment ?? "gst_adjusting", debitClaimId: credit?.debitClaimId ?? claimId ?? "",
    authorizationReason: credit?.authorizationReason ?? "", reason: credit?.reason ?? "", notes: credit?.notes ?? "",
  });
  const [rows, setRows] = useState<Row[]>(() => (existing ? rowsFromExisting(existing) : []));
  const [seeded, setSeeded] = useState(Boolean(existing));
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [preview, setPreview] = useState<CreditPreview | null>(null);
  const data = options.data;
  const billLines = useMemo(() => (data?.bills ?? []).flatMap((entry) => entry.lines.map((line) => ({ ...line, bill: entry }))), [data]);
  const returnLines = useMemo(() => (data?.returns ?? []).flatMap((entry) => entry.lines.map((line) => ({ ...line, ret: entry }))), [data]);
  if (!seeded && data && supplierId) {
    if (billId) setRows(billLines.filter((line) => line.bill.id === billId && !line.reverseCharge).map((line) => ({ key: nextKey(), kind: "bill", billLineId: line.id, purchaseReturnLineId: null,
      label: `${line.bill.number} / line ${line.sequence}`, hint: `${line.description} · open ${quantity(line.openQuantity)} / ${line.openTaxable}`, basis: "quantity", quantity: "", amount: "", taxAmount: "",
      reason: "damaged_goods", description: "" })));
    if (returnId) setRows(returnLines.filter((line) => line.returnId === returnId && Number(line.open) > 0).map((line) => ({ key: nextKey(), kind: "return", billLineId: null,
      purchaseReturnLineId: line.lineId, label: `${line.ret.number} / line ${line.lineNumber}`, hint: `${line.description} · billed ${quantity(line.billed)}, open ${quantity(line.open)}`,
      basis: "quantity", quantity: line.open, amount: "", taxAmount: "", reason: "returned_goods", description: "" })));
    setSeeded(true);
  }
  const body = () => {
    const lines = rows.filter((row) => (row.basis === "quantity" ? Number(row.quantity) > 0 : Number(row.amount) > 0)).map((row) => (row.kind === "return"
      ? { purchaseReturnLineId: row.purchaseReturnLineId, quantity: row.quantity, reason: row.reason, description: row.description || undefined }
      : row.kind === "bill" ? { billLineId: row.billLineId, basis: row.basis, quantity: row.basis === "quantity" ? row.quantity : undefined, amount: row.basis === "amount" ? row.amount : undefined,
        reason: row.reason, description: row.description || undefined }
        : { basis: "amount", amount: row.amount, taxAmount: row.taxAmount || "0", reason: row.reason, description: row.description }));
    return { ...header, debitClaimId: header.origin === "accepted_claim" || header.debitClaimId ? header.debitClaimId || undefined : undefined, supplierId, lines };
  };
  useFormChangesWarning({ supplierId, header, rows }, seeded);
  const save = useMutation({
    mutationFn: async (post: boolean) => {
      const input = body();
      if (existing) {
        await updateCredit(existing.credit.id, input);
        if (post) await creditAction(existing.credit.id, "post");
        return existing.credit.id;
      }
      const fromClaim = input.lines.length === 0 && input.debitClaimId ? { fromClaimId: input.debitClaimId } : {};
      return (await createCredit({ ...input, ...fromClaim, post })).id;
    },
    onSuccess: (id) => router.push(`/procurement/debit-notes-credits/vendor-credits/${id}`),
  });
  const calculate = useMutation({ mutationFn: () => previewCredit({ ...body(), creditId: existing?.credit.id }), onSuccess: setPreview });
  if (options.isLoading && !data) return <LoadingState label="Loading" />;
  if (!data) return <ErrorState title="Could not load the form" description={errorMessage(options.error)} />;
  const set = (key: keyof typeof header) => (value: string) => { setHeader((current) => ({ ...current, [key]: value })); setPreview(null); };
  const setRow = (key: string, patch: Partial<Row>) => { setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row))); setPreview(null); };
  const reasons = data.reasons.map((reason) => ({ value: reason.code, label: reason.label }));
  const origins = data.origins.filter((origin) => origin.code !== "other_authorized" || data.permissions.exceptional).map((origin) => ({ value: origin.code, label: origin.label }));
  const checkDuplicate = async () => {
    if (!supplierId || !header.supplierCreditNoteNumber.trim()) { setDuplicate(null); return; }
    const result = await checkDuplicateCreditNote(supplierId, header.supplierCreditNoteNumber, existing?.credit.id).catch(() => null);
    setDuplicate(result?.duplicate ? `Already recorded as ${result.existing?.number}.` : null);
  };
  const claimLines = header.origin === "accepted_claim" && header.debitClaimId && !rows.length;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={existing ? `Edit ${existing.credit.number}` : "Record Vendor Credit"}
        description="The supplier's financial credit. Saved as a draft; posted through Finance it reduces what you owe — then applied to bills or refunded. Posting never applies it by itself." />
      <Errors error={save.error} />
      <Panel title="Credit">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Select label="Supplier" isDisabled={Boolean(existing)} selectedKey={supplierId} onSelectionChange={(value) => { setSupplierId(String(value)); setRows([]); setPreview(null); }}
            options={data.suppliers.map((supplier) => ({ value: supplier.id, label: `${supplier.name} (${supplier.number})` }))} />
          <Select label="Origin" selectedKey={header.origin} onSelectionChange={(value) => set("origin")(String(value))} options={origins} />
          <Select label="Tax treatment" selectedKey={header.taxTreatment} onSelectionChange={(value) => set("taxTreatment")(String(value))}
            options={data.taxTreatments.map((entry) => ({ value: entry.code, label: entry.label }))} />
          <div onBlur={() => void checkDuplicate()}>
            <TextField label={header.origin === "supplier_credit_note" ? "Supplier credit note number" : "Supplier credit note number (if any)"} value={header.supplierCreditNoteNumber}
              onChange={set("supplierCreditNoteNumber")} />
          </div>
          <TextField label="Supplier credit note date" type="date" value={header.supplierCreditNoteDate} onChange={set("supplierCreditNoteDate")} />
          {(header.origin === "accepted_claim" || data.claims.length > 0) && (
            <Select label={header.origin === "accepted_claim" ? "Accepted debit claim" : "Resolves debit claim (optional)"} selectedKey={header.debitClaimId || "none"}
              onSelectionChange={(value) => set("debitClaimId")(value === "none" ? "" : String(value))}
              options={[...(header.origin === "accepted_claim" ? [] : [{ value: "none", label: "None" }]),
                ...data.claims.map((entry) => ({ value: entry.id, label: `${entry.number} — ${entry.remaining} of ${entry.accepted} to credit` }))]} />
          )}
          <TextField label="Credit date" type="date" value={header.creditDate} onChange={set("creditDate")} />
          <TextField label="Posting date" type="date" value={header.postingDate} onChange={set("postingDate")} />
        </div>
        {duplicate && <Notice tone="warning">Supplier credit note {header.supplierCreditNoteNumber}: {duplicate}</Notice>}
        <TextArea label="Reason" value={header.reason} onChange={set("reason")} />
        {header.origin === "other_authorized" && <TextArea label="Documented basis for this credit (required — e.g. the rebate agreement)" value={header.authorizationReason} onChange={set("authorizationReason")} />}
      </Panel>
      <Panel title="What is credited" description="Lines of the supplier's posted bills (several bills of one company and currency may share a credit), the billed part of posted returns, or an amount on account."
        actions={
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Add a bill line" size="compact" selectedKey={null} placeholder="Add bill line…" isDisabled={!supplierId}
              onSelectionChange={(value) => { const line = billLines.find((entry) => entry.id === value); if (line) setRows((current) => [...current, { key: nextKey(), kind: "bill", billLineId: line.id,
                purchaseReturnLineId: null, label: `${line.bill.number} / line ${line.sequence}`, hint: `${line.description} · open ${quantity(line.openQuantity)} / ${line.openTaxable}`, basis: "quantity",
                quantity: "", amount: "", taxAmount: "", reason: "damaged_goods", description: "" }]); }}
              options={billLines.filter((line) => !line.reverseCharge && Number(line.openTaxable) > 0).map((line) => ({ value: line.id,
                label: `${line.bill.number} / ${line.sequence} · ${line.description} (open ${quantity(line.openQuantity)} · ${line.openTaxable})` }))} />
            <Select aria-label="Add a returned line" size="compact" selectedKey={null} placeholder="Add returned line…" isDisabled={!supplierId || !returnLines.length}
              onSelectionChange={(value) => { const line = returnLines.find((entry) => entry.lineId === value); if (line) setRows((current) => [...current, { key: nextKey(), kind: "return", billLineId: null,
                purchaseReturnLineId: line.lineId, label: `${line.ret.number} / line ${line.lineNumber}`, hint: `${line.description} · billed ${quantity(line.billed)}, open ${quantity(line.open)}`,
                basis: "quantity", quantity: line.open, amount: "", taxAmount: "", reason: "returned_goods", description: "" }]); }}
              options={returnLines.filter((line) => Number(line.open) > 0).map((line) => ({ value: line.lineId, label: `${line.ret.number} / ${line.lineNumber} · ${line.description} (open ${quantity(line.open)})` }))} />
            <Button size="compact" variant="secondary" isDisabled={!supplierId} onPress={() => setRows((current) => [...current, { key: nextKey(), kind: "other", billLineId: null, purchaseReturnLineId: null,
              label: "On account", hint: "", basis: "amount", quantity: "", amount: "", taxAmount: "", reason: "commercial_settlement", description: "" }])}>Add on-account line</Button>
          </div>
        }>
        {claimLines && <Notice tone="info">No lines: the credit takes the accepted debit claim&apos;s lines, scaled to what is still to be credited.</Notice>}
        {!rows.length ? (!claimLines && <p className="text-sm text-text-muted">{supplierId ? "Add what the supplier credited." : "Choose the supplier first."}</p>) : (
          <div className="flex flex-col divide-y divide-border">
            {rows.map((row) => (
              <div key={row.key} className="grid grid-cols-1 gap-2 py-3 md:grid-cols-12 md:items-end">
                <div className="md:col-span-3 text-sm"><span className="font-medium">{row.label}</span>{row.hint && <span className="block text-xs text-text-muted">{row.hint}</span>}</div>
                <div className="md:col-span-2"><Select label="Reason" selectedKey={row.reason} onSelectionChange={(value) => setRow(row.key, { reason: String(value) })} options={reasons} /></div>
                {row.kind === "bill" && <div className="md:col-span-2"><Select label="Basis" selectedKey={row.basis} onSelectionChange={(value) => setRow(row.key, { basis: value === "amount" ? "amount" : "quantity" })}
                  options={[{ value: "quantity", label: "Quantity" }, { value: "amount", label: "Value (amount)" }]} /></div>}
                {row.kind === "other" && <div className="md:col-span-2"><TextField label="Description" value={row.description} onChange={(value) => setRow(row.key, { description: value })} /></div>}
                {row.basis === "quantity"
                  ? <div className={row.kind === "return" ? "md:col-span-4" : "md:col-span-2"}><TextField label="Quantity" inputMode="decimal" value={row.quantity} onChange={(value) => setRow(row.key, { quantity: value })} /></div>
                  : <div className="md:col-span-2"><TextField label="Taxable amount" inputMode="decimal" value={row.amount} onChange={(value) => setRow(row.key, { amount: value })} /></div>}
                {row.kind === "other" && header.taxTreatment === "gst_adjusting" && <div className="md:col-span-2"><TextField label="Tax" inputMode="decimal" value={row.taxAmount} onChange={(value) => setRow(row.key, { taxAmount: value })} /></div>}
                <div className="md:col-span-1 flex justify-end"><Button size="compact" variant="ghost" aria-label="Remove line" onPress={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}>
                  <Trash2 className="size-4" aria-hidden="true" /></Button></div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Taxes and totals" description="Calculated by the server: GST components proportional to the bill lines (none for a financial-only credit); TDS follows the credited value."
        actions={<Button size="compact" variant="secondary" isLoading={calculate.isPending} isDisabled={!supplierId || (!rows.length && !claimLines)} onPress={() => calculate.mutate()}>Calculate</Button>}>
        <Errors error={calculate.error} />
        {preview ? (
          <>
            {preview.warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
            <ul className="flex flex-col divide-y divide-border text-sm">
              {preview.lines.map((line, index) => <li key={index} className="flex flex-wrap justify-between gap-2 py-2"><span>{line.description}{line.billNumber ? ` · ${line.billNumber}` : ""}
                <span className="block text-xs text-text-muted">{line.components.map((component) => `${component.label} ${Number(component.rate)}%: ${component.amount}`).join(" · ") || "No tax"}</span></span>
                <span className="tabular-nums">{money(preview.currencyCode, line.taxable)} + {money(preview.currencyCode, line.tax)}</span></li>)}
            </ul>
            <Facts columns={4} items={[{ label: "Taxable", value: money(preview.currencyCode, preview.totals.taxable) }, { label: "Tax", value: money(preview.currencyCode, preview.totals.tax) },
              { label: "TDS", value: money(preview.currencyCode, preview.totals.withholding) }, { label: "Credit total", value: <span className="font-semibold">{money(preview.currencyCode, preview.totals.total)}</span> }]} />
          </>
        ) : <p className="text-sm text-text-muted">Calculate to see the credit&apos;s taxes and total.</p>}
      </Panel>
      <Panel title="Notes"><TextArea aria-label="Notes" value={header.notes} onChange={set("notes")} /></Panel>
      <div className="flex flex-wrap justify-end gap-2">
        <LinkButton variant="secondary" href={existing ? `/procurement/debit-notes-credits/vendor-credits/${existing.credit.id}` : "/procurement/debit-notes-credits"}>Cancel</LinkButton>
        <Button variant="secondary" isLoading={save.isPending && save.variables === false} isDisabled={!supplierId || (!rows.length && !claimLines)} onPress={() => save.mutate(false)}>Save Draft</Button>
        {data.permissions.post && <Button variant="primary" isLoading={save.isPending && save.variables === true} isDisabled={!supplierId || (!rows.length && !claimLines)} onPress={() => save.mutate(true)}>Save &amp; Post</Button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- detail

type DialogName = "post" | "cancel" | "reverse" | "allocate" | "unapply" | "refund";

export function VendorCreditDetailScreen({ creditId }: { creditId: string }) {
  const [tab, setTab] = useTabParam(["overview","lines","sources","taxes","settlement","accounting","documents","notes","history"], "overview");
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "vendor-credit", creditId), queryFn: () => getCredit(creditId) });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "credit-options"), queryFn: () => getCreditOptions(), staleTime: 60_000 });
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [refundToReverse, setRefundToReverse] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const approve = useMutation({ mutationFn: () => creditAction(creditId, "approve"), onSuccess: () => changed("Approved and posted.") });
  function changed(message: string) { setDialog(null); setRefundToReverse(null); setNotice(message); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") }); }
  if (query.isLoading) return <LoadingState label="Loading vendor credit" />;
  if (!query.data) return <ErrorState title="Could not load this vendor credit" description={errorMessage(query.error)} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  const detail = query.data;
  const { credit, actions } = detail;
  const c = (value: string | null | undefined) => money(credit.currencyCode, value);
  return (
    <div className="flex flex-col gap-4">
      {notice && <Notice tone="success">{notice}</Notice>}
      <Errors error={approve.error} />
      {credit.status === "reversed" && <Notice tone="warning">Reversed{credit.reversalReason ? `: ${credit.reversalReason}` : ""}. Its bills, returns and debit claim can be credited again.</Notice>}
      {credit.status === "cancelled" && <Notice tone="info">Cancelled{credit.cancelReason ? `: ${credit.cancelReason}` : ""}.</Notice>}
      {credit.status === "posted" && credit.settlementStatus === "unapplied" && <Notice tone="info">Posted and unapplied: apply it to the supplier&apos;s open bills, or record the supplier&apos;s refund.</Notice>}
      <RecordDetailsPage header={{
        title: credit.number,
        status: <span className="flex flex-wrap gap-2"><StatusBadge tone={CREDIT_TONE[credit.status] ?? "neutral"}>{credit.statusLabel}</StatusBadge>
          {credit.settlementStatus !== "not_applicable" && <StatusBadge tone={SETTLEMENT_TONE[credit.settlementStatus] ?? "neutral"}>{credit.settlementLabel}</StatusBadge>}</span>,
        fields: [
          { label: "Supplier", value: credit.supplierName ?? "—" },
          { label: "Origin", value: credit.originLabel },
          { label: "Credit total", value: <span className="font-semibold">{c(credit.total)}</span> },
          { label: "Unapplied", value: c(credit.available) },
        ],
        primaryAction: actions.post ? <Button variant="primary" onPress={() => setDialog("post")}>Post</Button>
          : actions.approve ? <Button variant="primary" isLoading={approve.isPending} onPress={() => approve.mutate()}>Approve &amp; Post</Button>
            : actions.allocate ? <Button variant="primary" onPress={() => setDialog("allocate")}>Apply to Bills</Button> : undefined,
        secondaryActions: (
          <div className="flex flex-wrap gap-2">
            {actions.edit && <LinkButton variant="secondary" href={`/procurement/debit-notes-credits/vendor-credits/${credit.id}/edit`}><Pencil className="size-4" aria-hidden="true" />Edit</LinkButton>}
            {actions.refund && <Button variant="ghost" onPress={() => setDialog("refund")}>Record Supplier Refund</Button>}
            {actions.unapply && <Button variant="ghost" onPress={() => setDialog("unapply")}>Unapply</Button>}
            {actions.cancel && <Button variant="ghost" onPress={() => setDialog("cancel")}>Cancel Draft</Button>}
            {actions.reverse && <Button variant="ghost" onPress={() => setDialog("reverse")}>Reverse</Button>}
            <a className={buttonVariants({ variant: "ghost" })} href={creditVoucherUrl(credit.id, true)} target="_blank" rel="noreferrer"><Eye className="size-4" aria-hidden="true" />Voucher</a>
            <a className={buttonVariants({ variant: "ghost" })} href={creditVoucherUrl(credit.id)} download><Download className="size-4" aria-hidden="true" />PDF</a>
          </div>
        ),
      }}>
        <Tabs selectedKey={tab} onSelectionChange={(value) => setTab(String(value))}>
          <TabList aria-label="Vendor credit sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="lines">Credit Lines</Tab>
            <Tab id="sources">Original Bills &amp; Returns</Tab>
            <Tab id="taxes">Taxes &amp; Withholding</Tab>
            <Tab id="settlement">Allocations &amp; Refunds</Tab>
            <Tab id="accounting">Accounting</Tab>
            <Tab id="documents">Supplier Credit Note Attachment</Tab>
            <Tab id="notes">Notes &amp; Attachments</Tab>
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview">
            <div className="pt-4">
              <Panel title="Vendor credit">
                <Facts columns={3} items={[
                  { label: "Supplier", value: `${credit.supplier?.legalName ?? credit.supplierName ?? "—"}${credit.supplier?.gstin ? ` · ${credit.supplier.gstin}` : ""}` },
                  { label: "Origin", value: credit.originLabel },
                  { label: "Supplier credit note", value: [credit.supplierCreditNoteNumber, credit.supplierCreditNoteDate && calendarDate(credit.supplierCreditNoteDate)].filter(Boolean).join(" dated ") || "—" },
                  { label: "Debit claim", value: credit.claim ? <Link className="text-brand hover:underline" href={credit.claim.href}>{credit.claim.number}</Link> : "—" },
                  { label: "Credit date", value: calendarDate(credit.date) }, { label: "Posting date", value: calendarDate(credit.postingDate) },
                  { label: "Tax treatment", value: credit.taxTreatmentLabel }, { label: "Place of supply", value: credit.placeOfSupply ?? "—" },
                  { label: "Posted", value: credit.postedAt ? dateTime(credit.postedAt) : "Not posted" },
                  { label: "Taxable", value: c(credit.taxable) }, { label: "Tax", value: c(credit.tax) }, { label: "TDS adjusted", value: c(credit.withholding) },
                  { label: "Applied to bills", value: c(credit.applied) }, { label: "Refunded", value: c(credit.refunded) }, { label: "Unapplied", value: c(credit.available) },
                  { label: "Reason", value: credit.reason ?? "—" },
                ]} />
              </Panel>
            </div>
          </TabPanel>
          <TabPanel id="lines">
            <div className="pt-4">
              <Panel title="Credit lines">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-text-muted">{["Description", "Source", "Reason", "Quantity", "Taxable", "Tax", "TDS", "Total"].map((name, index) =>
                      <th key={name} className={index >= 3 ? "py-1 pr-3 text-right font-normal" : "py-1 pr-3 font-normal"}>{name}</th>)}</tr></thead>
                    <tbody className="divide-y divide-border">
                      {detail.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="py-2 pr-3">{line.description}{line.hsnSac && <span className="block text-xs text-text-muted">HSN/SAC {line.hsnSac}</span>}</td>
                          <td className="py-2 pr-3">{line.billId ? <Link className="text-brand hover:underline" href={`/procurement/supplier-bills/${line.billId}`}>{line.billNumber} / {line.billLineSequence}</Link> : "On account"}
                            {line.returnId && <span className="block text-xs"><Link className="text-brand hover:underline" href={`/procurement/purchase-returns/${line.returnId}`}>{line.returnNumber} / {line.returnLineNumber}</Link></span>}</td>
                          <td className="py-2 pr-3">{line.reasonLabel ?? "—"}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{line.basis === "quantity" ? `${quantity(line.quantity)}${line.billedQuantity ? ` of ${quantity(line.billedQuantity)}` : ""}` : "Value"}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{c(line.taxable)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{c(line.tax)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{c(line.withholding)}</td>
                          <td className="py-2 pr-3 text-right font-medium tabular-nums">{c(line.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          </TabPanel>
          <TabPanel id="sources">
            <div className="flex flex-col gap-4 pt-4">
              <Panel title="Bills corrected" description="The bills stay as posted; the credit corrects them.">
                {!detail.sourceBills.length ? <p className="text-sm text-text-muted">On account — no bill.</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.sourceBills.map((bill) => <li key={bill.id} className="flex flex-wrap justify-between gap-2 py-2"><span><Link className="text-brand hover:underline" href={bill.href}>{bill.number}</Link>
                      {bill.supplierInvoice ? ` (${bill.supplierInvoice})` : ""} · {calendarDate(bill.date)} · {statusLabel(bill.status)}</span>
                      <span className="tabular-nums">credited here {c(bill.creditedHere)} · bill {c(bill.total)} · outstanding {c(bill.outstanding)}</span></li>)}
                  </ul>
                )}
              </Panel>
              <Panel title="Purchase returns">
                {!detail.sourceReturns.length ? <p className="text-sm text-text-muted">None.</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.sourceReturns.map((entry) => <li key={entry.id} className="py-2"><Link className="text-brand hover:underline" href={entry.href}>{entry.number}</Link> · {calendarDate(entry.date)} · {quantity(entry.quantity)} credited</li>)}
                  </ul>
                )}
              </Panel>
            </div>
          </TabPanel>
          <TabPanel id="taxes">
            <div className="pt-4">
              <Panel title="Taxes and withholding" description={credit.taxTreatment === "financial_only" ? "A financial-only credit: no GST is adjusted." : "GST components reduced in proportion to the credited value of each bill line."}>
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {detail.lines.map((line) => <li key={line.id} className="py-2"><span className="font-medium">{line.description}</span>
                    <span className="block text-xs text-text-muted">{line.components.map((component) => `${component.label} ${Number(component.rate)}% on ${component.taxable}: ${component.amount}`).join(" · ") || "No tax components"}
                      {Number(line.withholding) > 0 ? ` · TDS ${line.withholding}` : ""}</span></li>)}
                </ul>
                <Facts columns={3} items={[{ label: "Tax", value: c(credit.tax) }, { label: "TDS adjusted", value: c(credit.withholding) }, { label: "Credit total", value: c(credit.total) }]} />
              </Panel>
            </div>
          </TabPanel>
          <TabPanel id="settlement">
            <div className="flex flex-col gap-4 pt-4">
              <Panel title="Applied to bills">
                {!detail.allocations.length ? <p className="text-sm text-text-muted">Not applied.</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.allocations.map((entry) => <li key={entry.billId} className="flex flex-wrap justify-between gap-2 py-2"><span><Link className="text-brand hover:underline" href={entry.href}>{entry.billNumber}</Link>
                      {entry.supplierInvoice ? ` (${entry.supplierInvoice})` : ""} · {dateTime(entry.at)}</span><span className="tabular-nums">{c(entry.amount)}</span></li>)}
                  </ul>
                )}
              </Panel>
              <Panel title="Supplier refunds">
                {!detail.refunds.length ? <p className="text-sm text-text-muted">No refunds.</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.refunds.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><span className="font-medium tabular-nums">{entry.refundNumber}</span> · {calendarDate(entry.date)}
                      {entry.bankName ? ` · ${entry.bankName}` : ""} · {entry.reference}{entry.status === "reversed" ? ` · reversed: ${entry.reversalReason ?? ""}` : ""}</span>
                      <span className="flex items-center gap-2 tabular-nums">{c(entry.amount)}
                        {entry.status === "posted" && actions.reverseRefund && <Button size="compact" variant="ghost" onPress={() => setRefundToReverse(entry.id)}>Reverse</Button>}</span></li>)}
                  </ul>
                )}
              </Panel>
            </div>
          </TabPanel>
          <TabPanel id="accounting">
            <div className="flex flex-col gap-4 pt-4">
              {[["Posting", detail.accounting.journal], ["Reversal", detail.accounting.reversal]].map(([title, journal]) => journal && typeof journal === "object" ? (
                <Panel key={String(title)} title={`${title} · ${journal.number}`} description={`${statusLabel(journal.status)} · ${calendarDate(journal.date)}`}>
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {journal.lines.map((line, index) => <li key={index} className="flex flex-wrap justify-between gap-2 py-2"><span>{line.account}<span className="block text-xs text-text-muted">{line.description}</span></span>
                      <span className="tabular-nums">{Number(line.debit) > 0 ? `Dr ${line.debit}` : `Cr ${line.credit}`}</span></li>)}
                  </ul>
                </Panel>
              ) : null)}
              {!detail.accounting.journal && <p className="text-sm text-text-muted">Nothing posted yet: a draft has no accounting.</p>}
            </div>
          </TabPanel>
          <TabPanel id="documents"><div className="pt-4"><CreditFiles creditId={credit.id} canEdit={actions.edit || actions.allocate || actions.post} /></div></TabPanel>
          <TabPanel id="notes">
            <div className="flex flex-col gap-4 pt-4">
              <Panel title="Notes">{credit.notes ? <p className="whitespace-pre-wrap text-sm">{credit.notes}</p> : <p className="text-sm text-text-muted">No notes.</p>}</Panel>
              {credit.authorizationReason && <Panel title="Authorised basis" description="Why this credit was recognised without a supplier credit note or an accepted debit claim."><p className="text-sm">{credit.authorizationReason}</p></Panel>}
            </div>
          </TabPanel>
          <TabPanel id="history">
            <div className="pt-4">
              <Panel title="History">
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {detail.history.map((entry, index) => <li key={index} className="py-2">{statusLabel(entry.type.replace(/^accounting\./, "").replace(/\./g, "_"))}{entry.to ? ` → ${statusLabel(entry.to)}` : ""}
                    <span className="block text-xs text-text-muted">{dateTime(entry.at)}{entry.actor ? ` · ${entry.actor}` : ""}</span></li>)}
                </ul>
              </Panel>
            </div>
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>
      {dialog === "post" && <PostDialog creditId={credit.id} total={c(credit.total)} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "cancel" && <ReasonDialog title="Cancel the draft credit" label="Cancel draft" run={(reason) => creditAction(credit.id, "cancel", { reason })} onClose={() => setDialog(null)} onDone={() => changed("Draft cancelled.")} />}
      {dialog === "reverse" && <ReasonDialog title="Reverse the vendor credit" description="Its journals and tax entries are reversed; applications are taken off the bills (they are owed again). Not while a supplier refund stands."
        label="Reverse" run={(reason) => creditAction(credit.id, "reverse", { reason })} onClose={() => setDialog(null)} onDone={() => changed("Reversed.")} />}
      {dialog === "unapply" && <ReasonDialog title="Take the credit off its bills" description="Every bill it was applied to is owed again; the credit is available again."
        label="Unapply" run={(reason) => creditAction(credit.id, "unapply", { reason })} onClose={() => setDialog(null)} onDone={() => changed("Unapplied.")} />}
      {dialog === "allocate" && <AllocateDialog detail={detail} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "refund" && <RefundDialog detail={detail} options={options.data ?? null} onClose={() => setDialog(null)} onDone={changed} />}
      {refundToReverse && <ReasonDialog title="Reverse the refund" description="The refund's entry is reversed and the credit gets the amount back." label="Reverse refund"
        run={(reason) => reverseRefund(refundToReverse, reason)} onClose={() => setRefundToReverse(null)} onDone={() => changed("Refund reversed.")} />}
    </div>
  );
}

function PostDialog({ creditId, total, onClose, onDone }: { creditId: string; total: string; onClose: () => void; onDone: (message: string) => void }) {
  const check = useQuery({ queryKey: ["vendor-credit-validate", creditId], queryFn: () => creditAction(creditId, "validate") });
  const mutation = useMutation({ mutationFn: () => creditAction(creditId, "post"),
    onSuccess: (result) => onDone(result.status === "awaiting_approval" ? "Submitted for Finance's approval." : "Posted: the payable is reduced. Apply it to bills or record the supplier's refund.") });
  const issues = (check.data?.issues as Array<{ message: string }> | undefined) ?? [];
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Post the vendor credit" description={`${total} is posted through Finance (Dr Accounts Payable). It is not applied to any bill by itself.`} size="md">
      <div className="flex flex-col gap-3">
        <Errors error={mutation.error ?? check.error} />
        {issues.length > 0 && <Notice>{issues.map((issue) => <p key={issue.message}>{issue.message}</p>)}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Back</Button>
          <Button variant="primary" isLoading={mutation.isPending || check.isLoading} isDisabled={issues.length > 0} onPress={() => mutation.mutate()}>Post</Button>
        </div>
      </div>
    </Dialog>
  );
}

function ReasonDialog({ title, description, label, run, onClose, onDone }: { title: string; description?: string; label: string; run: (reason: string) => Promise<unknown>; onClose: () => void;
  onDone: () => void }) {
  const [reason, setReason] = useState("");
  const mutation = useMutation({ mutationFn: () => run(reason), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title} description={description} size="md">
      <div className="flex flex-col gap-3">
        <Errors error={mutation.error} />
        <TextArea label="Reason" value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Back</Button>
          <Button variant="primary" isLoading={mutation.isPending} isDisabled={reason.trim().length < 3} onPress={() => mutation.mutate()}>{label}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function AllocateDialog({ detail, onClose, onDone }: { detail: CreditDetail; onClose: () => void; onDone: (message: string) => void }) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [key] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: () => creditAction(detail.credit.id, "allocate", { idempotencyKey: key,
      allocations: Object.entries(amounts).filter(([, amount]) => Number(amount) > 0).map(([billId, amount]) => ({ billId, amount })) }),
    onSuccess: (result) => onDone(`Applied ${String(result.applied ?? "")}. ${result.settlementStatus === "fully_settled" ? "The credit is fully settled." : `${String(result.available ?? "")} left.`}`),
  });
  const total = Object.values(amounts).reduce((sum, amount) => sum + (Number(amount) || 0), 0);
  const c = (value: string | number) => money(detail.credit.currencyCode, value);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Apply the credit to bills" description={`${c(detail.credit.available)} available. Open bills of the same supplier, company and currency.`} size="lg">
      <div className="flex flex-col gap-3">
        <Errors error={mutation.error} />
        <ul className="flex flex-col divide-y divide-border text-sm">
          {detail.openBills.map((bill) => (
            <li key={bill.id} className="grid grid-cols-1 items-end gap-2 py-2 sm:grid-cols-3">
              <span className="sm:col-span-2"><span className="font-medium">{bill.number}</span>{bill.supplierInvoice ? ` (${bill.supplierInvoice})` : ""}
                <span className="block text-xs text-text-muted">{calendarDate(bill.date)}{bill.dueDate ? ` · due ${calendarDate(bill.dueDate)}` : ""} · outstanding {c(bill.outstanding)}</span></span>
              <TextField aria-label={`Amount for ${bill.number}`} inputMode="decimal" value={amounts[bill.id] ?? ""} onChange={(value) => setAmounts((current) => ({ ...current, [bill.id]: value }))} />
            </li>
          ))}
        </ul>
        <p className="text-sm">Applying {c(total)} of {c(detail.credit.available)}.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Back</Button>
          <Button variant="primary" isLoading={mutation.isPending} isDisabled={total <= 0 || total > Number(detail.credit.available)} onPress={() => mutation.mutate()}>Apply</Button>
        </div>
      </div>
    </Dialog>
  );
}

function RefundDialog({ detail, options, onClose, onDone }: { detail: CreditDetail; options: CreditOptions | null; onClose: () => void; onDone: (message: string) => void }) {
  const [values, setValues] = useState({ amount: detail.credit.available, refundDate: "", bankAccountId: "", reference: "" });
  const [key] = useState(() => crypto.randomUUID());
  const mutation = useMutation({ mutationFn: () => creditAction(detail.credit.id, "refunds", { ...values, bankAccountId: values.bankAccountId || undefined, idempotencyKey: key }),
    onSuccess: (result) => onDone(`Refund ${String(result.refundNumber ?? "")} recorded.`) });
  const set = (name: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [name]: value }));
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Record the supplier's refund" description={`Money the supplier paid back (Dr bank, Cr Accounts Payable). Up to ${money(detail.credit.currencyCode, detail.credit.available)}.`} size="lg">
      <div className="flex flex-col gap-3">
        <Errors error={mutation.error} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Amount" inputMode="decimal" value={values.amount} onChange={set("amount")} />
          <TextField label="Received on" type="date" value={values.refundDate} onChange={set("refundDate")} />
          <Select label="Bank account" selectedKey={values.bankAccountId || "default"} onSelectionChange={(value) => set("bankAccountId")(value === "default" ? "" : String(value))}
            options={[{ value: "default", label: "Default bank account" }, ...(options?.bankAccounts ?? []).map((account) => ({ value: account.id, label: account.name }))]} />
          <TextField label="Bank reference (UTR / cheque)" value={values.reference} onChange={set("reference")} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Back</Button>
          <Button variant="primary" isLoading={mutation.isPending} isDisabled={!values.amount || !values.reference.trim()} onPress={() => mutation.mutate()}>Record refund</Button>
        </div>
      </div>
    </Dialog>
  );
}

function CreditFiles({ creditId, canEdit }: { creditId: string; canEdit: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const key = scopedQueryKey(workspace, "procurement", "credit-files", creditId);
  const files = useQuery({ queryKey: key, queryFn: () => listBillFiles(creditId) });
  const upload = useMutation({ mutationFn: (file: File) => uploadBillFile(creditId, file), onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }) });
  const remove = useMutation({ mutationFn: (fileId: string) => removeBillFile(creditId, fileId), onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }) });
  return (
    <Panel title="Supplier documents" description="The supplier's credit note (the tax document), correspondence and the agreement behind the credit."
      actions={canEdit ? <Button size="compact" variant="secondary" isLoading={upload.isPending} onPress={() => input.current?.click()}>Add file</Button> : undefined}>
      <input ref={input} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
      <Errors error={upload.error ?? files.error} />
      {!files.data?.length ? <p className="text-sm text-text-muted">No files.</p> : (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {files.data.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <a className="text-brand hover:underline" href={billFileUrl(creditId, file.id)}>{file.fileName}</a>
              <span className="flex items-center gap-3 text-text-muted">{dateTime(file.uploadedAt)}
                {canEdit && <Button size="compact" variant="ghost" onPress={() => remove.mutate(file.id)}>Remove</Button>}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
