"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, NumberField, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { ProcApiError } from "@/features/procurement/shared/http";
import { actOn, createRecord, listRecords, updateRecord, type ProcRecord } from "@/features/procurement/shared/api";
import { DocumentDetail } from "@/features/procurement/shared/DocumentDetail";
import { ChildSection } from "@/features/procurement/shared/ChildSection";
import { calendarDate, statusLabel } from "@/features/procurement/shared/format";
import { ProcAlert, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { useCan } from "@/features/procurement/shared/use-can";
import { useLookup, type Lookup } from "@/features/procurement/shared/use-lookup";
import { rfqDetail } from "@/features/procurement/configs/rfqs";

type Line = { itemId?: string; description?: string; quantity?: string | number; unitPrice?: string | number; warehouseId?: string };

// Bid total from the bid's own lines, for COMPARISON only (the PO the award
// creates is priced and totalled by the server).
const bidTotal = (bid: ProcRecord) => (Array.isArray(bid.lines) ? (bid.lines as Line[]) : []).reduce((sum, line) => sum + Number(line.quantity ?? 0) * Number(line.unitPrice ?? 0), 0);
const weightedScore = (evaluations: ProcRecord[], bidId: string) => {
  const mine = evaluations.filter((e) => e.bidId === bidId);
  const weight = mine.reduce((sum, e) => sum + Number(e.weight ?? 0), 0);
  if (!weight) return null;
  return mine.reduce((sum, e) => sum + Number(e.score ?? 0) * Number(e.weight ?? 0), 0) / weight;
};

// F069-F073: one RFQ -- who was invited, the bids (supplier quotations), how they
// score and compare, and the award that turns the winner into a PO or agreement.
export function RfqDetailScreen({ id }: { id: string }) {
  const config = {
    ...rfqDetail,
    sections: [
      {
        id: "invitations",
        label: "Suppliers",
        render: (record: ProcRecord) => (
          <ChildSection
            parentId={record.id}
            parentStatus={record.status}
            config={{
              resource: "sourcing-invitations",
              title: "Invited suppliers",
              description: "The same RFQ can go to several vendors.",
              noun: "supplier",
              manage: "procurement.sourcing.manage",
              parentStates: ["draft", "submitted", "approved", "active"],
              emptyText: "No suppliers invited yet.",
              editable: false,
              fields: [
                { name: "supplierId", label: "Supplier", kind: "select", options: "suppliers", required: true },
                { name: "notes", label: "Message to the supplier", kind: "textarea" },
              ],
              columns: [
                { id: "supplier", header: "Supplier", accessorFn: (r) => r.supplierId },
                { id: "notes", header: "Message", accessorFn: (r) => String(r.notes ?? "—") },
              ],
            }}
          />
        ),
      },
      { id: "bids", label: "Quotations & award", render: (record: ProcRecord, refresh: () => void, lookup: Lookup) => <BidsAndAward record={record} lookup={lookup} onChanged={refresh} /> },
    ],
  };
  return <DocumentDetail config={config} id={id} />;
}

function BidsAndAward({ record, lookup, onChanged }: { record: ProcRecord; lookup: Lookup; onChanged: () => void }) {
  const workspace = useWorkspaceContext();
  const can = useCan();
  const bidsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "sourcing-bids", "children", record.id), queryFn: () => listRecords("sourcing-bids", { parentId: record.id, limit: 200 }).then((r) => r.rows) });
  const evalQuery = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "sourcing-evaluations", "children", record.id), queryFn: () => listRecords("sourcing-evaluations", { parentId: record.id, limit: 200 }).then((r) => r.rows) });
  const bids = bidsQuery.data ?? [];
  const evaluations = evalQuery.data ?? [];
  const [bidDialog, setBidDialog] = useState<ProcRecord | "new" | null>(null);
  const [evalDialog, setEvalDialog] = useState(false);
  const [awarding, setAwarding] = useState(false);
  const canBid = can("procurement.sourcing.manage") && record.status === "active";
  const canEvaluate = can("procurement.sourcing.evaluate") && ["active", "closed"].includes(record.status);
  const canAward = can("procurement.sourcing.award") && record.status === "active" && bids.length > 0;

  const totals = bids.map((bid) => bidTotal(bid));
  const lowest = totals.length ? Math.min(...totals.filter((t) => t > 0)) : 0;
  const scores = bids.map((bid) => weightedScore(evaluations, bid.id));
  const best = scores.reduce<number>((max, score) => (score !== null && score > max ? score : max), -1);

  const columns: ColumnDef<ProcRecord, unknown>[] = [
    { id: "supplier", header: "Supplier", accessorFn: (bid) => lookup.supplier(bid.supplierId) },
    { id: "quote", header: "Quotation no.", accessorFn: (bid) => String(bid.quotationNumber ?? "—") },
    { id: "total", header: "Total (from bid lines)", cell: ({ row }) => { const t = bidTotal(row.original); return <span>{t.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{t > 0 && t === lowest ? <StatusBadge tone="success">Lowest</StatusBadge> : null}</span>; } },
    { id: "lead", header: "Lead time", accessorFn: (bid) => (bid.leadTimeDays !== undefined ? `${bid.leadTimeDays} days` : "—") },
    { id: "valid", header: "Valid until", accessorFn: (bid) => calendarDate(bid.validUntil) },
    { id: "score", header: "Weighted score", cell: ({ row }) => { const s = weightedScore(evaluations, row.original.id); return s === null ? <span>—</span> : <span>{s.toFixed(1)}{s === best ? <StatusBadge tone="success">Best</StatusBadge> : null}</span>; } },
  ];
  const evalColumns: ColumnDef<ProcRecord, unknown>[] = [
    { id: "bid", header: "Bid", accessorFn: (e) => { const bid = bids.find((b) => b.id === e.bidId); return bid ? `${lookup.supplier(bid.supplierId)} (${bid.quotationNumber ?? "—"})` : "—"; } },
    { id: "criterion", header: "Criterion", accessorFn: (e) => String(e.criterion ?? "—") },
    { id: "score", header: "Score", accessorFn: (e) => String(e.score ?? "—") },
    { id: "weight", header: "Weight", accessorFn: (e) => String(e.weight ?? "—") },
    { id: "comment", header: "Comment", accessorFn: (e) => String(e.comment ?? "—") },
  ];
  const lines = (Array.isArray(record.lines) ? record.lines : []) as Line[];

  return (
    <>
      {record.award && (
        <ProcAlert tone="success">
          Awarded to <strong>{lookup.supplier(record.award.supplierId)}</strong> as a {statusLabel(record.award.awardType).toLowerCase()}.{" "}
          <Link className="underline" href={record.award.awardType === "agreement" ? `/procurement/agreements/${record.award.createdRecordId}` : `/procurement/orders/${record.award.createdRecordId}`}>
            Open it
          </Link>
        </ProcAlert>
      )}
      <ProcPanel
        title="Supplier quotations and comparison"
        description="Bids side by side. Totals here are for comparing; the order created by the award is priced and totalled by the server."
        actions={
          <div className="flex gap-2">
            {canBid && (
              <Button variant="secondary" size="compact" onPress={() => setBidDialog("new")}>
                <Plus className="size-3.5" aria-hidden="true" />
                Record quotation
              </Button>
            )}
            {canAward && (
              <Button variant="primary" size="compact" onPress={() => setAwarding(true)}>
                Award
              </Button>
            )}
          </div>
        }
      >
        <EnterpriseDataGrid<ProcRecord> aria-label="Supplier quotations" columns={columns} data={bids} getRowId={(bid) => bid.id} density="compact" state={bids.length ? "ready" : "empty"} emptyContent={<p className="px-4 py-6 text-sm text-text-muted">No quotations recorded yet.</p>} />
      </ProcPanel>
      <ProcPanel
        title="Evaluation"
        actions={
          canEvaluate && bids.length > 0 ? (
            <Button variant="secondary" size="compact" onPress={() => setEvalDialog(true)}>
              <Plus className="size-3.5" aria-hidden="true" />
              Add score
            </Button>
          ) : undefined
        }
      >
        <EnterpriseDataGrid<ProcRecord> aria-label="Evaluations" columns={evalColumns} data={evaluations} getRowId={(e) => e.id} density="compact" state={evaluations.length ? "ready" : "empty"} emptyContent={<p className="px-4 py-6 text-sm text-text-muted">No scores yet.</p>} />
      </ProcPanel>
      {bidDialog && <BidDialog rfq={record} lines={lines} existing={bidDialog === "new" ? null : bidDialog} onClose={() => setBidDialog(null)} onSaved={() => { setBidDialog(null); bidsQuery.refetch(); onChanged(); }} />}
      {evalDialog && <EvaluationDialog rfqId={record.id} bids={bids} lookup={lookup} onClose={() => setEvalDialog(false)} onSaved={() => { setEvalDialog(false); evalQuery.refetch(); }} />}
      {awarding && <AwardDialog rfq={record} bids={bids} lines={lines} lookup={lookup} onClose={() => setAwarding(false)} />}
    </>
  );
}

