"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, MetricStrip, NumberField, PageHeader, PermissionState, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { act, InvApiError, readStock, useInvOptions } from "@/features/inventory/shared/client";
import { amount, dateTime, label, quantity, tone } from "@/features/inventory/shared/format";
import { InvAlert, InvPanel, useCan } from "@/features/inventory/shared/InvUi";
import { Select } from "@vercentlabs/design-system";

type Line = { id: string; item_code: string; item_name: string; location_code: string | null; batch_number: string | null; system_quantity: string | null; counted_quantity: string | null; variance_reason: string | null; movement_id: string | null; unit_cost: string | null };
type Count = { id: string; count_number: string; count_type: string; status: string; warehouse_name: string | null; freeze_stock: boolean; blind: boolean; notes: string | null; created_at: string; submitted_at: string | null; posted_at: string | null; rejection_reason: string | null; cancel_reason: string | null; lines: Line[] };

const errorText = (error: unknown) => (error instanceof InvApiError ? error.message : "That could not be completed.");

export function CountDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const options = useInvOptions();
  const key = scopedQueryKey(workspace, "inventory", "count", id);
  const query = useQuery({ queryKey: key, queryFn: () => readStock<{ count: Count }>("count", { id }).then((r) => r.count) });
  const [entries, setEntries] = useState<Record<string, { counted?: number | ""; reason?: string }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"reject" | "cancel" | "add" | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "inventory") });

  const run = useMutation({
    mutationFn: async ({ action, body }: { action: string; body: Record<string, unknown>; success: string }) => act(action, body),
    onSuccess: (_result, variables) => {
      setNotice(variables.success);
      setError(null);
      setDialog(null);
      if (variables.action === "count-lines") setEntries({});
      refresh();
    },
    onError: (e) => { setError(errorText(e)); setNotice(null); },
  });

  const count = query.data;
  if (query.isError && query.error instanceof InvApiError && query.error.status === 403) return <PermissionState title="You don't have access to Inventory" description="Ask an administrator to grant stock.view." />;
  if (!count) return <p className="px-4 py-8 text-sm text-text-secondary">{query.isError ? "This count could not be loaded." : "Loading…"}</p>;

  const counting = count.status === "counting";
  const canCount = can("stock.count");
  const canApprove = can("stock.adjust");
  const value = (line: Line) => {
    const entry = entries[line.id];
    return entry && entry.counted !== undefined ? entry.counted : line.counted_quantity === null ? "" : Number(line.counted_quantity);
  };
  const reasonOf = (line: Line) => entries[line.id]?.reason ?? line.variance_reason ?? "";
  const variance = (line: Line) => {
    const counted = value(line);
    if (counted === "" || line.system_quantity === null) return null;
    return Number(counted) - Number(line.system_quantity);
  };
  const pendingLines = Object.entries(entries).filter(([, entry]) => entry.counted !== undefined || entry.reason !== undefined);
  const saveCounts = () =>
    run.mutate({
      action: "count-lines",
      success: "Counts saved.",
      body: { countId: count.id, lines: pendingLines.map(([lineId]) => ({ lineId, countedQuantity: value(count.lines.find((l) => l.id === lineId)!), reason: reasonOf(count.lines.find((l) => l.id === lineId)!) })).filter((l) => l.countedQuantity !== "") },
    });
  const counted = count.lines.filter((l) => l.counted_quantity !== null).length;
  const withVariance = count.lines.filter((l) => l.counted_quantity !== null && l.system_quantity !== null && Number(l.counted_quantity) !== Number(l.system_quantity)).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={count.count_number}
        description={`${label(count.count_type)} count · ${count.warehouse_name ?? ""}${count.freeze_stock && (counting || count.status === "review") ? " · warehouse frozen" : ""}${count.blind && counting ? " · blind" : ""}`}
        secondaryActions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={tone(count.status)}>{label(count.status)}</StatusBadge>
            <Link href={count.count_type === "physical" ? "/inventory/physical-inventory" : "/inventory/cycle-counts"} className="text-sm text-brand hover:underline">Back to counts</Link>
          </div>
        }
      />
      {notice && <InvAlert tone="success">{notice}</InvAlert>}
      {error && <InvAlert>{error}</InvAlert>}
      {count.rejection_reason && counting && <InvAlert tone="warning">Sent back for recount: {count.rejection_reason}</InvAlert>}
      {count.status === "cancelled" && <InvAlert tone="warning">Cancelled: {count.cancel_reason}</InvAlert>}
      <MetricStrip metrics={[{ label: "Lines", value: String(count.lines.length) }, { label: "Counted", value: `${counted} / ${count.lines.length}` }, { label: "With variance", value: String(withVariance) }, { label: "Started", value: dateTime(count.created_at) }]} />

      <InvPanel
        title="Lines"
        description={counting ? "Enter what you physically counted (zero if none found). A reason is required wherever it differs from the system." : undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {counting && canCount && <Button variant="secondary" onPress={() => setDialog("add")}>Add found stock</Button>}
            {counting && canCount && <Button variant="secondary" onPress={saveCounts} isDisabled={!pendingLines.length} isLoading={run.isPending}>Save counts</Button>}
            {counting && canCount && <Button variant="primary" onPress={() => run.mutate({ action: "count-submit", body: { id: count.id }, success: "Submitted for review." })} isDisabled={pendingLines.length > 0}>Submit for review</Button>}
            {count.status === "review" && canApprove && <Button variant="primary" onPress={() => run.mutate({ action: "count-approve", body: { id: count.id }, success: "Count approved and variances posted." })} isLoading={run.isPending}>Approve and post</Button>}
            {count.status === "review" && canApprove && <Button variant="secondary" onPress={() => setDialog("reject")}>Send back</Button>}
            {(counting || count.status === "review") && canCount && <Button variant="ghost" onPress={() => setDialog("cancel")}>Cancel count</Button>}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <Table className="w-full text-left text-sm">
            <TableHead>
              <TableRow className="border-b border-border text-xs uppercase text-text-muted">
                <TableHeaderCell className="px-2 py-2">Item</TableHeaderCell>
                <TableHeaderCell className="px-2 py-2">Location</TableHeaderCell>
                <TableHeaderCell className="px-2 py-2">Batch</TableHeaderCell>
                <TableHeaderCell className="px-2 py-2">System</TableHeaderCell>
                <TableHeaderCell className="px-2 py-2">Counted</TableHeaderCell>
                <TableHeaderCell className="px-2 py-2">Variance</TableHeaderCell>
                <TableHeaderCell className="px-2 py-2">Value</TableHeaderCell>
                <TableHeaderCell className="px-2 py-2">Reason</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {count.lines.map((line) => {
                const v = variance(line);
                return (
                  <TableRow key={line.id} className="border-b border-border/60 align-top">
                    <TableCell className="px-2 py-2 font-medium text-text">{line.item_name} ({line.item_code})</TableCell>
                    <TableCell className="px-2 py-2">{line.location_code ?? "—"}</TableCell>
                    <TableCell className="px-2 py-2">{line.batch_number ?? "—"}</TableCell>
                    <TableCell className="px-2 py-2">{line.system_quantity === null ? "hidden" : quantity(line.system_quantity)}</TableCell>
                    <TableCell className="px-2 py-2">
                      {counting && canCount ? (
                        <NumberField aria-label={`Counted ${line.item_code}`} value={value(line) === "" ? undefined : Number(value(line))} minValue={0} step={0.001} onChange={(n) => setEntries((current) => ({ ...current, [line.id]: { ...current[line.id], counted: Number.isNaN(n) ? "" : n } }))} />
                      ) : (
                        quantity(line.counted_quantity)
                      )}
                    </TableCell>
                    <TableCell className={v ? "px-2 py-2 font-medium text-danger" : "px-2 py-2"}>{v === null ? "—" : v > 0 ? `+${quantity(v)}` : quantity(v)}</TableCell>
                    <TableCell className="px-2 py-2">{v !== null && line.unit_cost !== null ? amount(v * Number(line.unit_cost)) : "—"}</TableCell>
                    <TableCell className="px-2 py-2">
                      {counting && canCount ? (
                        <TextField aria-label={`Reason ${line.item_code}`} value={reasonOf(line)} onChange={(text) => setEntries((current) => ({ ...current, [line.id]: { ...current[line.id], reason: text } }))} />
                      ) : (
                        line.variance_reason ?? "—"
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {count.lines.length === 0 && <p className="px-2 py-6 text-sm text-text-muted">This count has no lines. Add stock you found, or cancel it.</p>}
        </div>
      </InvPanel>

      {dialog === "add" && <AddLineDialog countId={count.id} options={options.data} onClose={() => setDialog(null)} onDone={() => { setDialog(null); setNotice("Line added."); refresh(); }} />}
      {(dialog === "reject" || dialog === "cancel") && (
        <ReasonDialog
          title={dialog === "reject" ? "Send back for recount" : "Cancel count"}
          error={error}
          isPending={run.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(reason) => run.mutate({ action: dialog === "reject" ? "count-reject" : "count-cancel", body: { id: count.id, reason }, success: dialog === "reject" ? "Sent back for recount." : "Count cancelled." })}
        />
      )}
    </div>
  );
}

function ReasonDialog({ title, onClose, onConfirm, isPending, error }: { title: string; onClose: () => void; onConfirm: (reason: string) => void; isPending: boolean; error: string | null }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title}>
      <div className="flex flex-col gap-4">
        {error && <InvAlert>{error}</InvAlert>}
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" onPress={() => onConfirm(reason.trim())} isLoading={isPending} isDisabled={!reason.trim()}>{title}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function AddLineDialog({ countId, options, onClose, onDone }: { countId: string; options: ReturnType<typeof useInvOptions>["data"]; onClose: () => void; onDone: () => void }) {
  const [itemId, setItemId] = useState("");
  const [batchId, setBatchId] = useState("");
  const add = useMutation({ mutationFn: () => act("count-add-line", { countId, itemId, batchId: batchId || undefined }), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Add found stock">
      <div className="flex flex-col gap-4">
        {add.error && <InvAlert>{errorText(add.error)}</InvAlert>}
        <Select label="Item" isRequired options={(options?.items ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.code})` }))} selectedKey={itemId || null} onSelectionChange={(k) => { setItemId(String(k ?? "")); setBatchId(""); }} placeholder="Select item" />
        <Select label="Batch / lot" options={(options?.batches ?? []).filter((b) => b.item_id === itemId).map((b) => ({ value: b.id, label: b.code }))} selectedKey={batchId || null} onSelectionChange={(k) => setBatchId(String(k ?? ""))} placeholder="Select batch" />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" onPress={() => add.mutate()} isLoading={add.isPending} isDisabled={!itemId}>Add line</Button>
        </div>
      </div>
    </Dialog>
  );
}
