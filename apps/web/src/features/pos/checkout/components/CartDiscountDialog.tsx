"use client";

// Cart Discounts: one discount on the eligible value of the whole bill — a percentage, or a fixed amount off the bill (not per product). The
// server decides which products qualify (an offer that cannot be combined, an item discount, a changed price or a product that takes no
// discounts leaves a line out, and the cashier sees why), shares the discount across the lines, works out each line's GST and the new total,
// and says whether this cashier may give it, needs a supervisor, or cannot. Nothing is saved until Apply; a touch keypad is there for
// counters without a keyboard.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Delete } from "lucide-react";
import { Button, Dialog, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { money } from "@/features/pos/shared/format";
import { PosApiError } from "@/features/pos/shared/http";

import { getPosCartDiscountTerms, previewPosCartDiscount, type PosCartDiscountEligibility, type PosCartDiscountPreview } from "../api/checkout-api";

export type CartDiscountInput = { type: "percent" | "amount"; value: string; reasonCode: string | null; note: string | null; reason: string };

const STATUS: Record<PosCartDiscountPreview["status"], { tone: "success" | "warning" | "danger"; label: string }> = {
  ALLOWED: { tone: "success", label: "Within your limit" },
  REQUIRES_APPROVAL: { tone: "warning", label: "Needs supervisor approval" },
  DENIED: { tone: "danger", label: "Not allowed" },
  INVALID: { tone: "danger", label: "Cannot be applied" },
};
const trim = (value: string | number | null | undefined) => (value === null || value === undefined ? "" : String(Number(value)));
const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "back"] as const;

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "discount" | "muted" }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? "font-semibold text-text" : tone === "muted" ? "text-text-muted" : "text-text-secondary"}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${tone === "discount" ? "text-success-emphasis" : ""}`}>{value}</span>
    </div>
  );
}

export function CartDiscountDialog({ cartId, cartVersion, currency, busy, onClose, onApply, onRemove }: {
  cartId: string; cartVersion: number; currency: string; busy?: boolean;
  onClose: () => void; onApply: (input: CartDiscountInput) => void; onRemove: () => void;
}) {
  const terms = useQuery({ queryKey: ["pos-cart-discount-terms", cartId, cartVersion], queryFn: () => getPosCartDiscountTerms(cartId) });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Cart discount">
      {terms.data ? (
        <DiscountForm data={terms.data} cartId={cartId} cartVersion={cartVersion} currency={currency} busy={busy} onClose={onClose} onApply={onApply} onRemove={onRemove} />
      ) : (
        <div className="flex flex-col gap-4">
          {terms.isLoading && <p className="text-sm text-text-muted">Checking what this bill allows…</p>}
          {terms.error && <p className="text-sm text-danger-emphasis">{terms.error instanceof PosApiError ? terms.error.message : "The bill could not be checked."}</p>}
          <div className="flex justify-end"><Button variant="secondary" onPress={onClose}>Cancel</Button></div>
        </div>
      )}
    </Dialog>
  );
}

// The form starts from the bill's current discount, if it has one.
function DiscountForm({ data, cartId, cartVersion, currency, busy, onClose, onApply, onRemove }: {
  data: PosCartDiscountEligibility; cartId: string; cartVersion: number; currency: string; busy?: boolean;
  onClose: () => void; onApply: (input: CartDiscountInput) => void; onRemove: () => void;
}) {
  const current = data.current;
  const [type, setType] = useState<"percent" | "amount">(current?.type ?? "percent");
  const [value, setValue] = useState(current ? trim(current.value) : "");
  const [reasonCode, setReasonCode] = useState<string | null>(current?.reasonCode ?? null);
  const [note, setNote] = useState(current?.note ?? "");
  const [showExcluded, setShowExcluded] = useState(false);

  // Debounced so each key press does not ask the server.
  const [proposal, setProposal] = useState<{ type: "percent" | "amount"; value: string } | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setProposal(Number(value) > 0 ? { type, value } : null), 300);
    return () => window.clearTimeout(timer);
  }, [type, value]);
  const preview = useQuery({
    queryKey: ["pos-cart-discount-preview", cartId, cartVersion, proposal],
    queryFn: () => previewPosCartDiscount(cartId, proposal!),
    enabled: Boolean(proposal),
    retry: false,
  });

  const press = (key: (typeof KEYS)[number]) => setValue((text) => {
    if (key === "back") return text.slice(0, -1);
    if (key === "." && text.includes(".")) return text;
    const next = text === "0" && key !== "." ? key : `${text}${key}`;
    return /^\d{0,9}(\.\d{0,2})?$/.test(next) ? next : text;
  });
  const reason = data.reasons.find((entry) => entry.code === reasonCode) ?? null;
  const needsNote = Boolean(reason?.requiresNote);
  const result = proposal && preview.data && proposal.value === value && proposal.type === type ? preview.data : null;
  const reasonMissing = (data.reasonRequired || result?.status === "REQUIRES_APPROVAL") && !reasonCode && !note.trim();
  const canApply = Boolean(result) && (result!.status === "ALLOWED" || result!.status === "REQUIRES_APPROVAL") && !reasonMissing && !(needsNote && !note.trim()) && !busy;
  const authority = data.authority;
  const excluded = result?.discount?.excluded ?? data.excluded;
  const eligibleBase = result?.discount?.eligibleBase ?? data.eligibleBase;
  const before = result?.before;
  const after = result?.after;

  if (!authority.canDiscount) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger-emphasis">{authority.denied ?? "You cannot apply Cart Discounts."}</p>
        <div className="flex justify-end gap-2">
          {current && <Button variant="ghost" className="mr-auto" isDisabled>Remove discount</Button>}
          <Button variant="secondary" onPress={onClose}>Close</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 text-sm">
        <Row label="Cart subtotal" value={money(currency, before?.subtotal ?? Number(eligibleBase) + Number(data.excludedBase))} />
        {before && Number(before.itemDiscounts) > 0 && <Row label="Item discounts" value={`−${money(currency, before.itemDiscounts)}`} tone="muted" />}
        {before && Number(before.promotions) > 0 && <Row label="Offers" value={`−${money(currency, before.promotions)}`} tone="muted" />}
        <Row label="Eligible cart value" value={money(currency, eligibleBase)} strong />
        {excluded.length > 0 && (
          <button type="button" className="self-start text-left text-xs text-text-muted underline" onClick={() => setShowExcluded((open) => !open)} aria-expanded={showExcluded}>
            {excluded.length === 1 ? "1 product is excluded from this discount" : `${excluded.length} products are excluded from this discount`} ({money(currency, result?.discount?.excludedBase ?? data.excludedBase)})
          </button>
        )}
        {showExcluded && (
          <ul className="ml-1 flex flex-col gap-0.5 border-l border-border pl-2 text-xs text-text-muted">
            {excluded.map((entry) => <li key={`${entry.lineId ?? entry.lineNumber}`}>{entry.description}: {entry.message}</li>)}
          </ul>
        )}
      </div>

      {Number(data.eligibleBase) <= 0 && !current ? (
        <p className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm">No products in this bill qualify for a Cart Discount.</p>
      ) : (
        <>
          <div className="flex gap-2" role="group" aria-label="Discount type">
            <Button variant={type === "percent" ? "primary" : "secondary"} size="compact" onPress={() => setType("percent")}>Percentage (%)</Button>
            <Button variant={type === "amount" ? "primary" : "secondary"} size="compact" onPress={() => setType("amount")}>Fixed amount ({currency})</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-2">
              <TextField label={type === "percent" ? "Discount percentage" : "Amount off the bill"} inputMode="decimal" value={value} autoFocus
                onChange={(text) => /^\d{0,9}(\.\d{0,6})?$/.test(text) && setValue(text)} description={type === "amount" ? "One amount off the eligible bill, shared across the products." : undefined} />
              <p className="text-xs text-text-muted">
                Your limit: {[authority.maxPercentage !== null ? `${trim(authority.maxPercentage)}%` : null, authority.maxAmount !== null ? money(currency, authority.maxAmount) : null,
                  authority.remainingOnSale !== null ? `${money(currency, authority.remainingOnSale)} left on this sale` : null].filter(Boolean).join(" · ") || "no limit"}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:w-48" aria-label="Keypad">
              {KEYS.map((key) => (
                <Button key={key} variant="secondary" onPress={() => press(key)} aria-label={key === "back" ? "Delete last digit" : key}>
                  {key === "back" ? <Delete className="size-4" aria-hidden="true" /> : key}
                </Button>
              ))}
            </div>
          </div>

          {proposal && preview.isFetching && !result && <p className="text-sm text-text-muted">Working out the discount…</p>}
          {preview.error && <p className="text-sm text-danger-emphasis">{preview.error instanceof PosApiError ? preview.error.message : "The discount could not be checked."}</p>}
          {result && (
            <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-surface-subtle px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-text">Before you confirm</span>
                <StatusBadge tone={STATUS[result.status].tone}>{STATUS[result.status].label}</StatusBadge>
              </div>
              {result.discount && after && (
                <div className="flex flex-col gap-1">
                  <Row label={`Cart discount${result.discount.type === "percent" ? ` (${trim(result.discount.value)}%)` : ""}`} value={`−${money(currency, result.discount.amount)}`} tone="discount" />
                  <Row label="Taxable value" value={money(currency, after.taxable)} />
                  <Row label="GST" value={`${money(currency, before?.tax)} → ${money(currency, after.tax)}`} />
                  <Row label="Total payable" value={`${money(currency, before?.total)} → ${money(currency, after.total)}`} strong />
                </div>
              )}
              {result.issues.map((issue) => <p key={`${issue.code}:${issue.message}`} className="text-danger-emphasis">{issue.message}</p>)}
              {result.status === "REQUIRES_APPROVAL" && result.authority?.message && <p className="text-warning-emphasis">{result.authority.message} Ask a supervisor after you apply.</p>}
              {result.status === "ALLOWED" && <p className="text-text-muted">Discount is within your limit.</p>}
            </div>
          )}

          <Select label="Reason" isRequired={data.reasonRequired || result?.status === "REQUIRES_APPROVAL"} placeholder="Choose a reason"
            options={data.reasons.map((entry) => ({ value: entry.code, label: entry.label }))} selectedKey={reasonCode}
            onSelectionChange={(key) => setReasonCode(key ? String(key) : null)} />
          {(needsNote || reasonCode) && (
            <TextField label={needsNote ? "Explanation (required)" : "Note (optional)"} isRequired={needsNote} value={note} onChange={setNote} maxLength={500} />
          )}
        </>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {current && <Button variant="ghost" className="mr-auto" isDisabled={busy} onPress={onRemove}>Remove discount</Button>}
        <Button variant="secondary" onPress={onClose}>Cancel</Button>
        <Button variant="primary" isDisabled={!canApply}
          onPress={() => onApply({ type, value, reasonCode, note: note.trim() || null, reason: reason ? `${reason.label}${note.trim() ? ` — ${note.trim()}` : ""}` : note.trim() })}>
          {result?.status === "REQUIRES_APPROVAL" ? "Apply and ask approval" : current ? "Update cart discount" : "Apply cart discount"}
        </Button>
      </div>
    </div>
  );
}
