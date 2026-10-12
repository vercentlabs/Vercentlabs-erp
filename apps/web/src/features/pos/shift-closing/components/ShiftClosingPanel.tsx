"use client";

// Close a shift in four steps: 1 check what is unfinished (and start closing — no new bills from then on), 2 count the drawer blind (an amount
// or notes and coins), 3 review the difference (a reason, a supervisor's approval when the company asks for one), 4 say where the cash goes
// and close. Every figure and rule comes from the server; a refresh resumes the same step, and a lost answer is recovered by asking whether
// the shift closed — never by closing again. A card / UPI shift skips the count.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { getApproval } from "@/features/pos/permission-profiles/api/profiles-api";
import {
  DESTINATION_LABEL, beginClosing, cancelClosing, closeShiftNow, closingContext, recoverClosing, requestClosingApproval, submitCount,
  type ClosingContext, type ClosingResult, type Destination, type DestinationInput,
} from "@/features/pos/shift-closing/api/shift-closing-api";
import { ClosingReportView } from "@/features/pos/shift-closing/components/ClosingReportView";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosAlert, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const MONEY = /^\d{1,14}(\.\d{1,2})?$/;
const STEPS = ["Check unfinished transactions", "Count cash in drawer", "Review difference and confirm", "Choose handover and close shift"];
const toPaise = (value: string | number) => Math.round(Number(value) * 100);

