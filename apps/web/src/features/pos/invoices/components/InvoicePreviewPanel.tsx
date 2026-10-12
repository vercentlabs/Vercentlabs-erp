"use client";

// The GST invoice this bill will become, shown before payment: the document type the rules decide, seller GSTIN, buyer, place of supply,
// taxable value and each tax — and anything that would stop the invoice (a wrong customer GSTIN, e-invoicing required, numbering). The number
// is given when the sale completes.
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@vercentlabs/design-system";

import { DOCUMENT_LABEL, invoicePreview } from "@/features/pos/invoices/api/invoices-api";
import { money } from "@/features/pos/shared/format";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const TAX_LABEL: Record<string, string> = { cgst: "CGST", sgst: "SGST", utgst: "UTGST", igst: "IGST", cess: "Cess" };

export function InvoicePreviewPanel({ cartId, version, currency }: { cartId: string; version: number; currency: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "invoice-preview", cartId, version), queryFn: () => invoicePreview(cartId), retry: false });
  const preview = query.data;
  if (!preview || !preview.documentType) return null;
  const invoiceIssues = preview.issues.filter((issue) => issue.code.startsWith("POS_INVOICE_"));
  return (
    <PosPanel title="Invoice" description={preview.note}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={preview.statutory ? "info" : "neutral"}>{DOCUMENT_LABEL[preview.documentType] ?? preview.documentType}</StatusBadge>
        {preview.statutory && <StatusBadge tone="neutral">{String(preview.supplyType ?? "")}</StatusBadge>}
        {preview.einvoiceApplicability === "REQUIRED" && <StatusBadge tone="warning">E-invoice required</StatusBadge>}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {preview.seller?.gstin && <div><dt className="text-xs text-text-muted">Seller GSTIN</dt><dd className="font-medium">{preview.seller.gstin}</dd></div>}
        <div><dt className="text-xs text-text-muted">Customer</dt><dd>{preview.customerMode === "REGISTERED" ? preview.buyerGstin ?? "Registered customer" : "Walk-in customer"}</dd></div>
        {preview.placeOfSupply && <div><dt className="text-xs text-text-muted">Place of supply</dt><dd>{preview.placeOfSupply.name} ({preview.placeOfSupply.code})</dd></div>}
        {preview.taxableAmount && <div><dt className="text-xs text-text-muted">Taxable value</dt><dd className="tabular-nums">{money(currency, preview.taxableAmount)}</dd></div>}
        {Object.entries(preview.taxes ?? {}).map(([type, amount]) => (
          <div key={type}><dt className="text-xs text-text-muted">{TAX_LABEL[type] ?? type.toUpperCase()}</dt><dd className="tabular-nums">{money(currency, amount)}</dd></div>
        ))}
      </dl>
      {invoiceIssues.map((issue) => <p key={issue.code} className="text-sm text-danger-emphasis">{issue.message}</p>)}
    </PosPanel>
  );
}
