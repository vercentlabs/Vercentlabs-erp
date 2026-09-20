"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, MetricStrip, NumberField, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { act, MfgApiError, readView, useMfgOptions, type MfgOptions } from "@/features/manufacturing/shared/client";
import { calendarDate, dateTime, label, quantity, tone } from "@/features/manufacturing/shared/format";
import { MfgAlert, MfgPanel, useCan } from "@/features/manufacturing/shared/MfgUi";

type Alternate = { id: string; itemCode: string; itemName: string; ratio: string; priority: number };
type Component = { id: string; line_number: number; item_id: string; item_code: string; item_name: string; quantity: string; scrap_percent: string; issue_method: string; has_sub_assembly: boolean; alternates: Alternate[]; notes: string | null };
type Bom = {
  id: string; code: string; name: string | null; version: number; revision: string | null; status: string; is_default: boolean; is_alternate: boolean; alternate_priority: number; output_quantity: string; effective_from: string | null; effective_to: string | null;
  item_id: string; item_code: string; item_name: string; rejection_reason: string | null; revision_note: string | null; notes: string | null; created_by: string; submitted_by: string | null; approved_at: string | null;
  components: Component[]; versions: Array<{ id: string; version: number; revision: string | null; status: string; created_at: string; revision_note: string | null }>; otherStructures: Array<{ id: string; code: string; version: number; status: string; alternate_priority: number }>;
};
type Line = { key: string; itemId: string; quantity: number; scrapPercent: number; issueMethod: string };
type Explosion = { lines: Array<{ level: number; itemCode: string; itemName: string; requiredQuantity: string; isSubAssembly: boolean; bomCode: string | null }>; purchasedTotals: Array<{ itemCode: string; itemName: string; requiredQuantity: string }> };

const errorText = (error: unknown) => (error instanceof MfgApiError ? error.message : "That could not be completed.");
let counter = 0;
const newLine = (line: Partial<Line> = {}): Line => ({ key: `l${++counter}`, itemId: "", quantity: 1, scrapPercent: 0, issueMethod: "manual", ...line });
const payloadLines = (lines: Line[]) => lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, quantity: l.quantity, scrapPercent: l.scrapPercent, issueMethod: l.issueMethod }));