function DialogShell({ title, error, confirm, pending, disabled, onClose, onConfirm, children }: { title: string; error: string | null; confirm: string; pending: boolean; disabled?: boolean; onClose: () => void; onConfirm: () => void; children: React.ReactNode }) {
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title}>
      <div className="flex flex-col gap-4">
        {error && <ProcAlert>{error}</ProcAlert>}
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          <Button variant="primary" onPress={onConfirm} isLoading={pending} isDisabled={disabled}>
            {confirm}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
const messageOf = (error: unknown) => (error ? (error instanceof ProcApiError ? error.message : "This could not be saved.") : null);

function BidDialog({ rfq, lines, existing, onClose, onSaved }: { rfq: ProcRecord; lines: Line[]; existing: ProcRecord | null; onClose: () => void; onSaved: () => void }) {
  const lookup = useLookup();
  const existingLines = (Array.isArray(existing?.lines) ? existing!.lines : []) as Line[];
  const [supplierId, setSupplierId] = useState<string>(existing?.supplierId ?? "");
  const [quotationNumber, setQuotationNumber] = useState<string>(existing?.quotationNumber ?? "");
  const [leadTimeDays, setLeadTimeDays] = useState<number>(Number(existing?.leadTimeDays ?? 0));
  const [validUntil, setValidUntil] = useState<string>(String(existing?.validUntil ?? "").slice(0, 10));
  const [paymentTerms, setPaymentTerms] = useState<string>(existing?.paymentTerms ?? "");
  const [prices, setPrices] = useState<number[]>(lines.map((_, index) => Number(existingLines[index]?.unitPrice ?? 0)));
  const save = useMutation({
    mutationFn: () => {
      const payload = {
        parentId: rfq.id,
        supplierId,
        quotationNumber: quotationNumber || undefined,
        currencyCode: rfq.currencyCode ?? "INR",
        leadTimeDays,
        validUntil: validUntil || undefined,
        paymentTerms: paymentTerms || undefined,
        lines: lines.map((line, index) => ({ ...line, unitPrice: prices[index] ?? 0 })),
      };
      return existing ? updateRecord("sourcing-bids", existing.id, { ...payload, expectedVersion: existing.version }) : createRecord("sourcing-bids", payload);
    },
    onSuccess: onSaved,
  });
  return (
    <DialogShell title={existing ? "Edit quotation" : "Record supplier quotation"} error={messageOf(save.error)} confirm="Save quotation" pending={save.isPending} disabled={!supplierId} onClose={onClose} onConfirm={() => save.mutate()}>
      <Select label="Supplier" isRequired options={(lookup.options?.suppliers ?? []).map((s) => ({ value: s.id, label: s.label }))} selectedKey={supplierId || null} onSelectionChange={(key) => setSupplierId(String(key ?? ""))} placeholder="Select a supplier" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Supplier's quotation number" value={quotationNumber} onChange={setQuotationNumber} />
        <NumberField label="Lead time (days)" value={leadTimeDays} onChange={setLeadTimeDays} minValue={0} step={1} />
        <TextField label="Valid until" type="date" value={validUntil} onChange={setValidUntil} />
        <TextField label="Payment terms" value={paymentTerms} onChange={setPaymentTerms} />
      </div>
      {lines.map((line, index) => (
        <NumberField key={index} label={`Unit price — ${line.description ?? "item"} (${Number(line.quantity ?? 0)})`} value={prices[index] ?? 0} onChange={(value) => setPrices((current) => current.map((price, i) => (i === index ? value : price)))} minValue={0} step={0.01} />
      ))}
    </DialogShell>
  );
}

