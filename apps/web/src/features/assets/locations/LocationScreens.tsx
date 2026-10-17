"use client";

// Assets — Asset Locations: the Company's one location master. The directory shows each location's full path, type, manager and asset
// counts (here, and including its sub-locations), as a list or as the hierarchy. A new location gets its code automatically and sits
// inside a site if chosen. A location's page shows its assets, its child locations and its history; it is renamed with history, moved in
// the hierarchy after an impact preview, and closed only once nothing in use is registered there. The discrepancy queue lists assets
// seen somewhere other than their registered location, for a transfer, a correction or dismissal.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button, Checkbox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PageHeader, PermissionState, RecordDetailsPage, SearchField, Select, StatusBadge, Tab, TabList, Tabs,
  TextArea, TextField,
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
import { LIFECYCLE_TONE, REGISTER_BASE, errorMessage, errorStatus, getOptions, listAssets } from "../register/register-api";
import {
  KINDS, LOCATIONS_BASE, createLocation, getChoices, getDiscrepancies, getLocation, getLocationChanges, listLocations, locationAction, locationsExportHref, resolveDiscrepancy, updateLocation,
  type DeactivationPreview, type Discrepancy, type Location, type LocationDetail,
} from "./locations-api";

const kindOptions = Object.entries(KINDS).map(([value, label]) => ({ value, label }));

