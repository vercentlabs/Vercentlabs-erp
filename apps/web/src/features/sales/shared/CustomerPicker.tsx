"use client";

// One customer, found by typing (name, code, GSTIN or phone): the search picker the document forms use, for screens that need only a
// customer (Payments Received, Outstanding).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TextField } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { getSalesOptions, type SalesOptions } from "@/features/sales/quotations/api/quotations-api";

import { SalesSearchPicker, mergeSalesOptions } from "./SalesSearchPicker";

export type PickedCustomer = { id: string; name: string; currencyCode: string | null };

export function CustomerPicker({ value, onPick, label = "Customer", isRequired, placeholder }: {
  value: string | null; onPick: (customer: PickedCustomer | null) => void; label?: string; isRequired?: boolean; placeholder?: string;
}) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options", "customer-picker", value ?? ""),
    queryFn: () => getSalesOptions(value || undefined).then((r) => r.options), staleTime: 60_000 });
  const [found, setFound] = useState<SalesOptions | null>(null);
  const known = options.data ? (found ? mergeSalesOptions(options.data, found) : options.data) : null;
  if (!known) return <TextField label={label} isDisabled value="" />;
  return (
    <SalesSearchPicker kind="customers" customersOnly label={label} value={value} known={known} isRequired={isRequired} placeholder={placeholder}
      onPick={(id, results) => {
        const merged = mergeSalesOptions(found ?? known, results);
        setFound(merged);
        const party = merged.parties.find((entry) => entry.id === id);
        onPick(party ? { id: party.id, name: party.display_name, currencyCode: party.currency_code?.trim() || null } : null);
      }} />
  );
}
