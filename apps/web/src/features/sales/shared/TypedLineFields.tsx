"use client";

// A document line without a catalogue product (Create-Where-You-Are): what is sold, its HSN/SAC, GST and price, typed on the line. The
// server keeps the line on the company's system "Unlisted item" with this name and tax. "Save as a product" turns the line into a
// catalogue product for next time (the price typed stays on the line).
import { Button, Select, TextField } from "@vercentlabs/design-system";

import { useQuickCreate } from "@/shell/pickers/useQuickCreate";

export type TypedLine = { itemName: string; hsnSac: string; taxCategoryId: string; unitPrice: string };

export function TypedLineFields({ index, line, onChange, taxCategories, onSavedAsProduct }: {
  index: number;
  line: TypedLine;
  onChange: (patch: Partial<TypedLine>) => void;
  taxCategories: Array<{ id: string; code: string; name: string }>;
  /** The line became this catalogue product. */
  onSavedAsProduct?: (itemId: string) => void;
}) {
  const quickCreate = useQuickCreate("item", {
    prefill: { isSellable: true, name: line.itemName },
    onCreated: (record) => onSavedAsProduct?.(record.id),
  });
  return (
    <div className="grid grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
      <TextField label={index === 0 ? "What is sold" : undefined} aria-label={`Line ${index + 1}: what is sold`} isRequired value={line.itemName}
        onChange={(value) => onChange({ itemName: value })} placeholder="For example: Weekend batch – Python" />
      <TextField label={index === 0 ? "HSN / SAC" : undefined} aria-label={`Line ${index + 1}: HSN or SAC`} inputMode="numeric" value={line.hsnSac}
        onChange={(value) => onChange({ hsnSac: value.replace(/[^0-9]/g, "").slice(0, 8) })} />
      <Select label={index === 0 ? "GST" : undefined} aria-label={`Line ${index + 1}: GST`} selectedKey={line.taxCategoryId || "default"}
        onSelectionChange={(key) => onChange({ taxCategoryId: String(key) === "default" ? "" : String(key) })}
        options={[{ value: "default", label: "Company default" }, ...taxCategories.map((tax) => ({ value: tax.id, label: tax.name }))]} />
      <TextField label={index === 0 ? "Price" : undefined} aria-label={`Line ${index + 1}: price`} isRequired inputMode="decimal" value={line.unitPrice}
        onChange={(value) => onChange({ unitPrice: value.replace(/[^0-9.]/g, "") })} placeholder="0.00" />
      {onSavedAsProduct && quickCreate.canCreate && line.itemName.trim() && (
        <div className="sm:col-span-4">
          <Button variant="ghost" size="compact" onPress={() => quickCreate.open(line.itemName.trim())}>Save as a product for next time</Button>
        </div>
      )}
      {quickCreate.drawer}
    </div>
  );
}
