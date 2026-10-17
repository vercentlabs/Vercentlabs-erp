"use client";

// Assets — Asset Categories: the Company's one category master. The directory lists each category with its rules and asset counts (Finance's
// policy state for those allowed) and, for Finance, the category corrections waiting for review. A new category is set up in plain words —
// what it is, how its assets are identified, located and looked after — and its code is generated. Finance alone sets the financial references,
// on the category's page; each rules change is a new policy version, and assets already registered keep theirs. Starter templates are
// offered, never created unasked.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button, Checkbox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PageHeader, PermissionState, RecordDetailsPage, SearchField, Select,
  StatusBadge, Tab, TabList, Tabs, TextArea, TextField,
} from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useSubmitKey } from "@/shared/http/submit-once";
import { FormSection } from "@/shared/ui/FormSection";
import { filterBarOf, useDebouncedValue } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, HistoryList, LinesTable, MoreActions, type MoreAction } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { ASSETS_BASE, LIFECYCLE_TONE, dateLabel, errorMessage, errorStatus, getOptions, money, newKey } from "../register/register-api";
import {
  CATEGORIES_BASE, LABELS, RECLASS_STATUS, addStarters, categoriesExportHref, categoryAction, createCategory, decideReclassification, getCategory, getCategoryAssets, getCategoryReport, getHistory,
  getReclassifications, getTemplates, listCategories, optionsOf, updateCategory, type Category, type CategoryDetail, type Impact, type Reclassification,
} from "./categories-api";

const yes = (value: boolean) => (value ? "Yes" : "No");

