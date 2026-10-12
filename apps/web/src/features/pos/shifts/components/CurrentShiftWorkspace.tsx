"use client";

// Shifts & Cash › Current shift: the signed-in cashier's shift as the server has it (restored after a refresh or a lost connection). No
// shift: open one here (counter, opening float, handover). A shift open: its details, Go to Register, cash in / out, and Close shift — the
// four-step close (unfinished transactions, blind count, difference, handover), shown on request or straight away while a close is under way.
import { useCallback, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import { Button, LinkButton, PermissionState } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { currentShift, type ShiftView } from "@/features/pos/shift-opening/api/shift-opening-api";
import { CurrentShiftFacts } from "@/features/pos/shift-opening/components/CurrentShiftPanel";
import { ShiftOpeningPanel } from "@/features/pos/shift-opening/components/ShiftOpeningPanel";
import { ShiftClosingPanel } from "@/features/pos/shift-closing/components/ShiftClosingPanel";
import { PosLoading, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function CurrentShiftWorkspace({ startClosing = false }: { startClosing?: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const [closing, setClosing] = useState(startClosing);
  const shiftKey = scopedQueryKey(workspace, "pos", "shifts", "current");
  const shiftQuery = useQuery({ queryKey: shiftKey, queryFn: currentShift });
  const shift = shiftQuery.data ?? null;
  const setShift = useCallback((value: ShiftView) => { queryClient.setQueryData(shiftKey, value); }, [queryClient, shiftKey]);

  if (shiftQuery.isLoading) return <PosLoading label="Checking your shift…" />;
  if (!shift) {
    if (can(POS_PERMISSIONS.shiftOpen)) return <ShiftOpeningPanel onOpened={setShift} />;
    return <PermissionState title="No shift is open for you" description="You are not authorized to open one. Ask a supervisor to open a shift." />;
  }
  const closingNow = closing || shift.status === "CLOSING";
  return (
    <div className="flex flex-col gap-4">
      <PosPanel title={`Current shift ${shift.shiftNumber}`} description={`${shift.storeName} · ${shift.terminalCode} ${shift.terminalName}`}
        actions={<LinkButton variant="primary" size="compact" href="/pos/register"><ShoppingCart className="size-4" aria-hidden="true" />Go to Register</LinkButton>}>
        <CurrentShiftFacts shift={shift} onChange={setShift} />
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {shift.cashSessionId && can(POS_PERMISSIONS.cashAdjust) && (
            <LinkButton variant="secondary" size="compact" href="/pos/shifts?tab=cash-movements">Cash in / out</LinkButton>
          )}
          {can(POS_PERMISSIONS.shiftClose) && !closingNow && <Button variant="secondary" size="compact" onPress={() => setClosing(true)}>Close shift</Button>}
        </div>
      </PosPanel>
      {can(POS_PERMISSIONS.shiftClose) && closingNow && (
        <ShiftClosingPanel onClosed={() => { setClosing(false); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "shifts") }); }} />
      )}
      <p className="text-xs text-text-muted">Past shifts, their closing reports and cash movements are under <Link className="text-brand underline" href="/pos/shifts?tab=history">Shift history</Link>.</p>
    </div>
  );
}
