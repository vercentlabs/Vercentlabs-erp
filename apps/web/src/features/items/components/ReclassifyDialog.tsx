"use client";

// Reclassify: moves an item to another category. It is a classification change only — stock, cost, valuation, tax, profiles and every
// document stay as they are. When the new category suggests different defaults the user chooses to keep the item's current settings
// or adopt the new ones; adopting goes through the item's own rules (valuation is fixed once stock has moved).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ComboBox, Dialog, Radio, RadioGroup, TextArea } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, previewReclassify, reclassifyItem, type DefaultField, type Item, type ItemOptions } from "../api/items-api";
import { ErrorBanner } from "../item-format";

// A default's value as people read it.
export function defaultValueLabel(field: DefaultField, value: string | null, options?: ItemOptions) {
  if (!value) return "Not set";
  if (field === "valuationMethod") return options?.valuationMethods.find((entry) => entry.code === value)?.label ?? value;
  if (field === "inventoryProfileId") return options?.inventoryProfiles.find((entry) => entry.id === value)?.name ?? "Inactive profile";
  if (field === "accountingProfileId") return options?.accountingProfiles.find((entry) => entry.id === value)?.name ?? "Inactive profile";
  if (field === "taxCategoryId") return options?.taxCategories.find((entry) => entry.id === value)?.name ?? "Inactive tax profile";
  return value;
}

export function ReclassifyDialog({ item, options, isOpen, onClose }: { item: Item; options?: ItemOptions; isOpen: boolean; onClose: (message?: string) => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [choice, setChoice] = useState<"keep" | "adopt">("keep");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: scopedQueryKey(workspace, "products", "product", item.id, "reclassify", categoryId),
    queryFn: () => previewReclassify(item.id, categoryId!),
    enabled: isOpen && Boolean(categoryId),
  });
  const differences = preview.data?.differences ?? [];
  const save = useMutation({
    mutationFn: () => reclassifyItem(item.id, { categoryId: categoryId!, adoptDefaults: choice === "adopt", reason: reason.trim() || undefined, expectedVersion: item.version }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") });
      setCategoryId(null); setChoice("keep"); setReason("");
      onClose(`Moved to ${result.product.categoryName}.${choice === "adopt" && differences.length ? " The new category's defaults were adopted." : " The item's own settings were kept."}`);
    },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const itemType = item.isVariantTemplate && item.type === "stock" ? "non_stock" : item.type;
  const choices = (options?.categories ?? []).filter((entry) => entry.id !== item.categoryId)
    .map((entry) => ({ value: entry.id, label: entry.effectiveItemTypes.includes(itemType) ? entry.name : `${entry.name} (not for this type)`, isDisabled: !entry.effectiveItemTypes.includes(itemType) }));

  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => !open && onClose()} title={`Reclassify ${item.name}`}
      description="Moves the item to another category. Stock, cost, valuation, tax, profiles and documents do not change.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <p className="text-sm text-text-secondary">Current category: <span className="font-medium text-text">{item.categoryName ?? "None"}</span></p>
        <ComboBox label="New category" isRequired placeholder="Search categories" selectedKey={categoryId} options={choices}
          onSelectionChange={(key) => { setError(null); setChoice("keep"); setCategoryId(key === null ? null : String(key)); }} />
        {categoryId && (preview.isLoading ? <LoadingState label="Comparing defaults" rows={2} /> : preview.isError ? <ErrorBanner message={errorMessage(preview.error)} /> :
          differences.length === 0 ? <p className="text-sm text-text-muted">The new category suggests nothing different from the item&apos;s current settings.</p> : (
            <div className="flex flex-col gap-3">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-text-muted"><th className="py-1 font-medium">Setting</th><th className="py-1 font-medium">Current</th><th className="py-1 font-medium">New category suggests</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {differences.map((entry) => (
                    <tr key={entry.field}>
                      <td className="py-1.5 pr-2 text-text-secondary">{entry.label}</td>
                      <td className="py-1.5 pr-2">{defaultValueLabel(entry.field, entry.current, options)}</td>
                      <td className="py-1.5">{defaultValueLabel(entry.field, entry.suggested, options)}<span className="block text-xs text-text-muted">{entry.source === "company" ? "Company default" : `From ${entry.fromName}`}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <RadioGroup label="Item settings" value={choice} onChange={(value) => setChoice(value as "keep" | "adopt")}>
                <Radio value="keep">Keep current settings</Radio>
                <Radio value="adopt">Adopt the new category&apos;s defaults</Radio>
              </RadioGroup>
            </div>
          ))}
        <TextArea label="Reason (optional)" rows={2} value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onClose()}>Cancel</Button>
          <Button variant="primary" isDisabled={!categoryId || preview.isLoading || preview.isError} isLoading={save.isPending} onPress={() => { setError(null); save.mutate(); }}>Reclassify</Button>
        </div>
      </div>
    </Dialog>
  );
}
