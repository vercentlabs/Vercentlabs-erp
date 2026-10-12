"use client";

// Closing cash waiting to be accepted: cash a closer put in the safe (confirmed by a supervisor at the outlet) or handed to a named manager
// (confirmed by that manager) — never by the person who closed. Say what was actually received; a difference stays visible. Cash left in the
// drawer is accepted by the next shift's opening count, so it is only listed here.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, StatusBadge, TextField } from "@vercentlabs/design-system";

import { DESTINATION_LABEL, acceptTransfer, cashTransfers } from "@/features/pos/shift-closing/api/shift-closing-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosAlert, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const MONEY = /^\d{1,14}(\.\d{1,2})?$/;

export function CashTransfersPanel() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "pos", "cash-transfers");
  const query = useQuery({ queryKey: key, queryFn: () => cashTransfers({ status: "PENDING_ACCEPTANCE" }), retry: false });
  const [received, setReceived] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rows = query.data ?? [];
  if (!rows.length) return null;
  const accept = async (id: string) => {
    setBusy(id);
    setError(null);
    try { await acceptTransfer(id, { receivedAmount: received[id].trim(), note: notes[id]?.trim() || undefined }); await queryClient.invalidateQueries({ queryKey: key }); }
    catch (failure) { setError(failure instanceof PosApiError ? failure.message : "The cash could not be accepted."); } finally { setBusy(null); }
  };
  return (
    <PosPanel title="Closing cash waiting to be accepted" description="Count what you received. The person who closed the shift cannot accept it.">
      <ul className="flex flex-col divide-y divide-border text-sm">
        {rows.map((row) => {
          const inDrawer = row.type === "NEXT_SHIFT_HANDOVER" || row.type === "SECURED_DRAWER_PENDING_HANDOVER";
          const value = received[row.id] ?? "";
          const differs = MONEY.test(value.trim()) && Math.round(Number(value) * 100) !== Math.round(Number(row.amount) * 100);
          return (
            <li key={row.id} className="flex flex-col gap-2 py-2">
              <p className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="warning">Pending</StatusBadge>
                <span className="font-medium">{money(row.currency, row.amount)}</span>
                <span>{DESTINATION_LABEL[row.type]}{row.recipient ? ` (${row.recipient})` : ""}{row.reference ? ` · ${row.reference}` : ""}</span>
                <span className="text-text-muted">from {row.shiftNumber ?? "a shift"} · {row.handedOverBy ?? "—"} · {dateTime(row.handedOverAt)}</span>
              </p>
              {inDrawer ? <p className="text-text-muted">Accepted when the next shift on this drawer counts its opening cash.</p> : (
                <div className="flex flex-wrap items-end gap-2">
                  <TextField label="Received (₹)" size="compact" inputMode="decimal" value={value} onChange={(next) => setReceived((all) => ({ ...all, [row.id]: next }))} className="sm:max-w-[9rem]" />
                  {differs && <TextField label="Why it differs" size="compact" value={notes[row.id] ?? ""} onChange={(next) => setNotes((all) => ({ ...all, [row.id]: next }))} maxLength={300} />}
                  <Button size="compact" variant="secondary" isLoading={busy === row.id} isDisabled={!MONEY.test(value.trim()) || (differs && !notes[row.id]?.trim())} onPress={() => accept(row.id)}>
                    Accept cash
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <PosAlert>{error}</PosAlert>}
    </PosPanel>
  );
}
