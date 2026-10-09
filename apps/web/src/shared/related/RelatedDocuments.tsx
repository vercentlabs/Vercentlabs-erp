"use client";

// The shared Related tab of a record page: upstream sources and downstream documents (from /api/related/<type>/<id>), one panel per kind of
// document, every row opening the page that owns it. Groups the person may not see are not sent; an empty group says so.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, StatusBadge } from "@vercentlabs/design-system";

import { formatDate, formatMoney, humanize } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type RelatedDocument = { id: string; number: string | null; status: string | null; date: string | null; amount: string | null; currency: string | null; detail: string | null; href: string };
type Group = { key: string; label: string; direction: string; documents: RelatedDocument[] };
type Related = { record: { type: string; id: string; number: string | null }; groups: Group[] };

async function load(type: string, id: string): Promise<Related> {
  const response = await fetch(`/api/related/${type}/${id}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "Related documents could not be loaded.");
  return payload.related as Related;
}

export function RelatedDocuments({ type, id }: { type: "purchase_order" | "opportunity" | "lead" | "item"; id: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "related", type, id), queryFn: () => load(type, id) });
  if (query.isLoading) return <LoadingState label="Loading related documents" />;
  if (query.isError)
    return <ErrorState title="Could not load related documents" description={query.error instanceof Error ? query.error.message : undefined} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  const groups = query.data?.groups ?? [];
  if (!groups.length) return <p className="text-sm text-text-muted">No related documents you can open.</p>;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {groups.map((group) => (
        <Panel key={group.key} title={`${group.label} (${group.documents.length})`}>
          {!group.documents.length ? <p className="text-sm text-text-muted">None yet.</p> : (
            <LinesTable columns={["Document", "Date", "Detail", { label: "Amount", numeric: true }, "Status"]}>
              {group.documents.map((document) => (
                <tr key={document.id}>
                  <Cell><Link className="font-medium text-brand hover:underline" href={document.href}>{document.number ?? "Untitled"}</Link></Cell>
                  <Cell className="whitespace-nowrap">{document.date ? formatDate(document.date) : null}</Cell>
                  <Cell>{document.detail}</Cell>
                  <Cell numeric>{document.amount !== null ? formatMoney(document.currency, document.amount) : null}</Cell>
                  <Cell>{document.status ? <StatusBadge tone="neutral">{humanize(document.status)}</StatusBadge> : null}</Cell>
                </tr>
              ))}
            </LinesTable>
          )}
        </Panel>
      ))}
    </div>
  );
}
