"use client";

// Valuation defaults: the company's valuation method (Moving Weighted Average or FIFO) for items and categories that do not set their own,
// and the stock-adjustment value above which posting needs the large-adjustment permission. Category defaults live on each category; an
// item's own method on the item, fixed once it has valuation history. The valuation itself is Stock → Valuation.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, TextField } from "@vercentlabs/design-system";

import { act, readStock } from "@/features/inventory/shared/client";
import { InvAlert, InvPanel, useCan } from "@/features/inventory/shared/InvUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Settings = { costing_method: string; adjustment_value_threshold: string | number | null; configured: boolean };

export function ValuationDefaults() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "inventory", "settings"), queryFn: () => readStock<{ settings: Settings }>("settings").then((r) => r.settings) });
  const [method, setMethod] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const current = query.data;
  const save = useMutation({
    mutationFn: () => act("settings", {
      costingMethod: method ?? current?.costing_method,
      adjustmentValueThreshold: threshold === null ? undefined : threshold.trim() === "" ? null : threshold.trim(),
    }),
    onSuccess: () => { setSaved(true); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "inventory") }); },
  });
  const editable = can("stock.settings.manage");
  return (
    <InvPanel title="Valuation defaults" description="The company default; a category or an item may set its own. An item's method is fixed once it has valuation history.">
      {save.error && <InvAlert>{save.error instanceof Error ? save.error.message : "Could not save."}</InvAlert>}
      {saved && <InvAlert tone="success">Settings saved.</InvAlert>}
      <div className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
        <Select label="Default valuation method" isDisabled={!editable || !current} selectedKey={method ?? current?.costing_method ?? null}
          options={[{ value: "moving_average", label: "Moving weighted average" }, { value: "fifo", label: "FIFO" }]}
          onSelectionChange={(key) => { setSaved(false); setMethod(String(key)); }} />
        <TextField label="Large stock adjustment above (value)" inputMode="decimal" isDisabled={!editable || !current}
          value={threshold ?? (current?.adjustment_value_threshold === null || current?.adjustment_value_threshold === undefined ? "" : String(Number(current.adjustment_value_threshold)))}
          onChange={(value) => { setSaved(false); setThreshold(value); }}
          description="Stock adjustments worth more than this need the Post large stock adjustments permission. Empty: no threshold." />
      </div>
      <p className="text-sm text-text-muted">Category defaults: <Link className="text-brand hover:underline" href="/inventory/item-categories">Items → Categories</Link>. Valuation reports: <Link className="text-brand hover:underline" href="/inventory/valuation">Stock → Valuation</Link>.</p>
      {editable ? <div><Button variant="primary" onPress={() => save.mutate()} isLoading={save.isPending} isDisabled={!current}>Save settings</Button></div>
        : <p className="text-sm text-text-muted">You can view these settings but not change them.</p>}
    </InvPanel>
  );
}
