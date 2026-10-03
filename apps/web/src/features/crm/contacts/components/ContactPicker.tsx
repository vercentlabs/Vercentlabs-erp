"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ComboBox } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { listContacts } from "../api/contacts-api";

// Search-as-you-type contact chooser. `excludeId` hides the contact being viewed.
export function ContactPicker({ label, value, onChange, excludeId, description }: {
  label: string;
  value: string | null;
  onChange: (id: string | null) => void;
  excludeId?: string;
  description?: string;
}) {
  const workspace = useWorkspaceContext();
  const [text, setText] = useState("");
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "contact-picker", text),
    queryFn: () => listContacts({ search: text || undefined, limit: 20, sortBy: "displayName", sortDirection: "asc" }),
    staleTime: 15_000,
  });
  const rows = (query.data?.rows ?? []).filter((row) => row.id !== excludeId);
  return (
    <ComboBox
      label={label}
      description={description}
      placeholder="Search contacts"
      options={rows.map((row) => ({ value: row.id, label: [row.displayName, row.accountName].filter(Boolean).join(" — ") }))}
      selectedKey={value}
      onSelectionChange={(key) => onChange(key ? String(key) : null)}
      onInputChange={setText}
      isLoading={query.isFetching}
      emptyMessage={query.isError ? "Search failed. Try again." : "No matching contacts"}
      allowsEmptyCollection
    />
  );
}
