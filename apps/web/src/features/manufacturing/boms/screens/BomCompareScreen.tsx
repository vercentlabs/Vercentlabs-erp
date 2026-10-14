"use client";

// Compare two revisions of a BOM: the recipe difference line by line (paired by lineage, so a material on two lines stays two lines), the
// header changes, and — for a quantity — what each revision needs and its estimated material cost, both priced with the same unit costs.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { bomOptions, compare, errorMessage, errorStatus, getBom, inr, qty, type Comparison, type LineView, type RequirementsComparison } from "../api/bom-api";
import { BOM_BASE } from "./BomListScreen";

const CHANGE_TONE = { added: "success", removed: "danger", changed: "warning", unchanged: "neutral" } as const;
const FIELD = { quantity: "quantity", uom: "unit", baseQuantity: "base quantity", mode: "counted", scrapAllowancePct: "extra %", childRevisionId: "subassembly recipe", notes: "notes" } as const;

export function BomCompareScreen({ bomId }: { bomId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const bom = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "bom", bomId, ""), queryFn: () => getBom(bomId), retry: false });
  const revisions = bom.data?.revisions ?? [];
  const from = params.get("from") ?? revisions[1]?.id ?? null;
  const to = params.get("to") ?? revisions[0]?.id ?? null;
  const ready = Boolean(from && to && from !== to);
  const comparison = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "bom-compare", bomId, from ?? "", to ?? ""), queryFn: () => compare(bomId, from!, to!), enabled: ready, retry: false });
  const pick = (key: "from" | "to", value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    if (key === "from" && !params.get("to") && to) next.set("to", to);
    if (key === "to" && !params.get("from") && from) next.set("from", from);
    router.replace(`${pathname}?${next.toString()}`);
  };
  if (bom.isLoading) return <LoadingState label="Loading the BOM" rows={6} />;
  if (bom.isError || !bom.data) {
    if (errorStatus(bom.error) === 403) return <PermissionState title="You don't have access to bills of materials" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load the BOM" description={errorMessage(bom.error)} />;
  }
  const options = revisions.map((row) => ({ value: row.id, label: `Rev ${row.revisionNumber} · ${row.statusLabel}${row.id === bom.data.effectiveRevisionId ? " (in use)" : ""}` }));
  const data = comparison.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader breadcrumbs={<Link className="text-sm text-brand underline" href={`${BOM_BASE}/${bomId}?tab=revisions`}>{bom.data.number}</Link>}
        title={`Compare revisions · ${bom.data.number}`} description={`${bom.data.finishedItem.code} · ${bom.data.finishedItem.name}. Lines are matched by their identity across revisions, not by position.`} />
      <div className="flex flex-wrap items-end gap-2">
        <Select label="From" size="compact" selectedKey={from} onSelectionChange={(key) => pick("from", String(key))} options={options} />
        <Select label="To" size="compact" selectedKey={to} onSelectionChange={(key) => pick("to", String(key))} options={options} />
      </div>
      {!ready && <Notice tone="neutral">Choose two different revisions.</Notice>}
      {comparison.isLoading && ready && <LoadingState label="Comparing" rows={4} />}
      {comparison.isError && <Notice tone="danger">{errorMessage(comparison.error)}</Notice>}
      {data && <RecipeDifference data={data} />}
      {data && <RequirementsDifference bomId={bomId} from={data.from.id} to={data.to.id} defaultQuantity={bom.data.revision?.outputQuantity ?? "1"} />}
    </div>
  );
}

function RecipeDifference({ data }: { data: Comparison }) {
  const changed = data.lines.filter((line) => line.change !== "unchanged");
  const side = (view: LineView | null, other: LineView | null, fields: string[]) => {
    if (!view) return "—";
    const mark = (key: string, value: string) => (other && fields.includes(key) ? <strong>{value}</strong> : value);
    return (
      <span className="flex flex-col">
        <span>{mark("quantity", qty(view.quantity))} {mark("uom", view.uom)}{view.mode === "FIXED_PER_BATCH" ? " per batch" : ""}{Number(view.scrapAllowancePct) ? <> +{mark("scrapAllowancePct", view.scrapAllowancePct)}%</> : ""}</span>
        {view.baseQuantity && fields.includes("baseQuantity") && <span className="text-xs text-text-muted">= {qty(view.baseQuantity)} in base unit</span>}
        {view.childRevision && <span className="text-xs text-text-muted">{fields.includes("childRevisionId") ? <strong>{view.childRevision}</strong> : view.childRevision}</span>}
        {view.notes && fields.includes("notes") && <span className="text-xs text-text-muted">{view.notes}</span>}
      </span>
    );
  };
  return (
    <>
      <FactList items={[["Added", String(data.summary.added)], ["Removed", String(data.summary.removed)], ["Modified", String(data.summary.changed)], ["Unchanged", String(data.summary.unchanged)],
        [`Rev ${data.from.revisionNumber}`, `${data.from.status.toLowerCase().replace("_", " ")}${data.from.effectiveFrom ? `, from ${formatDateTime(data.from.effectiveFrom)}` : ""}`],
        [`Rev ${data.to.revisionNumber}`, `${data.to.status.toLowerCase().replace("_", " ")}${data.to.changeReason ? ` — ${data.to.changeReason}` : ""}`]]} />
      {data.header.length > 0 && (
        <Panel title="Output and parameters">
          <LinesTable columns={["Field", `Rev ${data.from.revisionNumber}`, `Rev ${data.to.revisionNumber}`]}>
            {data.header.map((row) => <tr key={row.field}><Cell>{row.field}</Cell><Cell>{row.from ?? "—"}</Cell><Cell><strong>{row.to ?? "—"}</strong></Cell></tr>)}
          </LinesTable>
        </Panel>
      )}
      <Panel title="Materials" description={changed.length ? "Changed values are in bold." : "No material changed."}>
        <LinesTable columns={["Material", "Change", `Rev ${data.from.revisionNumber}`, `Rev ${data.to.revisionNumber}`, "What changed"]}>
          {data.lines.map((line, index) => (
            <tr key={`${line.lineageId}-${index}`}>
              <Cell><span className="flex flex-col"><span>{line.name}</span><span className="text-xs text-text-muted">{line.code}{(line.to ?? line.from) ? ` · line ${(line.to ?? line.from)!.lineNumber}` : ""}</span></span></Cell>
              <Cell><StatusBadge tone={CHANGE_TONE[line.change]}>{line.change === "changed" ? "modified" : line.change}</StatusBadge></Cell>
              <Cell>{side(line.from, line.to, line.fields)}</Cell>
              <Cell>{side(line.to, line.from, line.fields)}</Cell>
              <Cell>{line.fields.filter((field) => field !== "baseQuantity" || !line.fields.includes("quantity")).map((field) => FIELD[field as keyof typeof FIELD] ?? field).join(", ")}</Cell>
            </tr>
          ))}
        </LinesTable>
      </Panel>
    </>
  );
}

