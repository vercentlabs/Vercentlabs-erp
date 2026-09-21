"use client";

import { useEffect, useState } from "react";
import { ComboBox, Select } from "@vercentlabs/design-system";

import { listAccounts } from "@/features/crm/accounts/api/accounts-api";
import { listContacts } from "@/features/crm/contacts/api/contacts-api";
import { listLeads } from "@/features/crm/leads/api/leads-api";
import { listOpportunities } from "@/features/crm/opportunities/api/opportunities-api";

export type RelatedValue = { entityType: "general" | "lead" | "party" | "contact" | "opportunity"; entityId: string };
export const NO_RELATION: RelatedValue = { entityType: "general", entityId: "" };

const TYPES = [
  { value: "general", label: "Nothing (general)" },
  { value: "lead", label: "Lead" },
  { value: "party", label: "Account" },
  { value: "contact", label: "Contact" },
  { value: "opportunity", label: "Opportunity" },
];

type Row = Record<string, unknown> & { id: string };
const rowLabel = (type: string, row: Row) => {
  if (type === "party") return String(row.displayName ?? row.id);
  if (type === "opportunity") return String(row.name ?? row.id);
  return [row.firstName, row.lastName].filter(Boolean).join(" ") || String(row.email ?? row.id);
};

async function search(type: string, text: string): Promise<Row[]> {
  const filters = { search: text || undefined, limit: 20 } as never;
  if (type === "party") return ((await listAccounts(filters)).rows ?? []) as unknown as Row[];
  if (type === "contact") return ((await listContacts(filters)).rows ?? []) as unknown as Row[];
  if (type === "lead") return ((await listLeads(filters)).rows ?? []) as unknown as Row[];
  if (type === "opportunity") return ((await listOpportunities(filters)).rows ?? []) as unknown as Row[];
  return [];
}

// Which CRM record an activity belongs to: choose the kind, then search for the record by name. The stored values
// (entityType / entityId) are exactly what the activity APIs already take.
export function RelatedRecordPicker({ value, onChange, label = "Related to" }: { value: RelatedValue; onChange: (v: RelatedValue) => void; label?: string }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (value.entityType === "general") {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      search(value.entityType, text)
        .then((r) => { if (!cancelled) { setRows(r); setFailed(false); } })
        .catch(() => { if (!cancelled) setFailed(true); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [value.entityType, text]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Select label={label} options={TYPES} selectedKey={value.entityType} onSelectionChange={(k) => { setText(""); onChange({ entityType: String(k) as RelatedValue["entityType"], entityId: "" }); }} />
      {value.entityType !== "general" && (
        <ComboBox
          label={TYPES.find((t) => t.value === value.entityType)?.label ?? "Record"}
          placeholder="Search by name"
          options={rows.map((r) => ({ value: r.id, label: rowLabel(value.entityType, r) }))}
          selectedKey={value.entityId || null}
          onSelectionChange={(k) => onChange({ ...value, entityId: k ? String(k) : "" })}
          onInputChange={setText}
          isLoading={loading}
          emptyMessage={failed ? "Search failed. Try again." : "No matching records"}
          allowsEmptyCollection
        />
      )}
    </div>
  );
}
