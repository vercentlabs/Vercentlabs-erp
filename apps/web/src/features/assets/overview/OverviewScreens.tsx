"use client";

// Assets — the module's front door. The dashboard shows what needs attention in every workflow the person may see, the quick actions their role
// allows, a search by any identifier (it only opens the asset — finding never changes its location, custody or status), and recent activity.
// The Exceptions & Reconciliation center gathers every Assets queue and links each item to the workflow that resolves it.
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, PermissionState, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { useDebouncedValue } from "@/shared/ui/list";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus } from "../register/register-api";
import { ScanBox } from "../register/RegisterListScreens";
import { getControlCenter, getDashboard, searchAssets } from "./overview-api";

const toneClass = { neutral: "", warning: "text-warning", danger: "text-danger" } as const;

function AssetSearch() {
  const workspace = useWorkspaceContext();
  const [q, setQ] = useState("");
  const term = useDebouncedValue(q);
  const hits = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "search", term), queryFn: () => searchAssets(term), enabled: term.trim().length >= 2, retry: false });
  return (
    <Panel title="Find an asset">
      <TextField label="Asset code, name, tag, serial, legacy code, invoice or transfer number" value={q} onChange={setQ} />
      {term.trim().length >= 2 && (hits.isLoading ? <LoadingState label="Searching" rows={2} /> : hits.isError ? <Notice tone="danger">{errorMessage(hits.error)}</Notice> : (
        <LinesTable columns={["Asset", "Status", "Serial / tag", "Matched by"]} empty={(hits.data ?? []).length ? undefined : "No asset found."}>
          {(hits.data ?? []).map((h) => <tr key={h.id}><Cell><Link className="text-brand hover:underline" href={h.href}>{h.asset}</Link></Cell><Cell>{h.lifecycle.toLowerCase().replace(/_/g, " ")}</Cell>
            <Cell>{[h.serial, h.tag].filter(Boolean).join(" · ") || "—"}</Cell><Cell>{h.matched}</Cell></tr>)}
        </LinesTable>
      ))}
    </Panel>
  );
}

export function AssetsDashboardScreen() {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "dashboard"), queryFn: getDashboard, retry: false });
  if (q.isLoading) return <LoadingState label="Loading assets" rows={6} />;
  if (q.isError || !q.data) return errorStatus(q.error) === 403 ? <PermissionState title="You don't have access to assets" description="Ask an administrator for access." /> : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data;
  const c = d.register.counts;
  const status = (key: string) => d.register.byStatus.find((s) => s.status === key)?.count ?? 0;
  const tiles: Array<[string, number, string]> = [["Registered assets", c.total ?? 0, "/assets/register"], ["Active", status("ACTIVE"), "/assets/register?view=active"], ["Available", c.available ?? 0, "/assets/register?view=available"],
    ["Assigned", c.inUse ?? 0, "/assets/register?view=active&availability=ASSIGNED"], ["In transit", c.inTransfer ?? 0, "/assets/transfers"], ["Under maintenance", c.maintenance ?? 0, "/assets/register?view=maintenance"],
    ["Retired", status("RETIRED"), "/assets/register?lifecycle=RETIRED"], ["Lost", status("LOST"), "/assets/register?lifecycle=LOST"], ["Disposed", status("DISPOSED"), "/assets/register?lifecycle=DISPOSED"]];
  const groups = [...new Set(d.queues.map((x) => x.group))];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Assets" description="Register → acquire → assign → move → maintain → depreciate → dispose. What needs attention, in every workflow you can see." />
      <ScanBox />
      {d.actions.length > 0 && <div className="flex flex-wrap gap-2">{d.actions.map((x) => <Link key={x.href + x.label} className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-brand" href={x.href}>{x.label}</Link>)}</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([label, value, href]) => <Link key={label} href={href} className="rounded-md border border-border bg-surface p-3 hover:border-brand"><span className="block text-xs text-text-muted">{label}</span><span className="text-xl font-semibold">{value}</span></Link>)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Needs attention">
          {groups.length === 0 ? <p className="text-sm text-text-muted">Nothing waiting in the workflows you can see.</p> : groups.map((g) => (
            <div key={g} className="mb-3">
              <span className="text-xs font-medium uppercase text-text-muted">{g}</span>
              <ul className="mt-1 flex flex-col gap-1 text-sm">{d.queues.filter((x) => x.group === g).map((x) => <li key={x.label} className="flex justify-between gap-2"><Link className="text-brand hover:underline" href={x.href}>{x.label}</Link>
                <span className={x.value > 0 ? toneClass[x.tone] : "text-text-muted"}>{x.value}</span></li>)}</ul>
            </div>))}
          {d.team && <Link className="text-sm text-brand hover:underline" href="/assets/exceptions">Exceptions &amp; reconciliation</Link>}
        </Panel>
        <AssetSearch />
      </div>
      <Panel title="Recent asset activity">
        <LinesTable columns={["When", "Asset", "What happened"]} empty={d.recent.length ? undefined : "Nothing yet."}>
          {d.recent.map((r, i) => <tr key={i}><Cell>{formatDateTime(r.at)}</Cell><Cell><Link className="text-brand hover:underline" href={r.href}>{r.asset}</Link></Cell><Cell>{r.what}</Cell></tr>)}
        </LinesTable>
      </Panel>
    </div>
  );
}

export function AssetsControlCenterScreen() {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "control-center"), queryFn: getControlCenter, retry: false });
  if (q.isLoading) return <LoadingState label="Loading exceptions" rows={6} />;
  if (q.isError || !q.data) return errorStatus(q.error) === 403 ? <PermissionState title="You don't have access to assets" description="Ask an administrator for access." /> : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Exceptions & Reconciliation" description="Every Assets queue that needs a decision, from acquisition to disposal. Each item opens the workflow that resolves it; nothing is fixed from here." />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {d.areas.map((a) => <a key={a.area} href={`#${a.area.replace(/\W+/g, "-")}`} className="rounded-md border border-border bg-surface p-3 hover:border-brand"><span className="block text-xs text-text-muted">{a.area}</span>
          <span className={`text-xl font-semibold ${a.count ? "text-warning" : ""}`}>{a.count}</span></a>)}
      </div>
      {d.total === 0 && <Notice tone="success">Nothing to reconcile in the areas you can see.</Notice>}
      {d.areas.filter((a) => a.count > 0).map((a) => (
        <div key={a.area} id={a.area.replace(/\W+/g, "-")}>
          <Panel title={`${a.area} (${a.count})`}>
            <LinesTable columns={["Exception", "About", "Detail"]}>
              {a.items.map((x, i) => <tr key={i}><Cell><Link className="text-brand hover:underline" href={x.href}>{x.label}</Link></Cell><Cell>{x.subject ?? "—"}</Cell><Cell>{x.detail ?? ""}</Cell></tr>)}
            </LinesTable>
          </Panel>
        </div>))}
    </div>
  );
}