// ------------------------------------------------------------------ directory
const VIEWS = [{ id: "active", label: "Active" }, { id: "inactive", label: "Inactive" }, { id: "all", label: "All locations" }];
export function LocationDirectoryScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(VIEWS.some((v) => v.id === params.get("view")) ? params.get("view")! : "active");
  const [layout, setLayout] = useState<"list" | "tree">(params.get("layout") === "tree" ? "tree" : "list");
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search);
  const [filters, setFilters] = useState<{ kind?: string; siteId?: string; hasAssets?: string; missingManager?: string; external?: string }>({});
  const query = { status: view, search: term || undefined, ...filters };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "locations", JSON.stringify(query)), queryFn: () => listLocations(query), retry: false });
  const sites = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "locations", "sites"), queryFn: () => listLocations({ status: "all" }).then((r) => r.rows.filter((x) => !x.parentId)), staleTime: 60_000 });
  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to asset locations" description="Ask an administrator for access." />;
  const rows = list.data?.rows ?? [];
  const can = list.data?.can;
  const set = (k: keyof typeof filters) => (v: string | null) => setFilters((f) => ({ ...f, [k]: v ?? undefined }));
  const columns: ColumnDef<Location>[] = [
    { id: "name", header: "Location", cell: ({ row }) => <span className="flex flex-col" style={{ paddingLeft: layout === "tree" ? row.original.depth * 16 : 0 }}>
      <Link className="font-medium text-brand hover:underline" href={row.original.href}>{layout === "tree" ? row.original.name : row.original.path}</Link><span className="text-xs text-text-muted">{row.original.code}{row.original.floorRoom ? ` · ${row.original.floorRoom}` : ""}</span></span> },
    { id: "kind", header: "Type", cell: ({ row }) => <span>{row.original.kindLabel}{row.original.externalParty ? <span className="block text-xs text-text-muted">{row.original.externalParty}</span> : null}</span> },
    { id: "direct", header: "Assets here", cell: ({ row }) => row.original.directAssets },
    { id: "subtree", header: "Incl. sub-locations", cell: ({ row }) => row.original.subtreeAssets },
    { id: "manager", header: "Manager", cell: ({ row }) => row.original.manager ?? <span className="text-xs text-text-muted">Not set</span> },
    { id: "status", header: "Status", cell: ({ row }) => row.original.active ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="neutral">Inactive</StatusBadge> },
  ];
  const chips = [
    { id: "kind", active: Boolean(filters.kind), label: `Type: ${KINDS[filters.kind ?? ""] ?? ""}`, clear: () => set("kind")(null) },
    { id: "siteId", active: Boolean(filters.siteId), label: `Site: ${sites.data?.find((s) => s.id === filters.siteId)?.name ?? ""}`, clear: () => set("siteId")(null) },
    { id: "hasAssets", active: Boolean(filters.hasAssets), label: "Has assets", clear: () => set("hasAssets")(null) },
    { id: "missingManager", active: Boolean(filters.missingManager), label: "No manager", clear: () => set("missingManager")(null) },
    { id: "external", active: Boolean(filters.external), label: "External sites", clear: () => set("external")(null) },
  ];
  return (
    <EnterpriseListPage
      header={{ title: "Asset Locations", description: "Where assets are registered: offices, rooms, storage points and external sites. Moving an asset between them is an Asset Transfer.",
        primaryAction: can?.create ? <LinkButton variant="primary" href={`${LOCATIONS_BASE}/new`}>New location</LinkButton> : undefined,
        secondaryActions: <span className="flex flex-wrap gap-2">
          <Button variant="secondary" onPress={() => setLayout(layout === "list" ? "tree" : "list")}>{layout === "list" ? "Show hierarchy" : "Show list"}</Button>
          <LinkButton variant="secondary" href={`${LOCATIONS_BASE}/discrepancies`}>Discrepancies</LinkButton>
          {can?.export && <LinkButton variant="ghost" href={locationsExportHref}>Export</LinkButton>}
        </span> }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); router.replace(`${pathname}?view=${id}`, { scroll: false }); } }}
      actionBar={{ start: (
        <>
          <SearchField aria-label="Search locations" placeholder="Name, code, path or room" className="w-full sm:w-72" value={search} onChange={setSearch} />
          <Select aria-label="Type" label="Type" size="compact" placeholder="Any type" selectedKey={filters.kind ?? null} onSelectionChange={(k) => set("kind")(k ? String(k) : null)} options={kindOptions} />
          <Select aria-label="Site" label="Site" size="compact" placeholder="Any site" selectedKey={filters.siteId ?? null} onSelectionChange={(k) => set("siteId")(k ? String(k) : null)} options={(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          <Select aria-label="Show" label="Show" size="compact" placeholder="Everything" selectedKey={filters.hasAssets ? "hasAssets" : filters.missingManager ? "missingManager" : filters.external ? "external" : null}
            onSelectionChange={(k) => setFilters((f) => ({ kind: f.kind, siteId: f.siteId, ...(k ? { [String(k)]: "true" } : {}) }))}
            options={[{ value: "hasAssets", label: "With assets" }, { value: "missingManager", label: "Without a manager" }, { value: "external", label: "External sites" }]} />
        </>
      ) }}
      filterBar={filterBarOf(chips, () => undefined)}
    >
      <EnterpriseDataGrid<Location>
        aria-label="Asset locations" columns={columns} data={rows} getRowId={(r) => r.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (term || Object.values(filters).some(Boolean) || view !== "active" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading locations" rows={6} />}
        errorContent={<ErrorState title="Could not load locations" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No locations yet" description="Start with your main office; add rooms inside it later if you need them." action={can?.create ? { label: "New location", onPress: () => router.push(`${LOCATIONS_BASE}/new`) } : undefined} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view, search or filter." />}
        onRowClick={(r) => router.push(r.href)}
        renderMobileCard={(r) => <div className="flex flex-col gap-1"><span className="flex justify-between gap-2"><span className="min-w-0 truncate font-medium">{r.path}</span>{r.active ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="neutral">Inactive</StatusBadge>}</span>
          <span className="text-xs text-text-muted">{`${r.code} · ${r.kindLabel} · ${r.subtreeAssets} asset(s)`}</span></div>}
      />
    </EnterpriseListPage>
  );
}

// ------------------------------------------------------------------ new and edit
type Form = { name: string; kind: string; parentId: string; floorRoom: string; address: string; managerUserId: string; externalPartyId: string; description: string; isAssetStore: boolean };
function LocationFields({ form, setForm, parents, users, parties, editing = false }: { form: Form; setForm: (f: Form) => void; parents: Array<{ id: string; name: string }>; users: Array<{ id: string; name: string }>;
  parties: Array<{ id: string; name: string }>; editing?: boolean }) {
  const set = (k: keyof Form) => (v: string | boolean) => setForm({ ...form, [k]: v });
  const parentPath = parents.find((p) => p.id === form.parentId)?.name;
  const external = ["CUSTOMER_SITE", "REPAIR_FACILITY"].includes(form.kind);
  return (
    <>
      <FormSection title="What is this place?" description="A unique location code will be generated automatically.">
        <TextField label="Location name" value={form.name} onChange={set("name")} isRequired placeholder="e.g. IT Equipment Room" />
        <Select label="Type" selectedKey={form.kind || null} onSelectionChange={(k) => set("kind")(String(k ?? ""))} options={kindOptions} isRequired />
        {!editing && <Select label="Inside which site or area?" selectedKey={form.parentId || ""} onSelectionChange={(k) => set("parentId")(String(k ?? ""))}
          options={[{ value: "", label: "Standalone (a top-level site)" }, ...parents.map((p) => ({ value: p.id, label: p.name }))]} description={`Preview: ${parentPath ? `${parentPath} → ` : ""}${form.name || "…"}`} />}
        <TextField label="Floor / room" value={form.floorRoom} onChange={set("floorRoom")} placeholder="e.g. 2nd floor, room 204" />
      </FormSection>
      <FormSection title="Details">
        <TextField label="Address" value={form.address} onChange={set("address")} description="For a site; rooms inherit their site's address." />
        <Select label="Responsible manager" selectedKey={form.managerUserId || ""} onSelectionChange={(k) => set("managerUserId")(String(k ?? ""))} options={[{ value: "", label: "None" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        {external && <Select label={form.kind === "REPAIR_FACILITY" ? "Repair vendor" : "Customer"} selectedKey={form.externalPartyId || ""} onSelectionChange={(k) => set("externalPartyId")(String(k ?? ""))}
          options={[{ value: "", label: "Not linked" }, ...parties.map((p) => ({ value: p.id, label: p.name }))]} description="An external site stays outside the Company's ownership; the asset's owner never changes." />}
        <Checkbox isSelected={form.isAssetStore} onChange={set("isAssetStore")}>{"An asset store — it holds spare assets in its manager's custody"}</Checkbox>
        <TextArea label="Description" value={form.description} onChange={set("description")} maxLength={1000} />
      </FormSection>
    </>
  );
}
const blank = (): Form => ({ name: "", kind: "OFFICE", parentId: "", floorRoom: "", address: "", managerUserId: "", externalPartyId: "", description: "", isAssetStore: false });
const inputOf = (f: Form) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === "" ? null : v]));
function useLocationOptions() {
  const workspace = useWorkspaceContext();
  const choices = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "location-choices"), queryFn: getChoices, staleTime: 30_000 });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000 });
  const parties = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "location-parties"), queryFn: () => fetch("/api/assets/locations/actions/parties").then((r) => r.json()).then((r) => (r.rows ?? []) as Array<{ id: string; name: string }>), staleTime: 60_000 });
  return { parents: choices.data ?? [], users: options.data?.users ?? [], parties: parties.data ?? [], loading: choices.isLoading || options.isLoading };
}
export function NewLocationScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const submit = useSubmitKey();
  const { parents, users, parties, loading } = useLocationOptions();
  const [form, setForm] = useState<Form>(() => ({ ...blank(), parentId: params.get("parentId") ?? "", kind: params.get("parentId") ? "ROOM_OR_AREA" : "OFFICE" }));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { const made = await submit.run(() => createLocation(inputOf(form))); setDone(true); router.replace(`${LOCATIONS_BASE}/${made.locationId}`); }
    catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  if (loading) return <LoadingState label="Preparing the form" rows={5} />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="New asset location" description="One office is enough to start; add floors, rooms and storage points inside it whenever you need them." />
      {error && <Notice tone="danger">{error}</Notice>}
      <LocationFields form={form} setForm={setForm} parents={parents} users={users} parties={parties} />
      <div className="flex justify-end gap-2"><Button variant="ghost" isDisabled={busy} onPress={() => router.replace(LOCATIONS_BASE)}>Cancel</Button>
        <Button variant="primary" isLoading={busy} isDisabled={busy || done || form.name.trim().length < 2} onPress={save}>Create location</Button></div>
    </div>
  );
}

