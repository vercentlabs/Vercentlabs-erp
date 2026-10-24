"use client";

// A line outside the catalogue (report Phase 3) on a purchase request, price request or rate contract: "Not in the list" swaps the item
// picker for a description and whether it is a service or a non-stock purchase. When one-off lines are ordered, OneOffAccountFields asks
// for the expense account and tax the order needs.
import { Checkbox, Select, TextField } from "@vercentlabs/design-system";

export type OneOffFields = { oneOff: boolean; description: string; oneOffType: "service" | "non_stock" };
export const blankOneOff = (): OneOffFields => ({ oneOff: false, description: "", oneOffType: "service" });

export function OneOffToggle({ value, onChange }: { value: boolean; onChange: (on: boolean) => void }) {
  return <Checkbox isSelected={value} onChange={onChange}>Not in the list</Checkbox>;
}

export function OneOffDescription({ line, label, onChange }: { line: OneOffFields; label: string; onChange: (change: Partial<OneOffFields>) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr]">
      <TextField label={label} isRequired placeholder="For example: annual maintenance of the chiller" value={line.description} onChange={(value) => onChange({ description: value })} />
      <Select label="Kind" selectedKey={line.oneOffType} onSelectionChange={(key) => onChange({ oneOffType: String(key) as OneOffFields["oneOffType"] })}
        options={[{ value: "service", label: "Service" }, { value: "non_stock", label: "Non-stock purchase" }]} />
    </div>
  );
}

// The input a one-off line sends: no product, its description, unit and kind.
export const oneOffInput = (line: OneOffFields & { uomId: string }) => ({ description: line.description.trim(), uomId: line.uomId || undefined, oneOffType: line.oneOffType });

export type OneOffAccount = { expenseAccountId: string; taxCategoryId: string; noTax: boolean };
export function OneOffAccountFields({ value, onChange, accounts, taxCategories }: {
  value: OneOffAccount; onChange: (value: OneOffAccount) => void; accounts: Array<{ id: string; code: string; name: string }>; taxCategories: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_2fr_auto] sm:items-end">
      <Select label="Expense account" isRequired selectedKey={value.expenseAccountId || null} onSelectionChange={(key) => onChange({ ...value, expenseAccountId: String(key) })}
        options={accounts.map((account) => ({ value: account.id, label: `${account.code} ${account.name}` }))} />
      <Select label="Tax category" isDisabled={value.noTax} selectedKey={value.taxCategoryId || null} onSelectionChange={(key) => onChange({ ...value, taxCategoryId: String(key) })}
        options={taxCategories.map((category) => ({ value: category.id, label: category.name }))} />
      <Checkbox isSelected={value.noTax} onChange={(on) => onChange({ ...value, noTax: on, taxCategoryId: on ? "" : value.taxCategoryId })}>No tax</Checkbox>
    </div>
  );
}
export const oneOffAccountInput = (value: OneOffAccount | undefined) =>
  value ? { expenseAccountId: value.expenseAccountId || undefined, ...(value.noTax ? { noTax: true } : value.taxCategoryId ? { taxCategoryId: value.taxCategoryId } : {}) } : undefined;
export const oneOffAccountReady = (value: OneOffAccount | undefined) => Boolean(value?.expenseAccountId && (value.noTax || value.taxCategoryId));
