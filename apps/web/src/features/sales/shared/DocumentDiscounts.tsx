"use client";

// Discounts on a quotation or sales order form: the document discount with
// its reason, and the totals laid out so the user sees how the amount was
// arrived at. Every figure shown comes from the server's calculation; the
// form only sends what was entered (a type and a value).
import { Button, NumberField, Select, TextField, type SelectOption } from "@vercentlabs/design-system";

import { money } from "@/features/sales/shared/format";
import type { SalesDocumentPreview, SalesOptions } from "@/features/sales/quotations/api/quotations-api";
import { Notice, Panel } from "@/shared/ui/Panel";

export type DiscountType = "percent" | "amount";
export type DocumentDiscountDraft = { type: DiscountType; value: number; reasonCode: string; reasonText: string };
export const NO_DOCUMENT_DISCOUNT: DocumentDiscountDraft = { type: "percent", value: 0, reasonCode: "", reasonText: "" };

type Discounts = SalesOptions["discounts"];

// The discount types the tenant allows, labelled for the currency.
export function discountTypeOptions(discounts: Discounts, currencyCode: string): SelectOption[] {
  return [
    ...(discounts.allowPercent ? [{ value: "percent", label: "%" }] : []),
    ...(discounts.allowAmount ? [{ value: "amount", label: currencyCode }] : []),
  ];
}
export const defaultDiscountType = (discounts: Discounts): DiscountType => (discounts.allowPercent ? "percent" : "amount");

export function DocumentDiscountPanel({ discounts, currencyCode, value, onChange, preview, hasAnyDiscount }: {
  discounts: Discounts; currencyCode: string; value: DocumentDiscountDraft; onChange: (next: DocumentDiscountDraft) => void;
  preview: SalesDocumentPreview | undefined;
  // A line or the document carries a discount, so a reason can be given.
  hasAnyDiscount: boolean;
}) {
  const canApply = discounts.allowDocument && discounts.canApplyDocument;
  const check = preview?.discount;
  return (
    <Panel
      title="Additional discount"
      description={
        !discounts.allowDocument ? "Document discounts are switched off in Sales settings."
          : !discounts.canApplyDocument ? "You do not have permission to give a document discount."
            : "A discount on the whole document, shared across the lines before tax."
      }
      actions={value.value > 0 ? <Button variant="ghost" size="compact" onPress={() => onChange({ ...value, value: 0 })}>Remove discount</Button> : undefined}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_6rem_minmax(0,1fr)_minmax(0,1.4fr)] sm:items-end">
        <NumberField
          label="Discount"
          value={value.value}
          onChange={(next) => onChange({ ...value, value: Number.isFinite(next) ? next : 0 })}
          minValue={0}
          maxValue={value.type === "percent" ? 100 : undefined}
          step={value.type === "percent" ? 0.5 : 0.01}
          isDisabled={!canApply}
        />
        <Select
          aria-label="Discount type"
          options={discountTypeOptions(discounts, currencyCode)}
          selectedKey={value.type}
          // The value entered for the other type is not carried over.
          onSelectionChange={(key) => onChange({ ...value, type: key === "amount" ? "amount" : "percent", value: 0 })}
          isDisabled={!canApply}
        />
        <Select
          label="Discount reason"
          options={[{ value: "", label: "None" }, ...discounts.reasons.map((reason) => ({ value: reason.code, label: reason.label }))]}
          selectedKey={value.reasonCode}
          onSelectionChange={(key) => onChange({ ...value, reasonCode: String(key ?? "") })}
          isRequired={Boolean(check?.reasonRequired)}
          isDisabled={!hasAnyDiscount}
        />
        <TextField
          label="Reason details"
          value={value.reasonText}
          onChange={(reasonText) => onChange({ ...value, reasonText })}
          isRequired={value.reasonCode === "other"}
          isDisabled={!hasAnyDiscount}
        />
      </div>
      {preview && Number(preview.totals.documentDiscountAmount) > 0 && (
        <p className="text-sm text-text-secondary">
          {money(currencyCode, preview.totals.documentDiscountAmount)} off
          {value.type === "amount" ? ` (${Number(Number(preview.totals.documentDiscountPercent).toFixed(2))}%)` : ""}, shared across the lines.
        </p>
      )}
      {check?.message && <Notice tone={check.limitExceeded ? "danger" : "warning"}>{check.message}</Notice>}
      {discounts.limitPercent !== null && !check?.limitExceeded && (
        <p className="text-xs text-text-muted">You can give up to {discounts.limitPercent}% discount on a line, including its share of this discount.</p>
      )}
    </Panel>
  );
}

