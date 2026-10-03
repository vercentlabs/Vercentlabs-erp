"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ComboBox } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { listAccounts } from "../api/accounts-api";

// Search-as-you-type account chooser. `excludeId` hides the account being
// edited (an account cannot be its own parent or merge into itself).
export function AccountPicker({
  label, value, onChange, excludeId, description, placeholder = "Search accounts",
}: {
  label: string;
  value: string | null;
  onChange: (id: string | null, name: string | null) => void;
  excludeId?: string;
  description?: string;
  placeholder?: string;
}) {
  const workspace = useWorkspaceContext();
  const [text, setText] = useState("");
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "account-picker", text),
    queryFn: () => listAccounts({ search: text || undefined, limit: 20, sortBy: "displayName", sortDirection: "asc" }),
    staleTime: 15_000,
  });
  const rows = (query.data?.rows ?? []).filter((row) => row.id !== excludeId);
  return (
    <ComboBox
      label={label}
      description={description}
      placeholder={placeholder}
      options={rows.map((row) => ({ value: row.id, label: `${row.displayName} (${row.code})` }))}
      selectedKey={value}
      onSelectionChange={(key) => {
        const id = key ? String(key) : null;
        onChange(id, rows.find((row) => row.id === id)?.displayName ?? null);
      }}
      onInputChange={setText}
      isLoading={query.isFetching}
      emptyMessage={query.isError ? "Search failed. Try again." : "No matching accounts"}
      allowsEmptyCollection
    />
  );
}
