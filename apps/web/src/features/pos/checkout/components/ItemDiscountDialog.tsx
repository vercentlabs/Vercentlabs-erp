"use client";

// Item Discounts: one cart line's manual discount, a percentage or a fixed amount for the whole line. Before anything is saved the server
// works out what it would do (the promotion kept apart, the discount, the taxable value, the tax, the line and the bill total) and whether
// this cashier may give it, needs a supervisor, or cannot (the product, its category, the stacking rule or the lowest price). The cashier
// sees their remaining authority and picks a reason from the company's list; the server decides — this never predicts a limit itself.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  NumberField,
  Select,
  StatusBadge,
  TextField,
} from "@vercentlabs/design-system";

import { money } from "@/features/pos/shared/format";
import { PosApiError } from "@/features/pos/shared/http";

import {
  getPosLineDiscountEligibility,
  previewPosLineDiscount,
  type PosLineDiscountEligibility,
  type PosLineDiscountPreview,
} from "../api/checkout-api";

export type ItemDiscountInput = {
  type: "percent" | "amount";
  value: string;
  reasonCode: string | null;
  note: string | null;
  reason: string;
};

const STATUS: Record<
  PosLineDiscountPreview["status"],
  { tone: "success" | "warning" | "danger"; label: string }
> = {
  ALLOWED: { tone: "success", label: "Within your limit" },
  REQUIRES_APPROVAL: { tone: "warning", label: "Needs supervisor approval" },
  DENIED: { tone: "danger", label: "Not allowed" },
  INVALID: { tone: "danger", label: "Cannot be applied" },
};
const trim = (value: string | number | null | undefined) =>
  value === null || value === undefined
    ? ""
    : String(value)
        .replace(/(\.\d*?)0+$/, "$1")
        .replace(/\.$/, "");

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "discount" | "muted";
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 ${strong ? "font-semibold text-text" : tone === "muted" ? "text-text-muted" : "text-text-secondary"}`}
    >
      <span>{label}</span>
      <span
        className={`tabular-nums ${tone === "discount" ? "text-success-emphasis" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

export function ItemDiscountDialog({
  cartId,
  cartVersion,
  lineId,
  title,
  currency,
  busy,
  onClose,
  onApply,
  onRemove,
}: {
  cartId: string;
  cartVersion: number;
  lineId: string;
  title: string;
  currency: string;
  busy?: boolean;
  onClose: () => void;
  onApply: (input: ItemDiscountInput) => void;
  onRemove: () => void;
}) {
  const eligibility = useQuery({
    queryKey: ["pos-line-discount-eligibility", cartId, lineId, cartVersion],
    queryFn: () => getPosLineDiscountEligibility(cartId, lineId),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title}>
      {eligibility.data ? (
        <DiscountForm
          data={eligibility.data}
          cartId={cartId}
          cartVersion={cartVersion}
          lineId={lineId}
          currency={currency}
          busy={busy}
          onClose={onClose}
          onApply={onApply}
          onRemove={onRemove}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {eligibility.isLoading && (
            <p className="text-sm text-text-muted">
              Checking what this line allows…
            </p>
          )}
          {eligibility.error && (
            <p className="text-sm text-danger-emphasis">
              {eligibility.error instanceof PosApiError
                ? eligibility.error.message
                : "The line could not be checked."}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" onPress={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// The form starts from the line's current discount, if it has one.
function DiscountForm({
  data,
  cartId,
  cartVersion,
  lineId,
  currency,
  busy,
  onClose,
  onApply,
  onRemove,
}: {
  data: PosLineDiscountEligibility;
  cartId: string;
  cartVersion: number;
  lineId: string;
  currency: string;
  busy?: boolean;
  onClose: () => void;
  onApply: (input: ItemDiscountInput) => void;
  onRemove: () => void;
}) {
  const current = data.current;
  const [type, setType] = useState<"percent" | "amount">(
    current?.type ?? "percent",
  );
  const [value, setValue] = useState(current ? Number(current.value) : 0);
  const [reasonCode, setReasonCode] = useState<string | null>(
    current?.reasonCode ?? null,
  );
  const [note, setNote] = useState(current?.note ?? "");

  // Debounced so each keystroke does not ask the server.
  const [proposal, setProposal] = useState<{
    type: "percent" | "amount";
    value: string;
  } | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setProposal(value > 0 ? { type, value: String(value) } : null),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [type, value]);
  const preview = useQuery({
    queryKey: [
      "pos-line-discount-preview",
      cartId,
      lineId,
      cartVersion,
      proposal,
    ],
    queryFn: () => previewPosLineDiscount(cartId, lineId, proposal!),
    enabled: Boolean(proposal),
    retry: false,
  });

  const reasons = data.reasons;
  const reason = reasons.find((entry) => entry.code === reasonCode) ?? null;
  const needsNote = Boolean(reason?.requiresNote);
  const result =
    proposal &&
    preview.data &&
    proposal.value === String(value) &&
    proposal.type === type
      ? preview.data
      : null;
  const reasonMissing = data.reasonRequired && !reasonCode;
  const canApply =
    Boolean(result) &&
    (result!.status === "ALLOWED" || result!.status === "REQUIRES_APPROVAL") &&
    !reasonMissing &&
    !(needsNote && !note.trim()) &&
    !busy;
  const line = result?.line;
  const authority = data.authority;
  const blocked = !data.discountable;

  return (
    <div className="flex flex-col gap-4">
      <>
        <div className="flex flex-col gap-1 text-sm">
          <Row
            label={`Line value (${trim(data.line.quantity)} × ${money(currency, data.line.unitPrice)})`}
            value={money(currency, data.line.grossAmount)}
          />
          {Number(data.line.promotionAmount) > 0 && (
            <Row
              label={
                data.stacking === "non_stackable"
                  ? "Offer on this line (cannot be combined)"
                  : data.stacking === "manual_replaces_automatic"
                    ? "Offer on this line (replaced by your discount)"
                    : "Offer on this line"
              }
              value={`−${money(currency, data.line.promotionAmount)}`}
              tone="muted"
            />
          )}
        </div>
        {blocked ? (
          <p className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger-emphasis">
            Discount is not allowed for this {data.blockedBy ?? "product"}.
          </p>
        ) : authority && !authority.canDiscount ? (
          <p className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger-emphasis">
            {authority.denied ?? "You cannot apply Item Discounts."}
          </p>
        ) : (
          <>
            <div className="flex gap-2" role="group" aria-label="Discount type">
              <Button
                variant={type === "percent" ? "primary" : "secondary"}
                size="compact"
                onPress={() => setType("percent")}
              >
                Percentage
              </Button>
              <Button
                variant={type === "amount" ? "primary" : "secondary"}
                size="compact"
                onPress={() => setType("amount")}
              >
                Fixed amount
              </Button>
            </div>
            <NumberField
              label={
                type === "percent"
                  ? "Percent off"
                  : `Amount off the whole line (${currency})`
              }
              value={value}
              onChange={(next) => setValue(Number.isFinite(next) ? next : 0)}
              minValue={0}
              maxValue={type === "percent" ? 100 : undefined}
              step={type === "percent" ? 0.5 : 0.01}
              autoFocus
            />
            {authority && (
              <p className="text-xs text-text-muted">
                Your limit:{" "}
                {[
                  authority.maxPercentage !== null
                    ? `${trim(authority.maxPercentage)}%`
                    : null,
                  authority.maxAmount !== null
                    ? `${money(currency, authority.maxAmount)} a line`
                    : null,
                  authority.remainingOnSale !== null
                    ? `${money(currency, authority.remainingOnSale)} left on this sale`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "no limit"}
                {data.maxPercent !== null && (
                  <> · this product: at most {trim(data.maxPercent)}%</>
                )}
                {data.minSellingPrice !== null && (
                  <>
                    {" "}
                    · lowest price {money(currency, data.minSellingPrice)} a
                    unit
                  </>
                )}
              </p>
            )}

            {proposal && preview.isFetching && !result && (
              <p className="text-sm text-text-muted">
                Working out the discount…
              </p>
            )}
            {preview.error && (
              <p className="text-sm text-danger-emphasis">
                {preview.error instanceof PosApiError
                  ? preview.error.message
                  : "The discount could not be checked."}
              </p>
            )}
            {result && (
              <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-surface-subtle px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text">
                    Before you confirm
                  </span>
                  <StatusBadge tone={STATUS[result.status].tone}>
                    {STATUS[result.status].label}
                  </StatusBadge>
                </div>
                {line && (
                  <div className="flex flex-col gap-1">
                    <Row
                      label="Discount"
                      value={`−${money(currency, line.manualDiscountAmount)}`}
                      tone="discount"
                    />
                    <Row
                      label="Taxable value"
                      value={money(currency, line.taxableAmount)}
                    />
                    <Row label="Tax" value={money(currency, line.taxAmount)} />
                    <Row
                      label="Line total"
                      value={money(currency, line.lineTotal)}
                      strong
                    />
                  </div>
                )}
                {result.bill && (
                  <Row
                    label="Bill total"
                    value={`${money(currency, result.bill.totalBefore)} → ${money(currency, result.bill.totalAfter)}`}
                  />
                )}
                {result.issues.map((issue) => (
                  <p
                    key={`${issue.code}:${issue.message}`}
                    className="text-danger-emphasis"
                  >
                    {issue.message}
                  </p>
                ))}
                {result.status === "REQUIRES_APPROVAL" &&
                  result.authority?.message && (
                    <p className="text-warning-emphasis">
                      {result.authority.message} A supervisor can approve it
                      after you apply.
                    </p>
                  )}
              </div>
            )}

            <Select
              label="Reason"
              isRequired={data.reasonRequired}
              placeholder="Choose a reason"
              options={reasons.map((entry) => ({
                value: entry.code,
                label: entry.label,
              }))}
              selectedKey={reasonCode}
              onSelectionChange={(key) =>
                setReasonCode(key ? String(key) : null)
              }
            />
            {(needsNote || reasonCode) && (
              <TextField
                label={needsNote ? "Note (required)" : "Note (optional)"}
                isRequired={needsNote}
                value={note}
                onChange={setNote}
                maxLength={500}
              />
            )}
          </>
        )}
      </>
      <div className="flex flex-wrap justify-end gap-2">
        {current && (
          <Button
            variant="ghost"
            className="mr-auto"
            isDisabled={busy}
            onPress={onRemove}
          >
            Remove discount
          </Button>
        )}
        <Button variant="secondary" onPress={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          isDisabled={!canApply}
          onPress={() =>
            onApply({
              type,
              value: String(value),
              reasonCode,
              note: note.trim() || null,
              reason: reason
                ? `${reason.label}${note.trim() ? ` — ${note.trim()}` : ""}`
                : note.trim(),
            })
          }
        >
          {result?.status === "REQUIRES_APPROVAL"
            ? "Apply and ask approval"
            : current
              ? "Update discount"
              : "Apply discount"}
        </Button>
      </div>
    </div>
  );
}
