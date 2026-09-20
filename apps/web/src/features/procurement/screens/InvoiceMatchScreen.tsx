"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, NumberField, PageHeader, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { ProcApiError } from "@/features/procurement/shared/http";
import { getOptions, getRecord, runMatch } from "@/features/procurement/shared/api";
import { money, quantity, statusLabel, statusTone } from "@/features/procurement/shared/format";
import { ProcAlert, ProcFacts, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { useCan } from "@/features/procurement/shared/use-can";

type Line = { id: string; description?: string; itemId?: string; quantity?: string; unitPrice?: string; taxAmount?: string; receivedQuantity?: string; invoicedQuantity?: string };
type Result = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// F084-F086: record a supplier invoice and match it. The SERVER decides whether it
// matches (price within tolerance, quantity not above what was ordered/received,
// no duplicate invoice number); this screen collects the invoice and shows the verdict.
export function InvoiceMatchScreen({ orderId }: { orderId?: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "options"), queryFn: getOptions });
  const [selected, setSelected] = useState(orderId ?? "");
  const order = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "purchase-orders", selected), queryFn: () => getRecord("purchase-orders", selected), enabled: Boolean(selected) });
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [mode, setMode] = useState("three-way");
  const [tolerance, setTolerance] = useState<number | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [edits, setEdits] = useState<Record<string, { quantity?: number; unitPrice?: number }>>({});
  const [result, setResult] = useState<Result | null>(null);

  const lines = ((order.data?.lines ?? []) as Line[]).filter((line) => Number(line.quantity ?? 0) > 0);
  const chosen = lines.map((line) => {
    const eligibleDefault = mode === "two-way" ? Number(line.quantity ?? 0) - Number(line.invoicedQuantity ?? 0) : Number(line.receivedQuantity ?? 0) - Number(line.invoicedQuantity ?? 0);
    return { line, quantity: edits[line.id]?.quantity ?? Math.max(eligibleDefault, 0), unitPrice: edits[line.id]?.unitPrice ?? Number(line.unitPrice ?? 0) };
  });

  const match = useMutation({
    mutationFn: () =>
      runMatch({
        purchaseOrderId: selected,
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate: invoiceDate || undefined,
        currencyCode: order.data?.currencyCode ?? "INR",
        matchMode: mode,
        ...(tolerance !== null ? { tolerancePercent: tolerance, overrideReason: overrideReason.trim() || undefined } : {}),
        invoiceLines: chosen.filter((row) => row.quantity > 0).map((row) => ({ purchaseOrderLineId: row.line.id, itemId: row.line.itemId, description: row.line.description, quantity: row.quantity, unitPrice: row.unitPrice })),
      }),
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") });
    },
  });
  const error = match.error ? (match.error instanceof ProcApiError ? match.error.message : "The invoice could not be matched.") : null;
  const record = result?.matchingRecord as Result | undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Record supplier invoice"
        description="Enter what the supplier invoiced. The system checks it against the order and what was received."
        secondaryActions={
          <Link href="/procurement/invoices">
            <Button variant="secondary">Back to invoices</Button>
          </Link>
        }
        primaryAction={
          <Button variant="primary" onPress={() => match.mutate()} isLoading={match.isPending} isDisabled={!selected || !invoiceNumber.trim() || chosen.every((row) => row.quantity <= 0) || (tolerance !== null && !overrideReason.trim())}>
            Match invoice
          </Button>
        }
      />
      {error && <ProcAlert>{error}</ProcAlert>}
      {record && (
        <ProcPanel title="Result">
          <div className="flex items-center gap-2">
            <StatusBadge tone={statusTone(record.status === "matched" ? "matched" : "open")}>{record.status === "matched" ? "Matched" : "Exception"}</StatusBadge>
            <span className="text-sm text-text-secondary">Invoice {String(record.invoiceNumber)}</span>
          </div>
          <ProcFacts columns={3} items={[{ label: "Invoice total", value: money(record.currencyCode, record.invoiceTotal) }, { label: "Order value for these quantities", value: money(record.currencyCode, record.orderMatchedTotal) }, { label: "Variance", value: money(record.currencyCode, record.varianceAmount) }]} />
          {Array.isArray(record.issues) && record.issues.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-text-secondary">
              {record.issues.map((issue: Result, index: number) => (
                <li key={index}>
                  {statusLabel(String(issue.type).replace(/-/g, " "))} — {String(issue.line ?? "")}
                </li>
              ))}
            </ul>
          )}
          {result?.exception && (
            <ProcAlert tone="warning">
              An exception was opened. <Link className="underline" href={`/procurement/three-way-match/${result.exception.id}`}>Review it</Link>.
            </ProcAlert>
          )}
          {record.status === "matched" && (
            <ProcAlert tone={result?.vendorBill ? "success" : "info"}>
              {result?.vendorBill ? "A vendor bill was created in Accounting." : result?.vendorBillSkippedReason === "PROCUREMENT_SUPPLIER_NOT_LINKED_TO_ACCOUNTING_PARTY" ? "Matched. No vendor bill was created because this supplier is not linked to an Accounting party." : "Matched."}
            </ProcAlert>
          )}
          <div>
            <Link href="/procurement/invoices">
              <Button variant="secondary">Back to invoices</Button>
            </Link>
          </div>
        </ProcPanel>
      )}
      {!result && (
        <>
          <ProcPanel title="Invoice">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="Purchase order" isRequired options={(options.data?.purchaseOrders ?? []).map((o) => ({ value: o.id, label: o.label }))} selectedKey={selected || null} onSelectionChange={(key) => { setSelected(String(key ?? "")); setEdits({}); }} placeholder="Select a purchase order" />
              <TextField label="Supplier's invoice number" isRequired value={invoiceNumber} onChange={setInvoiceNumber} />
              <TextField label="Invoice date" type="date" value={invoiceDate} onChange={setInvoiceDate} />
              <Select
                label="Match against"
                options={[
                  { value: "two-way", label: "Order only (2-way)" },
                  { value: "three-way", label: "Order and receipts (3-way)" },
                  { value: "four-way", label: "Order, receipts and inspection (4-way)" },
                ]}
                selectedKey={mode}
                onSelectionChange={(key) => setMode(String(key ?? "three-way"))}
              />
            </div>
          </ProcPanel>
          {selected && (
            <ProcPanel title="Invoiced lines" description="Quantities default to what has been received and not yet invoiced.">
              {order.isLoading && <p className="text-sm text-text-muted">Loading order…</p>}
              <div className="flex flex-col gap-3">
                {chosen.map(({ line, quantity: qty, unitPrice }, index) => (
                  <div key={line.id} className="grid grid-cols-1 items-end gap-2 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="text-sm">
                      <div className="font-medium text-text">{line.description}</div>
                      <div className="text-xs text-text-muted">
                        Ordered {quantity(line.quantity)} · received {quantity(line.receivedQuantity)} · already invoiced {quantity(line.invoicedQuantity)}
                      </div>
                    </div>
                    <NumberField aria-label={`Invoiced quantity ${index + 1}`} value={qty} onChange={(value) => setEdits((current) => ({ ...current, [line.id]: { ...current[line.id], quantity: value } }))} minValue={0} step={1} />
                    <NumberField aria-label={`Invoiced unit price ${index + 1}`} value={unitPrice} onChange={(value) => setEdits((current) => ({ ...current, [line.id]: { ...current[line.id], unitPrice: value } }))} minValue={0} step={0.01} />
                  </div>
                ))}
              </div>
            </ProcPanel>
          )}
          {can("procurement.matching.override") && (
            <ProcPanel title="Tolerance override" description="Widen the price tolerance for this invoice only. Needs a reason and is recorded on the match.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NumberField label="Tolerance (%)" value={tolerance ?? 0} onChange={(value) => setTolerance(value)} minValue={0} maxValue={100} step={1} />
                <TextField label="Reason for the override" value={overrideReason} onChange={setOverrideReason} />
              </div>
              {tolerance !== null && (
                <Button variant="ghost" size="compact" onPress={() => { setTolerance(null); setOverrideReason(""); }}>
                  Use the policy tolerance instead
                </Button>
              )}
            </ProcPanel>
          )}
        </>
      )}
    </div>
  );
}