// Subtotal → line discounts → document discount → taxable value → tax → total.
export function DocumentTotals({ currencyCode, preview }: { currencyCode: string; preview: SalesDocumentPreview }) {
  const totals = preview.totals;
  const lineDiscounts = Number(totals.lineDiscountTotal);
  const documentDiscount = Number(totals.documentDiscountAmount);
  const rows: Array<{ label: string; value: string; rule?: boolean; strong?: boolean }> = [
    { label: "Subtotal", value: money(currencyCode, totals.grossTotal) },
    ...(lineDiscounts ? [{ label: "Line discounts", value: `- ${money(currencyCode, totals.lineDiscountTotal)}` }] : []),
    ...(lineDiscounts && documentDiscount ? [{ label: "Net before additional discount", value: money(currencyCode, Number(totals.grossTotal) - lineDiscounts), rule: true }] : []),
    ...(documentDiscount
      ? [{ label: `Additional discount${totals.documentDiscountType === "percent" ? ` ${Number(totals.documentDiscountValue)}%` : ""}`, value: `- ${money(currencyCode, totals.documentDiscountAmount)}` }]
      : []),
    { label: "Taxable value", value: money(currencyCode, totals.taxableTotal), rule: Boolean(lineDiscounts || documentDiscount) },
    ...(Number(totals.chargeTotal) ? [{ label: "Charges", value: money(currencyCode, totals.chargeTotal) }] : []),
    ...(preview.tax.summary.length
      ? preview.tax.summary.map((entry) => ({ label: `${entry.label} ${Number(entry.rate)}%`, value: money(currencyCode, entry.taxAmount) }))
      : [{ label: preview.tax.treatment === "taxable" ? "Tax" : "Tax (none charged)", value: money(currencyCode, totals.taxTotal) }]),
    ...(Number(totals.roundingAdjustment) ? [{ label: "Rounding", value: money(currencyCode, totals.roundingAdjustment) }] : []),
  ];
  return (
    <div className="flex flex-col gap-1 text-sm">
      {rows.map((row) => (
        <div key={row.label} className={`flex items-center justify-between gap-3 ${row.rule ? "border-t border-border pt-1" : ""}`}>
          <span className="text-text-secondary">{row.label}</span>
          <span className="tabular-nums text-text">{row.value}</span>
        </div>
      ))}
      {preview.priceList?.taxInclusive && <p className="text-xs text-text-muted">Prices include tax; the taxable value is shown without it.</p>}
      <div className="mt-1 flex items-center justify-between border-t border-border pt-3 text-lg font-semibold text-text">
        <span>Grand total</span>
        <span className="tabular-nums">{money(currencyCode, totals.grandTotal)}</span>
      </div>
      {totals.marginPercent !== undefined && <p className="text-xs text-text-muted">Margin {Number(totals.marginPercent).toFixed(1)}%</p>}
    </div>
  );
}

// The same breakdown for a saved document (its stored values).
export type StoredDocumentTotals = {
  gross_total: string; line_discount_total: string; document_discount_type: "percent" | "amount"; document_discount_value: string; document_discount_amount: string;
  taxable_total: string; charge_total: string; tax_total: string; rounding_adjustment: string; grand_total: string;
  discount_reason_code: string | null; discount_reason_text: string | null;
};
const REASON_LABELS: Record<string, string> = {
  volume: "Volume", negotiation: "Negotiation", competitive_match: "Competitive match", existing_customer: "Existing customer", management_decision: "Management decision",
  launch_offer: "Launch offer", other: "Other",
};
export const discountReasonLabel = (code: string | null, details: string | null) =>
  [code ? REASON_LABELS[code] ?? code : null, details].filter(Boolean).join(": ") || null;

export type StoredTaxLine = { tax_type: string; label: string; rate: string; taxable_amount: string; tax_amount: string };

export function StoredTotals({ currencyCode, document, taxLines = [] }: { currencyCode: string; document: StoredDocumentTotals; taxLines?: StoredTaxLine[] }) {
  const lineDiscounts = Number(document.line_discount_total);
  const documentDiscount = Number(document.document_discount_amount);
  const reason = discountReasonLabel(document.discount_reason_code, document.discount_reason_text);
  const rows: Array<{ label: string; value: string; rule?: boolean }> = [
    { label: "Subtotal", value: money(currencyCode, document.gross_total) },
    ...(lineDiscounts ? [{ label: "Line discounts", value: `- ${money(currencyCode, document.line_discount_total)}` }] : []),
    ...(lineDiscounts && documentDiscount ? [{ label: "Net before additional discount", value: money(currencyCode, Number(document.gross_total) - lineDiscounts), rule: true }] : []),
    ...(documentDiscount
      ? [{ label: `Additional discount${document.document_discount_type === "percent" ? ` ${Number(document.document_discount_value)}%` : ""}`, value: `- ${money(currencyCode, document.document_discount_amount)}` }]
      : []),
    { label: "Taxable value", value: money(currencyCode, document.taxable_total), rule: Boolean(lineDiscounts || documentDiscount) },
    ...(Number(document.charge_total) ? [{ label: "Charges", value: money(currencyCode, document.charge_total) }] : []),
    ...(taxLines.length
      ? taxLines.map((tax) => ({ label: `${tax.label ?? tax.tax_type.toUpperCase()} ${Number(tax.rate)}%`, value: money(currencyCode, tax.tax_amount) }))
      : [{ label: "Tax", value: money(currencyCode, document.tax_total) }]),
    ...(Number(document.rounding_adjustment) ? [{ label: "Rounding", value: money(currencyCode, document.rounding_adjustment) }] : []),
  ];
  return (
    <div className="flex flex-col gap-1 text-sm">
      {rows.map((row) => (
        <div key={row.label} className={`flex items-center justify-between gap-3 ${row.rule ? "border-t border-border pt-1" : ""}`}>
          <span className="text-text-secondary">{row.label}</span>
          <span className="tabular-nums text-text">{row.value}</span>
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between border-t border-border pt-2 font-semibold text-text">
        <span>Grand total</span>
        <span className="tabular-nums">{money(currencyCode, document.grand_total)}</span>
      </div>
      {reason && <p className="text-xs text-text-muted">Discount reason: {reason}</p>}
    </div>
  );
}
