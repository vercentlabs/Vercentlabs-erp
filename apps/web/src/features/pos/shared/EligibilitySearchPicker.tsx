"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ComboBox } from "@vercentlabs/design-system";
import { X } from "lucide-react";

export type EligibilitySearchResult = { id: string; label: string };

// Shared by the promotion/coupon eligibility pickers (item/item-group/
// customer) -- closes a disclosed gap: those screens could previously only
// set eligible_item_ids/eligible_item_group_ids/eligible_customer_ids
// through the raw API, never a UI, because no search-select existed for
// any of the three. Search-one-at-a-time via the ERP-standard ComboBox
// (react-aria's own documented composition for "search a large/async set"),
// selected ids render as a removable list below -- the design system has
// no async multi-select primitive to reuse instead (MultiSelect there is
// fixed-option-list only), so this composes the existing single-select
// ComboBox rather than inventing a new design-system component.
//
// A label is captured locally at the moment an option is selected (from
// that search's own current results), never re-derived from a ref/effect
// cache -- this project's stricter React Compiler lint rules disallow
// reading/writing refs during render, and TanStack Query v5 has no
// onSuccess callback to hook a cache update off of either. A
// pre-existing selected id whose label was never captured this session
// (e.g. opening the edit dialog for a promotion someone else configured
// via the API) renders as a shortened id rather than a fabricated name.
export function EligibilitySearchPicker({
  label,
  placeholder,
  selectedIds,
  onChange,
  search,
  queryKeyPrefix,
}: {
  label: string;
  placeholder: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  search: (query: string) => Promise<EligibilitySearchResult[]>;
  queryKeyPrefix: string;
}) {
  const [inputValue, setInputValue] = useState("");
  const [debounced, setDebounced] = useState("");
  const [knownLabels, setKnownLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(inputValue), 250);
    return () => clearTimeout(handle);
  }, [inputValue]);

  const searchQuery = useQuery({
    queryKey: [queryKeyPrefix, "eligibility-search", debounced],
    queryFn: () => search(debounced),
    enabled: debounced.trim().length > 0,
  });

  const results = searchQuery.data ?? [];
  const options = results.map((result) => ({ value: result.id, label: result.label }));

  function add(id: string) {
    const match = results.find((result) => result.id === id);
    if (match) setKnownLabels((prev) => ({ ...prev, [id]: match.label }));
    if (!selectedIds.includes(id)) onChange([...selectedIds, id]);
    setInputValue("");
  }
  function remove(id: string) {
    onChange(selectedIds.filter((existing) => existing !== id));
  }

  return (
    <div className="flex flex-col gap-2">
      <ComboBox
        label={label}
        placeholder={placeholder}
        inputValue={inputValue}
        onInputChange={setInputValue}
        options={options}
        isLoading={searchQuery.isFetching}
        emptyMessage={debounced.trim() ? "No matches" : "Type to search"}
        allowsEmptyCollection
        onSelectionChange={(key) => {
          if (key == null) return;
          add(String(key));
        }}
      />
      {selectedIds.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {selectedIds.map((id) => (
            <li key={id} className="flex items-center gap-1 rounded-[var(--radius-control)] bg-surface-muted px-2 py-1 text-xs text-text">
              <span>{knownLabels[id] ?? `#${id.slice(0, 8)}`}</span>
              <button type="button" aria-label={`Remove ${knownLabels[id] ?? id}`} onClick={() => remove(id)} className="text-text-muted hover:text-text">
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