// ------------------------------------------------------------------ one location
const TABS = [{ id: "overview", label: "Overview" }, { id: "assets", label: "Assets" }, { id: "children", label: "Child locations" }, { id: "history", label: "History" }];
export function LocationDetailScreen({ locationId }: { locationId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "location", locationId), queryFn: () => getLocation(locationId), retry: false });
  const { parents, users, parties } = useLocationOptions();
  const [tab, setTab] = useState(TABS.some((t) => t.id === params.get("tab")) ? params.get("tab")! : "overview");
  const [dialog, setDialog] = useState<"edit" | "deactivate" | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const refresh = async (text: string, tone: "success" | "warning" = "success") => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); setMessage({ tone, text }); };
  if (q.isLoading) return <LoadingState label="Loading the location" rows={6} />;
  if (q.isError || !q.data) return errorStatus(q.error) === 403 ? <PermissionState title="You don't have access to asset locations" description="Ask an administrator for access." />
    : <ErrorState title="Location not found" description={errorMessage(q.error)} action={{ label: "Asset Locations", onPress: () => router.push(LOCATIONS_BASE) }} />;
  const l = q.data;
  const move = (): Ask => ({ title: `Move ${l.name}`, confirm: "Move", description: "Changes where it sits in the hierarchy. Its assets keep it as their registered location.",
    fields: [{ name: "parentId", label: "New parent", kind: "select", options: [{ value: "", label: "Top level (a site)" }, ...parents.filter((p) => p.id !== l.id).map((p) => ({ value: p.id, label: p.name }))] },
      { name: "reason", label: "Why", kind: "textarea", required: true }],
    run: async (v) => {
      const preview = await locationAction<{ to: string; assetsAffected: number }>(l.id, "move-preview", { parentId: v.parentId || null });
      const done = await locationAction<{ path: string }>(l.id, "move", { parentId: v.parentId || null, reason: v.reason, expectedVersion: l.version });
      await refresh(`Moved: now ${done.path ?? preview.to} (${preview.assetsAffected} asset(s) inside keep their location).`);
    } });
  const more: MoreAction[] = [
    { id: "child", label: "Add a location inside", show: l.can.create && l.active, run: () => router.push(`${LOCATIONS_BASE}/new?parentId=${l.id}`) },
    { id: "move", label: "Move in the hierarchy", show: l.can.hierarchy, run: () => setAsk(move()) },
    { id: "deactivate", label: "Deactivate", show: l.can.deactivate && l.active, run: () => setDialog("deactivate") },
    { id: "reactivate", label: "Reactivate", show: l.can.deactivate && !l.active, run: () => setAsk({ title: `Reactivate ${l.name}`, confirm: "Reactivate", fields: [{ name: "reason", label: "Why", kind: "textarea" }],
      run: async (v) => { await locationAction(l.id, "reactivate", { reason: v.reason || undefined, expectedVersion: l.version }); await refresh("Reactivated."); } }) },
  ];
  return (
    <>
      <RecordDetailsPage
        header={{ title: <>{l.name} <span className="text-base font-normal text-text-muted">{l.code}</span></>,
          status: l.active ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="neutral">Inactive</StatusBadge>,
          fields: [{ label: "Path", value: l.path }, { label: "Type", value: l.kindLabel }, { label: "Assets", value: `${l.directAssets} here · ${l.subtreeAssets} including sub-locations` }, { label: "Manager", value: l.manager ?? "Not set" }],
          primaryAction: l.can.edit ? <Button variant="primary" onPress={() => setDialog("edit")}>Edit</Button> : undefined, secondaryActions: <MoreActions actions={more} /> }}
        tabs={message ? <Notice tone={message.tone}>{message.text}</Notice> : undefined}>
        <Tabs selectedKey={tab} onSelectionChange={(k) => { setTab(String(k)); router.replace(`${pathname}?tab=${String(k)}`, { scroll: false }); }}>
          <TabList aria-label="Location sections">{TABS.filter((t) => t.id !== "history" || l.can.history || l.can.edit).map((t) => <Tab key={t.id} id={t.id}>{t.label}</Tab>)}</TabList>
        </Tabs>
        <div className="mt-4">
          {tab === "overview" && <div className="flex flex-col gap-4">
            {!l.active && <Notice tone="neutral">Inactive: no asset can be moved here. Assets already registered here keep it in their history.</Notice>}
            {l.parent && !l.parent.active && <Notice tone="warning">Its parent location is inactive.</Notice>}
            <FactList title="Location" items={[["Code", l.code], ["Name", l.name], ["Full path", l.path], ["Type", l.kindLabel], ["Floor / room", l.floorRoom ?? "—"], ["Address", l.address ?? "—"],
              ["Manager", l.manager ?? "Not set"], ["Customer or vendor", l.externalParty ?? (l.external ? "Not linked" : "—")], ["Created", formatDateTime(l.createdAt)]]} />
            {l.description && <Panel title="Description"><p className="whitespace-pre-wrap text-sm">{l.description}</p></Panel>}
          </div>}
          {tab === "assets" && <LocationAssets location={l} />}
          {tab === "children" && <Panel title="Locations inside" actions={l.can.create && l.active ? <LinkButton size="compact" variant="secondary" href={`${LOCATIONS_BASE}/new?parentId=${l.id}`}>Add one</LinkButton> : undefined}>
            <LinesTable columns={["Location", "Type", "Assets", "Status"]} empty={l.childLocations.length ? undefined : "No locations inside this one."}>
              {l.childLocations.map((x) => <tr key={x.id}><Cell><Link className="text-brand hover:underline" href={x.href}>{x.name}</Link><span className="block text-xs text-text-muted">{x.code}</span></Cell><Cell>{x.kindLabel}</Cell>
                <Cell>{`${x.directAssets} · ${x.subtreeAssets} incl. inside`}</Cell><Cell>{x.active ? "Active" : "Inactive"}</Cell></tr>)}
            </LinesTable>
          </Panel>}
          {tab === "history" && <LocationHistory locationId={l.id} />}
        </div>
      </RecordDetailsPage>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
      {dialog === "edit" && <EditLocationDialog location={l} users={users} parties={parties} onClose={() => setDialog(null)} onDone={async (t) => { setDialog(null); await refresh(t); }} />}
      {dialog === "deactivate" && <DeactivateDialog location={l} onClose={() => setDialog(null)} onDone={async (t, tone) => { setDialog(null); await refresh(t, tone); }} />}
    </>
  );
}
function LocationAssets({ location: l }: { location: LocationDetail }) {
  const workspace = useWorkspaceContext();
  const [subtree, setSubtree] = useState(false);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "location-assets", l.id, String(subtree)), queryFn: () => listAssets({ locationId: l.id, locationTree: subtree ? "true" : undefined, pageSize: 200 }) });
  const rows = q.data?.rows ?? [];
  return (
    <Panel title="Assets" description={q.data && q.data.total > rows.length ? `The first ${rows.length} of ${q.data.total}.` : undefined}
      actions={<span className="flex gap-1"><Button size="compact" variant={subtree ? "ghost" : "secondary"} onPress={() => setSubtree(false)}>Here</Button><Button size="compact" variant={subtree ? "secondary" : "ghost"} onPress={() => setSubtree(true)}>Including sub-locations</Button>
        <LinkButton size="compact" variant="ghost" href={`${REGISTER_BASE}?locationId=${l.id}`}>Open in the register</LinkButton></span>}>
      {q.isLoading ? <LoadingState label="Loading assets" rows={3} /> : (
        <LinesTable columns={["Asset", "Status", "Custodian", "Location"]} empty={rows.length ? undefined : "No assets are registered here."}>
          {rows.map((a) => <tr key={a.id}><Cell><Link className="text-brand hover:underline" href={a.href}>{a.code}</Link><span className="block text-xs text-text-muted">{a.name}</span></Cell>
            <Cell><StatusBadge tone={LIFECYCLE_TONE[a.lifecycle]}>{a.lifecycleLabel}</StatusBadge></Cell><Cell>{a.custodian ?? a.department ?? "—"}</Cell><Cell>{a.location ?? "—"}</Cell></tr>)}
        </LinesTable>
      )}
    </Panel>
  );
}
function LocationHistory({ locationId }: { locationId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "location-history", locationId), queryFn: () => getLocationChanges(locationId), retry: false });
  if (q.isLoading) return <LoadingState label="Loading history" rows={3} />;
  if (q.isError || !q.data) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <div className="flex flex-col gap-4">
      <HistoryList title="Changes to this location" entries={q.data.changes.map((x) => ({ summary: `${x.action.charAt(0)}${x.action.slice(1).toLowerCase()}${x.reason ? `: ${x.reason}` : ""}`, at: x.at, actor: x.by,
        detail: x.action === "UPDATED" || x.action === "MOVED" ? <ul className="text-xs text-text-muted">{Object.entries(x.changes).map(([k, v]) => { const c = v as { from?: unknown; to?: unknown };
          return <li key={k}>{typeof v === "object" && v && "from" in (v as object) ? `${k.replace(/_/g, " ")}: ${show(c.from)} → ${show(c.to)}` : `${k}: ${show(v)}`}</li>; })}</ul> : undefined }))} />
      <HistoryList title="Assets arriving and leaving" entries={q.data.movements.map((m) => ({ summary: <>{m.direction === "IN" ? "In" : "Out"}: <Link className="text-brand hover:underline" href={`${REGISTER_BASE}/${m.assetId}`}>{m.asset}</Link>{` (${m.event.toLowerCase()})`}</>, at: m.at, actor: m.by }))} />
    </div>
  );
}
function EditLocationDialog({ location: l, users, parties, onClose, onDone }: { location: LocationDetail; users: Array<{ id: string; name: string }>; parties: Array<{ id: string; name: string }>; onClose: () => void; onDone: (t: string) => Promise<void> }) {
  const original: Form = { name: l.name, kind: l.kind, parentId: l.parentId ?? "", floorRoom: l.floorRoom ?? "", address: l.address ?? "", managerUserId: l.managerUserId ?? "", externalPartyId: l.externalPartyId ?? "", description: l.description ?? "", isAssetStore: l.isAssetStore };
  const [form, setForm] = useState<Form>(original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = (Object.keys(form) as Array<keyof Form>).filter((k) => k !== "parentId" && form[k] !== original[k]);
  const save = async () => {
    setBusy(true); setError(null);
    try { await updateLocation(l.id, { ...Object.fromEntries(changed.map((k) => [k, form[k] === "" ? null : form[k]])), expectedVersion: l.version }); await onDone("Saved. Assets keep this location; its new name shows everywhere."); }
    catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(o) => { if (!o) onClose(); }} title={`Edit ${l.name}`} size="lg" description="Renaming keeps the location's code and every asset's history.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <LocationFields form={form} setForm={setForm} parents={[]} users={users} parties={parties} editing />
        <div className="flex justify-end gap-2"><Button variant="ghost" onPress={onClose}>Cancel</Button><Button variant="primary" isLoading={busy} isDisabled={busy || !changed.length || form.name.trim().length < 2} onPress={save}>Save</Button></div>
      </div>
    </Dialog>
  );
}
function DeactivateDialog({ location: l, onClose, onDone }: { location: LocationDetail; onClose: () => void; onDone: (t: string, tone: "success" | "warning") => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const preview = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "location-deactivation", l.id), queryFn: () => locationAction<DeactivationPreview>(l.id, "deactivation-preview"), retry: false });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = preview.data;
  const save = async () => {
    setBusy(true); setError(null);
    try { const done = await locationAction<{ warnings: string[] }>(l.id, "deactivate", { reason: reason || undefined, expectedVersion: l.version });
      await onDone(done.warnings?.length ? `Deactivated. Note: ${done.warnings.join("; ")}.` : "Deactivated.", done.warnings?.length ? "warning" : "success"); }
    catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(o) => { if (!o) onClose(); }} title={`Deactivate ${l.name}`} description="An inactive location takes no new assets; its history stays.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        {preview.isLoading ? <LoadingState label="Checking what is registered here" rows={2} /> : preview.isError ? <Notice tone="danger">{errorMessage(preview.error)}</Notice> : p && (
          <>
            {p.blocking.length ? <Notice tone="danger">{`It cannot be deactivated yet: ${p.blocking.join("; ")}. Transfer the assets and close the child locations first.`}</Notice> : <Notice tone="success">Nothing in use is registered here.</Notice>}
            {p.warnings.length > 0 && <Notice tone="warning">{p.warnings.join("; ")}.</Notice>}
          </>
        )}
        <TextArea label="Reason" value={reason} onChange={setReason} maxLength={500} />
        <div className="flex justify-end gap-2"><Button variant="ghost" onPress={onClose}>Cancel</Button><Button variant="primary" isLoading={busy} isDisabled={busy || !p?.canDeactivate} onPress={save}>Deactivate</Button></div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ discrepancies
