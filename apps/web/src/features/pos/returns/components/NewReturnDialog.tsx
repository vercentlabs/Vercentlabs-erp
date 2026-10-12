"use client";

// New return in three steps: 1) find the sale (scan the receipt, or its receipt / invoice number) and choose what comes back; 2) a reason and
// the condition of each item; 3) review — the refund the server worked out from the original sale, the exceptions and whether a supervisor
// must approve — then create the return (its quantities are held at once) and open it.
import { useState } from "react";
import { Button, Checkbox, Dialog, NumberField, SearchField, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { CONDITION_LABEL, REASON_LABEL, createReturn, findSaleForReturn, type PosReturn, type PosReturnEligibility } from "@/features/pos/returns/api/returns-api";
import { findReturnLine } from "@/features/pos/products/scanner/scanner-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";

type Choice = { quantity: number; reasonCode: string; reasonNote: string; conditionCode: string };

export function NewReturnDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (posReturn: PosReturn) => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [code, setCode] = useState("");
  const [sale, setSale] = useState<PosReturnEligibility | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [receiptPresent, setReceiptPresent] = useState(true);
  const [reasonSummary, setReasonSummary] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [itemScan, setItemScan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await work(); } catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Something went wrong."); } finally { setBusy(false); }
  }
  const find = () => run(async () => {
    const found = await findSaleForReturn(code.trim());
    setSale(found);
    setChoices({});
  });
  const choose = (saleLineId: string, change: Partial<Choice>) => setChoices((all) => {
    const current: Choice = all[saleLineId] ?? { quantity: 0, reasonCode: "", reasonNote: "", conditionCode: "" };
    return { ...all, [saleLineId]: { ...current, ...change } };
  });
  const scanItem = () => run(async () => {
    if (!sale) return;
    const match = await findReturnLine(sale.sale.id, itemScan.trim());
    const current = choices[match.saleLineId]?.quantity ?? 0;
    choose(match.saleLineId, { quantity: current + 1 });
    setItemScan("");
  });
  const selected = sale ? sale.lines.filter((line) => (choices[line.saleLineId]?.quantity ?? 0) > 0) : [];
  const policy = sale?.policy;
  const lineIssues = selected.filter((line) => {
    const choice = choices[line.saleLineId];
    return (policy?.requireReason && !choice.reasonCode) || (choice.reasonCode === "other" && !choice.reasonNote.trim()) || (line.stockItem && policy?.requireCondition && !choice.conditionCode);
  });
  const estimate = selected.reduce((sum, line) => sum + Number(line.unitRefund ?? 0) * (choices[line.saleLineId]?.quantity ?? 0), 0);
  const create = () => run(async () => {
    if (!sale) return;
    const created = await createReturn({
      saleId: sale.sale.id, receiptPresent, reasonSummary: reasonSummary.trim() || undefined, overrideReason: overrideReason.trim() || undefined, idempotencyKey,
      lines: selected.map((line) => {
        const choice = choices[line.saleLineId];
        return { saleLineId: line.saleLineId, quantity: String(choice.quantity), reasonCode: (choice.reasonCode || undefined) as never, reasonNote: choice.reasonNote.trim() || undefined,
          conditionCode: line.stockItem ? ((choice.conditionCode || undefined) as never) : undefined };
      }),
    });
    onCreated(created);
  });
  const currency = sale?.sale.currency ?? "INR";

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`New return · step ${step} of 3`} size="xl">
      <div className="flex flex-col gap-4">
        {step === 1 && (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <SearchField aria-label="Receipt or invoice number" placeholder="Scan the receipt or enter its number" value={code} onChange={setCode} onSubmit={find} className="min-w-[280px] flex-1" autoFocus />
              <Button variant="primary" onPress={find} isLoading={busy} isDisabled={!code.trim()}>Find sale</Button>
            </div>
            <Checkbox isSelected={!receiptPresent} onChange={(value) => setReceiptPresent(!value)}>The customer has no receipt (the sale was found another way)</Checkbox>
            {!receiptPresent && <p className="text-sm text-warning-emphasis">A return without the receipt needs the no-receipt permission, a reason and a supervisor&apos;s approval. The original sale must still be found.</p>}
            {sale && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] bg-surface-muted p-3 text-sm">
                  <span className="font-medium">{sale.sale.invoiceNumber ?? sale.sale.receiptNumber}</span>
                  <span>{dateTime(sale.sale.soldAt)}</span>
                  <span>{money(currency, sale.sale.grandTotal)}</span>
                  <span>{sale.payments.map((payment) => payment.method.toUpperCase()).join(" + ")}</span>
                  {sale.sale.customer && <span>{sale.sale.customer}</span>}
                  {sale.window.outside && <StatusBadge tone="warning">{`Outside the ${sale.window.days}-day window`}</StatusBadge>}
                  {sale.fullyReturned && <StatusBadge tone="neutral">Everything already returned</StatusBadge>}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <SearchField aria-label="Scan an item" placeholder="Scan an item to add it" value={itemScan} onChange={setItemScan} onSubmit={scanItem} className="min-w-[220px]" />
                </div>
                <table className="w-full text-sm">
                  <thead className="text-xs text-text-muted"><tr><th className="pb-1 text-left">Item</th><th className="pb-1 text-right">Sold</th><th className="pb-1 text-right">Returnable</th>
                    <th className="pb-1 text-right">Refund per unit</th><th className="pb-1 text-right">Return</th></tr></thead>
                  <tbody>{sale.lines.map((line) => (
                    <tr key={line.saleLineId} className="border-t border-border">
                      <td className="py-1.5">
                        {line.description}{line.serial?.number ? ` · S/N ${line.serial.number}` : ""}{line.batch?.number ? ` · batch ${line.batch.number}` : ""}
                        {line.restriction === "blocked" && <span className="ml-2 text-xs text-danger-emphasis">Not returnable</span>}
                        {line.restriction === "approval" && <span className="ml-2 text-xs text-warning-emphasis">Needs approval</span>}
                      </td>
                      <td className="text-right tabular-nums">{Number(line.sold)} {line.uom ?? ""}</td>
                      <td className="text-right tabular-nums">{Number(line.returnable)}</td>
                      <td className="text-right tabular-nums">{line.unitRefund ? money(currency, line.unitRefund) : "—"}</td>
                      <td className="w-28 text-right">
                        <NumberField aria-label={`Return quantity of ${line.description}`} size="compact" minValue={0} maxValue={Number(line.returnable)} step={line.wholeUnits ? 1 : 0.001}
                          value={choices[line.saleLineId]?.quantity ?? 0} isDisabled={Number(line.returnable) === 0 || line.restriction === "blocked"}
                          onChange={(value) => choose(line.saleLineId, { quantity: Number.isFinite(value) ? value : 0 })} />
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </>
        )}
        {step === 2 && sale && (
          <div className="flex flex-col gap-3">
            {selected.map((line) => {
              const choice = choices[line.saleLineId];
              return (
                <div key={line.saleLineId} className="grid grid-cols-1 gap-2 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-3">
                  <p className="text-sm font-medium sm:col-span-3">{line.description} × {choice.quantity}</p>
                  <Select label="Reason" selectedKey={choice.reasonCode || undefined} onSelectionChange={(value) => choose(line.saleLineId, { reasonCode: String(value) })}
                    options={(policy?.reasons ?? Object.keys(REASON_LABEL)).map((code) => ({ value: code, label: REASON_LABEL[code] ?? code }))} />
                  {line.stockItem ? (
                    <Select label="Condition" selectedKey={choice.conditionCode || undefined} onSelectionChange={(value) => choose(line.saleLineId, { conditionCode: String(value) })}
                      options={["unopened", "good", "opened", "damaged", "defective"].map((code) => ({ value: code, label: CONDITION_LABEL[code] }))} />
                  ) : <p className="self-end text-sm text-text-muted">A service — no stock comes back.</p>}
                  {choice.reasonCode === "other" && <TextField label="Describe the reason" value={choice.reasonNote} onChange={(value) => choose(line.saleLineId, { reasonNote: value })} maxLength={300} />}
                </div>
              );
            })}
            <TextField label={receiptPresent ? "Note (optional)" : "Why there is no receipt"} value={reasonSummary} onChange={setReasonSummary} maxLength={300} />
            {sale.window.outside && <TextField label="Override reason (only if you may override the return policy)" value={overrideReason} onChange={setOverrideReason} maxLength={300} />}
          </div>
        )}
        {step === 3 && sale && (
          <div className="flex flex-col gap-2 text-sm">
            <p>Returning {selected.length} item{selected.length === 1 ? "" : "s"} from {sale.sale.invoiceNumber ?? sale.sale.receiptNumber}.</p>
            <ul className="flex flex-col gap-1">{selected.map((line) => (
              <li key={line.saleLineId} className="flex justify-between border-t border-border py-1">
                <span>{line.description} × {choices[line.saleLineId].quantity} · {REASON_LABEL[choices[line.saleLineId].reasonCode] ?? "—"}{line.stockItem ? ` · ${CONDITION_LABEL[choices[line.saleLineId].conditionCode] ?? "—"}` : ""}</span>
                <span className="tabular-nums">{money(currency, String(Number(line.unitRefund ?? 0) * choices[line.saleLineId].quantity))}</span>
              </li>
            ))}</ul>
            <p className="text-base font-semibold">About {money(currency, String(estimate))} back to the customer</p>
            <p className="text-xs text-text-muted">The exact refund, the tax reversed and its split across the original payment methods are worked out from the original sale when the return is created. Nothing is refunded until it is posted.</p>
          </div>
        )}
        {error && <p className="text-sm text-danger-emphasis">{error}</p>}
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onPress={() => (step === 1 ? onClose() : setStep((step - 1) as 1 | 2))}>{step === 1 ? "Cancel" : "Back"}</Button>
          {step < 3
            ? <Button variant="primary" onPress={() => setStep((step + 1) as 2 | 3)} isDisabled={!selected.length || (step === 2 && lineIssues.length > 0)}>
                {step === 1 ? "Continue to reason & condition" : "Review refund"}
              </Button>
            : <Button variant="primary" onPress={create} isLoading={busy}>Create return</Button>}
        </div>
      </div>
    </Dialog>
  );
}
