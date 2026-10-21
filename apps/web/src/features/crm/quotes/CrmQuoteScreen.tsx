"use client";

// One CRM quote (CRM audit M1): its lines with HSN/SAC and GST, the place of supply (CGST + SGST in the seller's state, IGST across
// states), validity, notes and terms — then Download PDF, Email (with the PDF), WhatsApp (the customer's link), and the customer's
// answer. A sent quote that is changed goes back to draft. With Sales on, "Move to Sales" turns it into a Sales quotation.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Download, Mail, MessageCircle, Plus, Trash2 } from "lucide-react";
import { Button, Dialog, ErrorState, IconButton, PageHeader, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { GST_STATES } from "@/features/crm/shared/gst-states";
import { formatDate, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  dealQuoteShareLink, emailDealQuote, getDealQuote, GST_RATES, QUOTE_STATUS, quoteErrorMessage, quotePdfUrl, setDealQuoteStatus, updateDealQuote, upgradeDealQuote,
  type CrmQuoteLine, type CrmQuoteView,
} from "./quotes-api";

const NO_STATE = "none";
const blankLine = (): CrmQuoteLine => ({ itemId: null, description: "", hsnSac: "", quantity: "1", unitPrice: "0", discountPercent: "0", gstRate: "18" });

// The amounts of one line as the server computes them (paise, rounded per line), so the totals shown while editing match the saved ones.
function lineAmounts(line: CrmQuoteLine, intra: boolean) {
  const gross = Math.round(Number(line.quantity) * Number(line.unitPrice) * 100);
  const taxable = Math.round(gross * (1 - Number(line.discountPercent || 0) / 100));
  const tax = Math.round((taxable * Number(line.gstRate || 0)) / 100);
  return { gross: gross / 100, taxable: taxable / 100, cgst: intra ? Math.floor(tax / 2) / 100 : 0, sgst: intra ? (tax - Math.floor(tax / 2)) / 100 : 0, igst: intra ? 0 : tax / 100 };
}

export function CrmQuoteScreen({ quoteId }: { quoteId: string }) {
  const workspace = useWorkspaceContext();
  const key = scopedQueryKey(workspace, "crm", "quote", quoteId);
  const query = useQuery({ queryKey: key, queryFn: () => getDealQuote(quoteId) });
  if (query.isLoading) return <LoadingState label="Loading the quote" rows={4} />;
  if (query.isError || !query.data) return <ErrorState title="This quote could not be opened" description={quoteErrorMessage(query.error)} />;
  return <QuoteEditor key={query.data.quote.updatedAt ?? query.data.quote.id} view={query.data} queryKey={key} />;
}

function QuoteEditor({ view, queryKey }: { view: CrmQuoteView & { quote: { updatedAt?: string } }; queryKey: readonly unknown[] }) {
  const queryClient = useQueryClient();
  const { quote } = view;
  const editable = view.capabilities.edit && (quote.status === "draft" || quote.status === "sent");
  const [lines, setLines] = useState<CrmQuoteLine[]>(view.lines.map((line) => ({ ...line, hsnSac: line.hsnSac ?? "" })));
  const [placeOfSupply, setPlaceOfSupply] = useState(quote.placeOfSupply ?? NO_STATE);
  const [validUntil, setValidUntil] = useState(quote.validUntil ?? "");
  const [notes, setNotes] = useState(quote.notes ?? "");
  const [terms, setTerms] = useState(quote.terms ?? "");
  const [emailing, setEmailing] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const done = (next: CrmQuoteView, text?: string) => { queryClient.setQueryData(queryKey, next); setMessage(text ? { tone: "success", text } : null); };
  const fail = (failure: unknown) => setMessage({ tone: "danger", text: quoteErrorMessage(failure) });
  const save = useMutation({
    mutationFn: () => updateDealQuote(quote.id, { lines, placeOfSupply: placeOfSupply === NO_STATE ? null : placeOfSupply, validUntil: validUntil || null, notes: notes || null, terms: terms || null }),
    onSuccess: (next) => done(next, "Saved."), onError: fail,
  });
  const status = useMutation({ mutationFn: (next: "sent" | "accepted" | "declined") => setDealQuoteStatus(quote.id, next), onSuccess: (next) => done(next, "Updated."), onError: fail });
  const upgrade = useMutation({
    mutationFn: () => upgradeDealQuote(quote.id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey }); setMessage({ tone: "success", text: "Moved to Sales as a draft quotation." }); },
    onError: fail,
  });
  const share = useMutation({ mutationFn: () => dealQuoteShareLink(quote.id), onError: fail });

  const intra = placeOfSupply === NO_STATE || !quote.sellerStateCode || placeOfSupply === quote.sellerStateCode;
  const totals = useMemo(() => lines.reduce((sum, line) => {
    const amounts = lineAmounts(line, intra);
    return { gross: sum.gross + amounts.gross, taxable: sum.taxable + amounts.taxable, cgst: sum.cgst + amounts.cgst, sgst: sum.sgst + amounts.sgst, igst: sum.igst + amounts.igst };
  }, { gross: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 }), [lines, intra]);
  const total = totals.taxable + totals.cgst + totals.sgst + totals.igst;
  const money = (value: number | string) => formatMoney(quote.currencyCode, Number(value));
  const setLine = (index: number, patch: Partial<CrmQuoteLine>) => setLines((current) => current.map((line, at) => (at === index ? { ...line, ...patch } : line)));

  // WhatsApp: the customer's link in a ready message, to the contact's mobile when known.
  const whatsapp = async () => {
    const { url } = await share.mutateAsync();
    const text = `${quote.kindLabel} ${quote.number}${quote.companyName ? ` for ${quote.companyName}` : ""}: ${money(quote.grandTotal)}. View and download: ${url}`;
    const phone = (quote.contactMobile ?? "").replace(/\D/g, "");
    window.open(`https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    if (quote.status === "draft") status.mutate("sent");
  };
  const copyLink = async () => {
    const { url } = await share.mutateAsync();
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setMessage({ tone: "success", text: `Link copied: ${url}` });
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Link href={`/crm/opportunities/${quote.opportunityId}?tab=quotes`} className="flex w-fit items-center gap-1 text-sm text-text-secondary hover:text-text">
        <ArrowLeft className="size-4" aria-hidden="true" />{quote.dealName ?? "Back to the deal"}
      </Link>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{quote.kindLabel} {quote.number} <StatusBadge tone={QUOTE_STATUS[quote.status].tone}>{QUOTE_STATUS[quote.status].label}</StatusBadge></span>}
        description={[quote.companyName, quote.contactName, quote.customerGstin ? `GSTIN ${quote.customerGstin}` : null].filter(Boolean).join(" · ") || undefined}
        primaryAction={editable ? <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button> : undefined}
        secondaryActions={
          <span className="flex flex-wrap gap-2">
            <a href={quotePdfUrl(quote.id)} className="inline-flex h-[var(--control-height-compact)] items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface px-3 text-xs font-medium text-text hover:bg-surface-muted">
              <Download className="size-4" aria-hidden="true" />PDF
            </a>
            {quote.status !== "upgraded" && view.capabilities.edit && <>
              <Button variant="secondary" size="compact" onPress={() => setEmailing(true)}><Mail className="size-4" aria-hidden="true" />Email</Button>
              <Button variant="secondary" size="compact" isLoading={share.isPending} onPress={() => void whatsapp()}><MessageCircle className="size-4" aria-hidden="true" />WhatsApp</Button>
              <Button variant="ghost" size="compact" onPress={() => void copyLink()}><Copy className="size-4" aria-hidden="true" />Copy link</Button>
            </>}
          </span>
        }
      />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {quote.status === "sent" && editable && <p className="text-sm text-text-secondary">Sent{quote.sentAt ? ` on ${formatDate(quote.sentAt)}` : ""}. Changing it makes it a draft again; send it once more after.</p>}

      <div className="grid gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:grid-cols-3">
        <Select label="Place of supply" isDisabled={!editable} selectedKey={placeOfSupply} onSelectionChange={(key) => setPlaceOfSupply(String(key))}
          description={intra ? "Same state: CGST + SGST" : "Another state: IGST"}
          options={[{ value: NO_STATE, label: "Not set (same state)" }, ...GST_STATES.map((state) => ({ value: state.code, label: `${state.name} (${state.code})` }))]} />
        <TextField label="Valid until" type="date" isDisabled={!editable} value={validUntil} onChange={setValidUntil} />
        <div className="flex flex-col justify-end text-sm text-text-secondary">Dated {formatDate(quote.quoteDate)}</div>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-surface-muted text-left text-xs text-text-secondary">
            <tr>
              <th className="px-3 py-2 font-medium">Item</th><th className="w-24 px-2 py-2 font-medium">HSN/SAC</th><th className="w-20 px-2 py-2 text-right font-medium">Qty</th>
              <th className="w-28 px-2 py-2 text-right font-medium">Price</th><th className="w-20 px-2 py-2 text-right font-medium">Disc. %</th><th className="w-24 px-2 py-2 font-medium">GST</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Amount</th>{editable && <th className="w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line, index) => {
              const amounts = lineAmounts(line, intra);
              return (
                <tr key={index} className="align-top">
                  <td className="px-3 py-2">{editable ? <TextField aria-label={`Line ${index + 1} item`} size="compact" value={line.description} onChange={(value) => setLine(index, { description: value })} /> : line.description}</td>
                  <td className="px-2 py-2">{editable ? <TextField aria-label={`Line ${index + 1} HSN or SAC`} size="compact" value={line.hsnSac ?? ""} onChange={(value) => setLine(index, { hsnSac: value })} /> : line.hsnSac}</td>
                  <td className="px-2 py-2 text-right">{editable ? <TextField aria-label={`Line ${index + 1} quantity`} size="compact" inputMode="decimal" value={String(line.quantity)} onChange={(value) => setLine(index, { quantity: value })} /> : Number(line.quantity)}</td>
                  <td className="px-2 py-2 text-right">{editable ? <TextField aria-label={`Line ${index + 1} price`} size="compact" inputMode="decimal" value={String(line.unitPrice)} onChange={(value) => setLine(index, { unitPrice: value })} /> : money(line.unitPrice)}</td>
                  <td className="px-2 py-2 text-right">{editable ? <TextField aria-label={`Line ${index + 1} discount`} size="compact" inputMode="decimal" value={String(line.discountPercent)} onChange={(value) => setLine(index, { discountPercent: value })} /> : `${Number(line.discountPercent)}%`}</td>
                  <td className="px-2 py-2">{editable
                    ? <Select aria-label={`Line ${index + 1} GST rate`} size="compact" selectedKey={String(Number(line.gstRate))} onSelectionChange={(key) => setLine(index, { gstRate: String(key) })}
                        options={GST_RATES.map((rate) => ({ value: String(rate), label: `${rate}%` }))} />
                    : `${Number(line.gstRate)}%`}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(amounts.taxable)}</td>
                  {editable && <td className="py-2 pr-2"><IconButton aria-label={`Remove line ${index + 1}`} variant="ghost" size="compact" isDisabled={lines.length === 1} onPress={() => setLines((current) => current.filter((_, at) => at !== index))}><Trash2 className="size-4" /></IconButton></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {editable && <div className="border-t border-border px-3 py-2"><Button variant="ghost" size="compact" onPress={() => setLines((current) => [...current, blankLine()])}><Plus className="size-4" aria-hidden="true" />Add line</Button></div>}
      </div>

      <dl className="ml-auto grid w-full max-w-sm grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-text-secondary">Subtotal</dt><dd className="text-right tabular-nums">{money(totals.gross)}</dd>
        {totals.gross !== totals.taxable && <><dt className="text-text-secondary">Discounts</dt><dd className="text-right tabular-nums">-{money(totals.gross - totals.taxable)}</dd></>}
        {intra ? <>
          <dt className="text-text-secondary">CGST</dt><dd className="text-right tabular-nums">{money(totals.cgst)}</dd>
          <dt className="text-text-secondary">SGST</dt><dd className="text-right tabular-nums">{money(totals.sgst)}</dd>
        </> : <><dt className="text-text-secondary">IGST</dt><dd className="text-right tabular-nums">{money(totals.igst)}</dd></>}
        <dt className="font-semibold text-text">Total</dt><dd className="text-right font-semibold tabular-nums">{money(total)}</dd>
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextArea label="Notes for the customer" isDisabled={!editable} value={notes} onChange={setNotes} />
        <TextArea label="Terms and conditions" isDisabled={!editable} value={terms} onChange={setTerms} description="Delivery, payment and validity terms, as printed." />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {view.capabilities.edit && quote.status === "draft" && <Button variant="secondary" isLoading={status.isPending} onPress={() => status.mutate("sent")}>Mark as sent</Button>}
        {view.capabilities.edit && ["sent", "draft"].includes(quote.status) && <>
          <Button variant="secondary" isLoading={status.isPending} onPress={() => status.mutate("accepted")}>Customer accepted</Button>
          <Button variant="ghost" isLoading={status.isPending} onPress={() => status.mutate("declined")}>Customer declined</Button>
        </>}
        {view.capabilities.upgrade && quote.status !== "upgraded" && <Button variant="primary" isLoading={upgrade.isPending} onPress={() => upgrade.mutate()}>Move to Sales</Button>}
        {quote.salesQuotationId && <Link className="text-sm font-medium text-brand hover:underline" href={`/sales/quotations/${quote.salesQuotationId}`}>Open Sales quotation {quote.salesQuotationNumber}</Link>}
      </div>

      {emailing && <EmailQuoteDialog view={view} onClose={() => setEmailing(false)} onSent={() => { setEmailing(false); void queryClient.invalidateQueries({ queryKey }); setMessage({ tone: "success", text: "Emailed with the PDF attached." }); }} />}
    </div>
  );
}

function EmailQuoteDialog({ view, onClose, onSent }: { view: CrmQuoteView; onClose: () => void; onSent: () => void }) {
  const { quote } = view;
  const [to, setTo] = useState(quote.contactEmail ?? "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(`${quote.kindLabel} ${quote.number}`);
  const [message, setMessage] = useState("");
  const send = useMutation({ mutationFn: () => emailDealQuote(quote.id, { to, cc: cc || undefined, subject, message: message || undefined }), onSuccess: onSent });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Email ${quote.kindLabel.toLowerCase()} ${quote.number}`} description="The PDF is attached. The email is kept on the deal.">
      <div className="flex flex-col gap-3">
        {send.isError && <Notice>{quoteErrorMessage(send.error, "The email could not be sent.")}</Notice>}
        <TextField label="To" type="email" isRequired value={to} onChange={setTo} />
        <TextField label="CC" value={cc} onChange={setCc} description="Separate several addresses with commas." />
        <TextField label="Subject" value={subject} onChange={setSubject} />
        <TextArea label="Message" value={message} onChange={setMessage} placeholder={`Please find attached our ${quote.kindLabel.toLowerCase()} ${quote.number}.`} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={send.isPending} isDisabled={!to.trim()} onPress={() => send.mutate()}>Send</Button>
        </div>
      </div>
    </Dialog>
  );
}