// ------------------------------------------------------------------ directory
const VIEWS = [{ id: "active", label: "Active" }, { id: "inactive", label: "Inactive" }, { id: "all", label: "All categories" }];
export function CategoryDirectoryScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [view, setView] = useState(VIEWS.some((row) => row.id === params.get("view")) ? params.get("view")! : "active");
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search);
  const [assetType, setAssetType] = useState<string | null>(null);
  const [starters, setStarters] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const filters = { status: view, search: term || undefined, assetType: assetType ?? undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "categories", JSON.stringify(filters)), queryFn: () => listCategories(filters), retry: false });
  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to asset categories" description="Ask an administrator for access." />;
  const can = list.data?.can;
  const rows = list.data?.rows ?? [];
  const columns: ColumnDef<Category>[] = [
    { id: "name", header: "Category", cell: ({ row }) => <span className="flex flex-col"><Link className="font-medium text-brand hover:underline" href={`${CATEGORIES_BASE}/${row.original.id}`}>{row.original.name}</Link><span className="text-xs text-text-muted">{row.original.code}</span></span> },
    { id: "type", header: "Type", cell: ({ row }) => row.original.assetTypeLabel },
    { id: "guidance", header: "Tracking", cell: ({ row }) => row.original.capitalizationGuidanceLabel },
    { id: "identification", header: "Serial / tag", cell: ({ row }) => <span className="text-xs">{`Serial ${row.original.serialNumberPolicyLabel.toLowerCase()}`}<span className="block text-text-muted">{`Tag ${row.original.assetTagPolicyLabel.toLowerCase()}`}</span></span> },
    { id: "custody", header: "Custody", cell: ({ row }) => <span className="text-xs">{row.original.custodianPolicyLabel}</span> },
    { id: "assets", header: "Assets", cell: ({ row }) => <span className="text-sm">{row.original.counts?.total ?? 0}<span className="block text-xs text-text-muted">{`${row.original.counts?.active ?? 0} active`}</span></span> },
    ...(can?.seeFinance ? [{ id: "finance", header: "Finance policy", cell: ({ row }: { row: { original: Category } }) => row.original.capitalizationGuidance === "TRACK_ONLY" ? <span className="text-xs text-text-muted">Not needed</span>
      : row.original.financePolicyComplete ? <StatusBadge tone="success">Complete</StatusBadge> : <StatusBadge tone="warning">Incomplete</StatusBadge> }] as ColumnDef<Category>[] : []),
    { id: "status", header: "Status", cell: ({ row }) => row.original.active ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="neutral">Inactive</StatusBadge> },
  ];
  const filtered = Boolean(term || assetType);
  return (
    <EnterpriseListPage
      header={{ title: "Asset Categories", description: "How each kind of asset is identified, located and looked after. A category suggests and checks; it never capitalizes, depreciates or posts anything.",
        primaryAction: can?.create ? <LinkButton variant="primary" href={`${CATEGORIES_BASE}/new`}>New category</LinkButton> : undefined,
        secondaryActions: (
          <span className="flex flex-wrap gap-2">
            {can?.create && <Button variant="secondary" onPress={() => setStarters(true)}>Add starter categories</Button>}
            <LinkButton variant="secondary" href={`${CATEGORIES_BASE}/reports`}>Reports</LinkButton>
            {can?.export && <LinkButton variant="secondary" href={categoriesExportHref}>Export</LinkButton>}
          </span>
        ) }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); router.replace(`${pathname}?view=${id}`, { scroll: false }); } }}
      actionBar={{ start: (
        <>
          <SearchField aria-label="Search categories" placeholder="Name, code or description" className="w-full sm:w-80" value={search} onChange={setSearch} />
          <Select aria-label="Type" label="Type" size="compact" placeholder="Any type" selectedKey={assetType} onSelectionChange={(key) => setAssetType(key ? String(key) : null)} options={optionsOf(LABELS.assetType)} />
        </>
      ) }}
      filterBar={filterBarOf([{ id: "assetType", active: Boolean(assetType), label: `Type: ${LABELS.assetType[assetType as keyof typeof LABELS.assetType] ?? ""}`, clear: () => setAssetType(null) }], () => undefined)}
    >
      {message && <div className="mb-3"><Notice tone="success">{message}</Notice></div>}
      {can?.finance && <PendingReclassifications />}
      <EnterpriseDataGrid<Category>
        aria-label="Asset categories" columns={columns} data={rows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered || view !== "active" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading categories" rows={6} />}
        errorContent={<ErrorState title="Could not load categories" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No asset categories yet" description="Start from the common categories — computers, furniture, vehicles and more — or set up your own."
          action={can?.create ? { label: "Add starter categories", onPress: () => setStarters(true) } : undefined} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view, search or type." />}
        onRowClick={(row) => router.push(`${CATEGORIES_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-start justify-between gap-2"><span className="min-w-0 truncate font-medium">{row.name}</span>{row.active ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="neutral">Inactive</StatusBadge>}</span>
            <span className="text-xs text-text-muted">{`${row.code} · ${row.assetTypeLabel} · ${row.counts?.total ?? 0} asset(s)`}</span>
          </div>
        )}
      />
      {starters && <StarterTemplatesDialog onClose={() => setStarters(false)} onDone={async (text) => { setStarters(false); setMessage(text); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); }} />}
    </EnterpriseListPage>
  );
}

function StarterTemplatesDialog({ onClose, onDone }: { onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "category-templates"), queryFn: getTemplates });
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const result = await addStarters(picked);
      await onDone(`${result.added.length} categor${result.added.length === 1 ? "y" : "ies"} added${result.skipped.length ? `; ${result.skipped.length} already existed` : ""}. Review each one's rules before registering assets.`);
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title="Add starter categories" size="lg"
      description="Common categories with sensible tracking rules. Pick the ones your Company uses; you can change every rule afterwards. Finance sets the financial policy separately.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        {q.isLoading ? <LoadingState label="Loading templates" rows={4} /> : (
          <ul className="flex flex-col gap-2">
            {(q.data ?? []).map((t) => (
              <li key={t.key} className="flex items-start gap-2">
                <Checkbox isDisabled={Boolean(t.existing)} isSelected={Boolean(t.existing) || picked.includes(t.key)} onChange={(on) => setPicked((list) => (on ? [...list, t.key] : list.filter((k) => k !== t.key)))}>
                  <span className="font-medium">{t.name}</span>
                </Checkbox>
                <span className="text-xs text-text-muted">{t.existing ? `Already added (${t.existing})` : `${t.description} · ${t.guidance} · serial ${t.serial.toLowerCase()}`}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2"><Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || picked.length === 0} onPress={save}>{`Add ${picked.length || ""} categor${picked.length === 1 ? "y" : "ies"}`}</Button></div>
      </div>
    </Dialog>
  );
}

// Finance's queue: category corrections of capitalized assets that reach their accounting.
function PendingReclassifications() {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "reclassifications", "pending"), queryFn: () => getReclassifications({ status: "PENDING_FINANCE" }), retry: false });
  const rows = q.data?.rows ?? [];
  if (!rows.length) return null;
  return <div className="mb-3"><ReclassificationsPanel title="Category changes waiting for Finance" rows={rows} canDecide={Boolean(q.data?.can.decide)} showAsset /></div>;
}
export function ReclassificationsPanel({ title, rows, canDecide, showAsset = false }: { title: string; rows: Reclassification[]; canDecide: boolean; showAsset?: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const decide = (r: Reclassification, decision: "APPROVE" | "REJECT"): Ask => ({
    title: decision === "APPROVE" ? `Approve ${r.number}` : `Reject ${r.number}`, confirm: decision === "APPROVE" ? "Approve" : "Reject", tone: decision === "APPROVE" ? "primary" : "danger",
    description: decision === "APPROVE" ? `${r.asset} moves from ${r.from} to ${r.to}. Its posted depreciation and acquisition records stay as they are; record any separate adjustment's reference here.` : "The asset keeps its current category.",
    fields: decision === "APPROVE" ? [{ name: "note", label: "Note", kind: "textarea" }, { name: "financeAdjustmentReference", label: "Finance adjustment reference (if any)", kind: "text" }]
      : [{ name: "note", label: "Why it is rejected", kind: "textarea", required: true }],
    run: async (v) => {
      await decideReclassification({ reclassificationId: r.id, decision, note: v.note || undefined, financeAdjustmentReference: v.financeAdjustmentReference || undefined });
      setMessage({ tone: "success", text: `${r.number} ${decision === "APPROVE" ? "approved and applied" : "rejected"}.` });
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") });
    },
  });
  return (
    <Panel title={title}>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <LinesTable columns={["Change", ...(showAsset ? ["Asset"] : []), "From → to", "Reason", "Status", ""]}>
        {rows.map((r) => <tr key={r.id}>
          <Cell>{r.number}<span className="block text-xs text-text-muted">{`${r.requestedBy ?? ""} · ${formatDateTime(r.requestedAt)}`}</span></Cell>
          {showAsset && <Cell><Link className="text-brand hover:underline" href={r.href}>{r.asset}</Link></Cell>}
          <Cell>{`${r.from} → ${r.to}`}{r.impact?.finance.differences.length ? <span className="block text-xs text-text-muted">{`Accounting differs: ${r.impact.finance.differences.join(", ").replace(/_/g, " ")}`}</span> : null}</Cell>
          <Cell>{r.reason}{r.decisionNote && <span className="block text-xs text-text-muted">{`${r.decidedBy ?? ""}: ${r.decisionNote}`}</span>}</Cell>
          <Cell><StatusBadge tone={RECLASS_STATUS[r.status]?.tone ?? "neutral"}>{RECLASS_STATUS[r.status]?.label ?? r.status}</StatusBadge></Cell>
          <Cell>{canDecide && r.status === "PENDING_FINANCE" && <span className="flex gap-1"><Button size="compact" variant="secondary" onPress={() => setAsk(decide(r, "APPROVE"))}>Approve</Button>
            <Button size="compact" variant="ghost" onPress={() => setAsk(decide(r, "REJECT"))}>Reject</Button></span>}</Cell>
        </tr>)}
      </LinesTable>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </Panel>
  );
}

// ------------------------------------------------------------------ the operational setup (new and edit)
type Setup = Record<string, string | boolean>;
const blankSetup = (): Setup => ({ name: "", description: "", assetType: "TANGIBLE", capitalizationGuidance: "REVIEW", serialNumberPolicy: "OPTIONAL", assetTagPolicy: "OPTIONAL", locationRequired: true,
  custodianPolicy: "ALLOWED", ownershipApplicability: "ANY", suggestedCondition: "NEW", defaultDepartmentId: "", warrantyApplicable: true, maintenanceApplicable: true, verificationApplicable: true });
const setupOf = (c: Category): Setup => ({ name: c.name, description: c.description ?? "", assetType: c.assetType, capitalizationGuidance: c.capitalizationGuidance, serialNumberPolicy: c.serialNumberPolicy,
  assetTagPolicy: c.assetTagPolicy, locationRequired: c.locationRequired, custodianPolicy: c.custodianPolicy, ownershipApplicability: c.ownershipApplicability, suggestedCondition: c.suggestedCondition ?? "",
  defaultDepartmentId: c.defaultDepartmentId ?? "", warrantyApplicable: c.warrantyApplicable, maintenanceApplicable: c.maintenanceApplicable, verificationApplicable: c.verificationApplicable });
function SetupFields({ value, onChange, departments, inUse = 0 }: { value: Setup; onChange: (next: Setup) => void; departments: Array<{ id: string; name: string }>; inUse?: number }) {
  const set = (k: string) => (v: string | boolean) => onChange({ ...value, [k]: v });
  const pick = (k: string, label: string, labels: Record<string, string>, description?: string, isRequired = true) => (
    <Select label={label} description={description} selectedKey={String(value[k] || "") || null} onSelectionChange={(key) => set(k)(String(key ?? ""))} options={optionsOf(labels)} isRequired={isRequired} />
  );
  return (
    <>
      <FormSection title="What is this category?">
        <TextField label="Category name" value={String(value.name)} onChange={set("name")} isRequired placeholder="e.g. Computers & Laptops" description="The code is generated for you." />
        {pick("assetType", "Asset type", LABELS.assetType, inUse ? `${inUse} asset(s) use this category.` : undefined)}
        {pick("capitalizationGuidance", "Usually tracked as", LABELS.guidance, "A suggestion only — Finance decides each asset's capitalization.")}
        <TextArea label="Description" value={String(value.description)} onChange={set("description")} maxLength={1000} />
      </FormSection>
      <FormSection title="How are these assets identified?">
        {pick("serialNumberPolicy", "Serial number", LABELS.serial, "Required means an asset cannot be registered without one.")}
        {pick("assetTagPolicy", "Asset tag", LABELS.tag)}
      </FormSection>
      <FormSection title="Where are they, and who looks after them?">
        <Checkbox isSelected={Boolean(value.locationRequired)} onChange={set("locationRequired")}>A location is required</Checkbox>
        {pick("custodianPolicy", "Custodian", LABELS.custodian)}
        {pick("ownershipApplicability", "Ownership", LABELS.ownership)}
        <Select label="Default department" description="Suggested when an asset is added; can be changed." selectedKey={String(value.defaultDepartmentId) || null} onSelectionChange={(key) => set("defaultDepartmentId")(String(key ?? ""))}
          options={[{ value: "", label: "None" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} />
        {pick("suggestedCondition", "Suggested condition", LABELS.condition, undefined, false)}
      </FormSection>
      <FormSection title="What applies to them?">
        <Checkbox isSelected={Boolean(value.warrantyApplicable)} onChange={set("warrantyApplicable")}>Warranty is tracked</Checkbox>
        <Checkbox isSelected={Boolean(value.maintenanceApplicable)} onChange={set("maintenanceApplicable")}>Maintenance applies</Checkbox>
        <Checkbox isSelected={Boolean(value.verificationApplicable)} onChange={set("verificationApplicable")}>Included in physical verification</Checkbox>
      </FormSection>
    </>
  );
}
const toInput = (s: Setup) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v === "" ? null : v]));

export function NewCategoryScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000 });
  const submit = useSubmitKey();
  const [setup, setSetup] = useState<Setup>(blankSetup);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const made = await submit.run(() => createCategory(toInput(setup)));
      setDone(true);
      router.replace(`${CATEGORIES_BASE}/${made.categoryId}`);
    } catch (failure) { setError(errorStatus(failure) === 403 ? "You can't create asset categories." : errorMessage(failure)); setBusy(false); }
  };
  if (options.isLoading) return <LoadingState label="Preparing the form" rows={6} />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="New asset category" description="Set how assets of this kind are registered and looked after. Finance adds the depreciation and accounting policy on the category's page." />
      {error && <Notice tone="danger">{error}</Notice>}
      <SetupFields value={setup} onChange={setSetup} departments={options.data?.departments ?? []} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" isDisabled={busy} onPress={() => router.replace(CATEGORIES_BASE)}>Cancel</Button>
        <Button variant="primary" isLoading={busy} isDisabled={busy || done || String(setup.name).trim().length < 2} onPress={save}>Create category</Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ one category
