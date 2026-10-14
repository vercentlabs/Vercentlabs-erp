"use client";

// An order's material usage variance (its Materials tab): for each material, what the frozen BOM expects for the chosen basis, what was
// actually used (posted consumption, plus material scrap as a separate loss), the difference and its status under the tolerance, in plain
// words — and the way to investigate a line. Issued material still in production is shown but never counted as use.
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button, Select, StatusBadge } from "@vercentlabs/design-system";

import { useSubmitKey } from "@/shared/http/submit-once";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { BAND_TONE, VARIANCE_BASE, openException, orderVariances, signed, type Basis } from "../api/variance-api";

export function OrderVariancePanel({ orderId }: { orderId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [basis, setBasis] = useState<Basis>("REPORTED_OUTPUT");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const submitKey = useSubmitKey();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "order-variances", orderId, basis), queryFn: () => orderVariances(orderId, basis), retry: false });
  if (query.isError && errorStatus(query.error) === 403) return null;
  const data = query.data;
  const investigate = async (materialId: string) => {
    setBusy(materialId); setError(null);
    try {
      const result = await submitKey.run(() => openException({ manufacturingOrderId: orderId, materialId }));
      router.push(`${VARIANCE_BASE}/${result.exceptionId}`);
    } catch (failure) { setError(errorMessage(failure)); setBusy(null); }
  };
  const cost = Boolean(data?.can.viewCost);
  return (
    <Panel title="Material usage variance"
      description="Expected use from the order's frozen BOM revision against posted consumption and material scrap. Issued material still in production is not use; approving a variance never changes the BOM or stock."
      actions={data ? <Select aria-label="Compare against" className="w-72" selectedKey={basis} onSelectionChange={(value) => setBasis(String(value) as Basis)}
        options={data.bases.map((row) => ({ value: row.key, label: `${row.label}${row.quantity ? ` · ${qty(row.quantity)}` : ""}` }))} /> : undefined}>
      {query.isLoading && <p className="text-sm text-text-muted">Calculating…</p>}
      {query.isError && <Notice tone="danger">{errorMessage(query.error)}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {data && (
        <div className="flex flex-col gap-3">
          {data.failure && <Notice tone="warning">Expected use cannot be calculated: {data.failure}</Notice>}
          {data.recoveryRequired && <Notice tone="danger">Some postings of this order need recovery: the variance cannot be finalized until they are reconciled.</Notice>}
          {data.status === "PROVISIONAL" && !data.failure && <p className="text-xs text-text-muted">Provisional: the order is still producing. Final figures are recorded when it completes.</p>}
          <LinesTable columns={["Material", { label: "Expected", numeric: true }, { label: "Consumed", numeric: true }, { label: "Scrapped", numeric: true }, { label: "Variance", numeric: true },
            ...(cost ? [{ label: "Usage cost", numeric: true }] : []), "Status", ""]}>
            {data.lines.map((line) => (
              <tr key={line.materialId}>
                <Cell><span className="flex flex-col"><span className="font-medium">{line.code} · {line.name}</span>
                  <span className="text-xs text-text-muted">{line.explanation}</span>
                  {line.notes.filter((note) => !line.explanation.includes(note)).map((note) => <span key={note} className="text-xs text-text-muted">{note}</span>)}</span></Cell>
                <Cell numeric>{line.expected === null ? "—" : `${qty(line.expected)} ${line.uom}`}{line.allowance && Number(line.allowance) ? <span className="block text-xs text-text-muted">incl. {qty(line.allowance)} allowed waste</span> : null}</Cell>
                <Cell numeric>{qty(line.consumed)}</Cell><Cell numeric>{Number(line.scrapped) ? qty(line.scrapped) : ""}</Cell>
                <Cell numeric>{line.variance === null ? "—" : `${signed(line.variance)}${line.variancePct === null ? "" : ` (${signed(line.variancePct)}%)`}`}</Cell>
                {cost && <Cell numeric>{line.cost?.usage ? inr(line.cost.usage) : "—"}</Cell>}
                <Cell><span className="flex flex-col gap-1"><StatusBadge tone={BAND_TONE[line.band]}>{line.bandLabel}</StatusBadge>
                  {line.authorized && <StatusBadge tone="success">Approved</StatusBadge>}
                  {line.exception && <Link className="text-xs text-brand underline" href={`${VARIANCE_BASE}/${line.exception.id}`}>{line.exception.number} · {line.exception.statusLabel}</Link>}</span></Cell>
                <Cell>{line.needsReview && !line.exception && !line.authorized && data.can.investigate
                  ? <Button size="compact" variant={line.needsApproval ? "primary" : "secondary"} isLoading={busy === line.materialId} onPress={() => investigate(line.materialId)}>Investigate</Button>
                  : line.nextStep ? <span className="text-xs text-text-muted">{line.nextStep}</span> : null}</Cell>
              </tr>
            ))}
          </LinesTable>
          {cost && data.totals.usageCost !== null && (
            <p className="text-sm">Usage variance {inr(data.totals.usageCost)} at the reference cost · expected material {inr(data.totals.expectedCost ?? "0")} · actual material {inr(data.totals.actualCost ?? "0")}
              {data.totals.totalCostVariance !== null ? ` · total material cost variance ${inr(data.totals.totalCostVariance)}` : ""}. These overlap: the usage variance is part of the total, not added to it.</p>
          )}
          <p className="text-xs text-text-muted">Tolerance: within {data.policy.warningPct}% is normal; up to {data.policy.approvalPct}% needs review; beyond, approval.
            {data.policy.blockCompletion ? " Unapproved variance blocks completion." : ""} Item and group overrides apply where set.</p>
        </div>
      )}
    </Panel>
  );
}
