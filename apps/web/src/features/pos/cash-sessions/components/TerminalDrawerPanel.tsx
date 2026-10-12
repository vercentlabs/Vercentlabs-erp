"use client";

// The cash drawer this counter uses: one logical drawer (a till, a cash box) held by one cash session at a time, so two counters sharing a
// drawer can never each claim a float. Choose another drawer of the outlet, or add one. Not while a shift is open here. The server checks who
// may (those who configure terminal cash).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { assignDrawer, listDrawers, saveDrawer } from "@/features/pos/cash-sessions/api/cash-sessions-api";
import { PosApiError } from "@/features/pos/shared/http";
import { PosAlert, PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function TerminalDrawerPanel({ terminalId, outletId, drawerId }: { terminalId: string; outletId: string; drawerId: string | null }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "pos", "cash-drawers", outletId);
  const query = useQuery({ queryKey: key, queryFn: () => listDrawers(outletId), retry: false });
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const drawers = query.data ?? [];
  const current = drawers.find((drawer) => drawer.id === drawerId) ?? null;
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await work(); await queryClient.invalidateQueries({ queryKey: key }); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos-terminals") }); }
    catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Something went wrong."); } finally { setBusy(false); }
  };
  return (
    <PosPanel title="Cash drawer" description="The physical drawer whose cash this counter's shifts hold. One cash session holds a drawer at a time.">
      {current ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{current.name} ({current.code})</span>
          {current.terminals.length > 1 && <span className="text-text-muted">shared with {current.terminals.filter((entry) => entry).join(", ")}</span>}
          {current.heldByShift ? <StatusBadge tone="warning">{`Held by ${current.heldBy ?? "a cashier"} · ${current.heldByShift}`}</StatusBadge> : <StatusBadge tone="neutral">Free</StatusBadge>}
        </p>
      ) : <p className="text-sm text-text-muted">No drawer yet: the counter gets its own when its first cash shift opens.</p>}
      {drawers.length > 0 && (
        <Select label="Use drawer" size="compact" selectedKey={drawerId} className="sm:max-w-xs" onSelectionChange={(value) => { if (value && value !== drawerId) void run(() => assignDrawer(terminalId, String(value))); }}
          options={drawers.filter((drawer) => drawer.status === "active").map((drawer) => ({ value: drawer.id, label: `${drawer.name} (${drawer.code})` }))} />
      )}
      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <TextField label="New drawer code" size="compact" value={code} onChange={(value) => setCode(value.toUpperCase())} maxLength={30} />
        <TextField label="Name" size="compact" value={name} onChange={setName} maxLength={120} />
        <Button size="compact" variant="secondary" isLoading={busy} isDisabled={!code.trim() || !name.trim()}
          onPress={() => run(async () => { const drawer = await saveDrawer({ storeId: outletId, code: code.trim(), name: name.trim() }); await assignDrawer(terminalId, drawer.id); setCode(""); setName(""); })}>
          Add and use
        </Button>
      </div>
      {error && <PosAlert>{error}</PosAlert>}
    </PosPanel>
  );
}