const TABS = [{ id: "overview", label: "Overview" }, { id: "finance", label: "Financial policy" }, { id: "assets", label: "Assets" }, { id: "history", label: "History & versions" }];
export function CategoryDetailScreen({ categoryId }: { categoryId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "category", categoryId), queryFn: () => getCategory(categoryId), retry: false });
  const [tab, setTab] = useState(TABS.some((row) => row.id === params.get("tab")) ? params.get("tab")! : "overview");
  const [dialog, setDialog] = useState<"edit" | "finance" | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const refresh = async (text: string, tone: "success" | "warning" = "success") => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); setMessage({ tone, text }); };
  if (query.isLoading) return <LoadingState label="Loading the category" rows={8} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to asset categories" description="Ask an administrator for access." />;
    return <ErrorState title="Category not found" description={errorMessage(query.error)} action={{ label: "Asset Categories", onPress: () => router.push(CATEGORIES_BASE) }} />;
  }
  const c = query.data;
  const tabs = TABS.filter((row) => (row.id !== "finance" || c.can.seeFinance) && (row.id !== "history" || c.can.history));
  const selectTab = (id: string) => { setTab(id); router.replace(`${pathname}?tab=${id}`, { scroll: false }); };
  const lifecycle = (action: "deactivate" | "reactivate"): Ask => ({
    title: `${action === "deactivate" ? "Deactivate" : "Reactivate"} ${c.name}`, confirm: action === "deactivate" ? "Deactivate" : "Reactivate", tone: action === "deactivate" ? "danger" : "primary",
    description: action === "deactivate" ? `New assets can no longer use it.${c.counts?.total ? ` Its ${c.counts.total} asset(s) keep it, with their history.` : ""}` : "New assets can use it again. Its Finance accounts are re-checked first.",
    fields: [{ name: "reason", label: "Reason", kind: "textarea" }],
    run: async (v) => {
      const result = await categoryAction<{ warning?: string | null }>(c.id, action, { reason: v.reason || undefined, expectedVersion: c.version });
      await refresh(result.warning ?? `${c.name} ${action === "deactivate" ? "deactivated" : "reactivated"}.`, result.warning ? "warning" : "success");
    },
  });
  const more: MoreAction[] = [
    { id: "finance", label: "Set financial policy", show: c.can.finance, run: () => setDialog("finance") },
    { id: "deactivate", label: "Deactivate", show: c.can.deactivate && c.active, run: () => setAsk(lifecycle("deactivate")) },
    { id: "reactivate", label: "Reactivate", show: c.can.deactivate && !c.active, run: () => setAsk(lifecycle("reactivate")) },
    { id: "delete", label: "Delete", show: Boolean(c.can.delete), run: () => setAsk({ title: `Delete ${c.name}`, confirm: "Delete", tone: "danger", description: "No asset has ever used it, so it can be removed. Its code is never reused.", fields: [],
      run: async () => { await categoryAction(c.id, "delete"); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); router.replace(CATEGORIES_BASE); } }) },
  ];
  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{c.name} <span className="text-base font-normal whitespace-nowrap text-text-muted">{c.code}</span></>,
          status: <span className="flex flex-wrap items-center gap-2">{c.active ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="neutral">Inactive</StatusBadge>}
            {c.can.seeFinance && c.capitalizationGuidance !== "TRACK_ONLY" && !c.financePolicyComplete && <StatusBadge tone="warning">Finance policy incomplete</StatusBadge>}</span>,
          fields: [{ label: "Type", value: c.assetTypeLabel }, { label: "Usually tracked as", value: c.capitalizationGuidanceLabel }, { label: "Assets", value: `${c.counts?.total ?? 0} (${c.counts?.active ?? 0} active)` },
            { label: "Policy version", value: `v${c.policyVersion}` }],
          primaryAction: c.can.edit ? <Button variant="primary" onPress={() => setDialog("edit")}>Edit</Button> : undefined,
          secondaryActions: <MoreActions actions={more} />,
        }}
        tabs={message ? <Notice tone={message.tone}>{message.text}</Notice> : undefined}
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => selectTab(String(key))}>
          <TabList aria-label="Category sections">{tabs.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
        </Tabs>
        <div className="mt-4">
          {tab === "overview" && <CategoryOverview category={c} />}
          {tab === "finance" && c.can.seeFinance && <FinancePolicyTab category={c} onEdit={() => setDialog("finance")} />}
          {tab === "assets" && <CategoryAssetsTab categoryId={c.id} />}
          {tab === "history" && c.can.history && <CategoryHistoryTab categoryId={c.id} />}
        </div>
      </RecordDetailsPage>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {dialog === "edit" && <EditCategoryDialog category={c} onClose={() => setDialog(null)} onDone={async (text) => { setDialog(null); await refresh(text); }} />}
      {dialog === "finance" && <FinancePolicyDialog category={c} onClose={() => setDialog(null)} onDone={async (text) => { setDialog(null); await refresh(text); }} />}
    </>
  );
}

