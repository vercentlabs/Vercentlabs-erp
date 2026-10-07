"use client";

// New / edit category. The parent is chosen when the category is created (Move changes it later). Allowed item types can only narrow the
// parent's. Each default shows what the category would inherit when left empty, and from where; defaults apply to items created
// afterwards and never rewrite existing items. The resulting path is previewed before saving.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Checkbox, CheckboxGroup, ComboBox, Dialog, NumberField, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  createCategory, errorMessage, fieldErrors, getCategoryDefaults, updateCategory, type Category, type CategoryInput, type DefaultField, type ItemOptions, type ItemType,
} from "../api/items-api";
import { defaultValueLabel } from "../components/ReclassifyDialog";
import { ErrorBanner, NONE, orNull, withNone } from "../item-format";

type Draft = {
  code: string; name: string; parentId: string; description: string; sortOrder: number; skuPrefix: string; restrictTypes: boolean; allowedItemTypes: ItemType[];
  defaultValuationMethod: string; defaultInventoryProfileId: string; defaultAccountingProfileId: string; defaultTaxCategoryId: string; defaultHsnSacCode: string;
};
const blank = (parentId: string | null): Draft => ({
  code: "", name: "", parentId: parentId ?? NONE, description: "", sortOrder: 0, skuPrefix: "", restrictTypes: false, allowedItemTypes: [],
  defaultValuationMethod: NONE, defaultInventoryProfileId: NONE, defaultAccountingProfileId: NONE, defaultTaxCategoryId: NONE, defaultHsnSacCode: "",
});
const draftOf = (category: Category): Draft => ({
  code: category.code, name: category.name, parentId: category.parentId ?? NONE, description: category.description ?? "", sortOrder: category.sortOrder, skuPrefix: category.skuPrefix ?? "",
  restrictTypes: Boolean(category.allowedItemTypes?.length), allowedItemTypes: category.allowedItemTypes ?? [],
  defaultValuationMethod: category.defaultValuationMethod ?? NONE, defaultInventoryProfileId: category.defaultInventoryProfileId ?? NONE,
  defaultAccountingProfileId: category.defaultAccountingProfileId ?? NONE, defaultTaxCategoryId: category.defaultTaxCategoryId ?? NONE, defaultHsnSacCode: category.defaultHsnSacCode ?? "",
});

export type CategoryFormTarget = { mode: "new"; parentId: string | null } | { mode: "edit"; category: Category };

