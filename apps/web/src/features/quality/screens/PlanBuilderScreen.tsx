"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Button, NumberField, PageHeader, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { act, QualityApiError, useQualityOptions, type Row } from "@/features/quality/shared/client";
import { QualityAlert, QualityPanel } from "@/features/quality/shared/QualityUi";

const errorText = (e: unknown) => (e instanceof QualityApiError ? e.message : "This could not be saved.");
const RESULT_TYPES = [{ value: "numeric", label: "Numeric (with tolerance)" }, { value: "boolean", label: "Pass / fail" }, { value: "text", label: "Text (recorded, not judged)" }, { value: "selection", label: "Selection (from a list)" }];
type PointDraft = { characteristic: string; inspectionMethod: string; resultType: string; lowerLimit: string; targetValue: string; upperLimit: string; unit: string; allowedValues: string; critical: boolean; destructive: boolean; instructions: string };
const blank = (): PointDraft => ({ characteristic: "", inspectionMethod: "Visual", resultType: "boolean", lowerLimit: "", targetValue: "", upperLimit: "", unit: "", allowedValues: "", critical: false, destructive: false, instructions: "" });

// F308-311/F318: a quality plan needs a dynamic list of inspection points, each with its own
// tolerance/allowed-values shape -- too much structure for the generic Register form.
export function PlanBuilderScreen() {
  const router = useRouter();
  const options = useQualityOptions();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [planType, setPlanType] = useState("incoming");
  const [itemId, setItemId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [samplingMethod, setSamplingMethod] = useState("full");
  const [samplingValue, setSamplingValue] = useState(100);
  const [points, setPoints] = useState<PointDraft[]>([blank()]);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      act<{ record: Row }>("plan-create", {
        code, name, planType, itemId: itemId || undefined, supplierId: supplierId || undefined, samplingMethod, samplingValue,
        points: points.map((p) => ({
          characteristic: p.characteristic, inspectionMethod: p.inspectionMethod, resultType: p.resultType,
          lowerLimit: p.resultType === "numeric" && p.lowerLimit ? Number(p.lowerLimit) : undefined,
          targetValue: p.resultType === "numeric" && p.targetValue ? Number(p.targetValue) : undefined,
          upperLimit: p.resultType === "numeric" && p.upperLimit ? Number(p.upperLimit) : undefined,
          unit: p.unit || undefined,
          allowedValues: p.resultType === "selection" ? p.allowedValues.split(",").map((v) => v.trim()).filter(Boolean) : undefined,
          critical: p.critical, destructive: p.destructive, instructions: p.instructions || undefined,
        })),
      }),
    onSuccess: (r) => { router.push(`/quality/plans`); void r; },
    onError: (e) => setError(errorText(e)),
  });
  const missing = !code.trim() || !name.trim() || points.some((p) => !p.characteristic.trim());
  const update = (i: number, patch: Partial<PointDraft>) => setPoints((cur) => cur.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="New quality plan" description="Add each characteristic to check, with its tolerance or allowed values. A second person approves the plan before it governs real inspections." />
      {error && <QualityAlert>{error}</QualityAlert>}
      <QualityPanel title="Plan">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Code" value={code} onChange={setCode} isRequired />
          <TextField label="Name" value={name} onChange={setName} isRequired />
          <Select label="Type" options={[{ value: "incoming", label: "Incoming" }, { value: "in_process", label: "In process" }, { value: "final", label: "Final" }, { value: "stock_audit", label: "Stock audit" }, { value: "supplier", label: "Supplier" }, { value: "customer_return", label: "Customer return" }]} selectedKey={planType} onSelectionChange={(k) => setPlanType(String(k))} />
          <Select label="Item (optional)" options={(options.data?.items ?? []).map((o) => ({ value: o.id, label: o.name }))} selectedKey={itemId || null} onSelectionChange={(k) => setItemId(String(k ?? ""))} />
          <Select label="Supplier (optional)" options={(options.data?.suppliers ?? []).map((o) => ({ value: o.id, label: o.name }))} selectedKey={supplierId || null} onSelectionChange={(k) => setSupplierId(String(k ?? ""))} />
          <Select label="Sampling" options={[{ value: "full", label: "Full (100%)" }, { value: "fixed_quantity", label: "Fixed quantity" }, { value: "percentage", label: "Percentage" }, { value: "aql", label: "AQL (looked up by lot size at inspection time)" }]} selectedKey={samplingMethod} onSelectionChange={(k) => setSamplingMethod(String(k))} />
          {(samplingMethod === "fixed_quantity" || samplingMethod === "percentage") && <NumberField label={samplingMethod === "percentage" ? "Percentage" : "Quantity"} value={samplingValue} onChange={setSamplingValue} minValue={0} />}
        </div>
      </QualityPanel>
      <QualityPanel title="Inspection points" actions={<Button variant="secondary" onPress={() => setPoints((cur) => [...cur, blank()])}>Add point</Button>}>
        <div className="flex flex-col gap-4">
          {points.map((p, i) => (
            <div key={i} className="rounded-[var(--radius-control)] border border-border p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <TextField label="Characteristic" value={p.characteristic} onChange={(v) => update(i, { characteristic: v })} isRequired />
                <TextField label="Inspection method" value={p.inspectionMethod} onChange={(v) => update(i, { inspectionMethod: v })} />
                <Select label="Result type" options={RESULT_TYPES} selectedKey={p.resultType} onSelectionChange={(k) => update(i, { resultType: String(k) })} />
                {p.resultType === "numeric" && (
                  <>
                    <TextField label="Lower limit" value={p.lowerLimit} onChange={(v) => update(i, { lowerLimit: v })} />
                    <TextField label="Target" value={p.targetValue} onChange={(v) => update(i, { targetValue: v })} />
                    <TextField label="Upper limit" value={p.upperLimit} onChange={(v) => update(i, { upperLimit: v })} />
                    <TextField label="Unit" value={p.unit} onChange={(v) => update(i, { unit: v })} />
                  </>
                )}
                {p.resultType === "selection" && <TextField label="Allowed values (comma-separated)" value={p.allowedValues} onChange={(v) => update(i, { allowedValues: v })} />}
              </div>
              <TextArea label="Instructions (optional)" value={p.instructions} onChange={(v) => update(i, { instructions: v })} />
              <div className="mt-2 flex gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={p.critical} onChange={(e) => update(i, { critical: e.target.checked })} /> Critical (any failure fails the whole lot)</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={p.destructive} onChange={(e) => update(i, { destructive: e.target.checked })} /> Destructive test</label>
                {points.length > 1 && <Button variant="ghost" onPress={() => setPoints((cur) => cur.filter((_, idx) => idx !== i))}>Remove</Button>}
              </div>
            </div>
          ))}
        </div>
      </QualityPanel>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onPress={() => router.push("/quality/plans")}>Cancel</Button>
        <Button variant="primary" isDisabled={missing} isLoading={save.isPending} onPress={() => save.mutate()}>Save plan</Button>
      </div>
    </div>
  );
}