function CategoryOverview({ category: c }: { category: CategoryDetail }) {
  return (
    <div className="flex flex-col gap-4">
      {!c.active && <Notice tone="neutral">Inactive: new assets cannot use this category. Assets already in it keep it.</Notice>}
      <FactList title="Basic information" items={[["Code", c.code], ["Name", c.name], ["Asset type", c.assetTypeLabel], ["Usually tracked as", c.capitalizationGuidanceLabel],
        ["Created", formatDateTime(c.createdAt)], ["Started from", c.template ? "A starter template" : "Set up by hand"]]} />
      {c.description && <Panel title="Description"><p className="whitespace-pre-wrap text-sm">{c.description}</p></Panel>}
      <FactList title="Registration rules" description={`Policy version ${c.policyVersion}. Assets keep the version they were registered under.`} items={[["Serial number", c.serialNumberPolicyLabel], ["Asset tag", c.assetTagPolicyLabel],
        ["Location", c.locationRequired ? "Required" : "Optional"], ["Custodian", c.custodianPolicyLabel], ["Ownership", c.ownershipApplicabilityLabel], ["Default department", c.defaultDepartment ?? "None"],
        ["Suggested condition", c.suggestedCondition ? LABELS.condition[c.suggestedCondition as keyof typeof LABELS.condition] ?? c.suggestedCondition : "None"]]} />
      <FactList title="What applies" items={[["Warranty tracking", yes(c.warrantyApplicable)], ["Maintenance", yes(c.maintenanceApplicable)], ["Physical verification", yes(c.verificationApplicable)]]} />
      {c.counts && <FactList title="Assets in this category" items={[["Total", String(c.counts.total)], ["Active", String(c.counts.active)], ["Retired, disposed or lost", String(c.counts.ended)],
        ["Tracked only", String(c.counts.tracked)], ["Capitalized", String(c.counts.capitalized)]]} />}
    </div>
  );
}

