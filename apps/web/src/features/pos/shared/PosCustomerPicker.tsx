"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ComboBox } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { searchPosCustomers, type PosCustomerMatch } from "@/features/pos/checkout/api/checkout-api";

// Single-select customer search for POS screens that need "pick a customer"
// (loyalty lookup today) -- the same bounded business_parties search
// checkout uses (searchPosCustomers), never a second customer source, and
// never a raw-ID text box. Debounced like checkout's own customer search
// (250ms) so search-as-you-type behaves identically everywhere.
export function PosCustomerPicker({
  label = "Customer",
  placeholder = "Search by name, code, phone or email…",
  onSelect,
  className,
}: {
  label?: string;
  placeholder?: string;
  onSelect: (customer: PosCustomerMatch) => void;
  className?: string;
}) {
  const workspace = useWorkspaceContext();
  const [inputValue, setInputValue] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(inputValue), 250);
    return () => clearTimeout(handle);
  }, [inputValue]);

  const searchQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "customer-picker", debounced),
    queryFn: () => searchPosCustomers(debounced),
    enabled: debounced.trim().length > 0,
  });

  const results = searchQuery.data?.rows ?? [];
  const options = results.map((customer) => ({
    value: customer.id,
    label: `${customer.displayName} · ${customer.code}${customer.phone || customer.email ? ` · ${customer.phone || customer.email}` : ""}`,
  }));

  return (
    <ComboBox
      label={label}
      placeholder={placeholder}
      className={className}
      inputValue={inputValue}
      onInputChange={setInputValue}
      options={options}
      isLoading={searchQuery.isFetching}
      emptyMessage={debounced.trim() ? "No matching customers" : "Type to search"}
      allowsEmptyCollection
      onSelectionChange={(key) => {
        if (key == null) return;
        const match = results.find((customer) => customer.id === String(key));
        if (!match) return;
        onSelect(match);
        setInputValue(match.displayName);
      }}
    />
  );
}
