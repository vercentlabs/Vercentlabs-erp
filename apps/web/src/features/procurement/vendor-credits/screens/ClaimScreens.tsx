"use client";

// Debit notes to suppliers: the claim form (draft, issue) and the claim's detail — its lines, the supplier's responses, the credits that
// resolve it and its history. A claim changes nothing in Accounts Payable; the supplier's credit, recorded as a vendor credit, does.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Eye, Pencil, Trash2 } from "lucide-react";
import {
  Button, Dialog, ErrorState, LinkButton, PageHeader, RecordDetailsPage, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea, TextField, buttonVariants,
} from "@vercentlabs/design-system";

import { useTabParam, useFormChangesWarning } from "@/features/procurement/shared/navigation";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { ProcAlert, ProcFacts, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { calendarDate, dateTime, money, quantity, statusLabel } from "@/features/procurement/shared/format";
import { getBill } from "@/features/procurement/supplier-bills/api/supplier-bills-api";

import {
  claimAction, claimPdfUrl, createClaim, errorMessage, getClaim, getCreditOptions, issuesOf, updateClaim, type ClaimDetail,
} from "../api/vendor-credits-api";
import { CLAIM_TONE, CREDIT_TONE } from "./DebitNotesCreditsScreens";

type Row = { key: string; billLineId: string | null; label: string; basis: "amount" | "quantity"; quantity: string; unitValue: string; amount: string; taxAmount: string; reason: string;
  description: string };
let seq = 0;
const nextKey = () => `row-${(seq += 1)}`;

function Errors({ error }: { error: unknown }) {
  if (!error) return null;
  const issues = issuesOf(error);
  return <ProcAlert>{errorMessage(error)}{issues.length > 1 && <ul className="mt-1 list-disc pl-5">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</ProcAlert>;
}

// ---------------------------------------------------------------- form

export function ClaimFormScreen({ claimId, billId, supplierId }: { claimId?: string; billId?: string; supplierId?: string }) {
  const workspace = useWorkspaceContext();
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "debit-claim", claimId), queryFn: () => getClaim(claimId!), enabled: Boolean(claimId) });
  const bill = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier-bill", billId), queryFn: () => getBill(billId!), enabled: Boolean(billId) && !supplierId });
  if (existing.isLoading || bill.isLoading) return <LoadingState label="Loading debit claim" />;
  if (claimId && !existing.data) return <ErrorState title="Could not load the debit claim" description={errorMessage(existing.error)} />;
  if (existing.data && existing.data.claim.status !== "draft") return <ErrorState title="This debit claim cannot be edited" description="Only a draft is edited; an issued one is answered by the supplier or closed." />;
  return <ClaimForm existing={existing.data ?? null} presetSupplierId={existing.data?.claim.supplierId ?? supplierId ?? bill.data?.bill.supplierId ?? null} presetBillId={billId ?? null} />;
}

