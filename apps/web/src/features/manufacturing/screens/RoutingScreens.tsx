"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, MetricStrip, NumberField, PageHeader, PermissionState, Select, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { act, MfgApiError, readView, useMfgOptions, type MfgOptions } from "@/features/manufacturing/shared/client";
import { label, quantity, tone } from "@/features/manufacturing/shared/format";
import { MfgAlert, MfgPanel, useCan } from "@/features/manufacturing/shared/MfgUi";

type Operation = { id: string; sequence: number; name: string; work_center_id: string | null; work_center_code: string | null; work_center_name: string | null; setup_minutes: string; run_minutes_per_unit: string; queue_minutes: string; move_minutes: string; subcontracted: boolean; inspection_required: boolean; instructions: string | null };
type Routing = { id: string; code: string; name: string; version: number; status: string; is_default: boolean; item_code: string | null; item_name: string | null; notes: string | null; operations: Operation[]; versions: Array<{ id: string; version: number; status: string }> };
type Row = { key: string; sequence: number; name: string; workCenterId: string; setupMinutes: number; runMinutesPerUnit: number; queueMinutes: number; moveMinutes: number; subcontracted: string; inspectionRequired: string };

const errorText = (error: unknown) => (error instanceof MfgApiError ? error.message : "That could not be completed.");
let counter = 0;
const blank = (sequence: number, patch: Partial<Row> = {}): Row => ({ key: `o${++counter}`, sequence, name: "", workCenterId: "", setupMinutes: 0, runMinutesPerUnit: 0, queueMinutes: 0, moveMinutes: 0, subcontracted: "false", inspectionRequired: "false", ...patch });
const payload = (rows: Row[]) => rows.filter((r) => r.name.trim()).map((r) => ({ sequence: r.sequence, name: r.name.trim(), workCenterId: r.workCenterId || undefined, setupMinutes: r.setupMinutes, runMinutesPerUnit: r.runMinutesPerUnit, queueMinutes: r.queueMinutes, moveMinutes: r.moveMinutes, subcontracted: r.subcontracted === "true", inspectionRequired: r.inspectionRequired === "true" }));

function OperationEditor({ rows, setRows, options }: { rows: Row[]; setRows: (rows: Row[]) => void; options: MfgOptions | undefined }) {
  const update = (key: string, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const centers = (options?.workCenters ?? []).map((w) => ({ value: w.id, label: `${w.name} (${w.code})` }));
  const num = (row: Row, field: keyof Row, aria: string, step = 1) => <NumberField aria-label={aria} value={Number(row[field])} minValue={0} step={step} onChange={(n) => update(row.key, { [field]: Number.isNaN(n) ? 0 : n } as Partial<Row>)} />;
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <div key={row.key} className="grid grid-cols-12 items-end gap-2 border-b border-border/60 pb-3" role="group" aria-label={`Operation ${index + 1}`}>
          <div className="col-span-1">{num(row, "sequence", `Operation ${index + 1} sequence`)}</div>
          <div className="col-span-3"><TextField aria-label={`Operation ${index + 1} name`} value={row.name} onChange={(name) => update(row.key, { name })} placeholder="Operation name" /></div>
          <div className="col-span-3"><Select aria-label={`Operation ${index + 1} work center`} options={centers} selectedKey={row.workCenterId || null} onSelectionChange={(k) => update(row.key, { workCenterId: String(k ?? "") })} placeholder="Select work center" /></div>
          <div className="col-span-1">{num(row, "setupMinutes", `Operation ${index + 1} setup minutes`)}</div>
          <div className="col-span-1">{num(row, "runMinutesPerUnit", `Operation ${index + 1} run minutes per unit`, 0.1)}</div>
          <div className="col-span-1">{num(row, "queueMinutes", `Operation ${index + 1} queue minutes`)}</div>
          <div className="col-span-1">{num(row, "moveMinutes", `Operation ${index + 1} move minutes`)}</div>
          <div className="col-span-1"><Button variant="ghost" size="compact" isDisabled={rows.length === 1} onPress={() => setRows(rows.filter((r) => r.key !== row.key))}>Remove</Button></div>
          <div className="col-span-4">
            <Select aria-label={`Operation ${index + 1} subcontracted`} options={[{ value: "false", label: "Done in-house" }, { value: "true", label: "Subcontracted" }]} selectedKey={row.subcontracted} onSelectionChange={(k) => update(row.key, { subcontracted: String(k ?? "false") })} />
          </div>
          <div className="col-span-4">
            <Select aria-label={`Operation ${index + 1} inspection`} options={[{ value: "false", label: "No inspection" }, { value: "true", label: "Inspection required" }]} selectedKey={row.inspectionRequired} onSelectionChange={(k) => update(row.key, { inspectionRequired: String(k ?? "false") })} />
          </div>
        </div>
      ))}
      <div className="text-xs text-text-muted">Columns: sequence · name · work center · setup · run per unit · queue · move (minutes)</div>
      <div><Button variant="secondary" onPress={() => setRows([...rows, blank((rows.length + 1) * 10)])}>Add operation</Button></div>
    </div>
  );
}