const ACCOUNT_FIELDS = [["assetAccountId", "Asset account"], ["accumulatedDepreciationAccountId", "Accumulated depreciation account"], ["depreciationExpenseAccountId", "Depreciation expense account"],
  ["gainLossAccountId", "Gain or loss on disposal account"], ["cwipAccountId", "Capital work in progress account"]] as const;
function FinancePolicyTab({ category: c, onEdit }: { category: CategoryDetail; onEdit: () => void }) {
  const f = c.finance ?? {};
  const account = (id: string | null | undefined) => (id ? c.accountOptions?.find((a) => a.id === id) : null);
  const accountLabel = (id: string | null | undefined) => { const a = account(id); return a ? `${a.code} · ${a.name}` : id ? "Set" : "Not set"; };
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info">{"Finance's references for this category. They are suggestions for Finance's own capitalization and depreciation; nothing here posts an entry, and a change applies to assets registered after it."}</Notice>
      <Panel title="Financial policy" actions={c.can.finance ? <Button size="compact" variant="secondary" onPress={onEdit}>Change policy</Button> : undefined}>
        <FactList items={[["Accounting class", f.accountingClass ?? "—"], ["Depreciation method", f.depreciationMethod ? LABELS.depreciationMethod[f.depreciationMethod as keyof typeof LABELS.depreciationMethod] ?? f.depreciationMethod : "—"],
          ["Useful life", f.usefulLifeMonths ? `${f.usefulLifeMonths} months` : "—"], ["Residual value", f.residualValuePercent ? `${f.residualValuePercent}%` : "—"], ["Declining rate", f.decliningRate ? `${f.decliningRate}%` : "—"],
          ["Convention", f.depreciationConvention ? LABELS.convention[f.depreciationConvention as keyof typeof LABELS.convention] ?? f.depreciationConvention : "—"],
          ["Tax depreciation reference", f.taxDepreciationReference ?? "—"], ["Capitalization threshold", f.capitalizationThreshold ? money(f.capitalizationThreshold) : "—"],
          ...ACCOUNT_FIELDS.map(([k, label]) => [label, accountLabel(f[k])] as [string, ReactNode]), ["Effective from", dateLabel(f.financePolicyEffectiveFrom)]]} />
      </Panel>
    </div>
  );
}
function CategoryAssetsTab({ categoryId }: { categoryId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "category-assets", categoryId), queryFn: () => getCategoryAssets(categoryId) });
  if (q.isLoading) return <LoadingState label="Loading assets" rows={4} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const rows = q.data?.rows ?? [];
  return (
    <Panel title="Assets" description={q.data && q.data.total > rows.length ? `The first ${rows.length} of ${q.data.total}; the register filters by category for the rest.` : undefined}
      actions={<LinkButton size="compact" variant="ghost" href={`${ASSETS_BASE}/register?categoryId=${categoryId}`}>Open in the register</LinkButton>}>
      <LinesTable columns={["Asset", "Status", "Location", "Custodian", "Tracking"]} empty={rows.length ? undefined : "No assets use this category yet."}>
        {rows.map((a) => <tr key={a.id}><Cell><Link className="text-brand hover:underline" href={a.href}>{a.code}</Link><span className="block text-xs text-text-muted">{a.name}</span></Cell>
          <Cell><StatusBadge tone={LIFECYCLE_TONE[a.lifecycle]}>{a.lifecycleLabel}</StatusBadge></Cell><Cell>{a.location ?? "—"}</Cell><Cell>{a.custodian ?? "—"}</Cell><Cell>{a.capitalizationLabel}</Cell></tr>)}
      </LinesTable>
    </Panel>
  );
}
const EVENT_LABEL: Record<string, string> = { CREATED: "Created", UPDATED: "Setup changed", FINANCE_POLICY_CHANGED: "Financial policy changed", DEACTIVATED: "Deactivated", REACTIVATED: "Reactivated", DELETED: "Deleted" };
function CategoryHistoryTab({ categoryId }: { categoryId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "category-history", categoryId), queryFn: () => getHistory(categoryId) });
  if (q.isLoading) return <LoadingState label="Loading history" rows={4} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const nice = (k: string) => k.replace(/_id$/, "").replace(/_/g, " ");
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Policy versions" description="Each change to the rules or the financial policy makes a version. An asset records the version it was registered under.">
        <LinesTable columns={["Version", "Effective from", "Reason", "By"]} empty={q.data?.versions.length ? undefined : "No versions."}>
          {(q.data?.versions ?? []).map((v) => <tr key={v.version}><Cell>{`v${v.version}`}</Cell><Cell>{dateLabel(v.effectiveFrom)}</Cell><Cell>{v.reason ?? "—"}</Cell><Cell>{`${v.by ?? ""} · ${formatDateTime(v.at)}`}</Cell></tr>)}
        </LinesTable>
      </Panel>
      <HistoryList title="Change history" entries={(q.data?.events ?? []).map((e) => ({
        summary: `${EVENT_LABEL[e.action] ?? e.action}${e.version ? ` (v${e.version})` : ""}${e.reason ? `: ${e.reason}` : ""}`, at: e.at, actor: e.by,
        detail: e.action === "UPDATED" || e.action === "FINANCE_POLICY_CHANGED" ? <ul className="text-xs text-text-muted">{Object.entries(e.changes ?? {}).map(([k, v]) => {
          const change = v as { from?: unknown; to?: unknown };
          return <li key={k}>{`${nice(k)}: ${show(change?.from)} → ${show(change?.to)}`}</li>;
        })}</ul> : undefined,
      }))} />
    </div>
  );
}

