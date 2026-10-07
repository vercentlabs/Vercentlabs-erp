"use client";

// Change SKU: a new code for the same item. The item, its stock, batches, serials, prices and documents stay as they are; documents keep
// the SKU they were made with. The old SKU stays in the item's history, is still found by search, and is never given to another item.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { changeItemSku, checkSku, errorMessage, fieldErrors, getSkuHistory, type Item } from "../api/items-api";
import { ErrorBanner } from "../item-format";

export function ChangeSkuDialog({ item, isOpen, onClose }: { item: Item; isOpen: boolean; onClose: (message?: string) => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [sku, setSku] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTyped(sku.trim()), 400);
    return () => clearTimeout(timer);
  }, [sku]);
  const check = useQuery({
    queryKey: scopedQueryKey(workspace, "products", "sku-check", typed, item.id),
    queryFn: () => checkSku(typed, item.id),
    enabled: isOpen && Boolean(typed),
  });
  const same = typed.toUpperCase() === item.code.toUpperCase();
  const problem = !typed ? null : same ? "That is already the item's SKU." : check.data && !check.data.valid ? check.data.problem
    : check.data?.reason === "in_use" ? `Already the SKU of ${check.data.holder?.name} (${check.data.holder?.code}).`
    : check.data?.reason === "previous" ? `Used before by ${check.data.holder?.name} (now ${check.data.holder?.code}). A SKU is never reused.` : null;
  const save = useMutation({
    mutationFn: () => changeItemSku(item.id, { sku: sku.trim(), reason: reason.trim() || undefined, expectedVersion: item.version }),
    onSuccess: (product) => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") });
      setSku(""); setReason("");
      onClose(`SKU changed from ${item.code} to ${product.code}. ${item.code} still finds this item and is never given to another.`);
    },
    onError: (failure) => { setFieldError(fieldErrors(failure).code ?? null); setError(errorMessage(failure)); },
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => !open && onClose()} title={`Change the SKU of ${item.name}`}
      description="The item, its stock, batches, serials and documents stay the same. Documents keep the SKU they were made with.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <p className="text-sm"><span className="text-text-muted">Current SKU: </span><span className="font-medium tabular-nums">{item.code}</span></p>
        <TextField label="New SKU" isRequired autoFocus value={sku} onChange={(value) => { setSku(value.toUpperCase()); setFieldError(null); setError(null); }}
          errorMessage={fieldError ?? problem ?? undefined} description={check.data?.available && !same ? `${check.data.sku} is free.` : "Letters, numbers, dashes, dots, underscores or slashes; no spaces."} />
        <TextArea label="Reason" rows={2} value={reason} onChange={setReason} description="Recorded in the item's history, such as Typo corrected." />
        {item.previousSkus.length > 0 && <p className="text-xs text-text-muted">Earlier SKUs of this item: {item.previousSkus.join(", ")}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onClose()}>Cancel</Button>
          <Button variant="primary" isDisabled={!typed || Boolean(problem) || check.isLoading} isLoading={save.isPending} onPress={() => { setError(null); save.mutate(); }}>Change SKU</Button>
        </div>
      </div>
    </Dialog>
  );
}

// The SKUs the item had before: when, by whom and why.
export function SkuHistoryList({ item }: { item: Item }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "products", "product", item.id, "sku-history"),
    queryFn: () => getSkuHistory(item.id),
    enabled: item.previousSkus.length > 0,
  });
  if (!item.previousSkus.length) return null;
  if (query.isError) return <p className="text-sm text-text-muted">Previous SKUs: {item.previousSkus.join(", ")}</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {(query.data ?? []).map((entry) => (
        <li key={entry.id}>
          <span className="tabular-nums">{entry.oldSku}</span> <span className="text-text-muted">→</span> <span className="tabular-nums">{entry.newSku}</span>
          <span className="block text-xs text-text-muted">{[entry.changedByName, formatDateTime(entry.changedAt), entry.reason].filter(Boolean).join(" · ")}</span>
        </li>
      ))}
    </ul>
  );
}
