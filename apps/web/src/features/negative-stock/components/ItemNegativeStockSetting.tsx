"use client";

// An item's negative-stock setting: it inherits the company policy or always blocks negative stock (never more permissive than the company).
// Batch and serial-numbered items never go negative whatever is set. Changing it needs its own permission and is audited.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, TextField } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, getNegativeSettings, setItemNegativeBlock } from "../api/negative-stock-api";

export function ItemNegativeStockSetting({ itemId, policy, trackingType }: { itemId: string; policy: "inherit" | "block"; trackingType: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: scopedQueryKey(workspace, "negative-stock", "settings"), queryFn: getNegativeSettings, retry: false, staleTime: 60_000 });
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const change = useMutation({
    mutationFn: () => setItemNegativeBlock(itemId, policy !== "block", reason),
    onSuccess: () => { setEditing(false); setReason(""); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products", "product", itemId) });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "negative-stock") }); },
  });
  const company = settings.data?.policy;
  const tracked = trackingType === "batch" || trackingType === "serial";
  const effective = tracked ? "Never goes negative (batch / serial-numbered)" : policy === "block" ? "Always blocked for this item"
    : company === "allow_with_override" ? "Company policy: may go negative with an authorised override" : company === "block" ? "Company policy: blocked" : "Inherits the company policy";
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-secondary">Negative stock</span>
        <Badge tone={policy === "block" || tracked || company === "block" ? "success" : "warning"}>{policy === "block" ? "Always block" : "Inherit"}</Badge>
        <span>{effective}</span>
        {settings.data?.capabilities.itemBlock && !editing && (
          <Button size="compact" variant="secondary" onPress={() => setEditing(true)}>{policy === "block" ? "Inherit company policy" : "Always block negative stock"}</Button>
        )}
      </div>
      {editing && (
        <div className="flex flex-wrap items-end gap-2">
          <TextField label="Reason (optional, kept in the audit)" value={reason} onChange={setReason} className="w-full sm:w-80" />
          <Button size="compact" variant="primary" isLoading={change.isPending} onPress={() => change.mutate()}>{policy === "block" ? "Inherit" : "Always block"}</Button>
          <Button size="compact" variant="secondary" onPress={() => setEditing(false)}>Cancel</Button>
        </div>
      )}
      {change.isError && <p role="alert" className="text-danger">{errorMessage(change.error)}</p>}
    </div>
  );
}