export function LocationDiscrepanciesScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("OPEN");
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "location-discrepancies", status), queryFn: () => getDiscrepancies(status), retry: false });
  const { parents } = useLocationOptions();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (q.isError && errorStatus(q.error) === 403) return <PermissionState title="You can't review location discrepancies" description="Ask an administrator for access." />;
  const resolve = (d: Discrepancy): Ask => ({ title: `Resolve ${d.number}`, confirm: "Resolve", description: `${d.asset}: registered at ${d.expected}, seen at ${d.observed ?? "—"}. A sighting never moves the asset by itself.`,
    fields: [{ name: "resolution", label: "Resolution", kind: "select", required: true, options: [{ value: "TRANSFER", label: "It has moved — request a transfer" }, { value: "CORRECTION", label: "The record was wrong — correct the location" },
      { value: "DISMISS", label: "It is where it is registered — dismiss" }] }, { name: "toLocationId", label: "Correct location (if not the one seen)", kind: "select", options: parents.map((p) => ({ value: p.id, label: p.name })) },
      { name: "note", label: "Explanation", kind: "textarea", required: true }],
    run: async (v) => { await resolveDiscrepancy({ discrepancyId: d.id, resolution: v.resolution, note: v.note, toLocationId: v.toLocationId || undefined });
      setMessage(`${d.number} resolved.`); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") }); } });
  const rows = q.data?.rows ?? [];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Location discrepancies" description="Assets seen somewhere other than their registered location — during verification or reported by the asset team." primaryAction={<LinkButton variant="secondary" href={LOCATIONS_BASE}>Asset Locations</LinkButton>} />
      {message && <Notice tone="success">{message}</Notice>}
      <span className="flex gap-1">{[["OPEN", "To review"], ["all", "All"]].map(([id, label]) => <Button key={id} size="compact" variant={status === id ? "secondary" : "ghost"} onPress={() => setStatus(id)}>{label}</Button>)}</span>
      {q.isLoading ? <LoadingState label="Loading" rows={4} /> : (
        <LinesTable columns={["Discrepancy", "Asset", "Registered at", "Seen at", "Status", ""]} empty={rows.length ? undefined : "No discrepancies to review."}>
          {rows.map((d) => <tr key={d.id}><Cell>{d.number}<span className="block text-xs text-text-muted">{`${d.reportedBy ?? ""} · ${formatDateTime(d.reportedAt)}`}</span></Cell>
            <Cell><Link className="text-brand hover:underline" href={d.href}>{d.asset}</Link></Cell><Cell>{d.expected}</Cell><Cell>{d.observed ?? "—"}<span className="block text-xs text-text-muted">{d.source === "VERIFICATION" ? "Verification" : "Reported"}</span></Cell>
            <Cell>{d.status === "OPEN" ? <StatusBadge tone="warning">{d.statusLabel}</StatusBadge> : <span className="text-sm">{d.statusLabel}{d.resolution ? <span className="block text-xs text-text-muted">{d.resolution}</span> : null}</span>}</Cell>
            <Cell>{d.status === "OPEN" && q.data?.can.review && <Button size="compact" variant="secondary" onPress={() => setAsk(resolve(d))}>Resolve</Button>}</Cell></tr>)}
        </LinesTable>
      )}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
