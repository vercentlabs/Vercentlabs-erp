"use client";

// Your shift as the server has it: number, outlet, counter, opening time (server clock), cash mode and float, any handover received, and what
// can be taken. A card / UPI shift can start taking cash only by counting the drawer into a cash session here.
import { useState } from "react";
import { Button, Checkbox, StatusBadge, TextField } from "@vercentlabs/design-system";

import { openCashDrawer, pauseShift, resumeShift, type ShiftView } from "@/features/pos/shift-opening/api/shift-opening-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosAlert, PosFacts } from "@/features/pos/shared/PosUi";

const STATUS_LABEL: Record<string, string> = { OPEN: "Open", OPENING: "Opening", SUSPENDED: "Suspended", CLOSING: "Closing", CLOSED: "Closed", RECOVERY_REQUIRED: "Needs review", FORCE_CLOSED: "Force-closed" };

export function CurrentShiftFacts({ shift, onChange }: { shift: ShiftView; onChange: (next: ShiftView) => void }) {
  const [amount, setAmount] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = /^\d{1,14}(\.\d{1,2})?$/.test(amount.trim());
  const countDrawer = async () => {
    setBusy(true);
    setError(null);
    try { onChange(await openCashDrawer(shift.shiftId, { openingCash: amount.trim(), openingCashConfirmed: confirmed })); }
    catch (failure) { setError(failure instanceof PosApiError ? failure.message : "The cash drawer could not be opened."); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={shift.status === "OPEN" ? "success" : "warning"}>{STATUS_LABEL[shift.status] ?? shift.status}</StatusBadge>
        <StatusBadge tone="neutral">{shift.cashEnabled && shift.cashSessionId ? "Cash counter" : "Card / UPI only"}</StatusBadge>
      </div>
      <PosFacts columns={2} items={[
        { label: "Shift", value: shift.shiftNumber },
        { label: "Outlet", value: shift.storeName },
        { label: "Counter", value: `${shift.terminalName} (${shift.terminalCode})` },
        { label: "Opened at", value: dateTime(shift.openedAt) },
        { label: "Opening cash", value: shift.openingCashAmount === null ? "No cash drawer" : money(shift.currency, shift.openingCashAmount) },
        { label: "Payments", value: (["cash", "card", "upi"] as const).filter((method) => shift.paymentMethods[method]).map((method) => method.toUpperCase()).join(" · ") || "—" },
      ]} />
      {shift.handover && (
        <p className="text-sm text-text-muted">Cash received from {shift.previousShiftNumber ?? "the previous shift"}
          {shift.handover.amount ? `: handed over ${money(shift.currency, shift.handover.amount)}, difference ${money(shift.currency, shift.handover.variance ?? "0")}` : ""}
          {shift.handover.approved ? " (approved by a supervisor)" : ""}.</p>
      )}
      {!shift.cashSessionId && shift.status === "OPEN" && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-sm font-medium">Start taking cash</p>
          <p className="text-sm text-text-muted">Count the money in the drawer to open a cash session. Cash cannot be taken until you do.</p>
          <TextField label="Cash in the drawer (₹)" inputMode="decimal" value={amount} onChange={setAmount} className="sm:max-w-xs" />
          <Checkbox isSelected={confirmed} isDisabled={!valid} onChange={setConfirmed}>I counted the cash in the drawer</Checkbox>
          <div><Button size="compact" variant="secondary" isLoading={busy} isDisabled={!valid || !confirmed} onPress={countDrawer}>Open cash drawer</Button></div>
        </div>
      )}
      <ShiftPauseControls shift={shift} onChange={onChange} />
      {error && <PosAlert>{error}</PosAlert>}
    </div>
  );
}

// The cashier's own pause and resume: a paused shift takes no sales until its cashier enters their password again. Under review, only a
// supervisor can clear it.
function ShiftPauseControls({ shift, onChange }: { shift: ShiftView; onChange: (next: ShiftView) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<ShiftView>) => {
    setBusy(true);
    setError(null);
    try { onChange(await work()); setPassword(""); }
    catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Something went wrong."); } finally { setBusy(false); }
  };
  if (shift.status === "RECOVERY_REQUIRED")
    return <PosAlert>{`This shift is under review${shift.review?.reason ? `: ${shift.review.reason}` : ""}. A supervisor must clear it before sales or closing.`}</PosAlert>;
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      {shift.status === "OPEN" && (
        <div><Button size="compact" variant="ghost" isLoading={busy} onPress={() => run(() => pauseShift(shift.shiftId))}>Pause shift</Button></div>
      )}
      {shift.status === "SUSPENDED" && (
        <>
          <p className="text-sm">Shift paused{shift.suspension?.reason ? ` — ${shift.suspension.reason}` : ""}. Enter your password to carry on selling.</p>
          <TextField label="Your password" type="password" value={password} onChange={setPassword} className="sm:max-w-xs" />
          <div><Button size="compact" variant="primary" isLoading={busy} isDisabled={!password} onPress={() => run(() => resumeShift(shift.shiftId, password))}>Resume shift</Button></div>
        </>
      )}
      {error && <PosAlert>{error}</PosAlert>}
    </div>
  );
}
