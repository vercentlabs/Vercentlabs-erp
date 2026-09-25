"use client";

import { useQuery } from "@tanstack/react-query";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { formatDate } from "@/features/crm/shared/human";

// F008 — "review each one side by side": the record under review and a
// suspected duplicate, field by field, with the fields that match marked, so a
// person can decide to dismiss or merge from the evidence rather than a name.
export type ComparisonField = { label: string; key: string; format?: "date" };

function display(value: unknown, format?: "date"): string {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "date") return formatDate(String(value));
  return String(value);
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function DuplicateComparison({
  entity,
  current,
  candidateId,
  fields,
  loadCandidate,
  currentTitle = "This record",
  candidateTitle = "Possible duplicate",
}: {
  entity: string;
  current: Record<string, unknown>;
  candidateId: string;
  fields: ComparisonField[];
  loadCandidate: (id: string) => Promise<{ record: unknown }>;
  currentTitle?: string;
  candidateTitle?: string;
}) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", entity, candidateId),
    queryFn: () => loadCandidate(candidateId),
  });
  if (query.isLoading) return <p className="text-xs text-text-muted">Loading the other record…</p>;
  if (query.isError || !query.data) return <p className="text-xs text-text-muted">The other record could not be opened.</p>;
  const candidate = query.data.record as Record<string, unknown>;
  const rows = fields.filter((field) => current[field.key] || candidate[field.key]);
  return (
    <table className="w-full table-fixed border-collapse text-sm" aria-label="Side-by-side comparison">
      <thead>
        <tr className="text-left text-xs text-text-muted">
          <th className="w-1/4 py-1 font-medium">Field</th>
          <th className="py-1 font-medium">{currentTitle}</th>
          <th className="py-1 font-medium">{candidateTitle}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((field) => {
          const same = normalized(current[field.key]) !== "" && normalized(current[field.key]) === normalized(candidate[field.key]);
          return (
            <tr key={field.key} className="border-t border-border align-top">
              <td className="py-1 text-text-muted">{field.label}</td>
              <td className={`py-1 break-words ${same ? "font-medium text-text" : "text-text-secondary"}`}>{display(current[field.key], field.format)}</td>
              <td className={`py-1 break-words ${same ? "font-medium text-text" : "text-text-secondary"}`}>
                {display(candidate[field.key], field.format)}
                {same && <span className="ml-1.5 rounded-full bg-warning-soft px-1.5 text-xs text-warning">same</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
