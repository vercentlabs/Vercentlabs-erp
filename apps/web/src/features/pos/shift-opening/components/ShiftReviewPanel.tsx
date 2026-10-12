"use client";

// A supervisor on someone else's shift: pause it (with a reason), stop it for review (no sales, no closing), or clear a review by recording what
// was found — the cashier then signs in again to carry on. The server decides who may: SESSION_CLOSE_OTHER at that outlet, never the shift's
// own cashier.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, StatusBadge, TextField } from "@vercentlabs/design-system";

import { clearShiftReview, flagShiftForReview, pauseShift, shiftSession, type ShiftView } from "@/features/pos/shift-opening/api/shift-opening-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime } from "@/features/pos/shared/format";
import { PosAlert, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const LABEL: Record<string, string> = { OPEN: "Open", SUSPENDED: "Paused", RECOVERY_REQUIRED: "Under review", CLOSING: "Closing", CLOSED: "Closed", FORCE_CLOSED: "Force-closed" };

export function ShiftReviewPanel({ shiftId }: { shiftId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "pos", "shift-session", shiftId);
  const query = useQuery({ queryKey: key, queryFn: () => shiftSession(shiftId), retry: false });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shift = query.data;
  if (!shift || shift.cashierUserId === workspace.userId || ["CLOSED", "FORCE_CLOSED"].includes(shift.status)) return null;
  const run = async (work: () => Promise<ShiftView>) => {
    setBusy(true);
    setError(null);
    try { queryClient.setQueryData(key, await work()); setNote(""); }
    catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Something went wrong."); } finally { setBusy(false); }
  };
  return (
    <PosPanel title="Supervisor" description={`${shift.cashierName ?? "Cashier"} · ${shift.terminalName}`} actions={<StatusBadge tone={shift.status === "OPEN" ? "success" : "warning"}>{LABEL[shift.status] ?? shift.status}</StatusBadge>}>
      {shift.review && (
        <p className="text-sm">Review: {shift.review.reason} ({dateTime(shift.review.flaggedAt)}){shift.review.resolution ? ` — cleared: ${shift.review.resolution}` : ""}</p>
      )}
      <TextField label={shift.status === "RECOVERY_REQUIRED" ? "What was found and done" : "Reason"} value={note} onChange={setNote} maxLength={300} />
      <div className="flex flex-wrap gap-2">
        {shift.status === "OPEN" && <Button size="compact" variant="secondary" isLoading={busy} isDisabled={!note.trim()} onPress={() => run(() => pauseShift(shiftId, note.trim()))}>Pause shift</Button>}
        {["OPEN", "SUSPENDED"].includes(shift.status) && (
          <Button size="compact" variant="secondary" isLoading={busy} isDisabled={!note.trim()} onPress={() => run(() => flagShiftForReview(shiftId, note.trim()))}>Stop for review</Button>
        )}
        {shift.status === "RECOVERY_REQUIRED" && (
          <Button size="compact" variant="primary" isLoading={busy} isDisabled={!note.trim()} onPress={() => run(() => clearShiftReview(shiftId, note.trim()))}>Clear review</Button>
        )}
      </div>
      {error && <PosAlert>{error}</PosAlert>}
    </PosPanel>
  );
}