export function ShiftClosingPanel({ shiftId = null, onClosed }: { shiftId?: string | null; onClosed?: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "pos", "shift-closing", shiftId ?? "current");
  const query = useQuery({ queryKey: key, queryFn: () => closingContext(shiftId), retry: false });
  const data = query.data;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [supervisorReason, setSupervisorReason] = useState("");
  // Step 2 — the count.
  const [recounting, setRecounting] = useState(false);
  const [byNotes, setByNotes] = useState(false);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  // Step 3 — the difference.
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [reasonNote, setReasonNote] = useState("");
  const [approval, setApproval] = useState<{ countId: string; id: string; state: string } | null>(null);
  // Step 4 — where the cash goes.
  const [destinations, setDestinations] = useState<DestinationInput[] | null>(null);
  const [result, setResult] = useState<ClosingResult | null>(null);

  const count = data?.count ?? null;
  const countId = count?.id ?? "none";
  // One request key per count: pressing Close twice, or retrying after a lost answer, is the same close.
  const closeKey = useMemo(() => crypto.randomUUID(), [countId]); // eslint-disable-line react-hooks/exhaustive-deps
  const countKey = useMemo(() => crypto.randomUUID(), [countId, recounting]); // eslint-disable-line react-hooks/exhaustive-deps
  const approvalId = approval?.countId === countId ? approval.id : null;
  const approvalState = approval?.countId === countId ? approval.state : null;
  useEffect(() => {
    if (!approvalId || approvalState !== "pending") return undefined;
    const timer = setInterval(async () => {
      try { const status = (await getApproval(approvalId)).status; setApproval((current) => (current?.id === approvalId ? { ...current, state: status } : current)); } catch { /* keep waiting */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [approvalId, approvalState]);

  if (query.isLoading) return <PosLoading label="Loading the shift…" />;
  if (query.isError || !data) return <PosAlert>{query.error instanceof PosApiError ? query.error.message : "Could not load the shift."}</PosAlert>;

  const currency = data.shift.currency || "INR";
  const shift = data.shift;
  const set = (next: ClosingContext) => queryClient.setQueryData(key, next);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); } catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Something went wrong. Check the connection and try again."); } finally { setBusy(false); }
  };
  const done = result ?? data.closing;
  if (done) return <ClosedView context={data} closing={done} />;

  const blockers = data.blockers;
  const checkoutBlocked = Boolean(blockers?.items.some((item) => item.type === "ACTIVE_CHECKOUT" && item.blocking));
  const stepIndex = data.step === "CHECK" ? 0 : data.step === "COUNT" || recounting ? 1 : 2;
  const supervising = !data.mine;

  const denominations = byNotes ? data.policy.denominations.map((value) => ({ denomination: value, count: Number(notes[value] || 0) })) : undefined;
  const notesTotal = denominations ? denominations.reduce((sum, entry) => sum + entry.denomination * entry.count, 0) : null;
  const typed = byNotes ? (notesTotal ?? 0).toFixed(2) : MONEY.test(amount.trim()) ? amount.trim() : null;

  const begin = () => run(async () => { set(await beginClosing(shift.id, { expectedVersion: shift.version, ...(supervising ? { reason: supervisorReason.trim(), takeOver: true } : {}) })); });
  const cancel = () => run(async () => { set(await cancelClosing(shift.id, supervising ? { reason: supervisorReason.trim() } : {})); setRecounting(false); });
  const saveCount = () => run(async () => {
    await submitCount(shift.id, { ...(byNotes ? { denominations: denominations!.filter((entry) => entry.count > 0) } : { countedAmount: typed! }), countedConfirmed: confirmed, idempotencyKey: countKey });
    setRecounting(false); setConfirmed(false); setDestinations(null); setApproval(null);
    await query.refetch();
  });
  const askApproval = () => run(async () => {
    const asked = await requestClosingApproval(shift.id, { reason: reasonNote.trim() || undefined, idempotencyKey: `${closeKey}:approval` });
    setApproval({ countId, id: asked.id, state: asked.status });
  });

  const counted = count ? toPaise(count.countedAmount) : 0;
  const rows = destinations ?? (count && counted > 0 ? [{ type: "NEXT_SHIFT_HANDOVER" as Destination, amount: count.countedAmount }] : []);
  const allocated = rows.reduce((sum, row) => sum + (MONEY.test(row.amount.trim()) ? toPaise(row.amount) : 0), 0);
  const rowsValid = rows.every((row) => MONEY.test(row.amount.trim()) && toPaise(row.amount) > 0 && (row.type !== "STORE_SAFE" || row.reference?.trim())
    && (row.type !== "AUTHORIZED_MANAGER" || row.recipientUserId));
  const noteNeeded = Boolean(data.policy.varianceReasons.find((entry) => entry.code === reasonCode)?.requiresNote);
  const reasonOk = !count?.reasonRequired || (reasonCode && (!noteNeeded || reasonNote.trim()));
  const approvalOk = !count?.approvalRequired || supervising || approvalState === "approved";
  const canClose = shift.status === "CLOSING" && (!shift.cashEnabled || (count && !recounting && !count.stale && reasonOk && approvalOk && (counted === 0 || (rowsValid && allocated === counted))))
    && Boolean(blockers?.ready) && (!count?.blocked || supervising) && (!supervising || supervisorReason.trim());

  const close = () => run(async () => {
    try {
      const closing = await closeShiftNow(shift.id, {
        ...(count ? { closingCountId: count.id } : {}),
        ...(count?.reasonRequired ? { varianceReasonCode: reasonCode ?? undefined, varianceReason: reasonNote.trim() || undefined } : {}),
        approvalId, destinations: counted > 0 ? rows.map((row) => ({ ...row, amount: row.amount.trim(), reference: row.reference?.trim() || undefined })) : undefined,
        idempotencyKey: closeKey, ...(supervising ? { reason: supervisorReason.trim() } : {}),
      });
      setResult(closing);
      onClosed?.();
    } catch (failure) {
      if (failure instanceof PosApiError) throw failure;
      // No answer: the shift may have closed. Ask — never close again.
      setError("Checking whether the shift closed. Do not close it again.");
      const recovered = await recoverClosing(shift.id);
      if (recovered.closed && recovered.closing) { setResult(recovered.closing); setError(null); onClosed?.(); }
      else setError("The shift did not close. Try again.");
    }
  });

  return (
    <PosPanel title="Close shift" description={`${shift.storeName} · ${shift.terminalName} (${shift.terminalCode}) · ${shift.shiftNumber}${shift.cashier ? ` · ${shift.cashier}` : ""}`} className="max-w-3xl">
      <ol className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {STEPS.map((label, index) => (
          <li key={label} className={`rounded-[var(--radius-control)] px-2 py-1.5 ${index === stepIndex ? "bg-info-soft font-semibold text-info" : index < stepIndex ? "text-text-secondary" : "text-text-muted"}`}>
            {index + 1} · {label}
          </li>
        ))}
      </ol>
      {supervising && (
        <TextField label="Why you are closing this cashier's shift" value={supervisorReason} onChange={setSupervisorReason} maxLength={300}
          description={shift.closingStartedBy ? `Closing was started by ${shift.closingStartedBy}.` : undefined} />
      )}

      {/* Step 1 — what is unfinished */}
      <section className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Completed sales", String(data.summary.sales.count)], ["Total sales", money(currency, data.summary.sales.total)],
            ["Needs attention", String(blockers?.blocking ?? 0)], ["Held bills", String(blockers?.heldCarts ?? 0)]].map(([label, value]) => (
            <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
              <p className="text-xs text-text-muted">{label}</p>
              <p className="text-base font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        {blockers && blockers.items.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {blockers.items.map((item) => (
              <li key={`${item.type}:${item.referenceId}`} className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={item.blocking ? "danger" : item.managed ? "info" : "neutral"}>{item.blocking ? "Resolve first" : item.managed ? "Owner assigned" : "Continues after close"}</StatusBadge>
                <span>{item.label}</span>{item.amount && <span className="tabular-nums text-text-muted">{money(currency, item.amount)}</span>}
              </li>
            ))}
          </ul>
        )}
        {blockers?.ready && <p className="text-sm text-success">No blocking transactions remain.</p>}
        {(blockers?.openBills ?? 0) > 0 && <p className="text-sm text-text-muted">{blockers!.openBills} unfinished bill(s) without payment will be held for a later shift.</p>}
        {data.step === "CHECK" && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" isLoading={busy} isDisabled={checkoutBlocked || (supervising && !supervisorReason.trim())} onPress={begin}>
              {shift.cashEnabled ? "Continue to cash count" : "Start closing"}
            </Button>
            {checkoutBlocked && <span className="text-sm text-text-muted">Finish or release the checkout in progress first.</span>}
          </div>
        )}
      </section>

      {/* Step 2 — the blind count */}
      {shift.status === "CLOSING" && shift.cashEnabled && (data.step === "COUNT" || recounting) && (
        <section className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-sm">Count the money in {shift.cashDrawer ? `the ${shift.cashDrawer.name} drawer` : "the drawer"}. {data.policy.blindCount ? "The expected amount is shown after you count." : ""}</p>
          {byNotes ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {data.policy.denominations.map((value) => (
                <TextField key={value} label={`₹${value}`} inputMode="numeric" value={notes[value] ?? ""} onChange={(next) => setNotes((all) => ({ ...all, [value]: next.replace(/\D/g, "") }))} />
              ))}
            </div>
          ) : (
            <TextField label="Counted cash (₹)" inputMode="decimal" value={amount} onChange={setAmount} className="sm:max-w-xs"
              errorMessage={amount && !MONEY.test(amount.trim()) ? "Enter an amount such as 7950 or 7950.50." : undefined} />
          )}
          <div className="flex items-center gap-3">
            <Button size="compact" variant="ghost" onPress={() => setByNotes((value) => !value)}>{byNotes ? "Enter a total instead" : "Count notes and coins"}</Button>
            {byNotes && <span className="text-sm font-semibold tabular-nums">{money(currency, notesTotal ?? 0)}</span>}
          </div>
          <Checkbox isSelected={confirmed} isDisabled={typed === null} onChange={setConfirmed}>I have physically counted the cash in this drawer: {typed ? money(currency, typed) : "—"}</Checkbox>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" isLoading={busy} isDisabled={!confirmed || typed === null} onPress={saveCount}>Review cash difference</Button>
            {recounting && <Button variant="ghost" onPress={() => setRecounting(false)}>Keep the earlier count</Button>}
          </div>
        </section>
      )}

      {/* Step 3 — the difference */}
      {shift.status === "CLOSING" && count && !recounting && (
        <section className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="grid grid-cols-3 gap-3">
            {[["Expected cash", count.expectedAmount === null ? "Hidden" : money(currency, count.expectedAmount)], ["Physically counted", money(currency, count.countedAmount)],
              ["Cash difference", count.varianceAmount === null ? (count.direction === "EXACT" ? "None" : "Differs") : money(currency, count.varianceAmount)]].map(([label, value]) => (
              <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
                <p className="text-xs text-text-muted">{label}</p>
                <p className={`text-base font-semibold tabular-nums ${label === "Cash difference" && count.direction !== "EXACT" ? "text-warning-emphasis" : ""}`}>{value}</p>
              </div>
            ))}
          </div>
          {/* Cash Difference (0106): shortage, overage or a match, in plain words; a comparison made stale by a later cash event needs a recount. */}
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <StatusBadge tone={count.differenceType === "MATCH" ? "success" : "warning"}>{count.differenceType === "MATCH" ? "Cash matches" : count.differenceType === "SHORTAGE" ? "Shortage" : "Overage"}</StatusBadge>
            {count.differenceType !== "MATCH" && (count.varianceAmount
              ? `${money(currency, count.varianceAmount.replace("-", ""))} ${count.differenceType === "SHORTAGE" ? "less" : "more"} than expected. Please review your cash count.`
              : "Your count differs from the expected cash. Please review your count.")}
          </p>
          {count.stale && <PosAlert tone="warning">Cash in the drawer changed after your count (for example a refund payout was confirmed). Count the drawer again.</PosAlert>}
          {count.recounts > 0 && <p className="text-xs text-text-muted">Count {count.sequence} ({count.recounts} earlier count{count.recounts > 1 ? "s" : ""} kept).</p>}
          {count.blocked && <PosAlert>The difference is above what the company allows. {supervising ? "As the supervisor, reconcile it: record the reason and close." : "A supervisor must reconcile and close this shift."}</PosAlert>}
          {count.reasonRequired && (
            <div className="flex flex-wrap items-end gap-2">
              <Select label="Reason" size="compact" selectedKey={reasonCode} placeholder="Choose a reason" onSelectionChange={(value) => setReasonCode(value ? String(value) : null)}
                options={data.policy.varianceReasons.map((entry) => ({ value: entry.code, label: entry.label }))} />
              <TextField label={noteNeeded ? "Explain the difference" : "Note (optional)"} size="compact" value={reasonNote} onChange={setReasonNote} maxLength={300} className="sm:min-w-[18rem]" />
            </div>
          )}
          {count.approvalRequired && !count.blocked && !supervising && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="compact" variant="secondary" isLoading={busy} isDisabled={!reasonOk || Boolean(approvalId)} onPress={askApproval}>Ask a supervisor to approve</Button>
              {approvalState && <StatusBadge tone={approvalState === "approved" ? "success" : approvalState === "pending" ? "warning" : "danger"}>{`Approval ${approvalState}`}</StatusBadge>}
            </div>
          )}
          <div><Button size="compact" variant="ghost" onPress={() => { setRecounting(true); setAmount(""); setNotes({}); }}>Recount</Button></div>
        </section>
      )}

      {/* Step 4 — where the cash goes, and close */}
      {shift.status === "CLOSING" && (!shift.cashEnabled || (count && !recounting)) && (
        <section className="flex flex-col gap-2 border-t border-border pt-3">
          {shift.cashEnabled && counted > 0 ? (
            <>
              <p className="text-sm">Where will the {money(currency, count!.countedAmount)} be kept? Each amount stays pending until the person receiving it accepts it.</p>
              {rows.map((row, index) => (
                <div key={index} className="flex flex-wrap items-end gap-2">
                  <Select label="Destination" size="compact" selectedKey={row.type} className="sm:min-w-[18rem]"
                    onSelectionChange={(value) => setDestinations(rows.map((entry, at) => (at === index ? { ...entry, type: String(value) as Destination } : entry)))}
                    options={data.policy.destinations.map((type) => ({ value: type, label: DESTINATION_LABEL[type] }))} />
                  <TextField label="Amount (₹)" size="compact" inputMode="decimal" value={row.amount} className="sm:max-w-[9rem]"
                    onChange={(value) => setDestinations(rows.map((entry, at) => (at === index ? { ...entry, amount: value } : entry)))} />
                  {row.type === "STORE_SAFE" && <TextField label="Safe slip / bag no." size="compact" value={row.reference ?? ""} maxLength={120}
                    onChange={(value) => setDestinations(rows.map((entry, at) => (at === index ? { ...entry, reference: value } : entry)))} />}
                  {row.type === "AUTHORIZED_MANAGER" && <Select label="Manager" size="compact" selectedKey={row.recipientUserId ?? null} placeholder="Who receives it"
                    onSelectionChange={(value) => setDestinations(rows.map((entry, at) => (at === index ? { ...entry, recipientUserId: value ? String(value) : undefined } : entry)))}
                    options={data.receivers.map((entry) => ({ value: entry.userId, label: entry.name }))} />}
                  {rows.length > 1 && <Button size="compact" variant="ghost" onPress={() => setDestinations(rows.filter((_, at) => at !== index))}>Remove</Button>}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {rows.length < 4 && <Button size="compact" variant="ghost" onPress={() => setDestinations([...rows, { type: "STORE_SAFE", amount: ((counted - allocated) / 100).toFixed(2) }])}>Split the cash</Button>}
                <span className={allocated === counted ? "text-success" : "text-warning-emphasis"}>Allocated {money(currency, allocated / 100)} of {money(currency, counted / 100)}</span>
              </div>
            </>
          ) : <p className="text-sm text-text-muted">{shift.cashEnabled ? "No cash to hand over." : "Card / UPI shift — no cash count. Card and UPI settle later; that never blocks closing."}</p>}
          {error && <PosAlert>{error}</PosAlert>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" isLoading={busy} isDisabled={!canClose} onPress={close}>Close shift</Button>
            <Button variant="ghost" isDisabled={busy} onPress={cancel}>Back to selling</Button>
          </div>
        </section>
      )}
      {data.step === "CHECK" && error && <PosAlert>{error}</PosAlert>}
    </PosPanel>
  );
}

function ClosedView({ context, closing }: { context: ClosingContext; closing: ClosingResult }) {
  const currency = context.shift.currency || "INR";
  return (
    <PosPanel title={`Shift ${context.shift.shiftNumber} closed`} description={`${context.shift.storeName} · ${context.shift.terminalCode} · ${dateTime(closing.closedAt)}`} className="max-w-3xl">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Status", closing.status === "FORCE_CLOSED" ? "Force-closed" : "Closed"], ["Counted cash", closing.countedCashAmount === null ? "Not applicable" : money(currency, closing.countedCashAmount)],
          ["Expected cash", closing.expectedCashAmount === null ? "—" : money(currency, closing.expectedCashAmount)],
          ["Difference", closing.cashVarianceAmount === null ? "—" : money(currency, closing.cashVarianceAmount)]].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
            <p className="text-xs text-text-muted">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      {closing.destinations.length > 0 && (
        <ul className="text-sm">
          {closing.destinations.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={row.status === "ACCEPTED" ? "success" : "warning"}>{row.status === "ACCEPTED" ? `Accepted by ${row.acceptedBy ?? "recipient"}` : "Pending acceptance"}</StatusBadge>
              <span>{DESTINATION_LABEL[row.type]}{row.recipient ? ` (${row.recipient})` : ""}{row.reference ? ` · ${row.reference}` : ""}: {money(currency, row.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {closing.exceptions.length > 0 && <p className="text-sm text-text-muted">{closing.exceptions.length} item(s) handed on with an owner: {closing.exceptions.map((row) => row.type.replace(/_/g, " ").toLowerCase()).join(", ")}.</p>}
      <ClosingReportView shiftId={context.shift.id} canSeeExpected={context.canSeeExpected} />
    </PosPanel>
  );
}
