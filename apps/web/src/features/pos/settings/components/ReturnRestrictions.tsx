"use client";

// Return restrictions (administrators): product categories that are never returned at POS, or returned only with a supervisor's approval
// (a policy restriction, overridable by someone holding the override permission). Saved on their own.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select } from "@vercentlabs/design-system";

import { listProductCategories } from "@/features/pos/products/api/products-api";
import { getPosSettings, updatePosSettings } from "@/features/pos/settings/api/settings-api";
import { PosApiError } from "@/features/pos/shared/http";
import { PosPanel } from "@/features/pos/shared/PosUi";

type Restriction = { type: "item" | "category"; id: string; mode: "blocked" | "approval" };

export function ReturnRestrictions() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["pos-return-restrictions"], queryFn: getPosSettings });
  const categories = useQuery({ queryKey: ["pos-return-categories"], queryFn: () => listProductCategories().then((result) => result.categories) });
  const [category, setCategory] = useState<string | null>(null);
  const [mode, setMode] = useState<"blocked" | "approval">("blocked");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list: Restriction[] = (settings.data?.settings as { return_restrictions?: Restriction[] } | undefined)?.return_restrictions ?? [];
  const nameOf = (entry: Restriction) => entry.type === "category" ? (categories.data ?? []).find((row) => row.id === entry.id)?.name ?? "Category" : `Item ${entry.id.slice(0, 8)}`;
  async function save(next: Restriction[]) {
    setBusy(true);
    setError(null);
    try {
      await updatePosSettings({ return_restrictions: next } as never);
      await queryClient.invalidateQueries({ queryKey: ["pos-return-restrictions"] });
    } catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Could not save."); } finally { setBusy(false); }
  }
  if (!settings.data) return null;
  return (
    <PosPanel title="Return restrictions" description="Categories that cannot be returned at POS, or only with a supervisor's approval.">
      {list.length === 0 && <p className="text-sm text-text-muted">Everything can be returned within the policy.</p>}
      <ul className="flex flex-col gap-1 text-sm">{list.map((entry) => (
        <li key={`${entry.type}:${entry.id}`} className="flex items-center justify-between gap-2 border-t border-border py-1">
          <span>{nameOf(entry)} · {entry.mode === "blocked" ? "Not returnable" : "Needs approval"}</span>
          <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => save(list.filter((row) => !(row.type === entry.type && row.id === entry.id)))}>Remove</Button>
        </li>
      ))}</ul>
      <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-3">
        <Select label="Category" selectedKey={category ?? undefined} onSelectionChange={(key) => setCategory(String(key))}
          options={(categories.data ?? []).map((row) => ({ value: row.id, label: row.name }))} />
        <Select label="Rule" selectedKey={mode} onSelectionChange={(key) => setMode(String(key) as "blocked" | "approval")}
          options={[{ value: "blocked", label: "Not returnable" }, { value: "approval", label: "Needs approval" }]} />
        <Button variant="secondary" isLoading={busy} isDisabled={!category}
          onPress={() => save([...list.filter((row) => !(row.type === "category" && row.id === category)), { type: "category", id: category!, mode }])}>Add restriction</Button>
      </div>
      {error && <p className="text-sm text-danger-emphasis">{error}</p>}
    </PosPanel>
  );
}