// The same quantity through both revisions: materials needed, the difference, free stock against the second, and the cost difference.
function RequirementsDifference({ bomId, from, to, defaultQuantity }: { bomId: string; from: string; to: string; defaultQuantity: string }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "bom-options"), queryFn: bomOptions, staleTime: 60_000 });
  const [quantity, setQuantity] = useState(defaultQuantity);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [result, setResult] = useState<RequirementsComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setError(null);
    try { setResult((await compare(bomId, from, to, { plannedQuantity: quantity, warehouseId })).requirements ?? null); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Panel title="Material and cost effect" description="What each revision needs for the same quantity. A preview only: nothing is reserved, ordered or posted.">
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="Quantity to make" inputMode="decimal" className="w-32" value={quantity} onChange={setQuantity} />
        <Select label="Warehouse" selectedKey={warehouseId ?? "all"} onSelectionChange={(key) => setWarehouseId(key === "all" ? null : String(key))}
          options={[{ value: "all", label: "Default / all I can see" }, ...(options.data?.warehouses ?? []).map((warehouse) => ({ value: warehouse.id, label: warehouse.code }))]} />
        <Button variant="primary" isLoading={busy} onPress={run}>Calculate</Button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {result && <RequirementsTable result={result} />}
    </Panel>
  );
}

export function RequirementsTable({ result }: { result: RequirementsComparison }) {
  const stock = new Map(result.availability.lines.map((line) => [line.itemId, line]));
  const cost = new Map((result.cost?.lines ?? []).map((line) => [line.itemId, line]));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-muted">For {qty(result.plannedQuantity)} {result.plannedUom}: rev {result.from.revisionNumber} produces {qty(result.from.nominalQuantity)}, rev {result.to.revisionNumber} produces {qty(result.to.nominalQuantity)} (expected yield and batches applied).</p>
      <LinesTable columns={["Material", { label: `Rev ${result.from.revisionNumber}`, numeric: true }, { label: `Rev ${result.to.revisionNumber}`, numeric: true }, { label: "Difference", numeric: true }, "Unit",
        { label: "Free stock", numeric: true }, "Status", ...(result.cost ? [{ label: "Cost difference", numeric: true }] : [])]}>
        {result.materials.map((line) => {
          const free = stock.get(line.itemId);
          const money = cost.get(line.itemId);
          return (
            <tr key={line.itemId}>
              <Cell><span className="flex flex-col"><span>{line.name}</span><span className="text-xs text-text-muted">{line.code}</span></span></Cell>
              <Cell numeric>{qty(line.from)}</Cell><Cell numeric>{qty(line.to)}</Cell>
              <Cell numeric>{Number(line.difference) > 0 ? `+${qty(line.difference)}` : Number(line.difference) < 0 ? qty(line.difference) : ""}</Cell>
              <Cell>{line.baseUom}</Cell>
              <Cell numeric>{free ? qty(free.available) : ""}</Cell>
              <Cell>{free?.status === "short" ? <StatusBadge tone="danger">{`Short ${qty(free.shortage)}`}</StatusBadge> : free?.status === "available" ? <StatusBadge tone="success">Available</StatusBadge> : ""}</Cell>
              {result.cost && <Cell numeric>{money?.difference ? inr(money.difference) : money ? "Missing cost" : ""}</Cell>}
            </tr>
          );
        })}
      </LinesTable>
      {result.cost && (
        <>
          <FactList items={[[`Rev ${result.from.revisionNumber} material cost`, inr(result.cost.from.total)], [`Rev ${result.to.revisionNumber} material cost`, inr(result.cost.to.total)],
            ["Difference", `${Number(result.cost.difference) > 0 ? "+" : ""}${inr(result.cost.difference)}`], ["Priced at", formatDateTime(result.cost.basis.calculatedAt)]]} />
          <p className="text-xs text-text-muted">{result.cost.basis.note}</p>
          {result.cost.warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
        </>
      )}
    </div>
  );
}
