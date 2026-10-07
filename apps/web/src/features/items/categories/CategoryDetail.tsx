"use client";

// One category: Overview, Items, Subcategories, Defaults, Stock Summary and Activity. Counts and stock are read from items and Inventory;
// a category never holds stock or value itself.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog, Badge, Breadcrumb, Breadcrumbs, Button, Checkbox, ComboBox, Dialog, EmptyState, ErrorState, Menu, MenuItem, MenuTrigger, Tab, TabList, TabPanel, Tabs, TextArea,
} from "@vercentlabs/design-system";
import { MoreHorizontal, Plus } from "lucide-react";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  deleteCategory, errorMessage, getCategory, getCategoryItems, getCategoryStock, moveCategory, reassignCategory, setCategoryStatus, type Category, type DefaultField, type ItemOptions,
} from "../api/items-api";
import { defaultValueLabel } from "../components/ReclassifyDialog";
import { ErrorBanner, ItemTypeBadge, LifecycleBadge, money, quantity } from "../item-format";
import type { CategoryFormTarget } from "./CategoryFormDialog";

export const CATEGORY_BASE = "/inventory/item-categories";
const TABS = ["overview", "items", "subcategories", "defaults", "stock", "activity"] as const;
const DEFAULT_ROWS: Array<[DefaultField, string]> = [
  ["valuationMethod", "Valuation method"], ["inventoryProfileId", "Inventory profile"], ["accountingProfileId", "Accounting profile"], ["taxCategoryId", "Tax profile"], ["hsnSacCode", "HSN / SAC"],
];

