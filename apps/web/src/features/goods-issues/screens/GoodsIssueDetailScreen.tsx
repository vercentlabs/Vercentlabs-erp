"use client";

// One Goods Issue: Overview, Items, Tracking, Inventory (its Stock Ledger movements), Valuation and Accounting (for those who may see them),
// Attachments and History. A draft is edited, validated, posted or cancelled; a posted one is never edited — it is reversed, fully or partly,
// bringing the same batch or serial number back.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, EmptyState, ErrorState, RecordDetailsPage, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { ErrorBanner, money, quantity } from "@/features/items/item-format";
import type { NegativeOverride } from "@/features/negative-stock/api/negative-stock-api";
import { NegativeOverrideDialog } from "@/features/negative-stock/components/NegativeOverrideDialog";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { PropertyList } from "@/shared/ui/PropertyList";
import { Cell, HistoryList, LinesTable, MoreActions, byLine } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  DISPOSITION_LABEL, STATUS_LABEL, cancelGoodsIssue, errorCode, errorMessage, errorsOf, getGoodsIssue, goodsIssueFileUrl, postGoodsIssue, removeGoodsIssueFile, reverseGoodsIssue,
  uploadGoodsIssueFile, validateGoodsIssue, type GoodsIssueDetail,
} from "../api/goods-issues-api";
import { GOODS_ISSUES_BASE, STATUS_TONE } from "./GoodsIssuesScreen";

