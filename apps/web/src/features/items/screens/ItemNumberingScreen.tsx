"use client";

// Inventory → Settings → Item Numbering: how SKUs are given. Typed, generated (prefix + number), or either; the default prefix, separator,
// number length and an optional year; whether categories' SKU prefixes apply and whether SKUs may be changed. Counters only move forward and
// are never set by hand, so a generated SKU is never issued twice; a SKU that identified one item is never reused for another.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, NumberField, PermissionState, Radio, RadioGroup, Select, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorCode, errorMessage, fieldErrors, getItemOptions, getSkuSettings, updateSkuSettings, type SkuMode, type SkuSettings } from "../api/items-api";
import { ErrorBanner } from "../item-format";

const SEPARATOR_LABELS: Record<string, string> = { "-": "Dash (ITEM-000001)", _: "Underscore (ITEM_000001)", ".": "Dot (ITEM.000001)", "/": "Slash (ITEM/000001)", "": "None (ITEM000001)" };

export function ItemNumberingScreen() {
  const workspace = useWorkspaceContext();
  const key = scopedQueryKey(workspace, "products", "sku-settings");
  const query = useQuery({ queryKey: key, queryFn: getSkuSettings });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "products", "options"), queryFn: getItemOptions, staleTime: 60_000 });
  if (query.isLoading) return <LoadingState label="Loading SKU numbering" rows={5} />;
  if (query.isError) return errorCode(query.error) === "PERMISSION_DENIED"
    ? <PermissionState title="You don't have access to item numbering" description="Ask an administrator for access." />
    : <ErrorState title="Could not load SKU numbering" action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  return <NumberingForm key={query.data!.version} settings={query.data!} canEdit={Boolean(options.data?.capabilities.configureSkuNumbering)} />;
}

function NumberingForm({ settings, canEdit }: { settings: SkuSettings; canEdit: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(settings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof SkuSettings>(field: K) => (value: SkuSettings[K]) => { setDraft((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: "" })); setSaved(false); };
  const save = useMutation({
    mutationFn: () => updateSkuSettings({
      mode: draft.mode, defaultPrefix: draft.defaultPrefix, separator: draft.separator, padding: draft.padding, includeYear: draft.includeYear,
      useCategoryPrefix: draft.useCategoryPrefix, allowSkuChanges: draft.allowSkuChanges, expectedVersion: settings.version,
    }),
    onSuccess: () => { setSaved(true); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") }); },
    onError: (failure) => { setErrors(fieldErrors(failure)); setError(errorMessage(failure)); },
  });
  const number = "1".padStart(Number.isFinite(draft.padding) ? Math.min(Math.max(draft.padding, 3), 10) : 6, "0");
  const example = `${draft.includeYear ? `${new Date().getFullYear()}${draft.separator}` : ""}${draft.defaultPrefix || "ITEM"}${draft.separator}${number}`;

  return (
    <Panel className="max-w-3xl" title="Item numbering" description="How items get their SKU. A SKU identifies the item everywhere — Sales, Procurement and Inventory — and is never reused for another item.">
      <ErrorBanner message={error} />
      {saved && <Notice tone="success">Saved. New items follow the new numbering; existing SKUs do not change.</Notice>}
      <div className="flex flex-col gap-4">
        <RadioGroup label="SKU mode" value={draft.mode} isDisabled={!canEdit} onChange={(value) => set("mode")(value as SkuMode)} errorMessage={errors.mode}>
          {settings.modes.map((mode) => <Radio key={mode.code} value={mode.code}>{mode.label}<span className="ml-1 text-xs text-text-muted">— {mode.description}</span></Radio>)}
        </RadioGroup>
        {draft.mode !== "manual" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextField label="Default prefix" value={draft.defaultPrefix} isDisabled={!canEdit} onChange={(value) => set("defaultPrefix")(value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              errorMessage={errors.defaultPrefix} description="1 to 12 letters or digits." />
            <Select label="Separator" selectedKey={draft.separator === "" ? "none" : draft.separator} isDisabled={!canEdit}
              onSelectionChange={(value) => set("separator")(value === "none" ? "" : String(value))}
              options={settings.separators.map((separator) => ({ value: separator === "" ? "none" : separator, label: SEPARATOR_LABELS[separator] ?? separator }))} errorMessage={errors.separator} />
            <NumberField label="Number length" value={draft.padding} minValue={3} maxValue={10} step={1} isDisabled={!canEdit} onChange={set("padding")} errorMessage={errors.padding} />
            <Checkbox isSelected={draft.includeYear} isDisabled={!canEdit} onChange={set("includeYear")}>Start with the year</Checkbox>
            <Checkbox className="sm:col-span-2" isSelected={draft.useCategoryPrefix} isDisabled={!canEdit} onChange={set("useCategoryPrefix")}>Use the category&apos;s SKU prefix when it has one</Checkbox>
            <p className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2 text-sm sm:col-span-3"><span className="text-text-muted">Example: </span><span className="font-medium tabular-nums">{example}</span>
              <span className="block text-xs text-text-muted">The next number for this prefix: {settings.example}. Numbers may skip when a save fails; they are never issued twice.</span></p>
          </div>
        )}
        <Checkbox isSelected={draft.allowSkuChanges} isDisabled={!canEdit} onChange={set("allowSkuChanges")}>Allow authorised users to change an item&apos;s SKU</Checkbox>
        <ul className="list-disc pl-5 text-xs text-text-muted">
          <li>Previous SKUs stay searchable after a change and are reserved for their item.</li>
          <li>A SKU is never reused for another item, even when its item is inactive.</li>
          <li>Changing the numbering never changes existing SKUs.</li>
        </ul>
        {canEdit && <div className="flex justify-end"><Button variant="primary" isLoading={save.isPending} onPress={() => { setError(null); save.mutate(); }}>Save</Button></div>}
      </div>
    </Panel>
  );
}
