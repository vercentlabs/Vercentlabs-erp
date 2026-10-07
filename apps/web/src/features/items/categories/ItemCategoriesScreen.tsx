"use client";

// Item Categories: the one hierarchy Sales, Procurement, Inventory and Finance share. Tree view (the tree beside the chosen category),
// table view and category reports. A category suggests defaults for new items and restricts which item types it holds; it never holds
// stock, value or prices, and changing it never rewrites existing items.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Badge, Button, DatePicker, EmptyState, ErrorState, NoResultsState, PageHeader, PermissionState, SearchField, Select } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorCode, errorMessage, getCategoryReport, getItemOptions, listCategories, type Category, type CategoryFilters, type CategoryReport } from "../api/items-api";
import { money, quantity } from "../item-format";
import { CATEGORY_BASE, CategoryDetail } from "./CategoryDetail";
import { CategoryFormDialog, type CategoryFormTarget } from "./CategoryFormDialog";

type View = "tree" | "table" | "reports";
const ANY = "any";
const VIEWS: Array<{ id: View; label: string }> = [{ id: "tree", label: "Tree" }, { id: "table", label: "Table" }, { id: "reports", label: "Reports" }];

export function ItemCategoriesScreen({ categoryId }: { categoryId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const requestedView = params.get("view") as View | null;
  const [view, setViewState] = useState<View>(requestedView && VIEWS.some((entry) => entry.id === requestedView) ? requestedView : "tree");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ANY);
  const [hasItems, setHasItems] = useState(ANY);
  const [hasChildren, setHasChildren] = useState(ANY);
  const [profileId, setProfileId] = useState(ANY);
  const [form, setForm] = useState<CategoryFormTarget | null>(null);
  const filters: CategoryFilters = Object.fromEntries(Object.entries({ search: search.trim(), status, hasItems, hasChildren, profileId }).filter(([, value]) => value && value !== ANY));
  const filtered = Object.keys(filters).length > 0;
  // The whole tree (for paths, parents and the tree view) and, when filtering, the matching categories.
  const all = useQuery({ queryKey: scopedQueryKey(workspace, "products", "categories", "all"), queryFn: () => listCategories() });
  const matches = useQuery({ queryKey: scopedQueryKey(workspace, "products", "categories", filters), queryFn: () => listCategories(filters), enabled: filtered });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "products", "options"), queryFn: getItemOptions, staleTime: 60_000 });
  const can = options.data?.capabilities;
  const categories = useMemo(() => all.data ?? [], [all.data]);
  const shown = filtered ? matches.data ?? [] : categories;

  const setView = (next: View) => { setViewState(next); router.replace(`${CATEGORY_BASE}${next === "tree" ? "" : `?view=${next}`}`, { scroll: false }); };
  const open = (id: string | null) => router.push(id ? `${CATEGORY_BASE}/${id}` : CATEGORY_BASE);
  const saved = (category: Category) => {
    setForm(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") });
    if (view !== "tree") setViewState("tree");
    open(category.id);
  };

  if (all.isError && errorCode(all.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to item categories" description="Ask an administrator for access." />;
  const profiles = [...(options.data?.inventoryProfiles ?? []), ...(options.data?.accountingProfiles ?? [])];
  const yesNo = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Item Categories" description="One hierarchy for Sales, Procurement, Inventory and Finance. Defaults apply to items created afterwards; existing items keep their own settings."
        primaryAction={can?.manageCategories ? <Button variant="primary" onPress={() => setForm({ mode: "new", parentId: null })}><Plus className="size-4" aria-hidden="true" />New category</Button> : undefined} />
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="View" className="inline-flex rounded-[var(--radius-control)] border border-border p-0.5">
          {VIEWS.map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={view === entry.id} onClick={() => setView(entry.id)}
              className={`rounded-[calc(var(--radius-control)-2px)] px-3 py-1 text-sm ${view === entry.id ? "bg-surface-muted font-medium text-text" : "text-text-muted hover:text-text"}`}>{entry.label}</button>
          ))}
        </div>
        {view !== "reports" && (
          <>
            <SearchField aria-label="Search categories" placeholder="Search code, name or path" className="w-full sm:w-72" value={search} onChange={setSearch} />
            <Select aria-label="Status" size="compact" selectedKey={status} onSelectionChange={(key) => setStatus(String(key))}
              options={[{ value: ANY, label: "Any status" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
            <Select aria-label="Has items" size="compact" selectedKey={hasItems} onSelectionChange={(key) => setHasItems(String(key))} options={[{ value: ANY, label: "With or without items" }, ...yesNo.map((entry) => ({ ...entry, label: entry.value === "yes" ? "Has items" : "No items" }))]} />
            <Select aria-label="Has sub-categories" size="compact" selectedKey={hasChildren} onSelectionChange={(key) => setHasChildren(String(key))}
              options={[{ value: ANY, label: "With or without sub-categories" }, { value: "yes", label: "Has sub-categories" }, { value: "no", label: "No sub-categories" }]} />
            {profiles.length > 0 && <Select aria-label="Default profile" size="compact" selectedKey={profileId} onSelectionChange={(key) => setProfileId(String(key))}
              options={[{ value: ANY, label: "Any default profile" }, ...profiles.map((entry) => ({ value: entry.id, label: entry.name }))]} />}
          </>
        )}
      </div>

      {view === "reports" ? <ReportsView reports={options.data?.categoryReports ?? []} /> :
        all.isLoading || (filtered && matches.isLoading) ? <LoadingState label="Loading categories" rows={6} /> :
        all.isError || matches.isError ? <ErrorState title="Could not load categories" description={errorMessage(all.error ?? matches.error)} action={{ label: "Try again", onPress: () => { void all.refetch(); void matches.refetch(); } }} /> :
        categories.length === 0 ? <EmptyState title="No categories yet" description="Group items, such as Raw Materials › Steel or Components › Pumps."
          action={can?.manageCategories ? { label: "New category", onPress: () => setForm({ mode: "new", parentId: null }) } : undefined} /> :
        view === "table" ? <TableView rows={shown} onOpen={open} /> : (
          <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
            <nav aria-label="Category tree" className="max-h-[70vh] overflow-auto rounded-[var(--radius-card)] border border-border bg-surface p-2">
              {filtered ? (shown.length === 0 ? <NoResultsState title="Nothing matches" description="Try another search or filter." /> : (
                <ul className="flex flex-col text-sm">
                  {shown.map((entry) => (
                    <li key={entry.id}>
                      <button type="button" onClick={() => open(entry.id)} className={`flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-surface-muted ${entry.id === categoryId ? "bg-surface-muted" : ""}`}>
                        <span className="font-medium">{entry.name} {!entry.isActive && <Badge tone="neutral">Inactive</Badge>}</span>
                        <span className="text-xs text-text-muted">{entry.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )) : <Tree categories={categories} selectedId={categoryId ?? null} onOpen={open} />}
            </nav>
            <section aria-label="Category" className="min-w-0 rounded-[var(--radius-card)] border border-border bg-surface p-4">
              {categoryId ? <CategoryDetail key={categoryId} categoryId={categoryId} categories={categories} options={options.data} initialTab={params.get("tab")} onEdit={setForm} onOpen={open} />
                : <EmptyState title="Choose a category" description="Its items, sub-categories, defaults, stock and activity are shown here." />}
            </section>
          </div>
        )}
      <CategoryFormDialog target={form} categories={categories} options={options.data} onClose={() => setForm(null)} onSaved={saved} />
    </div>
  );
}

// The hierarchy, expandable; the chosen category's ancestors start expanded.
function Tree({ categories, selectedId, onOpen }: { categories: Category[]; selectedId: string | null; onOpen: (id: string) => void }) {
  const children = useMemo(() => {
    const map = new Map<string | null, Category[]>();
    for (const entry of categories) map.set(entry.parentId, [...(map.get(entry.parentId) ?? []), entry]);
    return map;
  }, [categories]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const selected = categories.find((entry) => entry.id === selectedId);
    return new Set([...(selected?.breadcrumb.map((step) => step.id) ?? []), ...categories.filter((entry) => !entry.parentId).map((entry) => entry.id)]);
  });
  const toggle = (id: string) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allIds = categories.filter((entry) => entry.childCount > 0).map((entry) => entry.id);
  const render = (parentId: string | null, depth: number) => (
    <ul role={depth === 0 ? "tree" : "group"} aria-label={depth === 0 ? "Categories" : undefined} className="flex flex-col text-sm">
      {(children.get(parentId) ?? []).map((entry) => {
        const isOpen = expanded.has(entry.id);
        return (
          <li key={entry.id} role="treeitem" aria-expanded={entry.childCount ? isOpen : undefined} aria-selected={entry.id === selectedId}>
            <div className={`flex items-center gap-1 rounded pr-2 ${entry.id === selectedId ? "bg-surface-muted" : "hover:bg-surface-muted"}`} style={{ paddingLeft: `${depth * 0.9}rem` }}>
              {entry.childCount ? (
                <button type="button" aria-label={isOpen ? `Collapse ${entry.name}` : `Expand ${entry.name}`} onClick={() => toggle(entry.id)} className="rounded p-0.5 text-text-muted hover:text-text">
                  {isOpen ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                </button>
              ) : <span className="w-5" aria-hidden="true" />}
              <button type="button" onClick={() => onOpen(entry.id)} className={`flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 text-left ${entry.isActive ? "" : "text-text-muted"}`}>
                <span className="truncate">{entry.name}</span>
                <span className="shrink-0 text-xs text-text-muted tabular-nums">{entry.totalItems}</span>
              </button>
            </div>
            {entry.childCount > 0 && isOpen && render(entry.id, depth + 1)}
          </li>
        );
      })}
    </ul>
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-end gap-1">
        <Button size="compact" variant="ghost" onPress={() => setExpanded(new Set(allIds))}>Expand all</Button>
        <Button size="compact" variant="ghost" onPress={() => setExpanded(new Set())}>Collapse all</Button>
      </div>
      {render(null, 0)}
    </div>
  );
}

function TableView({ rows, onOpen }: { rows: Category[]; onOpen: (id: string) => void }) {
  if (!rows.length) return <NoResultsState title="Nothing matches" description="Try another search or filter." />;
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs text-text-muted">
          <tr>{["Code", "Category", "Status", "Item types", "Items (direct)", "Items (total)", "Sub-categories", "Defaults"].map((label) => <th key={label} className="px-3 py-2 font-medium whitespace-nowrap">{label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id} className="cursor-pointer hover:bg-surface-muted" onClick={() => onOpen(row.id)}>
              <td className="px-3 py-2 tabular-nums">{row.code}</td>
              <td className="px-3 py-2"><Link href={`${CATEGORY_BASE}/${row.id}`} className="font-medium text-brand hover:underline" onClick={(event) => event.stopPropagation()}>{row.name}</Link>
                {row.parentId && <span className="block text-xs text-text-muted">{row.path}</span>}</td>
              <td className="px-3 py-2">{row.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</td>
              <td className="px-3 py-2">{row.allowedItemTypes?.length ? row.allowedItemTypesLabel : <span className="text-text-muted">All</span>}</td>
              <td className="px-3 py-2 tabular-nums">{row.directItems}</td>
              <td className="px-3 py-2 tabular-nums">{row.totalItems}</td>
              <td className="px-3 py-2 tabular-nums">{row.childCount}</td>
              <td className="px-3 py-2 text-xs text-text-secondary">{[row.defaultValuationLabel, row.defaultInventoryProfileName, row.defaultAccountingProfileName, row.defaultTaxCategoryName,
                row.defaultHsnSacCode ? `HSN ${row.defaultHsnSacCode}` : null].filter(Boolean).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportsView({ reports }: { reports: Array<{ key: string; title: string; unit: string; dated: boolean }> }) {
  const workspace = useWorkspaceContext();
  const [key, setKey] = useState("items");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const info = reports.find((entry) => entry.key === key);
  const range = info?.dated ? { from: from ?? undefined, to: to ?? undefined } : {};
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "products", "categories", "report", key, range), queryFn: () => getCategoryReport(key, range), enabled: Boolean(info) });
  const report = query.data;
  const show = (value: number, unit: CategoryReport["unit"]) => (unit === "money" ? money(value) : unit === "quantity" ? quantity(value) : String(value));
  const rows = (report?.rows ?? []).filter((row) => row.total !== 0 || (row.totalOut ?? 0) !== 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Report" className="w-72" selectedKey={key} onSelectionChange={(value) => setKey(String(value))} options={reports.map((entry) => ({ value: entry.key, label: entry.title }))} />
        {info?.dated && <DatePicker label="From" onChange={(value) => setFrom(value ? value.toString() : null)} />}
        {info?.dated && <DatePicker label="To" onChange={(value) => setTo(value ? value.toString() : null)} />}
      </div>
      {query.isLoading ? <LoadingState label="Loading report" rows={6} /> : query.isError ? <ErrorState title="Could not load the report" description={errorMessage(query.error)} /> : !report ? null :
        rows.length === 0 && !report.uncategorized ? <EmptyState title="Nothing to report" description="No figures for this report yet." /> : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-text-muted">
                <tr><th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">{key === "movements" ? "In (direct)" : "Direct"}</th><th className="px-3 py-2 text-right font-medium">{key === "movements" ? "In (with sub-categories)" : "With sub-categories"}</th>
                  {key === "movements" && <><th className="px-3 py-2 text-right font-medium">Out (direct)</th><th className="px-3 py-2 text-right font-medium">Out (with sub-categories)</th></>}</tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {rows.map((row) => (
                  <tr key={row.categoryId}>
                    <td className="px-3 py-2" style={{ paddingLeft: `${0.75 + row.depth * 1.1}rem` }}><Link className="text-brand hover:underline" href={`${CATEGORY_BASE}/${row.categoryId}`}>{row.name}</Link>
                      {!row.isActive && <span className="ml-1 text-xs text-text-muted">(inactive)</span>}</td>
                    <td className="px-3 py-2 text-right">{show(row.direct, report.unit)}</td>
                    <td className="px-3 py-2 text-right font-medium">{show(row.total, report.unit)}</td>
                    {key === "movements" && <><td className="px-3 py-2 text-right">{show(row.directOut ?? 0, report.unit)}</td><td className="px-3 py-2 text-right font-medium">{show(row.totalOut ?? 0, report.unit)}</td></>}
                  </tr>
                ))}
                {report.uncategorized !== 0 && <tr><td className="px-3 py-2 text-text-muted">No category</td><td className="px-3 py-2 text-right">{show(report.uncategorized, report.unit)}</td><td className="px-3 py-2 text-right">{show(report.uncategorized, report.unit)}</td></tr>}
              </tbody>
              <tfoot className="border-t border-border font-medium tabular-nums">
                <tr><td className="px-3 py-2">Total</td><td /><td className="px-3 py-2 text-right">{show(report.grandTotal, report.unit)}</td></tr>
              </tfoot>
            </table>
          </div>
        )}
      <p className="text-xs text-text-muted">Each figure is read from the module that owns it (items, Inventory, Procurement, Sales invoices) and rolled up the category tree.</p>
    </div>
  );
}