export function CategoryFormDialog({ target, categories, options, onClose, onSaved }: {
  target: CategoryFormTarget | null; categories: Category[]; options?: ItemOptions; onClose: () => void; onSaved: (category: Category) => void;
}) {
  return (
    <Dialog isOpen={target !== null} onOpenChange={(open) => !open && onClose()} title={target?.mode === "edit" ? `Edit ${target.category.name}` : "New category"}>
      {target && <CategoryForm key={target.mode === "edit" ? target.category.id : `new-${target.parentId}`} target={target} categories={categories} options={options} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

function CategoryForm({ target, categories, options, onClose, onSaved }: {
  target: CategoryFormTarget; categories: Category[]; options?: ItemOptions; onClose: () => void; onSaved: (category: Category) => void;
}) {
  const workspace = useWorkspaceContext();
  const editing = target.mode === "edit" ? target.category : null;
  const [draft, setDraft] = useState<Draft>(() => (editing ? draftOf(editing) : blank(target.mode === "new" ? target.parentId : null)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const can = options?.capabilities;
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => { setDraft((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "" })); };

  const parentId = orNull(draft.parentId);
  const parent = categories.find((entry) => entry.id === parentId) ?? null;
  // What the category would inherit for each default it leaves empty: the parent's resolved defaults, or the company's at the top.
  const inherited = useQuery({
    queryKey: scopedQueryKey(workspace, "products", "categories", "defaults", parentId),
    queryFn: () => getCategoryDefaults(parentId!),
    enabled: Boolean(parentId),
  });
  const inheritText = (field: DefaultField) => {
    if (!parentId) return field === "valuationMethod" ? "Empty: the company default applies." : "Empty: nothing is suggested.";
    const entry = inherited.data?.[field];
    if (!entry?.value) return "Empty: nothing is inherited.";
    return `Empty: inherits ${defaultValueLabel(field, entry.value, options)} ${entry.source === "company" ? "(company default)" : `from ${entry.fromName}`}.`;
  };
  const parentTypes = parent ? parent.effectiveItemTypes : (options?.types ?? []).map((entry) => entry.code);

  const save = useMutation({
    mutationFn: () => {
      const input: CategoryInput = {
        code: draft.code.trim(), name: draft.name.trim(), description: draft.description.trim() || null, sortOrder: Number.isFinite(draft.sortOrder) ? draft.sortOrder : 0,
        allowedItemTypes: draft.restrictTypes ? draft.allowedItemTypes : null, skuPrefix: draft.skuPrefix.trim() || null,
      };
      const defaults: CategoryInput = {
        defaultValuationMethod: orNull(draft.defaultValuationMethod), defaultInventoryProfileId: orNull(draft.defaultInventoryProfileId),
        defaultAccountingProfileId: orNull(draft.defaultAccountingProfileId), defaultTaxCategoryId: orNull(draft.defaultTaxCategoryId), defaultHsnSacCode: draft.defaultHsnSacCode.trim() || null,
      };
      // Only the defaults this user may set are sent; unchanged ones are left alone.
      const before = editing ? draftOf(editing) : blank(null);
      const allowed: Record<string, boolean | undefined> = {
        defaultValuationMethod: can?.categoryInventoryDefaults, defaultInventoryProfileId: can?.categoryInventoryDefaults, defaultAccountingProfileId: can?.categoryAccountingDefaults,
        defaultTaxCategoryId: can?.categoryTaxDefaults, defaultHsnSacCode: can?.categoryTaxDefaults,
      };
      for (const [field, value] of Object.entries(defaults)) {
        const old = field === "defaultHsnSacCode" ? before.defaultHsnSacCode.trim() || null : orNull(String(before[field as keyof Draft]));
        if (allowed[field] && value !== old) (input as Record<string, unknown>)[field] = value;
      }
      return editing ? updateCategory(editing.id, { ...input, expectedVersion: editing.version }) : createCategory({ ...input, parentId });
    },
    onSuccess: onSaved,
    onError: (failure) => { setErrors(fieldErrors(failure)); setError(errorMessage(failure)); },
  });

  const parentChoices = [{ value: NONE, label: "Top level" }, ...categories.filter((entry) => entry.isActive).map((entry) => ({ value: entry.id, label: entry.path }))];
  const typeLabel = (code: string) => options?.types.find((entry) => entry.code === code)?.label ?? code;
  const resultingPath = [...(parent ? [parent.path] : []), draft.name.trim() || "…"].join(" › ");

  return (
    <div className="flex flex-col gap-4">
      <ErrorBanner message={error} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Code" isRequired value={draft.code} onChange={(value) => set("code")(value.toUpperCase())} errorMessage={errors.code} description="Unique, such as PUMPS." />
        <TextField label="Name" isRequired value={draft.name} onChange={set("name")} errorMessage={errors.name} description="Unique under the same parent." />
        {editing ? (
          <p className="text-sm sm:col-span-2"><span className="text-text-muted">Parent: </span>{editing.parentName ?? "Top level"} <span className="text-xs text-text-muted">(use Move to change it)</span></p>
        ) : (
          <ComboBox className="sm:col-span-2" label="Parent category" selectedKey={draft.parentId} options={parentChoices} placeholder="Search categories"
            onSelectionChange={(key) => key !== null && set("parentId")(String(key))} errorMessage={errors.parentId} />
        )}
        <p className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2 text-sm sm:col-span-2"><span className="text-text-muted">Path: </span>{resultingPath}</p>
        <NumberField label="Sort order" value={draft.sortOrder} onChange={set("sortOrder")} step={1} errorMessage={errors.sortOrder} description="Lower comes first among siblings." />
        <div className="flex flex-col gap-2">
          <Checkbox isSelected={draft.restrictTypes} onChange={(value) => set("restrictTypes")(value)}>Restrict the item types it holds</Checkbox>
          {draft.restrictTypes ? (
            <CheckboxGroup aria-label="Allowed item types" orientation="horizontal" value={draft.allowedItemTypes} onChange={(value) => set("allowedItemTypes")(value as ItemType[])}
              errorMessage={errors.allowedItemTypes}>
              {parentTypes.map((code) => <Checkbox key={code} value={code}>{typeLabel(code)}</Checkbox>)}
            </CheckboxGroup>
          ) : (
            <p className="text-xs text-text-muted">{parent && parentTypes.length < (options?.types.length ?? 3) ? `As the parent: ${parentTypes.map(typeLabel).join(", ")}.` : "All item types."}{errors.allowedItemTypes ? ` ${errors.allowedItemTypes}` : ""}</p>
          )}
        </div>
        <TextField label="SKU prefix" value={draft.skuPrefix} onChange={(value) => set("skuPrefix")(value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} errorMessage={errors.skuPrefix}
          description={draft.skuPrefix ? `Generated SKUs here and below: ${draft.skuPrefix}-000001. Existing SKUs never change.` : "Optional. Empty: the parent's prefix, else the default."} />
        <TextArea className="sm:col-span-2" label="Description" rows={2} value={draft.description} onChange={set("description")} />
      </div>
      <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
        <legend className="text-sm font-semibold">Defaults for new items</legend>
        <p className="text-xs text-text-muted">Copied onto items created in this category or below. Existing items keep their own settings.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Valuation method" selectedKey={draft.defaultValuationMethod} isDisabled={!can?.categoryInventoryDefaults} onSelectionChange={(key) => set("defaultValuationMethod")(String(key))}
            options={withNone((options?.valuationMethods ?? []).map((entry) => ({ value: entry.code, label: entry.label })), "Inherit")} errorMessage={errors.defaultValuationMethod}
            description={draft.defaultValuationMethod === NONE ? inheritText("valuationMethod") : undefined} />
          <Select label="Inventory profile" selectedKey={draft.defaultInventoryProfileId} isDisabled={!can?.categoryInventoryDefaults} onSelectionChange={(key) => set("defaultInventoryProfileId")(String(key))}
            options={withNone((options?.inventoryProfiles ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "Inherit")} errorMessage={errors.defaultInventoryProfileId}
            description={draft.defaultInventoryProfileId === NONE ? inheritText("inventoryProfileId") : undefined} />
          <Select label="Accounting profile" selectedKey={draft.defaultAccountingProfileId} isDisabled={!can?.categoryAccountingDefaults} onSelectionChange={(key) => set("defaultAccountingProfileId")(String(key))}
            options={withNone((options?.accountingProfiles ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "Inherit")} errorMessage={errors.defaultAccountingProfileId}
            description={draft.defaultAccountingProfileId === NONE ? inheritText("accountingProfileId") : undefined} />
          <Select label="Tax profile" selectedKey={draft.defaultTaxCategoryId} isDisabled={!can?.categoryTaxDefaults} onSelectionChange={(key) => set("defaultTaxCategoryId")(String(key))}
            options={withNone((options?.taxCategories ?? []).map((entry) => ({ value: entry.id, label: entry.name })), "Inherit")} errorMessage={errors.defaultTaxCategoryId}
            description={draft.defaultTaxCategoryId === NONE ? inheritText("taxCategoryId") : undefined} />
          <TextField label="HSN / SAC" value={draft.defaultHsnSacCode} isDisabled={!can?.categoryTaxDefaults} onChange={(value) => set("defaultHsnSacCode")(value.replace(/\s/g, ""))}
            errorMessage={errors.defaultHsnSacCode} description={draft.defaultHsnSacCode ? undefined : inheritText("hsnSacCode")} />
        </div>
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onPress={onClose}>Cancel</Button>
        <Button variant="primary" isLoading={save.isPending} onPress={() => { setError(null); save.mutate(); }}>{editing ? "Save changes" : "Create category"}</Button>
      </div>
    </div>
  );
}