function EvaluationDialog({ rfqId, bids, lookup, onClose, onSaved }: { rfqId: string; bids: ProcRecord[]; lookup: Lookup; onClose: () => void; onSaved: () => void }) {
  const [bidId, setBidId] = useState("");
  const [criterion, setCriterion] = useState("price");
  const [score, setScore] = useState(0);
  const [weight, setWeight] = useState(1);
  const [comment, setComment] = useState("");
  const save = useMutation({ mutationFn: () => createRecord("sourcing-evaluations", { parentId: rfqId, bidId, criterion, score, weight, comment: comment || undefined }), onSuccess: onSaved });
  return (
    <DialogShell title="Score a quotation" error={messageOf(save.error)} confirm="Save score" pending={save.isPending} disabled={!bidId || !criterion.trim()} onClose={onClose} onConfirm={() => save.mutate()}>
      <Select label="Quotation" isRequired options={bids.map((bid) => ({ value: bid.id, label: `${lookup.supplier(bid.supplierId)} (${bid.quotationNumber ?? "—"})` }))} selectedKey={bidId || null} onSelectionChange={(key) => setBidId(String(key ?? ""))} placeholder="Select a quotation" />
      <TextField label="Criterion" isRequired value={criterion} onChange={setCriterion} />
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Score (0-100)" value={score} onChange={setScore} minValue={0} maxValue={100} step={1} />
        <NumberField label="Weight" value={weight} onChange={setWeight} minValue={0} step={1} />
      </div>
      <TextArea label="Comment" value={comment} onChange={setComment} />
    </DialogShell>
  );
}