function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-xs font-medium text-text-muted">{label}</dt>
          <dd className="text-sm break-words">{value === null || value === undefined || value === "" ? <span className="text-text-muted">Not set</span> : value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CategoryDetail({ categoryId, categories, options, initialTab, onEdit, onOpen }: {
  categoryId: string; categories: Category[]; options?: ItemOptions; initialTab?: string | null; onEdit: (target: CategoryFormTarget) => void; onOpen: (id: string | null) => void;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<string>(initialTab && (TABS as readonly string[]).includes(initialTab) ? initialTab : "overview");
  const [dialog, setDialog] = useState<"move" | "items" | "status" | "delete" | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "products", "categories", "one", categoryId), queryFn: () => getCategory(categoryId) });
  const can = options?.capabilities;
  const done = (message?: string) => {
    setDialog(null); setReason(""); setTarget(null); setError(null);
    if (message) setNotice(message);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "products") });
  };
  const fail = (failure: unknown) => setError(errorMessage(failure));
  const move = useMutation({
    mutationFn: () => moveCategory(categoryId, { parentId: target === "top" ? null : target, reason: reason.trim() || undefined, expectedVersion: query.data?.version }),
    onSuccess: (category) => done(`Moved. The path is now ${category.path}.`), onError: fail,
  });
  const reassign = useMutation({
    mutationFn: () => reassignCategory(categoryId, target!),
    onSuccess: (result) => done(`${result.moved} item${result.moved === 1 ? "" : "s"} moved.${result.failed.length ? ` ${result.failed.length} could not move: ${result.failed.map((entry) => `${entry.code} (${entry.message})`).join("; ")}` : ""}`),
    onError: fail,
  });
  const status = useMutation({
    mutationFn: () => setCategoryStatus(categoryId, query.data!.isActive ? "inactive" : "active", reason.trim() || undefined),
    onSuccess: (category) => done(category.isActive ? "Reactivated." : "Deactivated. It is no longer offered for new items."), onError: (failure) => { setDialog(null); fail(failure); },
  });
  const remove = useMutation({
    mutationFn: () => deleteCategory(categoryId, reason.trim() || undefined),
    onSuccess: () => { done(); onOpen(query.data?.parentId ?? null); }, onError: (failure) => { setDialog(null); fail(failure); },
  });

  if (query.isLoading) return <LoadingState label="Loading category" rows={6} />;
  if (query.isError || !query.data) return <ErrorState title="Category not found" description={errorMessage(query.error, "It may have been deleted.")} action={{ label: "Back to categories", onPress: () => onOpen(null) }} />;
  const category = query.data;
  const descendants = new Set(categories.filter((entry) => entry.breadcrumb.some((step) => step.id === category.id)).map((entry) => entry.id));
  const moveChoices = [{ value: "top", label: "Top level" },
    ...categories.filter((entry) => entry.isActive && !descendants.has(entry.id) && entry.id !== category.parentId).map((entry) => ({ value: entry.id, label: entry.path }))];
  const menu = [
    ...(can?.manageCategories ? [{ id: "move", label: "Move", run: () => setDialog("move") }] : []),
    ...(can?.reclassify && category.directItems > 0 ? [{ id: "items", label: "Move its items", run: () => setDialog("items") }] : []),
    ...(can?.manageCategories ? [{ id: "status", label: category.isActive ? "Deactivate" : "Reactivate", run: () => setDialog("status") }] : []),
    ...(can?.deleteCategories && category.totalItems === 0 && category.childCount === 0 ? [{ id: "delete", label: "Delete", run: () => setDialog("delete") }] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Breadcrumbs>
          <Breadcrumb href={CATEGORY_BASE}>Item Categories</Breadcrumb>
          {category.breadcrumb.map((step) => <Breadcrumb key={step.id} href={`${CATEGORY_BASE}/${step.id}`} isCurrent={step.id === category.id}>{step.name}</Breadcrumb>)}
        </Breadcrumbs>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">{category.name}<span className="text-sm font-normal text-text-muted tabular-nums">{category.code}</span>
              {!category.isActive && <Badge tone="neutral">Inactive</Badge>}</h2>
            <p className="text-sm text-text-secondary">{category.totalItems} item{category.totalItems === 1 ? "" : "s"} in total · {category.directItems} directly · {category.childCount} sub-categor{category.childCount === 1 ? "y" : "ies"}</p>
          </div>
          {can?.manageCategories && (
            <div className="flex gap-2">
              <Button variant="outline" onPress={() => onEdit({ mode: "new", parentId: category.id })} isDisabled={!category.isActive}><Plus className="size-4" aria-hidden="true" />Sub-category</Button>
              <Button variant="primary" onPress={() => onEdit({ mode: "edit", category })}>Edit</Button>
              {menu.length > 0 && (
                <MenuTrigger>
                  <Button variant="outline" aria-label="More actions"><MoreHorizontal className="size-4" aria-hidden="true" /></Button>
                  <Menu onAction={(key) => { setError(null); setTarget(null); menu.find((entry) => entry.id === key)?.run(); }}>{menu.map((entry) => <MenuItem key={entry.id} id={entry.id}>{entry.label}</MenuItem>)}</Menu>
                </MenuTrigger>
              )}
            </div>
          )}
        </div>
      </div>
      <ErrorBanner message={dialog ? null : error} />
      {notice && <p role="status" className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">{notice}</p>}
      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
        <TabList aria-label="Category sections">
          <Tab id="overview">Overview</Tab>
          <Tab id="items">Items</Tab>
          <Tab id="subcategories">Subcategories</Tab>
          <Tab id="defaults">Defaults</Tab>
          {can?.viewStock && <Tab id="stock">Stock Summary</Tab>}
          <Tab id="activity">Activity</Tab>
        </TabList>
        <TabPanel id="overview" className="pt-3">
          <Facts items={[["Code", category.code], ["Name", category.name], ["Path", category.path], ["Parent", category.parentName ?? "Top level"], ["Status", category.isActive ? "Active" : "Inactive"],
            ["Item types", category.allowedItemTypes?.length ? category.allowedItemTypesLabel : `All allowed by the parent (${category.effectiveItemTypes.map((code) => options?.types.find((entry) => entry.code === code)?.label ?? code).join(", ")})`],
            ["Sort order", String(category.sortOrder)], ["SKU prefix", category.skuPrefix ?? "Inherited or default"], ["Items", `${category.directItems} directly (${category.directActiveItems} active) · ${category.totalItems} with sub-categories`],
            ["Sub-categories", `${category.childCount} directly · ${category.descendantCount} in total`], ["Description", category.description],
            ["Created", formatDateTime(category.createdAt)], ["Last updated", formatDateTime(category.updatedAt)]]} />
        </TabPanel>
        <TabPanel id="items" className="pt-3"><ItemsPanel category={category} /></TabPanel>
        <TabPanel id="subcategories" className="pt-3">
          {category.children?.length ? (
            <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border text-sm">
              {category.children.map((child) => (
                <li key={child.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <Link href={`${CATEGORY_BASE}/${child.id}`} className="font-medium text-brand hover:underline">{child.name} <span className="font-normal text-text-muted">{child.code}</span></Link>
                  <span className="flex items-center gap-2 text-xs text-text-muted">{!child.isActive && <Badge tone="neutral">Inactive</Badge>}{child.totalItems} items · {child.childCount} sub-categories</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No sub-categories" description="Add one to split this category further."
            action={can?.manageCategories && category.isActive ? { label: "Add sub-category", onPress: () => onEdit({ mode: "new", parentId: category.id }) } : undefined} />}
        </TabPanel>
        <TabPanel id="defaults" className="pt-3">
          <div className="flex flex-col gap-2">
            <p className="text-xs text-text-muted">What a new item in this category receives. Set here, inherited from the nearest parent that sets it, or the company default. Existing items keep their own settings.</p>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-text-muted"><th className="py-1 font-medium">Setting</th><th className="py-1 font-medium">New items get</th><th className="py-1 font-medium">Source</th></tr></thead>
              <tbody className="divide-y divide-border">
                {DEFAULT_ROWS.map(([field, label]) => {
                  const entry = category.resolvedDefaults?.[field];
                  return (
                    <tr key={field}>
                      <td className="py-1.5 pr-2 text-text-secondary">{label}</td>
                      <td className="py-1.5 pr-2">{entry?.value ? entry.label ?? defaultValueLabel(field, entry.value, options) : <span className="text-text-muted">Nothing</span>}</td>
                      <td className="py-1.5">{!entry?.value ? "" : entry.source === "category" ? "Set here" : entry.source === "company" ? "Company default"
                        : <Link className="text-brand hover:underline" href={`${CATEGORY_BASE}/${entry.fromId}`}>Inherited from {entry.fromName}</Link>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabPanel>
        <TabPanel id="stock" className="pt-3"><StockPanel category={category} /></TabPanel>
        <TabPanel id="activity" className="pt-3">
          {category.history?.length ? (
            <ol className="flex flex-col gap-2 text-sm">
              {category.history.map((entry) => (
                <li key={entry.id} className="flex flex-col rounded-[var(--radius-control)] border border-border px-3 py-2">
                  <span>{entry.summary}</span>
                  <span className="text-xs text-text-muted">{[entry.actorName, formatDateTime(entry.createdAt)].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ol>
          ) : <EmptyState title="No activity yet" />}
        </TabPanel>
      </Tabs>

      <Dialog isOpen={dialog === "move"} onOpenChange={(open) => !open && setDialog(null)} title={`Move ${category.name}`}
        description="Its sub-categories and items move with it. Items, stock, cost and documents do not change.">
        <div className="flex flex-col gap-3">
          <ErrorBanner message={error} />
          <p className="text-sm"><span className="text-text-muted">Now: </span>{category.path}</p>
          <ComboBox label="New parent" isRequired placeholder="Search categories" selectedKey={target} options={moveChoices} onSelectionChange={(key) => setTarget(key === null ? null : String(key))} />
          {target && <p className="text-sm"><span className="text-text-muted">New path: </span>{[...(target === "top" ? [] : [categories.find((entry) => entry.id === target)?.path]), category.name].join(" › ")}</p>}
          <TextArea label="Reason (optional)" rows={2} value={reason} onChange={setReason} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setDialog(null)}>Cancel</Button><Button variant="primary" isDisabled={!target} isLoading={move.isPending} onPress={() => move.mutate()}>Move</Button></div>
        </div>
      </Dialog>
      <Dialog isOpen={dialog === "items"} onOpenChange={(open) => !open && setDialog(null)} title={`Move the items of ${category.name}`}
        description="Each item is reclassified on its own and keeps its settings, stock and cost. Items of a type the new category does not allow stay where they are.">
        <div className="flex flex-col gap-3">
          <ErrorBanner message={error} />
          <ComboBox label="Move to" isRequired placeholder="Search categories" selectedKey={target} onSelectionChange={(key) => setTarget(key === null ? null : String(key))}
            options={categories.filter((entry) => entry.isActive && entry.id !== category.id).map((entry) => ({ value: entry.id, label: entry.path }))} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setDialog(null)}>Cancel</Button><Button variant="primary" isDisabled={!target} isLoading={reassign.isPending} onPress={() => reassign.mutate()}>Move items</Button></div>
        </div>
      </Dialog>
      <Dialog isOpen={dialog === "status"} onOpenChange={(open) => !open && setDialog(null)} title={`${category.isActive ? "Deactivate" : "Reactivate"} ${category.name}?`}
        description={category.isActive ? "It stays on its items and in reports, but is no longer offered for new items. Its active sub-categories and active items must be moved or deactivated first." : "It is offered for new items again. Its parent must be active."}>
        <div className="flex flex-col gap-3">
          <TextArea label="Reason (optional)" rows={2} value={reason} onChange={setReason} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setDialog(null)}>Cancel</Button>
            <Button variant={category.isActive ? "danger" : "primary"} isLoading={status.isPending} onPress={() => status.mutate()}>{category.isActive ? "Deactivate" : "Reactivate"}</Button></div>
        </div>
      </Dialog>
      <AlertDialog isOpen={dialog === "delete"} onOpenChange={(open) => !open && setDialog(null)} title={`Delete ${category.name}?`}
        description="Only a category no item, sub-category, account mapping or pricing rule uses can be deleted. The deletion is recorded." confirmLabel="Delete"
        isConfirming={remove.isPending} onConfirm={() => remove.mutate()} />
    </div>
  );
}

function ItemsPanel({ category }: { category: Category }) {
  const workspace = useWorkspaceContext();
  const [withSubcategories, setWithSubcategories] = useState(true);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "products", "categories", "one", category.id, "items", withSubcategories),
    queryFn: () => getCategoryItems(category.id, withSubcategories),
  });
  const rows = query.data?.products ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Checkbox isSelected={withSubcategories} onChange={setWithSubcategories}>Include subcategories</Checkbox>
        <Link className="text-sm text-brand hover:underline" href={`/inventory/items?categoryId=${category.id}${withSubcategories ? "" : "&includeSubcategories=no"}`}>Open in the item list</Link>
      </div>
      {query.isLoading ? <LoadingState label="Loading items" rows={4} /> : query.isError ? <ErrorState title="Could not load items" action={{ label: "Try again", onPress: () => void query.refetch() }} /> :
        rows.length === 0 ? <EmptyState title="No items" description={withSubcategories ? "No item is in this category or below." : "No item is directly in this category."} /> : (
          <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border text-sm">
            {rows.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <Link href={`/inventory/items/${item.id}`} className="flex flex-col">
                  <span className="font-medium text-brand hover:underline">{item.name}</span>
                  <span className="text-xs text-text-muted">{item.code}{withSubcategories && item.categoryId !== category.id ? ` · ${item.categoryName}` : ""}</span>
                </Link>
                <span className="flex flex-wrap gap-1"><ItemTypeBadge item={item} /><LifecycleBadge status={item.lifecycleStatus} /></span>
              </li>
            ))}
          </ul>
        )}
      {(query.data?.total ?? 0) > rows.length && <p className="text-xs text-text-muted">Showing {rows.length} of {query.data?.total}. Open the item list for all of them.</p>}
    </div>
  );
}

function StockPanel({ category }: { category: Category }) {
  const workspace = useWorkspaceContext();
  const [withSubcategories, setWithSubcategories] = useState(true);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "products", "categories", "one", category.id, "stock", withSubcategories),
    queryFn: () => getCategoryStock(category.id, withSubcategories),
  });
  const data = query.data;
  const showsValue = data?.totals.value !== undefined;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Checkbox isSelected={withSubcategories} onChange={setWithSubcategories}>Include subcategories</Checkbox>
        <p className="text-xs text-text-muted">Read from Inventory balances. A category holds no stock of its own.</p>
      </div>
      {query.isLoading ? <LoadingState label="Loading stock" rows={3} /> : query.isError ? <ErrorState title="Could not load stock" description={errorMessage(query.error)} /> :
        !data?.warehouses.length ? <EmptyState title="No stock" description="No item in this category holds stock." /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-text-muted">
              <th className="py-1 font-medium">Warehouse</th><th className="py-1 text-right font-medium">On hand</th><th className="py-1 text-right font-medium">Reserved</th>
              <th className="py-1 text-right font-medium">Available</th>{showsValue && <th className="py-1 text-right font-medium">Value</th>}
            </tr></thead>
            <tbody className="divide-y divide-border tabular-nums">
              {data.warehouses.map((row) => (
                <tr key={row.warehouseId}><td className="py-1.5">{row.name}</td><td className="py-1.5 text-right">{quantity(row.onHand)}</td><td className="py-1.5 text-right">{quantity(row.reserved)}</td>
                  <td className="py-1.5 text-right">{quantity(row.available)}</td>{showsValue && <td className="py-1.5 text-right">{money(row.value)}</td>}</tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border font-medium tabular-nums">
              <tr><td className="py-1.5">Total</td><td className="py-1.5 text-right">{quantity(data.totals.onHand)}</td><td className="py-1.5 text-right">{quantity(data.totals.reserved)}</td>
                <td className="py-1.5 text-right">{quantity(data.totals.available)}</td>{showsValue && <td className="py-1.5 text-right">{money(data.totals.value)}</td>}</tr>
            </tfoot>
          </table>
        )}
      <p className="text-xs text-text-muted">Quantities add up the base units of different items, so they are a rough measure; value is exact.</p>
    </div>
  );
}
