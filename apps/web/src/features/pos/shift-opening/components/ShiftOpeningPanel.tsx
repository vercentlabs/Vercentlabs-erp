"use client";

// Open your shift in three steps: confirm the counter (preselected when there is one), count the opening cash (cash counters only — an amount,
// or the notes and coins), and start selling once nothing blocks it. Every figure and check comes from the server; the button is safe to press
// twice (one shift), and a lost answer is recovered by asking for the current shift, never by opening another.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { getApproval, requestApproval } from "@/features/pos/permission-profiles/api/profiles-api";
import {
  currentShift, openShift, openingContext, previewOpening, type OpeningPreview, type ShiftView,
} from "@/features/pos/shift-opening/api/shift-opening-api";
import { PosApiError } from "@/features/pos/shared/http";
import { money } from "@/features/pos/shared/format";
import { PosAlert, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const MONEY = /^\d{1,14}(\.\d{1,2})?$/;

export function ShiftOpeningPanel({ onOpened }: { onOpened: (shift: ShiftView) => void }) {
  const workspace = useWorkspaceContext();
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const context = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "shift-opening", terminalId), queryFn: () => openingContext(terminalId), retry: false });
  const data = context.data;
  const chosen = terminalId ?? data?.selectedTerminalId ?? null;
  const counter = data?.counters.find((entry) => entry.terminalId === chosen) ?? null;
  const [cashMode, setCashMode] = useState<boolean | null>(null);
  const cashEnabled = cashMode ?? Boolean(counter?.cashCounter);
  const [amount, setAmount] = useState("");
  const [byNotes, setByNotes] = useState(false);
  const [counts, setCounts] = useState<Record<number, string>>({});
  // Where the cash came from when nothing was handed over: a fresh float given to the cashier, or cash already in this drawer.
  const [source, setSource] = useState<"FRESH_FLOAT" | "EXISTING_DRAWER">("FRESH_FLOAT");
  const [sourceReference, setSourceReference] = useState("");
  // Confirmation and approval belong to the figures they were given for (counter, mode, count): a change drops them.
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [approval, setApproval] = useState<{ key: string; id: string; state: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const denominations = useMemo(() => (byNotes ? (data?.denominations ?? []).map((value) => ({ denomination: value, count: Number(counts[value] || 0) }))
    .filter((entry) => Number.isInteger(entry.count) && entry.count >= 0) : undefined), [byNotes, counts, data?.denominations]);
  const countedTotal = denominations ? denominations.reduce((sum, entry) => sum + entry.denomination * entry.count, 0) : null;
  const openingCash = byNotes ? (countedTotal === null ? undefined : countedTotal.toFixed(2)) : MONEY.test(amount.trim()) ? amount.trim() : undefined;
  const counted = !cashEnabled || openingCash !== undefined;

  // The preview follows every change: blocking problems, warnings, the handover comparison and whether a supervisor must approve.
  const previewKey = JSON.stringify({ chosen, cashEnabled, openingCash, source });
  const preview = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "shift-opening-preview", previewKey),
    queryFn: () => previewOpening({ terminalId: chosen!, cashEnabled, ...(cashEnabled ? { openingCash: openingCash ?? "0" } : {}) }),
    // (The float's source is decided with the count when the shift opens; a handover waiting in the drawer makes it a handover.)
    enabled: Boolean(chosen) && !data?.currentShift,
    retry: false,
  });
  const ready = preview.data as OpeningPreview | undefined;
  // A new attempt (changed counter, mode or count) gets a new key and drops an approval given for the old figures.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), [previewKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirmed = confirmedFor === previewKey;
  const approvalId = approval?.key === previewKey ? approval.id : null;
  const approvalState = approval?.key === previewKey ? approval.state : null;
  useEffect(() => {
    if (!approvalId || approvalState !== "pending") return undefined;
    const timer = setInterval(async () => {
      try { const status = (await getApproval(approvalId)).status; setApproval((current) => (current?.id === approvalId ? { ...current, state: status } : current)); } catch { /* keep waiting */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [approvalId, approvalState]);

  // Already open (a refresh, another tab): restored, never opened again.
  useEffect(() => { if (data?.currentShift) onOpened(data.currentShift); }, [data?.currentShift, onOpened]);

  if (context.isLoading) return <PosLoading label="Checking your counters…" />;
  if (context.isError || !data) return <PosAlert>{context.error instanceof PosApiError ? context.error.message : "Could not load your counters."}</PosAlert>;
  if (data.currentShift) return null;

  const askApproval = async () => {
    if (!ready?.approvalRequired || !chosen) return;
    setBusy(true);
    setError(null);
    try {
      const requested = await requestApproval({ permission: "SESSION_OPEN_OWN", resource: { type: "pos_terminal", id: chosen }, amount: ready.approvalAmount,
        action: { fingerprint: ready.approvalFingerprint, openingCash }, reason: reason.trim(), idempotencyKey: `${idempotencyKey}:approval` });
      setApproval({ key: previewKey, id: requested.id, state: requested.status });
    } catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Could not ask for approval."); } finally { setBusy(false); }
  };

  const open = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const received = ready?.handover ?? null;
      const shift = await openShift({ terminalId: chosen, cashEnabled, ...(cashEnabled ? { openingCash, denominations, openingCashConfirmed: confirmed,
        ...(received ? { handoverId: received.id } : Number(openingCash ?? 0) > 0 ? { sourceType: source, sourceReference: sourceReference.trim() || undefined } : {}) } : {}),
        varianceReason: reason.trim() || undefined, approvalId, expectedTerminalVersion: ready?.terminalVersion, idempotencyKey });
      onOpened(shift);
    } catch (failure) {
      if (failure instanceof PosApiError) setError(failure.message);
      else {
        // No answer: the shift may have opened. Ask, never open another.
        setError("Checking whether your shift opened. Do not open another.");
        try { const shift = await currentShift(); if (shift) onOpened(shift); else setError("The shift did not open. Try again."); }
        catch { setError("Connection lost. Your shift will be shown when the connection is back."); }
      }
    } finally { setBusy(false); }
  };

  const blocked = preview.error instanceof PosApiError ? preview.error : null;
  const handover = ready?.handover ?? null;
  const needsApproval = Boolean(ready?.approvalRequired);
  const needsReason = Boolean(ready?.varianceReasonRequired);
  const typedTotal = MONEY.test(amount.trim()) ? Number(amount.trim()) : null;
  const modesDisagree = byNotes && typedTotal !== null && countedTotal !== null && countedTotal > 0 && typedTotal !== countedTotal;
  const canOpen = Boolean(chosen) && !blocked && ready?.readyToOpen && counted && (!cashEnabled || confirmed) && (!needsReason || reason.trim())
    && (!needsApproval || approvalState === "approved");

  return (
    <PosPanel title="Open your shift" description={data.company ?? undefined} className="max-w-2xl">
      {/* Step 1 — the counter */}
      <section className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase text-text-muted">1 · Your counter</p>
        <Select label="Counter" selectedKey={chosen} placeholder="Choose a counter"
          onSelectionChange={(key) => { setTerminalId(String(key)); setCashMode(null); }}
          options={data.counters.map((entry) => ({ value: entry.terminalId, label: `${entry.storeName} · ${entry.name} (${entry.code})${entry.occupied ? ` — in use by ${entry.occupiedBy ?? "you"}` : ""}`,
            isDisabled: entry.occupied && !entry.mine }))} />
        {!data.counters.length && <p className="text-sm text-text-muted">No counter is assigned to you. Ask your manager.</p>}
      </section>

      {/* Step 2 — opening cash (cash counters only) */}
      {counter && (
        <section className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-xs font-medium uppercase text-text-muted">2 · Opening cash</p>
          {counter.cashCounter ? (
            <Checkbox isSelected={cashEnabled} onChange={(value) => setCashMode(value)}>This counter takes cash today</Checkbox>
          ) : <p className="text-sm text-text-muted">Card / UPI counter — no cash drawer to count.</p>}
          {cashEnabled && (
            <>
              <p className="text-sm text-text-muted">Count the money already in your drawer{ready?.cashDrawer ? ` (${ready.cashDrawer.name})` : ""}.</p>
              {handover && (
                <p className="text-sm">Cash was handed over by {handover.handedOverBy ?? "the previous cashier"} ({handover.fromShiftNumber})
                  {handover.amount ? `: ${money("INR", handover.amount)}.` : "."}</p>
              )}
              {byNotes ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {(data.denominations ?? []).map((value) => (
                    <TextField key={value} label={`₹${value}`} inputMode="numeric" value={counts[value] ?? ""} onChange={(next) => setCounts((all) => ({ ...all, [value]: next.replace(/\D/g, "") }))} />
                  ))}
                </div>
              ) : (
                <TextField label="Opening amount (₹)" inputMode="decimal" value={amount} onChange={setAmount} className="sm:max-w-xs"
                  errorMessage={amount && !MONEY.test(amount.trim()) ? "Enter an amount such as 2000 or 2000.50." : undefined} />
              )}
              <div className="flex items-center gap-3">
                <Button size="compact" variant="ghost" onPress={() => setByNotes((value) => !value)}>{byNotes ? "Enter a total instead" : "Count notes and coins"}</Button>
                {byNotes && <span className="text-sm font-semibold tabular-nums">{money("INR", countedTotal ?? 0)}</span>}
              </div>
              {modesDisagree && <p className="text-sm text-warning-emphasis">Your notes and coins add up to {money("INR", countedTotal)}, not the {money("INR", typedTotal)} you typed. The notes-and-coins count is what will be recorded.</p>}
              {!handover && Number(openingCash ?? 0) > 0 && (
                <div className="flex flex-wrap items-end gap-2">
                  <Select label="Where the cash came from" size="compact" selectedKey={source} onSelectionChange={(key) => setSource(key === "EXISTING_DRAWER" ? "EXISTING_DRAWER" : "FRESH_FLOAT")}
                    options={[{ value: "FRESH_FLOAT", label: "A fresh float given to me" }, { value: "EXISTING_DRAWER", label: "Cash already in this drawer" }]} />
                  <TextField label="Reference (optional)" size="compact" value={sourceReference} onChange={setSourceReference} maxLength={120} description="E.g. the safe slip number." />
                </div>
              )}
              {handover?.variance && handover.variance !== "0.00" && <p className="text-sm text-warning-emphasis">Difference from the handover: {money("INR", handover.variance)}</p>}
              {ready?.varianceBlocked && <PosAlert>The count differs from the cash handed over by more than the company allows. A manager must resolve it before this drawer opens.</PosAlert>}
              {needsReason && !ready?.varianceBlocked && (
                <div className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-surface-muted px-3 py-2">
                  <p className="text-sm">{needsApproval ? "The count differs from the cash handed over. Say why and ask a supervisor to approve before opening." : "The count differs from the cash handed over. Say why — it is kept with the shift."}</p>
                  <TextField label="Why the count differs" value={reason} onChange={setReason} maxLength={300} />
                  {needsApproval && <div className="flex items-center gap-2">
                    <Button size="compact" variant="secondary" isLoading={busy} isDisabled={!reason.trim() || Boolean(approvalId)} onPress={askApproval}>Ask a supervisor</Button>
                    {approvalState && <StatusBadge tone={approvalState === "approved" ? "success" : approvalState === "pending" ? "warning" : "danger"}>{`Approval ${approvalState}`}</StatusBadge>}
                  </div>}
                </div>
              )}
              <Checkbox isSelected={confirmed} isDisabled={!counted} onChange={(value) => setConfirmedFor(value ? previewKey : null)}>I counted the cash in the drawer: {openingCash ? money("INR", openingCash) : "—"}</Checkbox>
            </>
          )}
        </section>
      )}

      {/* Step 3 — readiness and start */}
      {counter && (
        <section className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-xs font-medium uppercase text-text-muted">3 · Start selling</p>
          {blocked && <PosAlert>{blocked.message}</PosAlert>}
          {ready && (
            <ul className="flex flex-wrap gap-2 text-sm">
              {(["cash", "card", "upi"] as const).map((method) => (
                <li key={method}><StatusBadge tone={ready.paymentMethods[method] ? "success" : "neutral"}>{`${method.toUpperCase()} ${ready.paymentMethods[method] ? "ready" : "off"}`}</StatusBadge></li>
              ))}
            </ul>
          )}
          {ready?.warnings.map((warning) => <p key={warning.code} className="text-sm text-warning-emphasis">{warning.message}</p>)}
          {error && <PosAlert>{error}</PosAlert>}
          <div><Button variant="primary" isLoading={busy} isDisabled={!canOpen} onPress={open}>Open shift &amp; start selling</Button></div>
        </section>
      )}
    </PosPanel>
  );
}
