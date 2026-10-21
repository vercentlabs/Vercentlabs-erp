"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ComboBox } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { searchSalesOptions, type SalesOptions, type SalesSearchResults } from "../quotations/api/quotations-api";

type Party = SalesOptions["parties"][number];
type Item = SalesOptions["items"][number];

// Search-as-you-type customer or product chooser for the document forms (Sales audit B4/M4): a company with thousands of customers or
// products finds one by typing its name, code, GSTIN, phone, HSN or barcode instead of scrolling a list that stopped at the first page.
// `known` is what the form already holds (its first page and anything picked), shown while nothing is typed; `onPick` gets the record
// and the search results it came from, so the form can take it (and a product's unit conversions) into its options.
export function SalesSearchPicker(props: {
  kind: "customers" | "products";
  label?: string;
  "aria-label"?: string;
  value: string | null;
  known: SalesOptions;
  // Customers only — an order is never for a prospect.
  customersOnly?: boolean;
  onPick: (id: string, found: SalesSearchResults) => void;
  isRequired?: boolean;
  isDisabled?: boolean;
  placeholder?: string;
  description?: React.ReactNode;
}) {
  const { kind, value, onPick } = props;
  const known = props.customersOnly ? { ...props.known, parties: props.known.parties.filter((party) => party.party_type !== "prospect") } : props.known;
  const workspace = useWorkspaceContext();
  const [text, setText] = useState("");
  const labelOf = (record: Party | Item) => "display_name" in record ? `${record.display_name} (${record.code})` : `${record.name} (${record.code})`;
  const chosen: Party | Item | undefined = kind === "customers" ? known.parties.find((party) => party.id === value) : known.items.find((item) => item.id === value);
  // The box shows the chosen record's name once picked; that is not a search.
  const typed = chosen && text.trim() === labelOf(chosen) ? "" : text.trim();
  const search = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "options-search", kind, typed, props.customersOnly ? "customers-only" : ""),
    queryFn: () => searchSalesOptions(kind, typed, !props.customersOnly).then((r) => r.results),
    enabled: typed.length > 0,
    staleTime: 15_000,
  });
  const found: SalesSearchResults = typed && search.data ? search.data : {};
  const records: Array<Party | Item> = kind === "customers"
    ? merged(found.parties ?? (typed ? [] : known.parties), known.parties.filter((party) => party.id === value))
    : merged(found.items ?? (typed ? [] : known.items), known.items.filter((item) => item.id === value));
  return (
    <ComboBox
      label={props.label}
      aria-label={props["aria-label"]}
      description={props.description}
      isRequired={props.isRequired}
      isDisabled={props.isDisabled}
      placeholder={props.placeholder ?? (kind === "customers" ? "Search customers" : "Search products")}
      options={records.map((record) => ({ value: record.id, label: labelOf(record) }))}
      selectedKey={value || null}
      onSelectionChange={(key) => {
        if (!key) return;
        const id = String(key);
        onPick(id, typed ? found : kind === "customers" ? { parties: known.parties } : { items: known.items, itemUomConversions: known.itemUomConversions });
      }}
      onInputChange={setText}
      isLoading={search.isFetching}
      emptyMessage={search.isError ? "Search failed. Try again." : kind === "customers" ? "No matching customers" : "No matching products"}
      allowsEmptyCollection
      // The server already matched (by GSTIN, phone, HSN… too); the box must not filter its answer again by the label.
      defaultFilter={() => true}
    />
  );
}

function merged<T extends { id: string }>(list: T[], extra: T[]) {
  const seen = new Set(list.map((row) => row.id));
  return [...list, ...extra.filter((row) => !seen.has(row.id))];
}

// The form's options with what a search or a customer's own load brought in (records already held are kept, new ones added).
export function mergeSalesOptions(options: SalesOptions, found: Partial<SalesOptions>): SalesOptions {
  const join = <T,>(current: T[], incoming: T[] | undefined, key: (row: T) => string) => {
    if (!incoming?.length) return current;
    const seen = new Set(current.map(key));
    return [...current, ...incoming.filter((row) => !seen.has(key(row)))];
  };
  return {
    ...options,
    parties: join(options.parties, found.parties, (row) => row.id),
    contacts: join(options.contacts, found.contacts, (row) => row.id),
    addresses: join(options.addresses, found.addresses, (row) => row.id),
    items: join(options.items, found.items, (row) => row.id),
    itemUomConversions: join(options.itemUomConversions, found.itemUomConversions, (row) => `${row.item_id}:${row.from_uom_id}:${row.to_uom_id}`),
  };
}
