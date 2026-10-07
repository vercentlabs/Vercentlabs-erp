"use client";

// Units of measure: the organization's list — each unit's dimension, symbol and precision (decimal places a quantity may have). Standard
// units of one dimension convert by their standard factor (1 KG = 1000 G); what a box or a roll holds is each item's own conversion, kept on
// the item under Units & Identifiers. A unit is never deleted: an inactive one stays on every document that used it.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Badge, Button, Dialog, EmptyState, ErrorState, PageHeader, PermissionState, Select, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { createUnit, errorCode, errorMessage, fieldErrors, getItemOptions, listUnits, setUnitStatus, updateUnit, type UnitOfMeasure } from "../api/items-api";
import { ErrorBanner } from "../item-format";

type Draft = { code: string; name: string; symbol: string; category: string; decimalPlaces: string };
const blank: Draft = { code: "", name: "", symbol: "", category: "quantity", decimalPlaces: "0" };

export function UnitsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<UnitOfMeasure | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "products", "units"), queryFn: listUnits });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "products", "options"), queryFn: getItemOptions, staleTime: 60_000 });
  const can = options.data?.capabilities;
  const categories = options.data?.uomCategories ?? [];
  const refresh = () => { setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") }); };
  const fail = (failure: unknown) => { setErrors(fieldErrors(failure)); setError(errorMessage(failure)); };
  const save = useMutation({
    mutationFn: () => editing === "new"
      ? createUnit({ code: draft.code.trim(), name: draft.name.trim(), symbol: draft.symbol.trim() || null, category: draft.category, decimalPlaces: Number(draft.decimalPlaces) })
      : updateUnit((editing as UnitOfMeasure).id, { name: draft.name.trim(), symbol: draft.symbol.trim() || null, category: draft.category, decimalPlaces: Number(draft.decimalPlaces),
          expectedVersion: (editing as UnitOfMeasure).version }),
    onSuccess: () => { setEditing(null); refresh(); },
    onError: fail,
  });
  const status = useMutation({ mutationFn: (unit: UnitOfMeasure) => setUnitStatus(unit.id, unit.isActive ? "inactive" : "active"), onSuccess: refresh, onError: fail });

  if (query.isError && errorCode(query.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to units of measure" description="Ask an administrator for access." />;
  const units = query.data ?? [];
  const open = (unit: UnitOfMeasure | "new") => {
    setErrors({}); setError(null);
    setDraft(unit === "new" ? blank : { code: unit.code, name: unit.name, symbol: unit.symbol ?? "", category: unit.category, decimalPlaces: String(unit.decimalPlaces) });
    setEditing(unit);
  };
  // "1 KG = 1000 G": the unit against its dimension's reference unit.
  const standardText = (unit: UnitOfMeasure, all: UnitOfMeasure[]) => {
    const reference = all.find((entry) => entry.category === unit.category && entry.standardFactor === "1" && entry.code !== unit.code);
    return unit.standardFactor === "1" || !reference ? "reference unit" : `1 ${unit.code} = ${unit.standardFactor} ${reference.code}`;
  };
  const label = (code: string) => categories.find((entry) => entry.code === code)?.label ?? code;
  const groups = [...new Set(units.map((unit) => unit.category))];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Units of Measure" description="Precision is how many decimals a quantity may have: 0 for whole pieces, 3 for kilograms to the gram. It can be raised any time, lowered only before items record quantities. Units of one dimension convert by their standard factor; packaging converts per item."
        primaryAction={can?.manageUomMaster ? <Button variant="primary" onPress={() => open("new")}><Plus className="size-4" aria-hidden="true" />New unit</Button> : undefined} />
      <ErrorBanner message={editing ? null : error} />
      {query.isLoading ? <LoadingState label="Loading units" rows={5} /> : query.isError ? <ErrorState title="Could not load units" action={{ label: "Try again", onPress: () => void query.refetch() }} /> :
        units.length === 0 ? <EmptyState title="No units yet" description="Add Piece, Kilogram, Box and the other units you count in." /> : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <section key={group} aria-label={label(group)} className="rounded-[var(--radius-card)] border border-border bg-surface">
                <h3 className="border-b border-border px-4 py-2 text-sm font-semibold">{label(group)}</h3>
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {units.filter((unit) => unit.category === group).map((unit) => (
                    <li key={unit.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium tabular-nums">{unit.code}</span><span>{unit.name}</span>
                        {unit.symbol && <span className="text-text-muted">({unit.symbol})</span>}
                        <span className="text-xs text-text-muted">{unit.decimalPlaces === 0 ? "Whole numbers" : `${unit.decimalPlaces} decimal place${unit.decimalPlaces === 1 ? "" : "s"}`} · {unit.itemCount} item{unit.itemCount === 1 ? "" : "s"}
                          {unit.standardFactor ? ` · standard: ${standardText(unit, units)}` : ""}</span>
                        {!unit.isActive && <Badge tone="neutral">Inactive</Badge>}
                      </span>
                      {can?.manageUomMaster && (
                        <span className="flex gap-1">
                          <Button size="compact" variant="ghost" onPress={() => open(unit)}>Edit</Button>
                          <Button size="compact" variant="ghost" isLoading={status.isPending && status.variables?.id === unit.id} onPress={() => status.mutate(unit)}>{unit.isActive ? "Deactivate" : "Activate"}</Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      <Dialog isOpen={editing !== null} onOpenChange={(next) => !next && setEditing(null)} title={editing === "new" ? "New unit" : `Edit ${typeof editing === "object" && editing ? editing.code : ""}`}>
        <div className="flex flex-col gap-3">
          <ErrorBanner message={error} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label="Code" isRequired isDisabled={editing !== "new"} value={draft.code} onChange={(code) => setDraft({ ...draft, code: code.toUpperCase() })} errorMessage={errors.code}
              description={editing !== "new" ? "Printed on documents; fixed once created." : undefined} />
            <TextField label="Name" isRequired value={draft.name} onChange={(name) => setDraft({ ...draft, name })} errorMessage={errors.name} />
            <TextField label="Symbol" value={draft.symbol} onChange={(symbol) => setDraft({ ...draft, symbol })} errorMessage={errors.symbol} description="Optional, such as kg." />
            <Select label="Dimension" selectedKey={draft.category} onSelectionChange={(value) => setDraft({ ...draft, category: String(value) })}
              options={categories.map((entry) => ({ value: entry.code, label: entry.label }))} errorMessage={errors.category} />
            <Select label="Decimal places" selectedKey={draft.decimalPlaces} onSelectionChange={(value) => setDraft({ ...draft, decimalPlaces: String(value) })}
              options={["0", "1", "2", "3", "4", "5", "6"].map((value) => ({ value, label: value }))} errorMessage={errors.decimalPlaces} />
          </div>
          <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setEditing(null)}>Cancel</Button><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button></div>
        </div>
      </Dialog>
    </div>
  );
}
