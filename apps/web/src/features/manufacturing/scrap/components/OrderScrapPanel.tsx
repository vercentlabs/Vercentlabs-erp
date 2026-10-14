"use client";

// An order's scrap notes (on its Materials and Production tabs), each opening its page, and the way to record new scrap of the given kind.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { LinkButton, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, inr } from "@/features/manufacturing/orders/api/mo-api";
import { SCRAP_BASE, SCRAP_TONE, listScraps, type ScrapType } from "../api/scrap-api";

export function OrderScrapPanel({ orderId, type, canRecord }: { orderId: string; type: ScrapType; canRecord: boolean }) {
  const workspace = useWorkspaceContext();
  const filters = { orderId, type };
  const scraps = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "scrap", filters), queryFn: () => listScraps(filters) });
  const rows = scraps.data ?? [];
  const material = type === "ISSUED_MATERIAL";
  return (
    <Panel title={material ? "Material scrap" : "Rejected output scrap"}
      description={material ? "Issued material that became unusable in production. It never returns to usable stock." : "Output Quality rejected and then disposed of as scrap. Rejection alone is not scrap."}
      actions={canRecord ? <LinkButton size="compact" variant="secondary" href={`${SCRAP_BASE}/new?orderId=${orderId}&type=${type}`}>{material ? "Scrap material" : "Scrap rejected output"}</LinkButton> : undefined}>
      {scraps.isError ? <p className="text-sm text-danger">{errorMessage(scraps.error)}</p> : rows.length ? (
        <LinesTable columns={["Scrap note", "Status", "Scrapped", "Reason", "Disposition", ...(rows.some((row) => row.totalCost !== null) ? [{ label: "Value", numeric: true }] : []), "Posted"]}>
          {rows.map((row) => (
            <tr key={row.id}>
              <Cell><Link className="text-brand underline" href={`${SCRAP_BASE}/${row.id}`}>{row.number}</Link></Cell>
              <Cell><span className="flex flex-wrap gap-1"><StatusBadge tone={SCRAP_TONE[row.status] ?? "neutral"}>{row.statusLabel}</StatusBadge>{row.correctionStatus === "REVERSED" && <StatusBadge tone="neutral">Reversed</StatusBadge>}</span></Cell>
              <Cell>{row.summary ?? ""}</Cell><Cell>{row.reasonLabel}</Cell>
              <Cell>{row.disposition === "RECOVERABLE" ? "Recoverable" : "Irrecoverable"} · {row.lossClass === "ABNORMAL" ? "abnormal" : "normal"}</Cell>
              {rows.some((entry) => entry.totalCost !== null) && <Cell numeric>{row.totalCost ? inr(row.totalCost) : ""}</Cell>}
              <Cell>{row.postedAt ? formatDateTime(row.postedAt) : <span className="text-text-muted">Not posted</span>}</Cell>
            </tr>
          ))}
        </LinesTable>
      ) : <p className="text-sm text-text-muted">{scraps.isLoading ? "Loading…" : "No scrap recorded."}</p>}
    </Panel>
  );
}
