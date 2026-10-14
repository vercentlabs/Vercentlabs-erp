"use client";

// Impact of a revision before it is activated: what is in use now and what is scheduled, the recipe difference, the material and cost
// effect for a sample quantity, the parent recipes and subassemblies it touches, and production — frozen recipes keep their revision,
// production orders are never replanned automatically.
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader, PermissionState, StatusBadge, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { STATUS_LABEL, errorMessage, errorStatus, impactOf, qty } from "../api/bom-api";
import { RequirementsTable } from "./BomCompareScreen";
import { BOM_BASE } from "./BomListScreen";

export function BomImpactScreen({ bomId, revisionId }: { bomId: string; revisionId: string }) {
  const workspace = useWorkspaceContext();
  const [quantity, setQuantity] = useState("");
  const [submitted, setSubmitted] = useState<string | undefined>(undefined);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "bom-impact", revisionId, submitted ?? ""), queryFn: () => impactOf(bomId, revisionId, { plannedQuantity: submitted }), retry: false });
  if (query.isLoading) return <LoadingState label="Working out the impact" rows={6} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to bills of materials" description="Ask an administrator for access." />;
    return <ErrorState title="Could not work out the impact" description={errorMessage(query.error)} />;
  }
  const impact = query.data;
  const diff = impact.comparison;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader breadcrumbs={<Link className="text-sm text-brand underline" href={`${BOM_BASE}/${bomId}?revision=${revisionId}`}>{impact.bomNumber}</Link>}
        title={`Impact of revision ${impact.revision.revisionNumber}`} description={`${impact.finishedItem.code} · ${impact.finishedItem.name}. A preview only: nothing changes until the revision is activated.`} />
      <FactList items={[
        ["This revision", `Rev ${impact.revision.revisionNumber} · ${STATUS_LABEL[impact.revision.status]}${impact.revision.effectiveFrom ? ` · from ${formatDateTime(impact.revision.effectiveFrom)}` : ""}`],
        ["In use now", impact.current ? `Rev ${impact.current.revisionNumber} since ${formatDateTime(impact.current.effectiveFrom)}${impact.current.effectiveTo ? `, until ${formatDateTime(impact.current.effectiveTo)}` : ""}` : "No revision"],
        ["Scheduled", impact.scheduled.length ? impact.scheduled.map((row) => `Rev ${row.revisionNumber} from ${formatDateTime(row.effectiveFrom)}`).join("; ") : "Nothing"],
        ["Change", impact.revision.changeReason ?? "—"],
      ]} />
      <Notice tone="info">{impact.production.note}</Notice>
      {diff ? (
        <Panel title={`What changes from rev ${diff.from.revisionNumber}`} description={`${diff.summary.added} added · ${diff.summary.removed} removed · ${diff.summary.changed} modified`}
          actions={<Link className="text-sm text-brand underline" href={`${BOM_BASE}/${bomId}/compare?from=${diff.from.id}&to=${diff.to.id}`}>Full comparison</Link>}>
          {diff.header.map((row) => <p key={row.field} className="text-sm">{row.field}: {row.from ?? "—"} → <strong>{row.to ?? "—"}</strong></p>)}
          <ul className="text-sm">
            {diff.lines.filter((line) => line.change !== "unchanged").map((line, index) => (
              <li key={`${line.lineageId}-${index}`}>
                <StatusBadge tone={line.change === "added" ? "success" : line.change === "removed" ? "danger" : "warning"}>{line.change === "changed" ? "modified" : line.change}</StatusBadge>{" "}
                {line.code} · {line.name}: {line.from ? `${qty(line.from.quantity)} ${line.from.uom}` : "—"} → {line.to ? `${qty(line.to.quantity)} ${line.to.uom}` : "—"}
                {line.childRevisionChanged ? ` (subassembly ${line.from?.childRevision ?? "none"} → ${line.to?.childRevision ?? "none"})` : ""}
              </li>
            ))}
          </ul>
        </Panel>
      ) : <Notice tone="neutral">{impact.current ? "This is the revision in use now." : "No revision is in use yet, so there is nothing to compare with."}</Notice>}
      {impact.requirements && (
        <Panel title="Material and cost effect" description="The same quantity through the revision in use and this one, priced with the same unit costs.">
          <div className="flex flex-wrap items-end gap-2">
            <TextField label="Sample quantity" inputMode="decimal" className="w-32" value={quantity || impact.samplePlannedQuantity} onChange={setQuantity} />
            <Button variant="secondary" onPress={() => setSubmitted(quantity || undefined)}>Recalculate</Button>
          </div>
          {impact.requirements.error ? <Notice tone="warning">{impact.requirements.error}</Notice> : <RequirementsTable result={impact.requirements} />}
        </Panel>
      )}
      <Panel title="Parent recipes" description="Recipes that use this product as a subassembly. A parent keeps the revision it pins until the parent itself is revised.">
        {impact.parents.length ? (
          <LinesTable columns={["BOM", "Product", "Parent revision", "Pins", "Effect"]}>
            {impact.parents.map((row, index) => (
              <tr key={`${row.bomId}-${row.revisionNumber}-${index}`}>
                <Cell><Link className="text-brand underline" href={`${BOM_BASE}/${row.bomId}`}>{row.bomNumber}</Link></Cell><Cell>{row.product}</Cell>
                <Cell>Rev {row.revisionNumber} · {STATUS_LABEL[row.status]}</Cell><Cell>{row.pinnedRevision ? `Rev ${row.pinnedRevision}` : "—"}</Cell><Cell>{row.effect}</Cell>
              </tr>
            ))}
          </LinesTable>
        ) : <p className="text-sm text-text-muted">No other recipe uses this product.</p>}
      </Panel>
      <Panel title="Subassemblies it uses" description="The exact subassembly revisions this recipe pins.">
        {impact.children.length ? (
          <LinesTable columns={["Subassembly", "Pinned", "In use now", ""]}>
            {impact.children.map((row) => (
              <tr key={row.itemId}><Cell>{row.code} · {row.name}</Cell><Cell>{row.pinned}</Cell><Cell>{row.effectiveNow ?? "—"}</Cell>
                <Cell>{row.newerAvailable ? <StatusBadge tone="warning">Newer revision in use</StatusBadge> : ""}</Cell></tr>
            ))}
          </LinesTable>
        ) : <p className="text-sm text-text-muted">No pinned subassembly.</p>}
      </Panel>
      <Panel title="Production" description="What already uses this BOM. None of it changes when a revision is activated.">
        {impact.production.frozenRecipes.length ? (
          <LinesTable columns={["Revision", { label: "Frozen recipes", numeric: true }, "Latest", "References"]}>
            {impact.production.frozenRecipes.map((row) => (
              <tr key={row.revisionNumber}><Cell>Rev {row.revisionNumber}</Cell><Cell numeric>{row.count}</Cell><Cell>{formatDateTime(row.latest)}</Cell><Cell>{row.references.join(", ")}</Cell></tr>
            ))}
          </LinesTable>
        ) : <p className="text-sm text-text-muted">No recipe has been frozen for production from this BOM.</p>}
        <FactList items={[["Manufacturing orders that may need a review (draft or awaiting approval)", String(impact.production.orders.mayNeedReview)],
          ["Released or in-progress manufacturing orders (they keep their frozen recipe)", String(impact.production.orders.unchanged)], ["Open material demand from this BOM", String(impact.production.openDemands)]]} />
      </Panel>
    </div>
  );
}
