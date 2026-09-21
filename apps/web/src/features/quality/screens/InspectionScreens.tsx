"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, NumberField, PageHeader, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { act, readView, QualityApiError, useQualityOptions, type Row } from "@/features/quality/shared/client";
import { label, quantity, tone } from "@/features/quality/shared/format";
import { QualityAlert, QualityPanel, useCan } from "@/features/quality/shared/QualityUi";

const errorText = (e: unknown) => (e instanceof QualityApiError ? e.message : "This could not be completed.");

// F312-315: pick a plan, a source and a lot quantity; the server sizes the sample from the plan's own
// sampling method (an AQL plan needs the sampling-plan code to size a bracket for this lot).
export function InspectionNewScreen() {
  const router = useRouter();
  const options = useQualityOptions();
  const [planId, setPlanId] = useState("");
  const [inspectionType, setInspectionType] = useState("incoming");
  const [sourceType, setSourceType] = useState("manual");
  const [itemId, setItemId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [lotQuantity, setLotQuantity] = useState(1);
  const [samplingPlanCode, setSamplingPlanCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => act<{ record: Row }>("inspection-create", { planId, inspectionType, sourceType, itemId: itemId || undefined, supplierId: supplierId || undefined, lotQuantity, samplingPlanCode: samplingPlanCode || undefined }),
    onSuccess: (r) => router.push(`/quality/inspection/${r.record.id}`),
    onError: (e) => setError(errorText(e)),
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="New inspection" description="Choose the plan this inspection is against, and the lot it covers." />
      {error && <QualityAlert>{error}</QualityAlert>}
      <QualityPanel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Plan" options={(options.data?.plans ?? []).map((o) => ({ value: o.id, label: o.name }))} selectedKey={planId || null} onSelectionChange={(k) => setPlanId(String(k ?? ""))} isRequired />
          <Select label="Type" options={[{ value: "incoming", label: "Incoming" }, { value: "in_process", label: "In process" }, { value: "final", label: "Final" }, { value: "stock_audit", label: "Stock audit" }, { value: "supplier", label: "Supplier" }, { value: "customer_return", label: "Customer return" }]} selectedKey={inspectionType} onSelectionChange={(k) => setInspectionType(String(k))} />
          <Select label="Source" options={[{ value: "manual", label: "Manual" }, { value: "procurement_receipt", label: "Procurement receipt" }, { value: "stock_batch", label: "Stock batch" }, { value: "stock_serial", label: "Stock serial" }, { value: "manufacturing_work_order", label: "Manufacturing work order" }, { value: "sales_return", label: "Sales return" }, { value: "pos_return", label: "POS return" }]} selectedKey={sourceType} onSelectionChange={(k) => setSourceType(String(k))} />
          <Select label="Item (optional; defaults to the plan's)" options={(options.data?.items ?? []).map((o) => ({ value: o.id, label: o.name }))} selectedKey={itemId || null} onSelectionChange={(k) => setItemId(String(k ?? ""))} />
          <Select label="Supplier (optional)" options={(options.data?.suppliers ?? []).map((o) => ({ value: o.id, label: o.name }))} selectedKey={supplierId || null} onSelectionChange={(k) => setSupplierId(String(k ?? ""))} />
          <NumberField label="Lot quantity" value={lotQuantity} onChange={setLotQuantity} minValue={0} />
          <TextField label="Sampling plan code (only if the plan samples by AQL)" value={samplingPlanCode} onChange={setSamplingPlanCode} />
        </div>
      </QualityPanel>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onPress={() => router.push("/quality/inspections")}>Cancel</Button>
        <Button variant="primary" isDisabled={!planId} isLoading={create.isPending} onPress={() => create.mutate()}>Start inspection</Button>
      </div>
    </div>
  );
}

// F316/F317/F319: record each point's result (the server checks numeric/selection points against
// their own tolerance/allowed values), then complete, then release (never by the same inspector).
export function InspectionDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const [values, setValues] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inspection = useQuery({ queryKey: scopedQueryKey(workspace, "quality", "inspection", id), queryFn: () => readView<{ inspection: Row }>("inspection", { id }).then((r) => r.inspection) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "quality") });
  const go = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setError(null); refresh(); },
    onError: (e) => setError(errorText(e)),
  });

  if (inspection.isError) return <PermissionState title="You don't have access to this inspection" description="Ask an administrator to grant quality.view." />;
  const insp = inspection.data;
  if (!insp) return <p className="text-sm text-text-muted">Loading…</p>;
  const points = (insp.points ?? []) as Row[];
  const results = (insp.results ?? []) as Row[];
  const resultFor = (pointId: string) => results.find((r) => r.inspection_point_id === pointId);
  const canRecord = ["draft", "in_progress"].includes(String(insp.status));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${String(insp.inspection_number)} — ${String(insp.plan_name)}`} description={`Lot ${quantity(insp.lot_quantity)}, sample ${quantity(insp.sample_quantity)}`} />
      {notice && <QualityAlert tone="success">{notice}</QualityAlert>}
      {error && <QualityAlert>{error}</QualityAlert>}
      <div className="flex items-center gap-2">
        <StatusBadge tone={tone(insp.status)}>{label(insp.status)}</StatusBadge>
        {insp.overall_result && <span className="text-sm text-text-muted">Overall: {label(insp.overall_result)}</span>}
      </div>

      <QualityPanel title="Points">
        <div className="flex flex-col gap-3">
          {points.map((p) => {
            const existing = resultFor(String(p.id));
            const key = String(p.id);
            return (
              <div key={key} className="rounded-[var(--radius-control)] border border-border p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-text">{String(p.characteristic)}{p.critical ? " (critical)" : ""}</span>
                  {existing && <StatusBadge tone={tone(existing.result_status)}>{label(existing.result_status)}</StatusBadge>}
                </div>
                <p className="text-xs text-text-muted">{String(p.inspection_method)}{p.result_type === "numeric" ? ` — tolerance ${p.lower_limit ?? "−∞"} to ${p.upper_limit ?? "+∞"}${p.unit ? ` ${p.unit}` : ""}` : ""}{p.result_type === "selection" ? ` — allowed: ${(p.allowed_values as string[] | undefined)?.join(", ")}` : ""}</p>
                {canRecord && (
                  <div className="mt-2 flex items-end gap-2">
                    {p.result_type === "numeric" && <TextField label="Value" value={values[key] ?? ""} onChange={(v) => setValues((c) => ({ ...c, [key]: v }))} />}
                    {p.result_type === "selection" && <TextField label="Value" value={values[key] ?? ""} onChange={(v) => setValues((c) => ({ ...c, [key]: v }))} />}
                    {(p.result_type === "boolean" || p.result_type === "text") && (
                      <Select label="Result" options={[{ value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }, { value: "not_applicable", label: "Not applicable" }]} selectedKey={values[key] || null} onSelectionChange={(k) => setValues((c) => ({ ...c, [key]: String(k ?? "") }))} />
                    )}
                    <Button
                      variant="secondary"
                      isDisabled={!values[key]}
                      isLoading={go.isPending}
                      onPress={() =>
                        go.mutate(async () => {
                          const v = values[key];
                          const body: Record<string, unknown> = { inspectionPointId: p.id };
                          if (p.result_type === "numeric") body.numericValue = Number(v);
                          else if (p.result_type === "selection") body.textValue = v;
                          else body.resultStatus = v;
                          await act("inspection-results", { id, results: [body] });
                          setNotice("Result recorded.");
                        })
                      }
                    >
                      Record
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </QualityPanel>

      <div className="flex flex-wrap gap-2">
        {canRecord && can("quality.inspect") && (
          <Button variant="primary" isLoading={go.isPending} onPress={() => go.mutate(async () => { await act("inspection-complete", { id }); setNotice("Completed."); })}>Complete inspection</Button>
        )}
        {["passed", "conditionally_accepted"].includes(String(insp.status)) && can("quality.release") && (
          <Button variant="primary" isLoading={go.isPending} onPress={() => go.mutate(async () => { await act("inspection-release", { id }); setNotice("Released."); })}>Release</Button>
        )}
        {canRecord && can("quality.inspect") && (
          <Button variant="ghost" onPress={() => go.mutate(async () => { await act("inspection-cancel", { id, reason: "Cancelled from the inspection screen" }); setNotice("Cancelled."); })}>Cancel inspection</Button>
        )}
      </div>
    </div>
  );
}