function AwardDialog({ rfq, bids, lines, lookup, onClose }: { rfq: ProcRecord; bids: ProcRecord[]; lines: Line[]; lookup: Lookup; onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [bidId, setBidId] = useState("");
  const [awardType, setAwardType] = useState<"purchase-order" | "agreement">("purchase-order");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const bid = bids.find((candidate) => candidate.id === bidId);
  const award = useMutation({
    mutationFn: () => {
      const awardLines = (Array.isArray(bid?.lines) && bid!.lines.length ? bid!.lines : lines) as Line[];
      return actOn("sourcing-events", rfq.id, "award", { expectedVersion: rfq.version, selectedBidId: bidId, awardType, lines: awardLines, ...(awardType === "purchase-order" ? { expectedDeliveryDate: deliveryDate } : { validFrom, validUntil }) }) as Promise<ProcRecord> & { award?: ProcRecord };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") });
      const created = (result as unknown as { award?: { id?: string } }).award?.id;
      router.push(created ? (awardType === "agreement" ? `/procurement/agreements/${created}` : `/procurement/orders/${created}`) : "/procurement/awards");
    },
  });
  const ready = bidId && (awardType === "purchase-order" ? deliveryDate : validFrom && validUntil);
  return (
    <DialogShell title="Award this RFQ" error={messageOf(award.error)} confirm="Award" pending={award.isPending} disabled={!ready} onClose={onClose} onConfirm={() => award.mutate()}>
      <p className="text-sm text-text-secondary">Awarding closes the RFQ and creates a draft {awardType === "agreement" ? "agreement" : "purchase order"} for the winning supplier from their quotation. It can only be done once.</p>
      <Select label="Winning quotation" isRequired options={bids.map((b) => ({ value: b.id, label: `${lookup.supplier(b.supplierId)} — ${bidTotal(b).toLocaleString(undefined, { minimumFractionDigits: 2 })}` }))} selectedKey={bidId || null} onSelectionChange={(key) => setBidId(String(key ?? ""))} placeholder="Select the winner" />
      <Select label="Create" options={[{ value: "purchase-order", label: "Purchase order" }, { value: "agreement", label: "Agreement (blanket / contract)" }]} selectedKey={awardType} onSelectionChange={(key) => setAwardType(key === "agreement" ? "agreement" : "purchase-order")} />
      {awardType === "purchase-order" ? (
        <TextField label="Expected delivery" type="date" isRequired value={deliveryDate} onChange={setDeliveryDate} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Valid from" type="date" isRequired value={validFrom} onChange={setValidFrom} />
          <TextField label="Valid until" type="date" isRequired value={validUntil} onChange={setValidUntil} />
        </div>
      )}
    </DialogShell>
  );
}