function ClaimForm({ existing, presetSupplierId, presetBillId }: { existing: ClaimDetail | null; presetSupplierId: string | null; presetBillId: string | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [supplierId, setSupplierId] = useState<string | null>(presetSupplierId);
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "credit-options", supplierId), queryFn: () => getCreditOptions(supplierId) });
  const [header, setHeader] = useState({ reason: existing?.claim.reason ?? "", issueDate: existing?.claim.issueDate ?? "", supplierReference: existing?.claim.supplierReference ?? "",
    notes: existing?.claim.notes ?? "" });
  const [rows, setRows] = useState<Row[]>(() => (existing?.lines ?? []).map((line) => ({ key: nextKey(), billLineId: line.billLineId,
    label: line.billNumber ? `${line.billNumber} / line ${line.billLineSequence}` : "Other", basis: line.basis, quantity: line.quantity ?? "", unitValue: line.unitValue ?? "",
    amount: line.amount, taxAmount: line.billLineId ? "" : line.taxAmount, reason: line.reason, description: line.description })));
  const [seeded, setSeeded] = useState(false);
  const billLines = useMemo(() => (options.data?.bills ?? []).flatMap((entry) => entry.lines.map((line) => ({ ...line, bill: entry }))), [options.data]);
  if (!seeded && presetBillId && options.data && !existing) {
    const first = billLines.filter((line) => line.bill.id === presetBillId);
    if (first.length) setRows(first.map((line) => ({ key: nextKey(), billLineId: line.id, label: `${line.bill.number} / line ${line.sequence}`, basis: "amount", quantity: "", unitValue: "",
      amount: "", taxAmount: "", reason: "price_difference", description: line.description })));
    setSeeded(true);
  }
  useFormChangesWarning({ supplierId, header, rows }, Boolean(existing) || !presetBillId || seeded);
  const save = useMutation({
    mutationFn: async (issue: boolean) => {
      const body = { ...header, supplierId, lines: rows.map((row) => ({ billLineId: row.billLineId ?? undefined, basis: row.basis, quantity: row.basis === "quantity" ? row.quantity : undefined,
        unitValue: row.basis === "quantity" && row.unitValue ? row.unitValue : undefined, amount: row.basis === "amount" ? row.amount : undefined,
        taxAmount: row.billLineId ? undefined : row.taxAmount || "0", reason: row.reason, description: row.description || undefined })) };
      if (existing) {
        await updateClaim(existing.claim.id, { ...body, expectedVersion: existing.claim.version });
        if (issue) await claimAction(existing.claim.id, "issue");
        return existing.claim.id;
      }
      return (await createClaim({ ...body, issue })).id;
    },
    onSuccess: (id) => router.push(`/procurement/debit-notes-credits/claims/${id}`),
  });
  if (options.isLoading && !options.data) return <LoadingState label="Loading" />;
  if (!options.data) return <ErrorState title="Could not load the form" description={errorMessage(options.error)} />;
  const set = (key: keyof typeof header) => (value: string) => setHeader((current) => ({ ...current, [key]: value }));
  const setRow = (key: string, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const reasons = options.data.reasons.map((reason) => ({ value: reason.code, label: reason.label }));
  return (
    <div className="flex flex-col gap-4">
      <Link href="/procurement/debit-notes-credits" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"><ArrowLeft className="size-3.5" aria-hidden="true" />Debit Notes &amp; Vendor Credits</Link>
      <PageHeader title={existing ? `Edit ${existing.claim.claimNumber}` : "New Debit Claim to Supplier"}
        description="A documented claim to the supplier. It is not a credit: nothing changes in Accounts Payable or tax until the supplier's credit is recorded." />
      <Errors error={save.error} />
      <ProcPanel title="Claim">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Select label="Supplier" isDisabled={Boolean(existing)} selectedKey={supplierId} onSelectionChange={(value) => { setSupplierId(String(value)); setRows([]); }}
            options={options.data.suppliers.map((supplier) => ({ value: supplier.id, label: `${supplier.name} (${supplier.number})` }))} />
          <TextField label="Issue date" type="date" value={header.issueDate} onChange={set("issueDate")} />
          <TextField label="Supplier reference (if any)" value={header.supplierReference} onChange={set("supplierReference")} />
        </div>
        <TextArea label="Reason for the claim" value={header.reason} onChange={set("reason")} />
      </ProcPanel>
      <ProcPanel title="What is claimed" description="An amount (or a quantity at a unit value) on a posted bill line, or another claim with no bill. Tax on bill lines is estimated from the bill."
        actions={
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Add a bill line" size="compact" selectedKey={null} placeholder="Add bill line…" isDisabled={!supplierId}
              onSelectionChange={(value) => { const line = billLines.find((entry) => entry.id === value); if (line) setRows((current) => [...current, { key: nextKey(), billLineId: line.id,
                label: `${line.bill.number} / line ${line.sequence}`, basis: "amount", quantity: "", unitValue: "", amount: "", taxAmount: "", reason: "price_difference", description: line.description }]); }}
              options={billLines.filter((line) => !line.reverseCharge).map((line) => ({ value: line.id, label: `${line.bill.number} / ${line.sequence} · ${line.description} (taxable ${line.taxable})` }))} />
            <Button size="compact" variant="secondary" isDisabled={!supplierId} onPress={() => setRows((current) => [...current, { key: nextKey(), billLineId: null, label: "Other", basis: "amount",
              quantity: "", unitValue: "", amount: "", taxAmount: "", reason: "other", description: "" }])}>Add other line</Button>
          </div>
        }>
        {!rows.length ? <p className="text-sm text-text-muted">{supplierId ? "Add the bill lines (or other items) being claimed." : "Choose the supplier first."}</p> : (
          <div className="flex flex-col divide-y divide-border">
            {rows.map((row) => (
              <div key={row.key} className="grid grid-cols-1 gap-2 py-3 md:grid-cols-12 md:items-end">
                <div className="md:col-span-2 text-sm"><span className="font-medium">{row.label}</span></div>
                <div className="md:col-span-3"><TextField label="Description" value={row.description} onChange={(value) => setRow(row.key, { description: value })} /></div>
                <div className="md:col-span-2"><Select label="Reason" selectedKey={row.reason} onSelectionChange={(value) => setRow(row.key, { reason: String(value) })} options={reasons} /></div>
                {row.billLineId && <div className="md:col-span-1"><Select label="Basis" selectedKey={row.basis} onSelectionChange={(value) => setRow(row.key, { basis: value === "quantity" ? "quantity" : "amount" })}
                  options={[{ value: "amount", label: "Amount" }, { value: "quantity", label: "Quantity" }]} /></div>}
                {row.basis === "quantity" ? (
                  <>
                    <div className="md:col-span-1"><TextField label="Quantity" inputMode="decimal" value={row.quantity} onChange={(value) => setRow(row.key, { quantity: value })} /></div>
                    <div className="md:col-span-2"><TextField label="Unit value (blank: bill's)" inputMode="decimal" value={row.unitValue} onChange={(value) => setRow(row.key, { unitValue: value })} /></div>
                  </>
                ) : (
                  <>
                    <div className={row.billLineId ? "md:col-span-3" : "md:col-span-2"}><TextField label="Taxable amount" inputMode="decimal" value={row.amount} onChange={(value) => setRow(row.key, { amount: value })} /></div>
                    {!row.billLineId && <div className="md:col-span-2"><TextField label="Tax" inputMode="decimal" value={row.taxAmount} onChange={(value) => setRow(row.key, { taxAmount: value })} /></div>}
                  </>
                )}
                <div className="md:col-span-1 flex justify-end"><Button size="compact" variant="ghost" aria-label="Remove line" onPress={() => setRows((current) => current.filter((entry) => entry.key !== row.key))}>
                  <Trash2 className="size-4" aria-hidden="true" /></Button></div>
              </div>
            ))}
          </div>
        )}
      </ProcPanel>
      <ProcPanel title="Notes"><TextArea aria-label="Notes" value={header.notes} onChange={set("notes")} /></ProcPanel>
      <div className="flex flex-wrap justify-end gap-2">
        <LinkButton variant="secondary" href={existing ? `/procurement/debit-notes-credits/claims/${existing.claim.id}` : "/procurement/debit-notes-credits"}>Cancel</LinkButton>
        <Button variant="secondary" isLoading={save.isPending && save.variables === false} isDisabled={!supplierId || !rows.length} onPress={() => save.mutate(false)}>Save Draft</Button>
        <Button variant="primary" isLoading={save.isPending && save.variables === true} isDisabled={!supplierId || !rows.length} onPress={() => save.mutate(true)}>Save &amp; Issue</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- detail

type DialogName = "respond" | "close";

export function ClaimDetailScreen({ claimId }: { claimId: string }) {
  const [tab, setTab] = useTabParam(["overview","lines","sources","responses","credits","notes","history"], "overview");
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "debit-claim", claimId), queryFn: () => getClaim(claimId) });
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const issue = useMutation({ mutationFn: () => claimAction(claimId, "issue"), onSuccess: () => changed("Issued to the supplier.") });
  function changed(message: string) { setDialog(null); setNotice(message); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") }); }
  if (query.isLoading) return <LoadingState label="Loading debit claim" />;
  if (!query.data) return <ErrorState title="Could not load this debit claim" description={errorMessage(query.error)} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  const detail = query.data;
  const { claim, actions } = detail;
  const c = (value: string | null | undefined) => money(claim.currencyCode, value);
  return (
    <div className="flex flex-col gap-4">
      <Link href="/procurement/debit-notes-credits" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"><ArrowLeft className="size-3.5" aria-hidden="true" />Debit Notes &amp; Vendor Credits</Link>
      {notice && <ProcAlert tone="success">{notice}</ProcAlert>}
      <Errors error={issue.error} />
      {claim.status === "closed" && <ProcAlert tone="info">Closed {dateTime(claim.closedAt)}{claim.closeReason ? `: ${claim.closeReason}` : ""}.</ProcAlert>}
      <ProcAlert tone="info">A debit claim is a claim to the supplier. It changes nothing in Accounts Payable or tax; the supplier&apos;s credit, recorded as a vendor credit, does.</ProcAlert>
      <RecordDetailsPage header={{
        title: claim.claimNumber,
        status: <StatusBadge tone={CLAIM_TONE[claim.status] ?? "neutral"}>{claim.statusLabel}</StatusBadge>,
        fields: [
          { label: "Supplier", value: claim.supplierName ?? "—" },
          { label: "Claimed", value: c(claim.claimedAmount) },
          { label: "Accepted", value: c(claim.acceptedAmount) },
          { label: "Disputed", value: c(claim.disputedAmount) },
          { label: "Credited", value: c(claim.creditedAmount) },
        ],
        primaryAction: actions.issue ? <Button variant="primary" isLoading={issue.isPending} onPress={() => issue.mutate()}>Issue to Supplier</Button>
          : actions.respond ? <Button variant="primary" onPress={() => setDialog("respond")}>Record Supplier Response</Button>
            : actions.createCredit ? <LinkButton variant="primary" href={`/procurement/debit-notes-credits/vendor-credits/new?claimId=${claim.id}&supplierId=${claim.supplierId}`}>Record Vendor Credit</LinkButton> : undefined,
        secondaryActions: (
          <div className="flex flex-wrap gap-2">
            {actions.edit && <LinkButton variant="secondary" href={`/procurement/debit-notes-credits/claims/${claim.id}/edit`}><Pencil className="size-4" aria-hidden="true" />Edit</LinkButton>}
            {actions.respond && actions.createCredit && <LinkButton variant="secondary" href={`/procurement/debit-notes-credits/vendor-credits/new?claimId=${claim.id}&supplierId=${claim.supplierId}`}>Record Vendor Credit</LinkButton>}
            {actions.close && <Button variant="ghost" onPress={() => setDialog("close")}>Close</Button>}
            <a className={buttonVariants({ variant: "ghost" })} href={claimPdfUrl(claim.id, true)} target="_blank" rel="noreferrer"><Eye className="size-4" aria-hidden="true" />View</a>
            <a className={buttonVariants({ variant: "ghost" })} href={claimPdfUrl(claim.id)} download><Download className="size-4" aria-hidden="true" />PDF</a>
          </div>
        ),
      }}>
        <Tabs selectedKey={tab} onSelectionChange={(value) => setTab(String(value))}>
          <TabList aria-label="Debit claim sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="lines">Claimed Items &amp; Amounts</Tab>
            <Tab id="sources">Original Bills / Returns</Tab>
            <Tab id="responses">Supplier Response</Tab>
            <Tab id="credits">Linked Vendor Credits</Tab>
            <Tab id="notes">Notes &amp; Attachments</Tab>
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview">
            <div className="pt-4">
              <ProcPanel title="Claim">
                <ProcFacts columns={3} items={[
                  { label: "Supplier", value: `${claim.supplier?.legalName ?? claim.supplierName ?? "—"}${claim.supplier?.gstin ? ` · ${claim.supplier.gstin}` : ""}` },
                  { label: "Issue date", value: calendarDate(claim.issueDate) }, { label: "Issued", value: claim.issuedAt ? dateTime(claim.issuedAt) : "Not issued" },
                  { label: "Supplier reference", value: claim.supplierReference ?? "—" }, { label: "Currency", value: claim.currencyCode },
                  { label: "Still to credit", value: c(claim.remainingToCredit) },
                  ...(Number(claim.creditPending) > 0 ? [{ label: "In draft credits", value: c(claim.creditPending) }] : []),
                  { label: "Reason", value: claim.reason },
                ]} />
                {claim.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{claim.notes}</p>}
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="lines">
            <div className="pt-4">
              <ProcPanel title="Claim lines">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-text-muted">{["Description", "Bill / line", "Reason", "Quantity", "Amount", "Tax (est.)", "Total"].map((name, index) =>
                      <th key={name} className={index >= 3 ? "py-1 pr-3 text-right font-normal" : "py-1 pr-3 font-normal"}>{name}</th>)}</tr></thead>
                    <tbody className="divide-y divide-border">
                      {detail.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="py-2 pr-3">{line.description}</td>
                          <td className="py-2 pr-3">{line.billId ? <Link className="text-brand hover:underline" href={`/procurement/supplier-bills/${line.billId}`}>{line.billNumber} / {line.billLineSequence}</Link> : "—"}</td>
                          <td className="py-2 pr-3">{line.reasonLabel}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{line.basis === "quantity" ? `${quantity(line.quantity)} × ${line.unitValue}` : "—"}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{c(line.amount)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{c(line.taxAmount)}</td>
                          <td className="py-2 pr-3 text-right font-medium tabular-nums">{c(line.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="sources">
            <div className="pt-4">
              <ProcPanel title="Original bills and returns" description="The posted bills (and returned goods) the claim is about.">
                {!detail.lines.some((line) => line.billId || line.purchaseReturnLineId) ? <p className="text-sm text-text-muted">The claim is not tied to a bill.</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {[...new Map(detail.lines.filter((line) => line.billId).map((line) => [line.billId, line])).values()].map((line) => (
                      <li key={line.billId} className="py-2">Supplier bill <Link className="text-brand hover:underline" href={`/procurement/supplier-bills/${line.billId}`}>{line.billNumber}</Link></li>
                    ))}
                    {claim.purchaseReturnId && <li className="py-2">Purchase return <Link className="text-brand hover:underline" href={`/procurement/purchase-returns/${claim.purchaseReturnId}`}>open</Link></li>}
                  </ul>
                )}
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="notes">
            <div className="pt-4">
              <ProcPanel title="Notes">{claim.notes ? <p className="whitespace-pre-wrap text-sm">{claim.notes}</p> : <p className="text-sm text-text-muted">No notes.</p>}</ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="responses">
            <div className="pt-4">
              <ProcPanel title="Supplier responses" description="Each decision as recorded. A partial acceptance leaves the rest disputed.">
                {!detail.responses.length ? <p className="text-sm text-text-muted">{claim.status === "draft" ? "Issue the debit claim first." : "Awaiting the supplier."}</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.responses.map((entry) => (
                      <li key={entry.id} className="py-2"><span className="font-medium">{statusLabel(entry.decision)}</span> · accepted {c(entry.acceptedAmount)} · disputed {c(entry.disputedAmount)}
                        {entry.supplierReference ? ` · ${entry.supplierReference}` : ""}
                        <span className="block text-xs text-text-muted">{entry.notes ?? ""}{entry.respondedOn ? ` — responded ${calendarDate(entry.respondedOn)}` : ""} — recorded by {entry.recordedBy ?? "—"}, {dateTime(entry.recordedAt)}</span></li>
                    ))}
                  </ul>
                )}
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="credits">
            <div className="pt-4">
              <ProcPanel title="Vendor credits" description="The supplier's credits recorded against this claim. Posted credits covering the accepted amount resolve it.">
                {!detail.credits.length ? <p className="text-sm text-text-muted">None yet.</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.credits.map((entry) => <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2"><Link className="text-brand hover:underline" href={entry.href}>{entry.number}</Link>
                      <span className="flex items-center gap-2"><StatusBadge tone={CREDIT_TONE[entry.status === "pending_approval" ? "awaiting_approval" : ["partially_paid", "paid"].includes(entry.status) ? "posted" : entry.status] ?? "neutral"}>
                        {statusLabel(entry.status)}</StatusBadge><span className="tabular-nums">{c(entry.total)}</span></span></li>)}
                  </ul>
                )}
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="history">
            <div className="pt-4">
              <ProcPanel title="History">
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {detail.history.map((entry) => <li key={entry.id} className="py-2">{entry.summary}<span className="block text-xs text-text-muted">{dateTime(entry.at)}{entry.actor ? ` · ${entry.actor}` : ""}</span></li>)}
                </ul>
              </ProcPanel>
            </div>
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>
      {dialog === "respond" && <RespondDialog detail={detail} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "close" && <CloseDialog claimId={claim.id} onClose={() => setDialog(null)} onDone={changed} />}
    </div>
  );
}

