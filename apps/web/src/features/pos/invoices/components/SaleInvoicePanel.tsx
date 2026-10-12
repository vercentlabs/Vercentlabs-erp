"use client";

// A sale's GST invoice as issued: number, type, B2B / B2C, place of supply, each line's HSN, taxable value and tax, totals by component,
// e-invoice status, and the credit notes issued against it. Read-only — an issued invoice is corrected only by a credit or debit note.
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@vercentlabs/design-system";

import { DOCUMENT_LABEL, saleInvoice } from "@/features/pos/invoices/api/invoices-api";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function SaleInvoicePanel({ saleId, compact = false }: { saleId: string; compact?: boolean }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "sale-invoice", saleId), queryFn: () => saleInvoice(saleId), retry: false });
  const invoice = query.data?.invoice;
  if (compact) return invoice ? <p className="text-sm text-text-muted">{DOCUMENT_LABEL[invoice.documentType]} <span className="font-medium text-text">{invoice.invoiceNumber}</span></p> : null;
  if (!query.data) return null;
  if (!invoice) return <PosPanel title="GST invoice"><p className="text-sm text-text-muted">{query.data.note}</p></PosPanel>;
  const currency = invoice.currency;
  const taxes = [["CGST", invoice.cgst], ["SGST", invoice.sgst], ["UTGST", invoice.utgst], ["IGST", invoice.igst], ["Cess", invoice.cess]].filter(([, value]) => Number(value) > 0);
  return (
    <PosPanel title={`${DOCUMENT_LABEL[invoice.documentType] ?? invoice.documentType} ${invoice.invoiceNumber}`} description={`Issued ${dateTime(invoice.issuedAt)} · financial year ${invoice.financialYear}`}>
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone="info">{invoice.supplyType.toUpperCase()}</StatusBadge>
        <StatusBadge tone={invoice.einvoiceStatus === "NOT_APPLICABLE" ? "neutral" : "warning"}>{invoice.einvoiceStatus === "NOT_APPLICABLE" ? "E-invoice not applicable" : `E-invoice ${invoice.einvoiceStatus.toLowerCase()}`}</StatusBadge>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-text-muted">Seller GSTIN</dt><dd className="font-medium">{invoice.seller?.gstin ?? "—"}</dd></div>
        <div><dt className="text-xs text-text-muted">Buyer GSTIN</dt><dd>{invoice.buyerGstin ?? "Unregistered (B2C)"}</dd></div>
        <div><dt className="text-xs text-text-muted">Place of supply</dt><dd>{invoice.placeOfSupply ?? "—"}</dd></div>
        <div><dt className="text-xs text-text-muted">Sale reference</dt><dd>{invoice.receiptNumber ?? "—"}</dd></div>
      </dl>
      <table className="w-full text-sm">
        <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Item</th><th className="pb-1 text-left">HSN/SAC</th><th className="pb-1 text-right">Qty</th>
          <th className="pb-1 text-right">Taxable</th><th className="pb-1 text-right">Rate</th><th className="pb-1 text-right">Tax</th></tr></thead>
        <tbody>{(invoice.lines ?? []).map((line) => (
          <tr key={line.lineNumber} className="border-t border-border">
            <td className="py-1.5">{line.description}</td><td>{line.hsnSac ?? "—"}</td><td className="text-right tabular-nums">{line.quantity}{line.uom ? ` ${line.uom}` : ""}</td>
            <td className="text-right tabular-nums">{money(currency, line.taxableAmount)}</td><td className="text-right tabular-nums">{line.taxRate === null ? "—" : `${line.taxRate}%`}</td>
            <td className="text-right tabular-nums">{money(currency, String([line.cgst, line.sgst, line.utgst, line.igst, line.cess].reduce((sum, value) => sum + Number(value ?? 0), 0)))}</td>
          </tr>
        ))}</tbody>
      </table>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-text-muted">Taxable value</dt><dd className="tabular-nums">{money(currency, invoice.taxableTotal)}</dd></div>
        {taxes.map(([label, value]) => <div key={label}><dt className="text-xs text-text-muted">{label}</dt><dd className="tabular-nums">{money(currency, value)}</dd></div>)}
        <div><dt className="text-xs text-text-muted">Invoice total</dt><dd className="font-semibold tabular-nums">{money(currency, invoice.grandTotal)}</dd></div>
      </dl>
      {(invoice.creditNotes ?? []).length > 0 && (
        <div className="text-sm">
          <p className="font-medium">Credit notes against this invoice</p>
          <ul>{invoice.creditNotes!.map((note) => <li key={note.id} className="text-text-muted">{note.number} · {dateTime(note.issuedAt)} · {money(currency, note.total)}</li>)}</ul>
        </div>
      )}
    </PosPanel>
  );
}