// The component grid: one row per component, edited in place. Used for a new BOM, a draft, and an
// engineering-change proposal.
function ComponentEditor({ lines, setLines, options, excludeItemId }: { lines: Line[]; setLines: (lines: Line[]) => void; options: MfgOptions | undefined; excludeItemId?: string }) {
  const update = (key: string, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const itemOptions = (options?.items ?? []).filter((i) => i.id !== excludeItemId).map((i) => ({ value: i.id, label: `${i.name} (${i.code})` }));
  return (
    <div className="flex flex-col gap-2">
      {lines.map((line, index) => (
        <div key={line.key} className="grid grid-cols-12 items-end gap-2" role="group" aria-label={`Component ${index + 1}`}>
          <div className="col-span-5">
            <Select aria-label={`Component ${index + 1} item`} options={itemOptions} selectedKey={line.itemId || null} onSelectionChange={(k) => update(line.key, { itemId: String(k ?? "") })} placeholder="Select component" />
          </div>
          <div className="col-span-2">
            <NumberField aria-label={`Component ${index + 1} quantity`} value={line.quantity} minValue={0} step={0.001} onChange={(n) => update(line.key, { quantity: Number.isNaN(n) ? 0 : n })} />
          </div>
          <div className="col-span-2">
            <NumberField aria-label={`Component ${index + 1} scrap percent`} value={line.scrapPercent} minValue={0} step={0.5} onChange={(n) => update(line.key, { scrapPercent: Number.isNaN(n) ? 0 : n })} />
          </div>
          <div className="col-span-2">
            <Select aria-label={`Component ${index + 1} issue method`} options={[{ value: "manual", label: "Manual issue" }, { value: "backflush", label: "Backflush" }]} selectedKey={line.issueMethod} onSelectionChange={(k) => update(line.key, { issueMethod: String(k ?? "manual") })} />
          </div>
          <div className="col-span-1">
            <Button variant="ghost" size="compact" onPress={() => setLines(lines.filter((l) => l.key !== line.key))} isDisabled={lines.length === 1}>Remove</Button>
          </div>
        </div>
      ))}
      <div className="text-xs text-text-muted">Columns: component · quantity per output · scrap % · issue method</div>
      <div>
        <Button variant="secondary" onPress={() => setLines([...lines, newLine()])}>Add component</Button>
      </div>
    </div>
  );
}

// New BOM (/manufacturing/bom/new)
export function BomCreateScreen() {
  const router = useRouter();
  const options = useMfgOptions();
  const [itemId, setItemId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [outputQuantity, setOutputQuantity] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [isAlternate, setIsAlternate] = useState("false");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const save = useMutation({
    mutationFn: () => act<{ record: { id: string } }>("bom-create", { itemId, code, name: name || undefined, outputQuantity, effectiveFrom: from || undefined, effectiveTo: to || undefined, isAlternate: isAlternate === "true", alternatePriority: isAlternate === "true" ? 1 : 0, components: payloadLines(lines) }),
    onSuccess: (result) => router.push(`/manufacturing/bom/${result.record.id}`),
  });
  const invalid = !itemId || !code.trim() || !payloadLines(lines).length;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="New BOM" description="Define what one output of the product is made of. It starts as a draft." />
      {save.error && <MfgAlert>{errorText(save.error)}</MfgAlert>}
      <MfgPanel title="Header">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select label="Product" isRequired options={(options.data?.items ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.code})` }))} selectedKey={itemId || null} onSelectionChange={(k) => setItemId(String(k ?? ""))} placeholder="Select product" />
          <TextField label="BOM code" isRequired value={code} onChange={setCode} />
          <TextField label="Name" value={name} onChange={setName} />
          <NumberField label="Output quantity" value={outputQuantity} minValue={0} step={1} onChange={(n) => setOutputQuantity(Number.isNaN(n) ? 1 : n)} />
          <TextField label="Effective from" type="date" value={from} onChange={setFrom} />
          <TextField label="Effective to" type="date" value={to} onChange={setTo} />
          <Select label="Kind" options={[{ value: "false", label: "Default structure" }, { value: "true", label: "Alternate structure" }]} selectedKey={isAlternate} onSelectionChange={(k) => setIsAlternate(String(k ?? "false"))} />
        </div>
      </MfgPanel>
      <MfgPanel title="Components">
        <ComponentEditor lines={lines} setLines={setLines} options={options.data} excludeItemId={itemId} />
      </MfgPanel>
      <div className="flex gap-2">
        <Button variant="primary" onPress={() => save.mutate()} isLoading={save.isPending} isDisabled={invalid}>Create BOM</Button>
        <Link href="/manufacturing/boms" className="self-center text-sm text-brand hover:underline">Cancel</Link>
      </div>
    </div>
  );
}

export function BomDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const can = useCan();
  const options = useMfgOptions();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "bom", id), queryFn: () => readView<{ bom: Bom }>("bom", { id }).then((r) => r.bom) });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Line[] | null>(null);
  const [dialog, setDialog] = useState<"reject" | "obsolete" | "propose" | "revise" | null>(null);
  const [explodeQty, setExplodeQty] = useState(1);
  const [explosion, setExplosion] = useState<Explosion | null>(null);
  const [altFor, setAltFor] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });

  const run = useMutation({
    mutationFn: ({ action, body }: { action: string; body: Record<string, unknown>; success: string; go?: boolean }) => act<{ record: { id: string } }>(action, body),
    onSuccess: (result, v) => {
      setNotice(v.success);
      setError(null);
      setDialog(null);
      setEditing(null);
      setAltFor(null);
      refresh();
      if (v.go && result.record?.id) router.push(`/manufacturing/bom/${result.record.id}`);
    },
    onError: (e) => { setError(errorText(e)); setNotice(null); },
  });
  const explode = useMutation({ mutationFn: () => readView<{ explosion: Explosion }>("explode", { bomId: id, quantity: String(explodeQty) }).then((r) => r.explosion), onSuccess: setExplosion, onError: (e) => setError(errorText(e)) });

  const bom = query.data;
  if (query.isError && query.error instanceof MfgApiError && query.error.status === 403) return <PermissionState title="You don't have access to Manufacturing" description="Ask an administrator to grant manufacturing.view." />;
  if (!bom) return <p className="px-4 py-8 text-sm text-text-secondary">{query.isError ? "This BOM could not be loaded." : "Loading…"}</p>;

  const canManage = can("manufacturing.bom.manage");
  const draft = bom.status === "draft";
  const startEdit = () => setEditing(bom.components.map((c) => newLine({ itemId: c.item_id, quantity: Number(c.quantity), scrapPercent: Number(c.scrap_percent), issueMethod: c.issue_method })));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`${bom.code} v${bom.version}`}
        description={`${bom.item_name} (${bom.item_code})${bom.name ? ` · ${bom.name}` : ""} · revision ${bom.revision ?? "—"}${bom.is_alternate ? " · alternate structure" : bom.is_default ? " · default" : ""}`}
        secondaryActions={
          <div className="flex items-center gap-2">
            <StatusBadge tone={tone(bom.status)}>{label(bom.status)}</StatusBadge>
            <Link href="/manufacturing/boms" className="text-sm text-brand hover:underline">Back to BOMs</Link>
          </div>
        }
      />
      {notice && <MfgAlert tone="success">{notice}</MfgAlert>}
      {error && <MfgAlert>{error}</MfgAlert>}
      {bom.rejection_reason && draft && <MfgAlert tone="warning">Sent back: {bom.rejection_reason}</MfgAlert>}
      {bom.revision_note && <MfgAlert tone="info">Revision note: {bom.revision_note}</MfgAlert>}
      <MetricStrip metrics={[{ label: "Output", value: quantity(bom.output_quantity) }, { label: "Components", value: String(bom.components.length) }, { label: "Effective from", value: calendarDate(bom.effective_from) }, { label: "Effective to", value: calendarDate(bom.effective_to) }, { label: "Approved", value: dateTime(bom.approved_at) }]} />

      <MfgPanel
        title="Components"
        description={draft ? "This draft can be edited. Submit it for approval when it is ready." : "An approved structure cannot be edited; revise it into a new version."}
        actions={
          canManage && (
            <div className="flex flex-wrap gap-2">
              {draft && !editing && <Button variant="secondary" onPress={startEdit}>Edit components</Button>}
              {draft && editing && <Button variant="primary" isLoading={run.isPending} isDisabled={!payloadLines(editing).length} onPress={() => run.mutate({ action: "bom-update", body: { id: bom.id, components: payloadLines(editing) }, success: "Components saved." })}>Save components</Button>}
              {draft && editing && <Button variant="ghost" onPress={() => setEditing(null)}>Discard changes</Button>}
              {draft && !editing && <Button variant="primary" onPress={() => run.mutate({ action: "bom-submit", body: { id: bom.id }, success: "Submitted for approval." })}>Submit for approval</Button>}
              {bom.status === "pending_approval" && <Button variant="primary" onPress={() => run.mutate({ action: "bom-approve", body: { id: bom.id }, success: "BOM approved and active." })} isLoading={run.isPending}>Approve</Button>}
              {bom.status === "pending_approval" && <Button variant="secondary" onPress={() => setDialog("reject")}>Send back</Button>}
              {["active", "inactive", "obsolete"].includes(bom.status) && <Button variant="secondary" onPress={() => setDialog("revise")}>Revise</Button>}
              {bom.status === "active" && <Button variant="secondary" onPress={() => { setEditing(bom.components.map((c) => newLine({ itemId: c.item_id, quantity: Number(c.quantity), scrapPercent: Number(c.scrap_percent), issueMethod: c.issue_method }))); setDialog("propose"); }}>Propose change</Button>}
              {["active", "inactive"].includes(bom.status) && <Button variant="ghost" onPress={() => setDialog("obsolete")}>Mark obsolete</Button>}
            </div>
          )
        }
      >
        {editing && dialog !== "propose" ? (
          <ComponentEditor lines={editing} setLines={setEditing} options={options.data} excludeItemId={bom.item_id} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label="Components">
              <thead>
                <tr className="border-b border-border text-xs uppercase text-text-muted">
                  <th className="px-2 py-2">#</th><th className="px-2 py-2">Component</th><th className="px-2 py-2">Quantity</th><th className="px-2 py-2">Scrap %</th><th className="px-2 py-2">Issue</th><th className="px-2 py-2">Alternates</th>
                </tr>
              </thead>
              <tbody>
                {bom.components.map((c) => (
                  <tr key={c.id} className="border-b border-border/60 align-top">
                    <td className="px-2 py-2">{c.line_number}</td>
                    <td className="px-2 py-2 font-medium text-text">{c.item_name} ({c.item_code}){c.has_sub_assembly && <span className="ml-2 text-xs font-normal text-text-muted">sub-assembly</span>}</td>
                    <td className="px-2 py-2">{quantity(c.quantity)}</td>
                    <td className="px-2 py-2">{quantity(c.scrap_percent)}</td>
                    <td className="px-2 py-2">{label(c.issue_method)}</td>
                    <td className="px-2 py-2">
                      {c.alternates.length === 0 && !(draft && canManage) && "—"}
                      {c.alternates.map((a) => (
                        <span key={a.id} className="mr-2 inline-flex items-center gap-1">
                          {a.itemName} ({a.itemCode}) × {quantity(a.ratio)}
                          {draft && canManage && <Button variant="ghost" size="compact" onPress={() => run.mutate({ action: "alternate-remove", body: { id: a.id }, success: "Alternate removed." })}>Remove</Button>}
                        </span>
                      ))}
                      {draft && canManage && <Button variant="ghost" size="compact" onPress={() => setAltFor(c.id)}>Add alternate</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MfgPanel>

      <MfgPanel title="Explode" description="Multi-level requirement for a quantity of this product: every sub-assembly is opened, scrap allowance included.">
        <div className="flex flex-wrap items-end gap-2">
          <NumberField label="Quantity to make" value={explodeQty} minValue={0} step={1} onChange={(n) => setExplodeQty(Number.isNaN(n) ? 1 : n)} />
          <Button variant="secondary" onPress={() => explode.mutate()} isLoading={explode.isPending}>Explode</Button>
        </div>
        {explosion && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-1 text-sm font-medium text-text">All levels</h3>
              <ul className="text-sm" aria-label="Explosion levels">
                {explosion.lines.map((l, i) => (
                  <li key={i} style={{ paddingLeft: `${(l.level - 1) * 16}px` }}>{l.itemName} ({l.itemCode}) — {quantity(l.requiredQuantity)}{l.isSubAssembly ? ` · built from ${l.bomCode}` : ""}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-medium text-text">Bought materials (totals)</h3>
              <ul className="text-sm" aria-label="Purchased totals">
                {explosion.purchasedTotals.map((l) => (
                  <li key={l.itemCode}>{l.itemName} ({l.itemCode}) — {quantity(l.requiredQuantity)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </MfgPanel>

      <MfgPanel title="Versions">
        <ul className="text-sm" aria-label="Versions">
          {bom.versions.map((v) => (
            <li key={v.id} className="py-0.5">
              <Link className={v.id === bom.id ? "font-medium text-text" : "text-brand hover:underline"} href={`/manufacturing/bom/${v.id}`}>v{v.version} · revision {v.revision ?? "—"}</Link>{" "}
              <StatusBadge tone={tone(v.status)}>{label(v.status)}</StatusBadge>{v.revision_note ? ` — ${v.revision_note}` : ""}
            </li>
          ))}
        </ul>
        {bom.otherStructures.length > 0 && <p className="text-xs text-text-muted">Other structures for this product: {bom.otherStructures.map((s) => `${s.code} v${s.version} (${label(s.status)})`).join(", ")}</p>}
      </MfgPanel>

      {dialog === "reject" && <ReasonDialog title="Send back" isPending={run.isPending} error={error} onClose={() => setDialog(null)} onConfirm={(reason) => run.mutate({ action: "bom-reject", body: { id: bom.id, reason }, success: "Sent back to draft." })} />}
      {dialog === "obsolete" && <ReasonDialog title="Mark obsolete" isPending={run.isPending} error={error} onClose={() => setDialog(null)} onConfirm={(reason) => run.mutate({ action: "bom-obsolete", body: { id: bom.id, reason }, success: "BOM marked obsolete." })} />}
      {dialog === "revise" && <ReviseDialog error={error} isPending={run.isPending} onClose={() => setDialog(null)} onConfirm={(note) => run.mutate({ action: "bom-revise", body: { id: bom.id, revisionNote: note }, success: "Revision created as a draft.", go: true })} />}
      {dialog === "propose" && editing && (
        <ProposeDialog lines={editing} setLines={setEditing} options={options.data} excludeItemId={bom.item_id} error={error} isPending={run.isPending} onClose={() => { setDialog(null); setEditing(null); }} onConfirm={(title, reason, effectiveFrom) => run.mutate({ action: "change-create", body: { targetBomId: bom.id, title, reason, effectiveFrom: effectiveFrom || undefined, components: payloadLines(editing) }, success: "Engineering change proposed — see Engineering changes." })} />
      )}
      {altFor && <AlternateDialog options={options.data} error={error} isPending={run.isPending} onClose={() => setAltFor(null)} onConfirm={(itemId, ratio) => run.mutate({ action: "alternate-add", body: { componentId: altFor, itemId, ratio }, success: "Alternate added." })} />}
    </div>
  );
}

function ReasonDialog({ title, onClose, onConfirm, isPending, error }: { title: string; onClose: () => void; onConfirm: (reason: string) => void; isPending: boolean; error: string | null }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title}>
      <div className="flex flex-col gap-4">
        {error && <MfgAlert>{error}</MfgAlert>}
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" onPress={() => onConfirm(reason.trim())} isLoading={isPending} isDisabled={!reason.trim()}>{title}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function ReviseDialog({ onClose, onConfirm, isPending, error }: { onClose: () => void; onConfirm: (note: string) => void; isPending: boolean; error: string | null }) {
  const [note, setNote] = useState("");
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Revise BOM">
      <div className="flex flex-col gap-4">
        {error && <MfgAlert>{error}</MfgAlert>}
        <p className="text-sm text-text-secondary">Creates a new draft version copied from this one. The current version stays in force until the new one is approved.</p>
        <TextArea label="What is changing" value={note} onChange={setNote} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" onPress={() => onConfirm(note.trim())} isLoading={isPending}>Create revision</Button>
        </div>
      </div>
    </Dialog>
  );
}

function ProposeDialog({ lines, setLines, options, excludeItemId, onClose, onConfirm, isPending, error }: { lines: Line[]; setLines: (l: Line[]) => void; options: MfgOptions | undefined; excludeItemId: string; onClose: () => void; onConfirm: (title: string, reason: string, effectiveFrom: string) => void; isPending: boolean; error: string | null }) {
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [from, setFrom] = useState("");
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Propose change">
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
        {error && <MfgAlert>{error}</MfgAlert>}
        <TextField label="Title" isRequired value={title} onChange={setTitle} />
        <TextArea label="Why is this change needed" isRequired value={reason} onChange={setReason} />
        <TextField label="Effective from" type="date" value={from} onChange={setFrom} />
        <ComponentEditor lines={lines} setLines={setLines} options={options} excludeItemId={excludeItemId} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" onPress={() => onConfirm(title.trim(), reason.trim(), from)} isLoading={isPending} isDisabled={!title.trim() || !reason.trim() || !payloadLines(lines).length}>Submit proposal</Button>
        </div>
      </div>
    </Dialog>
  );
}

function AlternateDialog({ options, onClose, onConfirm, isPending, error }: { options: MfgOptions | undefined; onClose: () => void; onConfirm: (itemId: string, ratio: number) => void; isPending: boolean; error: string | null }) {
  const [itemId, setItemId] = useState("");
  const [ratio, setRatio] = useState(1);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Add alternate">
      <div className="flex flex-col gap-4">
        {error && <MfgAlert>{error}</MfgAlert>}
        <Select label="Alternate item" isRequired options={(options?.items ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.code})` }))} selectedKey={itemId || null} onSelectionChange={(k) => setItemId(String(k ?? ""))} placeholder="Select item" />
        <NumberField label="Ratio (alternate units per component unit)" value={ratio} minValue={0} step={0.1} onChange={(n) => setRatio(Number.isNaN(n) ? 1 : n)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" onPress={() => onConfirm(itemId, ratio)} isLoading={isPending} isDisabled={!itemId}>Add alternate</Button>
        </div>
      </div>
    </Dialog>
  );
}
