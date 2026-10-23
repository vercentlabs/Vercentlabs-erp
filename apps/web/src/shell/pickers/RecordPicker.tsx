"use client";

// RecordPicker (Create-Where-You-Are plan): the one searchable picker for a field that refers to another record — a customer, supplier,
// contact, company, lead, item or a simple master. It searches the server as the user types (no preloaded list, no cap), shows a second
// line (GSTIN, mobile, code…), and ends its list with "+ Create '…'" (or Alt+C) that opens the kind's quick-create form in a side drawer;
// the new record comes back selected. A field holding a record that is not in the current results keeps showing it (`selected`).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ComboBox } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { PICKERS } from "./registry";
import { useQuickCreate } from "./useQuickCreate";
import type { PickedRecord, PickerKind } from "./types";

export type RecordPickerProps = {
  kind: PickerKind;
  label?: string;
  "aria-label"?: string;
  value: string | null;
  onChange: (id: string | null, record: PickedRecord | null) => void;
  /** The chosen record's name and second line, for a value set before the picker searched (an edit form). */
  selected?: PickedRecord | null;
  /** Narrows the search (a company's contacts: { accountId }; sellable items: { sellable: true }). */
  filters?: Record<string, unknown>;
  /** Defaults for a record created here (the deal's company for a new contact, a person for a customer…). */
  createPrefill?: Record<string, unknown>;
  /** false hides the create row even for someone who may create. */
  creatable?: boolean;
  /** Hides records already used (the deal's other contacts…). */
  excludeIds?: string[];
  isRequired?: boolean;
  isDisabled?: boolean;
  description?: string;
  errorMessage?: string;
  placeholder?: string;
  className?: string;
  size?: "compact" | "standard";
};

export function RecordPicker({ kind, value, onChange, selected, filters = {}, createPrefill, creatable = true, excludeIds = [], ...field }: RecordPickerProps) {
  const workspace = useWorkspaceContext();
  const definition = PICKERS[kind];
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<PickedRecord | null>(selected ?? null);
  const current = chosen && chosen.id === value ? chosen : selected && selected.id === value ? selected : null;
  // The box shows the chosen record's name once picked; that is not a search.
  const typed = current && text.trim() === current.label ? "" : text.trim();
  const search = useQuery({
    queryKey: scopedQueryKey(workspace, "record-picker", kind, typed, JSON.stringify(filters)),
    queryFn: () => definition.search(typed, filters),
    staleTime: 15_000,
  });
  const quickCreate = useQuickCreate(kind, {
    prefill: createPrefill,
    onCreated: (record) => { setChosen(record); onChange(record.id, record); },
  });
  const results = (search.data ?? []).filter((record) => !excludeIds.includes(record.id) || record.id === value);
  const records = current && !results.some((record) => record.id === current.id) ? [current, ...results] : results;
  return (
    <>
      <ComboBox
        {...field}
        placeholder={field.placeholder ?? `Search ${definition.noun === "company" ? "companies" : `${definition.noun}s`}`}
        options={records.map((record) => ({ value: record.id, label: record.label, description: record.description }))}
        selectedKey={value}
        onSelectionChange={(key) => {
          const id = key ? String(key) : null;
          const record = records.find((entry) => entry.id === id) ?? null;
          setChosen(record);
          onChange(id, record);
        }}
        onInputChange={setText}
        isLoading={search.isFetching}
        emptyMessage={search.isError ? "Search failed. Try again." : `No matching ${definition.noun === "company" ? "companies" : `${definition.noun}s`}`}
        allowsEmptyCollection
        // The server already matched (by GSTIN, phone, code…); the box must not filter its answer again by the name.
        defaultFilter={() => true}
        onCreate={creatable && quickCreate.canCreate ? quickCreate.open : undefined}
        createLabel={(typedText) => (typedText ? `Create ${definition.noun} "${typedText}"` : `Create a new ${definition.noun}`)}
      />
      {quickCreate.drawer}
    </>
  );
}