function EditCategoryDialog({ category: c, onClose, onDone }: { category: CategoryDetail; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000 });
  const original = setupOf(c);
  const [setup, setSetup] = useState<Setup>(original);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = Object.keys(setup).filter((k) => setup[k] !== original[k]);
  const rulesChanged = changed.some((k) => !["name", "description"].includes(k));
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const input = Object.fromEntries(changed.map((k) => [k, setup[k] === "" ? null : setup[k]]));
      const result = await updateCategory(c.id, { ...input, reason: reason || undefined, expectedVersion: c.version });
      await onDone(result.policyVersion > c.policyVersion ? `Saved as policy version ${result.policyVersion}. Assets already registered keep version ${c.policyVersion}.` : "Saved.");
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Edit ${c.name}`} size="lg"
      description="Changing a rule makes a new policy version; assets already registered keep theirs and are not re-checked.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <SetupFields value={setup} onChange={setSetup} departments={options.data?.departments ?? []} inUse={c.counts?.total ?? 0} />
        {rulesChanged && <TextArea label="Why the rules change" value={reason} onChange={setReason} maxLength={500} />}
        <div className="flex justify-end gap-2"><Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !changed.length || String(setup.name).trim().length < 2} onPress={save}>Save</Button></div>
      </div>
    </Dialog>
  );
}

function FinancePolicyDialog({ category: c, onClose, onDone }: { category: CategoryDetail; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const original: Record<string, string> = Object.fromEntries(Object.entries(c.finance ?? {}).map(([k, v]) => [k, v ?? ""]));
  const [form, setForm] = useState<Record<string, string>>(original);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const changed = Object.keys(form).filter((k) => (form[k] ?? "") !== (original[k] ?? ""));
  const accounts = [{ value: "", label: "Not set" }, ...(c.accountOptions ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))];
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const input = Object.fromEntries(changed.filter((k) => !(k === "usefulLifeMonths" && !form[k])).map((k) => [k, form[k] === "" ? null : form[k]]));
      const result = await categoryAction<{ policyVersion: number }>(c.id, "financial-policy", { ...input, reason, expectedVersion: c.version });
      await onDone(`Financial policy saved as version ${result.policyVersion}. Assets already registered keep theirs.`);
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  const field = (k: string, label: string, extra: { inputMode?: "decimal" | "numeric"; type?: "date"; description?: string } = {}) => (
    <TextField key={k} label={label} value={form[k] ?? ""} onChange={set(k)} inputMode={extra.inputMode} type={extra.type} description={extra.description} />
  );
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Financial policy — ${c.name}`} size="lg"
      description="Finance's references for assets of this category. Saving makes a new policy version; nothing is posted and assets already registered keep theirs.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("accountingClass", "Accounting class")}
          <Select label="Depreciation method" selectedKey={form.depreciationMethod || null} onSelectionChange={(k) => set("depreciationMethod")(String(k ?? ""))} options={optionsOf(LABELS.depreciationMethod)} />
          {field("usefulLifeMonths", "Useful life (months)", { inputMode: "numeric" })}
          {field("residualValuePercent", "Residual value (%)", { inputMode: "decimal" })}
          {field("decliningRate", "Declining rate (%)", { inputMode: "decimal" })}
          <Select label="Convention" selectedKey={form.depreciationConvention || null} onSelectionChange={(k) => set("depreciationConvention")(String(k ?? ""))} options={optionsOf(LABELS.convention)} />
          {field("taxDepreciationReference", "Tax depreciation reference", { description: "e.g. the block or rate under the tax rules" })}
          {field("capitalizationThreshold", "Capitalization threshold", { inputMode: "decimal", description: "Below this, Finance normally tracks the asset only." })}
          {ACCOUNT_FIELDS.map(([k, label]) => <Select key={k} label={label} selectedKey={form[k] || ""} onSelectionChange={(v) => set(k)(String(v ?? ""))} options={accounts} />)}
          {field("financePolicyEffectiveFrom", "Effective from", { type: "date" })}
        </div>
        <TextArea label="Reason for the change" value={reason} onChange={setReason} isRequired maxLength={500} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !changed.length || reason.trim().length < 3} onPress={save}>Save policy</Button></div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ reports