export function RoutingCreateScreen() {
  const router = useRouter();
  const options = useMfgOptions();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [itemId, setItemId] = useState("");
  const [rows, setRows] = useState<Row[]>([blank(10)]);
  const save = useMutation({
    mutationFn: () => act<{ record: { id: string } }>("routing-create", { code, name, itemId: itemId || undefined, operations: payload(rows) }),
    onSuccess: (r) => router.push(`/manufacturing/routing/${r.record.id}`),
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="New routing" description="The operations, in order, that turn components into the product. It starts as a draft." />
      {save.error && <MfgAlert>{errorText(save.error)}</MfgAlert>}
      <MfgPanel title="Header">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField label="Routing code" isRequired value={code} onChange={setCode} />
          <TextField label="Name" isRequired value={name} onChange={setName} />
          <Select label="Product (optional)" options={(options.data?.items ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.code})` }))} selectedKey={itemId || null} onSelectionChange={(k) => setItemId(String(k ?? ""))} placeholder="Select product" />
        </div>
      </MfgPanel>
      <MfgPanel title="Operations"><OperationEditor rows={rows} setRows={setRows} options={options.data} /></MfgPanel>
      <div className="flex gap-2">
        <Button variant="primary" onPress={() => save.mutate()} isLoading={save.isPending} isDisabled={!code.trim() || !name.trim() || !payload(rows).length}>Create routing</Button>
        <Link href="/manufacturing/routings" className="self-center text-sm text-brand hover:underline">Cancel</Link>
      </div>
    </div>
  );
}

export function RoutingDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const can = useCan();
  const options = useMfgOptions();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "routing", id), queryFn: () => readView<{ routing: Routing }>("routing", { id }).then((r) => r.routing) });
  const [editing, setEditing] = useState<Row[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [obsolete, setObsolete] = useState(false);
  const run = useMutation({
    mutationFn: ({ action, body }: { action: string; body: Record<string, unknown>; success: string; go?: boolean }) => act<{ record: { id: string } }>(action, body),
    onSuccess: (r, v) => {
      setNotice(v.success);
      setError(null);
      setEditing(null);
      setObsolete(false);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
      if (v.go) router.push(`/manufacturing/routing/${r.record.id}`);
    },
    onError: (e) => { setError(errorText(e)); setNotice(null); },
  });
  const routing = query.data;
  if (query.isError && query.error instanceof MfgApiError && query.error.status === 403) return <PermissionState title="You don't have access to Manufacturing" description="Ask an administrator to grant manufacturing.view." />;
  if (!routing) return <p className="px-4 py-8 text-sm text-text-secondary">{query.isError ? "This routing could not be loaded." : "Loading…"}</p>;
  const canManage = can("manufacturing.routing.manage");
  const draft = routing.status === "draft";
  const toRows = () => routing.operations.map((o) => blank(o.sequence, { name: o.name, workCenterId: o.work_center_id ?? "", setupMinutes: Number(o.setup_minutes), runMinutesPerUnit: Number(o.run_minutes_per_unit), queueMinutes: Number(o.queue_minutes), moveMinutes: Number(o.move_minutes), subcontracted: String(o.subcontracted), inspectionRequired: String(o.inspection_required) }));
  const setup = routing.operations.reduce((t, o) => t + Number(o.setup_minutes), 0);
  const run1 = routing.operations.reduce((t, o) => t + Number(o.run_minutes_per_unit), 0);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`${routing.code} v${routing.version}`}
        description={`${routing.name}${routing.item_name ? ` · ${routing.item_name} (${routing.item_code})` : ""}${routing.is_default ? " · default routing" : ""}`}
        secondaryActions={<div className="flex items-center gap-2"><StatusBadge tone={tone(routing.status)}>{label(routing.status)}</StatusBadge><Link href="/manufacturing/routings" className="text-sm text-brand hover:underline">Back to routings</Link></div>}
      />
      {notice && <MfgAlert tone="success">{notice}</MfgAlert>}
      {error && <MfgAlert>{error}</MfgAlert>}
      <MetricStrip metrics={[{ label: "Operations", value: String(routing.operations.length) }, { label: "Setup (min)", value: quantity(setup) }, { label: "Run per unit (min)", value: quantity(run1) }, { label: "For 10 units (min)", value: quantity(setup + run1 * 10) }]} />
      <MfgPanel
        title="Operations"
        description={draft ? "This draft can be edited. Activate it to make it the product's routing." : "An active routing cannot be edited; revise it into a new version."}
        actions={
          canManage && (
            <div className="flex flex-wrap gap-2">
              {draft && !editing && <Button variant="secondary" onPress={() => setEditing(toRows())}>Edit operations</Button>}
              {draft && editing && <Button variant="primary" isLoading={run.isPending} isDisabled={!payload(editing).length} onPress={() => run.mutate({ action: "routing-update", body: { id: routing.id, operations: payload(editing) }, success: "Operations saved." })}>Save operations</Button>}
              {draft && editing && <Button variant="ghost" onPress={() => setEditing(null)}>Discard changes</Button>}
              {draft && !editing && <Button variant="primary" onPress={() => run.mutate({ action: "routing-activate", body: { id: routing.id }, success: "Routing activated." })}>Activate</Button>}
              {["active", "inactive"].includes(routing.status) && <Button variant="secondary" onPress={() => run.mutate({ action: "routing-revise", body: { id: routing.id }, success: "Revision created as a draft.", go: true })}>Revise</Button>}
              {["active", "inactive"].includes(routing.status) && <Button variant="ghost" onPress={() => setObsolete(true)}>Mark obsolete</Button>}
            </div>
          )
        }
      >
        {editing ? (
          <OperationEditor rows={editing} setRows={setEditing} options={options.data} />
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full text-left text-sm" aria-label="Operations">
              <TableHead>
                <TableRow className="border-b border-border text-xs uppercase text-text-muted">
                  <TableHeaderCell className="px-2 py-2">Seq</TableHeaderCell><TableHeaderCell className="px-2 py-2">Operation</TableHeaderCell><TableHeaderCell className="px-2 py-2">Work center</TableHeaderCell><TableHeaderCell className="px-2 py-2">Setup</TableHeaderCell><TableHeaderCell className="px-2 py-2">Run / unit</TableHeaderCell><TableHeaderCell className="px-2 py-2">Queue</TableHeaderCell><TableHeaderCell className="px-2 py-2">Move</TableHeaderCell><TableHeaderCell className="px-2 py-2">Notes</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {routing.operations.map((o) => (
                  <TableRow key={o.id} className="border-b border-border/60">
                    <TableCell className="px-2 py-2">{o.sequence}</TableCell>
                    <TableCell className="px-2 py-2 font-medium text-text">{o.name}</TableCell>
                    <TableCell className="px-2 py-2">{o.subcontracted ? "Subcontracted" : o.work_center_name ? `${o.work_center_name} (${o.work_center_code})` : "—"}</TableCell>
                    <TableCell className="px-2 py-2">{quantity(o.setup_minutes)}</TableCell>
                    <TableCell className="px-2 py-2">{quantity(o.run_minutes_per_unit)}</TableCell>
                    <TableCell className="px-2 py-2">{quantity(o.queue_minutes)}</TableCell>
                    <TableCell className="px-2 py-2">{quantity(o.move_minutes)}</TableCell>
                    <TableCell className="px-2 py-2">{o.inspection_required ? "Inspection required" : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </MfgPanel>
      <MfgPanel title="Versions">
        <ul className="text-sm" aria-label="Versions">
          {routing.versions.map((v) => (
            <li key={v.id}><Link className={v.id === routing.id ? "font-medium text-text" : "text-brand hover:underline"} href={`/manufacturing/routing/${v.id}`}>v{v.version}</Link> <StatusBadge tone={tone(v.status)}>{label(v.status)}</StatusBadge></li>
          ))}
        </ul>
      </MfgPanel>
      {obsolete && <ObsoleteDialog error={error} isPending={run.isPending} onClose={() => setObsolete(false)} onConfirm={(reason) => run.mutate({ action: "routing-obsolete", body: { id: routing.id, reason }, success: "Routing marked obsolete." })} />}
    </div>
  );
}

function ObsoleteDialog({ onClose, onConfirm, isPending, error }: { onClose: () => void; onConfirm: (reason: string) => void; isPending: boolean; error: string | null }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Mark obsolete">
      <div className="flex flex-col gap-4">
        {error && <MfgAlert>{error}</MfgAlert>}
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" onPress={() => onConfirm(reason.trim())} isLoading={isPending} isDisabled={!reason.trim()}>Mark obsolete</Button>
        </div>
      </div>
    </Dialog>
  );
}

type Capacity = { from: string; days: number; centers: Array<{ workCenterId: string; code: string; name: string; status: string; utilization: number | null; overloadedDays: number; availableTotal: number; loadTotal: number; days: Array<{ day: string; available: number; load: number; utilization: number | null }> }> };

// Available minutes against planned load, per work center per day (F153). Overloaded days are marked.
export function CapacityScreen() {
  const workspace = useWorkspaceContext();
  const [days, setDays] = useState("14");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "capacity", days), queryFn: () => readView<{ capacity: Capacity }>("capacity", { days }).then((r) => r.capacity) });
  if (query.isError && query.error instanceof MfgApiError && query.error.status === 403) return <PermissionState title="You don't have access to Manufacturing" description="Ask an administrator to grant manufacturing.view." />;
  const capacity = query.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Capacity" description="Available minutes (shifts x machines x efficiency, less closures and maintenance) against the minutes planned on open work orders that start each day." />
      <div className="max-w-[220px]">
        <Select aria-label="Horizon" options={[{ value: "7", label: "Next 7 days" }, { value: "14", label: "Next 14 days" }, { value: "30", label: "Next 30 days" }]} selectedKey={days} onSelectionChange={(k) => setDays(String(k ?? "14"))} />
      </div>
      {!capacity ? <p className="text-sm text-text-muted">Loading…</p> : capacity.centers.length === 0 ? <MfgAlert tone="info">No active work centers. Add one under Work centers.</MfgAlert> : (
        <div className="overflow-x-auto">
          <Table className="w-full text-left text-sm" aria-label="Capacity by work center">
            <TableHead>
              <TableRow className="border-b border-border text-xs uppercase text-text-muted">
                <TableHeaderCell className="px-2 py-2">Work center</TableHeaderCell><TableHeaderCell className="px-2 py-2">Load</TableHeaderCell><TableHeaderCell className="px-2 py-2">Overloaded days</TableHeaderCell>
                {capacity.centers[0].days.map((d) => <TableHeaderCell key={d.day} className="px-1 py-2 text-center">{d.day.slice(5)}</TableHeaderCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {capacity.centers.map((c) => (
                <TableRow key={c.workCenterId} className="border-b border-border/60">
                  <TableCell className="px-2 py-2 font-medium text-text">{c.name} ({c.code}){c.status === "maintenance" ? " · maintenance" : ""}</TableCell>
                  <TableCell className="px-2 py-2">{c.utilization === null ? "—" : `${c.utilization}%`}</TableCell>
                  <TableCell className={c.overloadedDays ? "px-2 py-2 font-medium text-danger" : "px-2 py-2"}>{c.overloadedDays}</TableCell>
                  {c.days.map((d) => (
                    <TableCell key={d.day} className={d.load > d.available ? "px-1 py-2 text-center text-danger" : "px-1 py-2 text-center"} title={`${d.load} of ${d.available} minutes`}>{d.available === 0 && d.load === 0 ? "–" : `${d.load}/${d.available}`}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