export function GoodsIssueDetailScreen({ issueId }: { issueId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "goods-issues", "detail", issueId);
  const detail = useQuery({ queryKey: key, queryFn: () => getGoodsIssue(issueId) });
  const refresh = (data?: GoodsIssueDetail) => { if (data) queryClient.setQueryData(key, data); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "goods-issues") }); };
  const [dialog, setDialog] = useState<"cancel" | "reverse" | "override" | null>(null);
  const [tab, setTab] = useState("overview");
  const validation = useQuery({ queryKey: [...key, "validation"], queryFn: () => validateGoodsIssue(issueId), enabled: detail.data?.goodsIssue.status === "draft" });
  const post = useMutation({ mutationFn: () => postGoodsIssue(issueId), onSuccess: refresh });
  // Negative-Stock Control: lines the stock does not cover may go below zero only with an authorised override (the company allows it, the user may).
  const overridePost = useMutation({ mutationFn: (override: NegativeOverride) => postGoodsIssue(issueId, override), onSuccess: (data) => { refresh(data); setDialog(null); } });
  const negative = validation.data?.negative ?? [];
  const onlyNegative = Boolean(validation.data && !validation.data.ready && validation.data.errors.every((entry) => entry.code === "NEGATIVE_STOCK_OVERRIDE_REQUIRED"));

  if (detail.isLoading) return <LoadingState label="Loading goods issue" rows={6} />;
  if (detail.isError) return errorCode(detail.error) === "GOODS_ISSUE_NOT_FOUND"
    ? <EmptyState title="Goods issue not found" description="It does not exist, or it is in a warehouse you cannot see." action={{ label: "Back to goods issues", onPress: () => router.push(GOODS_ISSUES_BASE) }} />
    : <ErrorState title="Could not load the goods issue" description={errorMessage(detail.error)} action={{ label: "Try again", onPress: () => void detail.refetch() }} />;
  const data = detail.data!;
  const head = data.goodsIssue;
  const can = data.capabilities;

  return (
    <>
      <RecordDetailsPage
        header={{
          title: <>{head.number} <span className="text-base font-normal whitespace-nowrap text-text-muted">{head.reason}</span></>,
          status: <StatusBadge tone={STATUS_TONE[head.status]}>{STATUS_LABEL[head.status]}</StatusBadge>,
          fields: [
            { label: "Warehouse", value: head.warehouse },
            { label: "Issue date", value: formatDate(head.issueDate) },
            { label: "Issued to", value: head.issuedTo ?? "Not set" },
            { label: "Items", value: String(data.lines.length) },
            ...(can.seesCost && head.value !== undefined ? [{ label: "Value", value: money(head.value) }] : []),
          ],
          primaryAction: can.post ? <Button variant="primary" isLoading={post.isPending} onPress={() => post.mutate()}>Post goods issue</Button> : undefined,
          secondaryActions: (
            <>
              {can.edit && <Button variant="secondary" onPress={() => router.push(`${GOODS_ISSUES_BASE}/${head.id}/edit`)}>Edit</Button>}
              <MoreActions actions={[
                { id: "cancel", label: "Cancel draft", show: can.cancel, run: () => setDialog("cancel") },
                { id: "reverse", label: "Reverse goods issue", show: can.reverse, run: () => setDialog("reverse") },
              ]} />
            </>
          ),
        }}
        tabs={
          <div className="flex flex-col gap-3">
            {post.error ? <Notice>{errorMessage(post.error)}
              {errorsOf(post.error).length > 1 && <ul className="mt-1 list-disc pl-5">{errorsOf(post.error).map((entry) => <li key={entry.message}>{entry.message}</li>)}</ul>}</Notice> : null}
            {head.status === "draft" && validation.data && !validation.data.ready && !post.error && (
              <Notice tone="warning">
                <p className="font-medium">Not ready to post against current stock:</p><ul className="list-disc pl-5">{validation.data.errors.map((entry) => <li key={entry.message}>{entry.message}</li>)}</ul>
                {onlyNegative && negative.length > 0 && (validation.data.canOverrideNegative
                  ? <div className="mt-2"><Button variant="danger" size="compact" onPress={() => setDialog("override")}>Override negative stock…</Button></div>
                  : <p className="mt-1">Reduce the quantity, choose another location, receive the pending stock, or ask someone with the Override negative stock permission.</p>)}
              </Notice>
            )}
          </div>
        }
      >
        <Tabs selectedKey={tab} onSelectionChange={(selected) => setTab(String(selected))}>
          <TabList aria-label="Goods issue sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="items">Items</Tab>
            <Tab id="tracking">Tracking</Tab>
            <Tab id="inventory">Inventory</Tab>
            {can.seesCost && <Tab id="valuation">Valuation</Tab>}
            {can.seesAccounting && <Tab id="accounting">Accounting</Tab>}
            <Tab id="files">Attachments</Tab>
            <Tab id="history">History</Tab>
          </TabList>

          <TabPanel id="overview">
            <div className="flex flex-col gap-6">
              <PropertyList title="Goods issue" columns={3} items={[
                { label: "Warehouse", value: `${head.warehouse} · ${head.warehouseName}` },
                { label: "Issue date", value: formatDate(head.issueDate) },
                { label: "Reason", value: head.reason },
                { label: "Issued to", value: head.issuedTo },
                { label: "Project", value: head.project },
                { label: "Cost center", value: head.costCenter },
                { label: "Reference", value: head.externalReference },
                { label: "Value issued", value: can.seesCost && head.value !== undefined ? money(head.value) : null },
                { label: "Notes", value: head.notes ? <span className="whitespace-pre-wrap">{head.notes}</span> : null, wide: true },
              ]} />
              <PropertyList title="Record" columns={3} items={[
                { label: "Issued by", value: head.issuedByName },
                { label: "Posted", value: head.postedAt ? byLine(head.postedAt, head.postedByName) : "Not posted" },
                { label: "Created", value: byLine(head.createdAt, head.createdByName) },
                { label: "Cancelled", value: head.cancelledAt ? `${formatDateTime(head.cancelledAt)}${head.cancelReason ? ` · ${head.cancelReason}` : ""}` : null },
              ]} />
            </div>
          </TabPanel>

          <TabPanel id="items">
            <Panel title="Items" description="Quantities in the unit entered and in the item's base unit.">
              <LinesTable columns={["#", "SKU", "Item", "Location", "From", { label: "Quantity", numeric: true }, { label: "Base quantity", numeric: true },
                { label: head.status === "draft" ? "Available now" : "Reversed", numeric: true }]}>
                {data.lines.map((line) => (
                  <tr key={line.id}>
                    <Cell>{line.lineNumber}</Cell><Cell>{line.sku}</Cell><Cell>{line.itemName}</Cell><Cell>{line.location}</Cell><Cell>{DISPOSITION_LABEL[line.sourceDisposition]}</Cell>
                    <Cell numeric>{quantity(line.quantity, line.uom)}{line.conversion !== 1 ? ` × ${line.conversion}` : ""}</Cell><Cell numeric>{quantity(line.baseQuantity, line.baseUom)}</Cell>
                    <Cell numeric>{head.status === "draft" ? <span className={(line.availableNow ?? 0) < line.baseQuantity ? "text-warning" : ""}>{quantity(line.availableNow ?? 0)}</span> : quantity(line.reversedQuantity)}</Cell>
                  </tr>
                ))}
              </LinesTable>
            </Panel>
          </TabPanel>

          <TabPanel id="tracking">
            <Panel title="Batches and serial numbers">
              {data.lines.every((line) => !line.batches.length && !line.serials.length) ? <p className="text-sm text-text-muted">No batch or serial-numbered items.</p> : (
                <div className="flex flex-col gap-3 text-sm">
                  {data.lines.filter((line) => line.batches.length || line.serials.length).map((line) => (
                    <div key={line.id} className="flex flex-col gap-1">
                      <p className="font-medium">Line {line.lineNumber} · {line.sku}</p>
                      {line.batches.map((batch) => <p key={batch.batchId}>Batch {batch.batch}{batch.expiresOn ? ` (expires ${formatDate(batch.expiresOn)})` : ""}: {quantity(batch.quantity)}{batch.reversed ? ` · ${quantity(batch.reversed)} back` : ""}</p>)}
                      {line.serials.length > 0 && <p>Serials: {line.serials.map((serial) => `${serial.serialNumber}${serial.reversed ? " (back)" : ""}`).join(", ")}</p>}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </TabPanel>

          <TabPanel id="inventory">
            <Panel title="Stock movements" description="What this goods issue posted to the stock ledger."
              actions={data.movements.length ? <>
                <Link className="text-sm text-brand hover:underline" href={`/inventory/transactions?tab=ledger&sourceId=${head.id}`}>Stock ledger</Link>
                <Link className="text-sm text-brand hover:underline" href={`/inventory/warehouses/${head.warehouseId}`}>Warehouse</Link>
              </> : undefined}>
              {data.movements.length === 0 ? <p className="text-sm text-text-muted">{head.status === "draft" ? "A draft moves no stock." : "No stock movements."}</p> : (
                <LinesTable columns={["Movement", "Type", "Effective", "Item", "Location", "Batch / Serial", { label: "Quantity", numeric: true }]}>
                  {data.movements.map((movement) => (
                    <tr key={movement.id}>
                      <Cell><Link className="text-brand hover:underline" href={`/inventory/stock-ledger/${movement.id}`}>{movement.number}</Link></Cell><Cell>{movement.typeLabel}</Cell>
                      <Cell>{formatDateTime(movement.effectiveAt)}</Cell><Cell>{movement.sku}</Cell><Cell>{movement.location}</Cell><Cell>{movement.serial ?? movement.batch}</Cell>
                      <Cell numeric>{quantity(movement.quantity, movement.baseUom)}</Cell>
                    </tr>
                  ))}
                </LinesTable>
              )}
            </Panel>
          </TabPanel>

          {can.seesCost && (
            <TabPanel id="valuation">
              <Panel title="Valuation" description="Costs come from Inventory Valuation (the item's valuation method), never typed in.">
                <LinesTable columns={["Line", "Item", { label: "Base quantity", numeric: true }, { label: "Value issued", numeric: true }]}>
                  {data.lines.map((line) => (
                    <tr key={line.id}><Cell>{line.lineNumber}</Cell><Cell>{line.sku} · {line.itemName}</Cell><Cell numeric>{quantity(line.baseQuantity, line.baseUom)}</Cell>
                      <Cell numeric>{line.value === undefined ? null : money(line.value)}</Cell></tr>
                  ))}
                </LinesTable>
                {data.reversals.length > 0 && <p className="text-sm">Reversed: {data.reversals.map((entry) => `${formatDate(entry.date)} ${quantity(entry.quantity)}${entry.value !== undefined ? ` (${money(entry.value)})` : ""}`).join(" · ")}</p>}
              </Panel>
            </TabPanel>
          )}

          {can.seesAccounting && (
            <TabPanel id="accounting">
              <Panel title="Accounting" description="Posting debits the reason's expense account (write-off for scrap) and credits Inventory; a reversal posts the opposite. Finance owns the journals.">
                {!data.journals?.length ? <p className="text-sm text-text-muted">No journal yet.</p> : (
                  <LinesTable columns={["Journal", "Date", "Status", ""]}>
                    {data.journals.map((entry) => (
                      <tr key={entry.id}><Cell><Link className="text-brand hover:underline" href={entry.href}>{entry.number}</Link></Cell><Cell>{formatDate(entry.date)}</Cell><Cell>{entry.status}</Cell>
                        <Cell>{entry.reversal ? "Reversal" : null}</Cell></tr>
                    ))}
                  </LinesTable>
                )}
              </Panel>
            </TabPanel>
          )}

          <TabPanel id="files"><Files detail={data} onChange={() => void detail.refetch()} /></TabPanel>
          <TabPanel id="history"><HistoryList entries={data.history.map((entry) => ({ summary: entry.summary, at: entry.at, actor: entry.actor }))} /></TabPanel>
        </Tabs>
      </RecordDetailsPage>
      {dialog === "cancel" && <CancelDialog id={head.id} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "reverse" && <ReverseDialog detail={data} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "override" && <NegativeOverrideDialog title={`Post ${head.number} with a negative-stock override`} reasons={validation.data?.overrideReasons ?? []}
        lines={negative.map((line) => ({ key: `${line.lineId}:${line.location}`, label: `Line ${line.lineNumber} · ${line.sku}`, location: line.location, uom: line.uom, onHand: line.onHand,
          requested: line.requested, projected: line.projected }))}
        isPending={overridePost.isPending} error={overridePost.isError ? errorMessage(overridePost.error) : null} onConfirm={(override) => overridePost.mutate(override)}
        onClose={() => { overridePost.reset(); setDialog(null); }} />}
    </>
  );
}

function CancelDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: (data: GoodsIssueDetail) => void }) {
  const [reason, setReason] = useState("");
  const cancel = useMutation({ mutationFn: () => cancelGoodsIssue(id, reason), onSuccess: (data) => { onDone(data); onClose(); } });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Cancel this draft">
      <div className="flex flex-col gap-3">
        <TextArea label="Reason (optional)" value={reason} onChange={setReason} />
        <ErrorBanner message={cancel.isError ? errorMessage(cancel.error) : null} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Keep it</Button><Button variant="danger" isLoading={cancel.isPending} onPress={() => cancel.mutate()}>Cancel draft</Button></div>
      </div>
    </Dialog>
  );
}

// Reverse everything still issued, or part of it: a quantity per line, or the serial numbers that come back.
function ReverseDialog({ detail, onClose, onDone }: { detail: GoodsIssueDetail; onClose: () => void; onDone: (data: GoodsIssueDetail) => void }) {
  const [reason, setReason] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [key] = useState(() => crypto.randomUUID());
  const partial = Object.values(amounts).some(Boolean) || Object.values(serials).some((list) => list.length);
  const reverse = useMutation({
    mutationFn: () => reverseGoodsIssue(detail.goodsIssue.id, { reason, idempotencyKey: key,
      lines: partial ? detail.lines.flatMap((line): Array<{ lineId: string; quantity?: string; serialIds?: string[] }> => line.trackingType === "serial" ? (serials[line.id]?.length ? [{ lineId: line.id, serialIds: serials[line.id] }] : [])
        : amounts[line.id] ? [{ lineId: line.id, quantity: amounts[line.id] }] : []) : undefined }),
    onSuccess: (data) => { onDone(data); onClose(); },
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Reverse ${detail.goodsIssue.number}`}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">Only when the issue was posted in error and the goods are back in the warehouse. The same batch or serial returns to the same location at the cost it left with;
          the original stays in the ledger. Leave the quantities empty to reverse everything still issued.</p>
        {detail.lines.map((line) => {
          const open = line.baseQuantity - line.reversedQuantity;
          if (open <= 0) return null;
          return line.trackingType === "serial" ? (
            <div key={line.id}><p className="font-medium">Line {line.lineNumber} · {line.sku}</p>
              <div className="flex flex-wrap gap-3">{line.serials.filter((serial) => !serial.reversed).map((serial) => (
                <label key={serial.id} className="flex items-center gap-1"><input type="checkbox" checked={serials[line.id]?.includes(serial.id) ?? false}
                  onChange={(event) => setSerials((current) => ({ ...current, [line.id]: event.target.checked ? [...(current[line.id] ?? []), serial.id] : (current[line.id] ?? []).filter((id) => id !== serial.id) }))} />{serial.serialNumber}</label>))}</div></div>
          ) : (
            <TextField key={line.id} label={`Line ${line.lineNumber} · ${line.sku} (up to ${quantity(open)} ${line.baseUom ?? ""})`} inputMode="decimal" value={amounts[line.id] ?? ""}
              onChange={(value) => setAmounts((current) => ({ ...current, [line.id]: value }))} />
          );
        })}
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
        <ErrorBanner message={reverse.isError ? errorMessage(reverse.error) : null} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="danger" isDisabled={reason.trim().length < 3} isLoading={reverse.isPending} onPress={() => reverse.mutate()}>{partial ? "Reverse selected" : "Reverse everything"}</Button></div>
      </div>
    </Dialog>
  );
}

function Files({ detail, onChange }: { detail: GoodsIssueDetail; onChange: () => void }) {
  const upload = useMutation({ mutationFn: (file: File) => uploadGoodsIssueFile(detail.goodsIssue.id, file), onSuccess: onChange });
  const remove = useMutation({ mutationFn: (fileId: string) => removeGoodsIssueFile(detail.goodsIssue.id, fileId), onSuccess: onChange });
  return (
    <Panel title="Attachments" description="Requisitions, maintenance tickets, disposal approvals, damage photos, scrap certificates.">
      <div className="flex flex-col gap-3 text-sm">
      {detail.files.length === 0 && <p className="text-text-muted">No files yet.</p>}
      {detail.files.map((file) => (
        <div key={file.id} className="flex items-center justify-between gap-2"><a className="text-brand hover:underline" href={goodsIssueFileUrl(detail.goodsIssue.id, file.id)}>{file.fileName}</a>
          <span className="text-xs text-text-muted">{formatDateTime(file.uploadedAt)}</span>
          {detail.goodsIssue.status === "draft" && detail.capabilities.edit && <Button size="compact" variant="ghost" onPress={() => remove.mutate(file.id)}>Remove</Button>}</div>
      ))}
      {detail.capabilities.edit || detail.goodsIssue.status !== "cancelled" ? <label className="text-sm"><input type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); }} /></label> : null}
      <ErrorBanner message={upload.isError ? errorMessage(upload.error) : remove.isError ? errorMessage(remove.error) : null} />
      </div>
    </Panel>
  );
}
