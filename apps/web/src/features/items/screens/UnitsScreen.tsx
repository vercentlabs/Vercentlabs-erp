"use client";

// Units of measure: the organization's list — each unit's dimension, symbol and precision (decimal places a quantity may have). Standard
// units of one dimension convert by their standard factor (1 KG = 1000 G); what a box or a roll holds is each item's own conversion, kept on
// the item under Units & Identifiers. A unit is never deleted: an inactive one stays on every document that used it.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Plus } from "lucide-react";
import {
  Button, buttonVariants, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, Menu, MenuItem, MenuTrigger, NoResultsState, PermissionState, SearchField, Select,
  StatusBadge, TextField,
} from "@vercentlabs/design-system";

import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { createUnit, errorCode, errorMessage, fieldErrors, getItemOptions, listUnits, setUnitStatus, unitConversionsExportUrl, updateUnit, type UnitOfMeasure } from "../api/items-api";
import { UnitConversionsImport } from "../components/UnitConversionsImport";
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
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search).toLowerCase();
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

  const units = useMemo(() => query.data ?? [], [query.data]);
  const label = (code: string) => categories.find((entry) => entry.code === code)?.label ?? code;
  const shown = useMemo(() => units.filter((unit) => (view === "all" || (view === "inactive" ? !unit.isActive : unit.category === view))
    && (!submitted || `${unit.code} ${unit.name} ${unit.symbol ?? ""}`.toLowerCase().includes(submitted))), [units, view, submitted]);
  const paged = usePagedRows(shown, { initialSorting: [{ id: "code", desc: false }] });
  // "1 KG = 1000 G": the unit against its dimension's reference unit.
  const standardText = (unit: UnitOfMeasure) => {
    const reference = units.find((entry) => entry.category === unit.category && entry.standardFactor === "1" && entry.code !== unit.code);
    return unit.standardFactor === "1" || !reference ? "Reference unit" : `1 ${unit.code} = ${unit.standardFactor} ${reference.code}`;
  };
  const open = (unit: UnitOfMeasure | "new") => {
    setErrors({}); setError(null);
    setDraft(unit === "new" ? blank : { code: unit.code, name: unit.name, symbol: unit.symbol ?? "", category: unit.category, decimalPlaces: String(unit.decimalPlaces) });
    setEditing(unit);
  };
  const columns: ColumnDef<UnitOfMeasure, unknown>[] = [
    { id: "code", accessorKey: "code", header: "Code", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.code}</span> },
    { id: "name", accessorKey: "name", header: "Unit", cell: ({ row }) => <>{row.original.name}{row.original.symbol && <span className="text-text-muted"> ({row.original.symbol})</span>}</> },
    { id: "category", accessorKey: "category", header: "Dimension", cell: ({ row }) => label(row.original.category) },
    { id: "decimalPlaces", accessorKey: "decimalPlaces", header: "Precision", cell: ({ row }) => (row.original.decimalPlaces === 0 ? "Whole numbers" : `${row.original.decimalPlaces} decimal place${row.original.decimalPlaces === 1 ? "" : "s"}`) },
    { id: "standard", header: "Standard conversion", enableSorting: false, cell: ({ row }) => (row.original.standardFactor ? standardText(row.original) : "") },
    { id: "itemCount", accessorKey: "itemCount", header: "Items", cell: ({ row }) => <span className="tabular-nums">{row.original.itemCount}</span> },
    { id: "isActive", accessorKey: "isActive", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.isActive ? "success" : "neutral"}>{row.original.isActive ? "Active" : "Inactive"}</StatusBadge> },
  ];

  if (query.isError && errorCode(query.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to units of measure" description="Ask an administrator for access." />;
  const dimensions = [...new Set(units.map((unit) => unit.category))];

  return (
    <div className="flex flex-col gap-4">
      <EnterpriseListPage
        header={{
          title: "Units of Measure",
          description: "Precision is how many decimals a quantity may have: 0 for whole pieces, 3 for kilograms to the gram. It can be raised any time, lowered only before items record quantities. Units of one dimension convert by their standard factor; packaging converts per item.",
          primaryAction: can?.manageUomMaster ? <Button variant="primary" onPress={() => open("new")}><Plus className="size-4" aria-hidden="true" />New unit</Button> : undefined,
          secondaryActions: (
            <>
              {can?.export && <a className={buttonVariants({ variant: "outline" })} href={unitConversionsExportUrl} download>Export item conversions</a>}
              {can?.import && can.manageUnits && <Button variant="outline" onPress={() => setImporting(true)}>Import item conversions</Button>}
            </>
          ),
        }}
        savedViews={{ views: [{ id: "all", label: "All" }, ...dimensions.map((code) => ({ id: code, label: label(code) })), { id: "inactive", label: "Inactive" }],
          activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
        actionBar={{ start: <SearchField aria-label="Search units" placeholder="Code, name or symbol" className="w-full sm:w-80" value={search} onChange={setSearch} /> }}
      >
        <ErrorBanner message={editing ? null : error} />
        <EnterpriseDataGrid<UnitOfMeasure>
          aria-label="Units of measure"
          columns={columns}
          data={paged.pageRows}
          getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : query.isError ? "error" : shown.length === 0 ? (units.length ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading units" rows={6} />}
          errorContent={<ErrorState title="Could not load units" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="No units yet" description="Add Piece, Kilogram, Box and the other units you count in." />}
          noResultsContent={<NoResultsState title="No units match" description="Try another view or search." />}
          {...paged.grid}
          rowActions={can?.manageUomMaster ? (unit) => (
            <MenuTrigger>
              <Button size="compact" variant="ghost" aria-label={`Actions for ${unit.code}`}><MoreHorizontal className="size-4" aria-hidden="true" /></Button>
              <Menu onAction={(key) => (key === "edit" ? open(unit) : status.mutate(unit))}>
                <MenuItem id="edit">Edit</MenuItem>
                <MenuItem id="status">{unit.isActive ? "Deactivate" : "Activate"}</MenuItem>
              </Menu>
            </MenuTrigger>
          ) : undefined}
          onRowClick={can?.manageUomMaster ? (unit) => open(unit) : undefined}
        />
      </EnterpriseListPage>
      <UnitConversionsImport isOpen={importing} onClose={() => setImporting(false)} />
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