const REPORTS = [{ id: "by-category", label: "Assets by category" }, { id: "capitalized-vs-tracked", label: "Capitalized vs tracked" }, { id: "by-location", label: "By location" },
  { id: "value-by-category", label: "Value by category" }, { id: "missing-finance-policy", label: "Missing Finance policy" }, { id: "inactive-in-use", label: "Inactive, still in use" },
  { id: "reclassified", label: "Reclassified assets" }, { id: "acquisition-by-category", label: "Acquisitions by month" }, { id: "applicability", label: "Rules by category" },
  { id: "missing-required-fields", label: "Missing required details" }];
type Row = Record<string, unknown>;
const cellText = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));
export function CategoryReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const kind = REPORTS.some((r) => r.id === params.get("report")) ? params.get("report")! : "by-category";
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "category-report", kind), queryFn: () => getCategoryReport<Row>(kind), retry: false });
  const rows = q.data ?? [];
  const columns = rows[0] ? Object.keys(rows[0]).filter((k) => !["href", "asset_id", "id"].includes(k)) : [];
  const nice = (k: string) => k.replace(/_/g, " ").replace(/([A-Z])/g, " $1").replace(/^./, (ch) => ch.toUpperCase());
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Category reports" description="The register by category, the rules each category applies, and where Finance's policy or an asset's details are missing."
        primaryAction={<LinkButton variant="secondary" href={CATEGORIES_BASE}>Asset Categories</LinkButton>} />
      <Tabs selectedKey={kind} onSelectionChange={(key) => router.replace(`${CATEGORIES_BASE}/reports?report=${String(key)}`)}>
        <TabList aria-label="Reports">{REPORTS.map((r) => <Tab key={r.id} id={r.id}>{r.label}</Tab>)}</TabList>
      </Tabs>
      {q.isLoading ? <LoadingState label="Preparing the report" rows={6} /> : q.isError ? (errorStatus(q.error) === 403 ? <PermissionState title="This report is restricted" description="Value and Finance policy reports need financial access." />
        : <ErrorState title="Could not load the report" description={errorMessage(q.error)} />) : (
        <Panel title={REPORTS.find((r) => r.id === kind)?.label}>
          <LinesTable columns={columns.map(nice)} empty={rows.length ? undefined : "Nothing to report."}>
            {rows.map((row, i) => <tr key={i}>{columns.map((k, j) => <Cell key={k}>{j === 0 && typeof row.href === "string" ? <Link className="text-brand hover:underline" href={row.href}>{cellText(row[k])}</Link>
              : ["cost", "carrying"].includes(k) ? money(row[k] as string) : k === "at" || k === "requested_at" ? formatDateTime(String(row[k])) : cellText(row[k])}</Cell>)}</tr>)}
          </LinesTable>
        </Panel>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ reclassify one asset (from the asset's page)
export function ReclassifyDialog({ assetId, assetCode, currentCategoryId, onClose, onDone }: { assetId: string; assetCode: string; currentCategoryId: string; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000 });
  const [toCategoryId, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "reclassify-preview", assetId, toCategoryId), enabled: Boolean(toCategoryId), retry: false,
    queryFn: async () => {
      const response = await fetch(`/api/assets/register/${assetId}/reclassify-preview`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ toCategoryId }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.message || "The impact could not be checked.");
      return payload as Impact;
    } });
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/assets/register/${assetId}/reclassify`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ toCategoryId, reason, idempotencyKey: key }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.message || "The category could not be changed.");
      await onDone(payload.status === "PENDING_FINANCE" ? `${payload.number}: Finance reviews this change before it applies.` : `${assetCode} moved to its new category.`);
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  const impact = preview.data;
  const categories = (options.data?.categories ?? []).filter((row) => row.id !== currentCategoryId);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Change the category of ${assetCode}`} size="lg"
      description="A correction, recorded with its reason. The asset's posted depreciation and acquisition records are not changed.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <Select label="New category" selectedKey={toCategoryId || null} onSelectionChange={(k) => setTo(String(k ?? ""))} options={categories.map((row) => ({ value: row.id, label: row.name }))} isRequired />
        {toCategoryId && (preview.isLoading ? <LoadingState label="Checking the impact" rows={2} /> : preview.isError ? <Notice tone="danger">{errorMessage(preview.error)}</Notice> : impact && (
          <Panel title="What changes">
            {impact.operational.length ? <ul className="list-disc pl-5 text-sm">{impact.operational.map((line) => <li key={line}>{line}</li>)}</ul> : <p className="text-sm">The tracking rules stay the same.</p>}
            {impact.missing.length > 0 && <Notice tone="warning">{`The new category needs ${impact.missing.join("; ")}. Complete these first.`}</Notice>}
            <Notice tone={impact.finance.reviewRequired ? "warning" : "neutral"}>{impact.finance.reviewRequired ? `Finance reviews this change before it applies. ${impact.finance.note}` : impact.finance.note}</Notice>
            {impact.documentsToReview > 0 && <p className="text-xs text-text-muted">{`${impact.documentsToReview} document(s) on the asset may be worth reviewing.`}</p>}
          </Panel>
        ))}
        <TextArea label="Why the category is wrong" value={reason} onChange={setReason} isRequired maxLength={1000} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !toCategoryId || reason.trim().length < 3 || !impact} onPress={save}>{impact?.finance.reviewRequired ? "Send to Finance" : "Change category"}</Button></div>
      </div>
    </Dialog>
  );
}