function RespondDialog({ detail, onClose, onDone }: { detail: ClaimDetail; onClose: () => void; onDone: (message: string) => void }) {
  const [values, setValues] = useState({ decision: "accepted", acceptedAmount: "", supplierReference: "", respondedOn: "", notes: "" });
  const mutation = useMutation({ mutationFn: () => claimAction(detail.claim.id, "respond", values), onSuccess: () => onDone("Supplier response recorded.") });
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Record the supplier's response" description={`Claimed ${money(detail.claim.currencyCode, detail.claim.claimedAmount)}.`} size="lg">
      <div className="flex flex-col gap-3">
        <Errors error={mutation.error} />
        <Select label="Decision" selectedKey={values.decision} onSelectionChange={(value) => set("decision")(String(value))}
          options={[{ value: "accepted", label: "Accepted in full" }, { value: "partially_accepted", label: "Partly accepted (the rest disputed)" }, { value: "rejected", label: "Rejected" }]} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {values.decision === "partially_accepted" && <TextField label="Amount accepted" inputMode="decimal" value={values.acceptedAmount} onChange={set("acceptedAmount")} />}
          <TextField label="Supplier reference" value={values.supplierReference} onChange={set("supplierReference")} />
          <TextField label="Responded on" type="date" value={values.respondedOn} onChange={set("respondedOn")} />
        </div>
        <TextArea label={values.decision === "accepted" ? "Notes" : "What the supplier said (required)"} value={values.notes} onChange={set("notes")} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isLoading={mutation.isPending} isDisabled={values.decision !== "accepted" && values.notes.trim().length < 3} onPress={() => mutation.mutate()}>Record</Button>
        </div>
      </div>
    </Dialog>
  );
}

function CloseDialog({ claimId, onClose, onDone }: { claimId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const mutation = useMutation({ mutationFn: () => claimAction(claimId, "close", { reason }), onSuccess: () => onDone("Debit claim closed.") });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Close the debit claim" description="Nothing more will come of it: withdrawn, rejected for good, or the rest written off." size="md">
      <div className="flex flex-col gap-3">
        <Errors error={mutation.error} />
        <TextArea label="Reason" value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Back</Button>
          <Button variant="primary" isLoading={mutation.isPending} isDisabled={reason.trim().length < 3} onPress={() => mutation.mutate()}>Close debit claim</Button>
        </div>
      </div>
    </Dialog>
  );
}

