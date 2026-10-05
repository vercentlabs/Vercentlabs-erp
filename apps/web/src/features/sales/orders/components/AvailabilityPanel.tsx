"use client";

// Check Availability on a sales order: for each stock line, what is required,
// what this order already holds, on hand, reserved by other demand, available
// and short, in the warehouse the line ships from, with other warehouses that
// have stock. A check is a point-in-time reading: it reserves nothing and is
// not saved. Reserve Available asks Inventory again before committing.
import { Fragment, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, CircleMinus, RefreshCw, XCircle } from "lucide-react";
import { Button, Dialog, StatusBadge, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { dateTime } from "@/features/sales/shared/format";
import { SalesAlert, SalesPanel } from "@/features/sales/shared/SalesUi";

import { changeLineWarehouse, getSalesOrderAvailability, type AlternativeWarehouse, type LineAvailability } from "../api/orders-api";
import { failureText } from "./OrderDialogs";

const amount = (value: number | null | undefined) => (value == null ? "—" : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 }));
const withUnit = (value: number | null | undefined, unit: string | null | undefined) => `${amount(value)}${unit ? ` ${unit}` : ""}`;

// Text and an icon, never colour alone.
function ResultBadge({ result, label }: { result: string; label: string }) {
  const tone = result === "available" ? "success" : result === "partially_available" ? "warning" : result === "unavailable" || result === "no_warehouse" ? "danger" : "neutral";
  const Icon = result === "available" ? CheckCircle2 : result === "partially_available" ? CircleAlert : result === "unavailable" || result === "no_warehouse" ? XCircle : CircleMinus;
  return <span className="inline-flex items-center gap-1"><Icon className="size-3.5 text-text-muted" aria-hidden="true" /><StatusBadge tone={tone}>{label}</StatusBadge></span>;
}

export function AvailabilityPanel({ orderId, autoCheck, canReserve, reserving, onReserve, canChangeWarehouse, onChanged }: {
  orderId: string; autoCheck: boolean; canReserve: boolean; reserving: boolean; onReserve: () => void; canChangeWarehouse: boolean; onChanged: () => void;
}) {
  const workspace = useWorkspaceContext();
  const [checked, setChecked] = useState(autoCheck);
  const [open, setOpen] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ line: LineAvailability; to: AlternativeWarehouse } | null>(null);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "order", orderId, "availability"),
    queryFn: () => getSalesOrderAvailability(orderId).then((r) => r.availability),
    enabled: checked || autoCheck,
    staleTime: 0,
  });
  const data = query.data;
  const refresh = () => (checked ? void query.refetch() : setChecked(true));
  const stockLines = data?.lines.filter((line) => line.stockTracked) ?? [];
  const otherLines = data?.lines.filter((line) => !line.stockTracked) ?? [];
  return (
    <SalesPanel title="Availability"
      description="On hand minus reserved, in the warehouse each line ships from; stock under quality hold is not counted. A check is for now only: only a reservation commits stock."
      actions={(
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="compact" isLoading={query.isFetching} onPress={refresh}><RefreshCw className="size-3.5" aria-hidden="true" />{data ? "Refresh" : "Check Availability"}</Button>
          {canReserve && data && !data.informational && <Button variant="primary" size="compact" isLoading={reserving} onPress={onReserve}>Reserve Available</Button>}
        </div>
      )}>
      {query.isError && <SalesAlert>{failureText(query.error, "Availability could not be checked.")}</SalesAlert>}
      {!data && !query.isFetching && !query.isError && <p className="text-sm text-text-muted">Check what is available now for this order&apos;s stock lines.</p>}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">Overall:</span>
            <ResultBadge result={data.summary === "fully_available" ? "available" : data.summary} label={data.summaryLabel} />
            <span className="text-text-muted">Availability checked {dateTime(data.checkedAt)}</span>
          </div>
          {data.informational && <SalesAlert tone="info">This order is a draft: the result is for information. Stock can be reserved once the order is confirmed.</SalesAlert>}
          {stockLines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <thead className="text-left text-xs text-text-muted">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-medium">Product</th><th className="py-2 pr-3 font-medium">Warehouse</th>
                    <th className="py-2 pr-3 text-right font-medium">Required</th><th className="py-2 pr-3 text-right font-medium">Reserved for this order</th>
                    <th className="py-2 pr-3 text-right font-medium">On hand</th><th className="py-2 pr-3 text-right font-medium">Reserved by others</th>
                    <th className="py-2 pr-3 text-right font-medium">Available</th><th className="py-2 pr-3 text-right font-medium">Shortage</th><th className="py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {stockLines.map((line) => {
                    const alternatives = line.alternatives ?? [];
                    const expanded = open === line.lineId;
                    return (
                      <Fragment key={line.lineId}>
                        <tr className="border-b border-border align-top">
                          <td className="py-2 pr-3">
                            <span className="flex flex-col">
                              <span className="font-medium">{line.itemName}</span>
                              {line.unit && line.baseUnit && line.unit !== line.baseUnit && <span className="text-xs text-text-muted">{withUnit(line.baseRequired, line.baseUnit)} required in the stock unit</span>}
                              {line.problem && <span className="text-xs text-danger">{line.problem}</span>}
                            </span>
                          </td>
                          <td className="py-2 pr-3">
                            <span className="flex flex-col">
                              <span>{line.warehouseName ?? "—"}</span>
                              {line.warehouseSource === "order_default" && <span className="text-xs text-text-muted">Order default</span>}
                              {alternatives.length > 0 && (
                                <button type="button" className="inline-flex items-center gap-0.5 text-left text-xs text-brand hover:underline" aria-expanded={expanded}
                                  onClick={() => setOpen(expanded ? null : line.lineId)}>
                                  {expanded ? <ChevronDown className="size-3" aria-hidden="true" /> : <ChevronRight className="size-3" aria-hidden="true" />}Other warehouses ({alternatives.length})
                                </button>
                              )}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">{withUnit(line.remaining, line.unit)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{amount(line.reserved)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{amount(line.onHand)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{amount(line.reservedByOthers)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{amount(line.available)}{Number(line.unusable) > 0 && <span className="block text-xs text-text-muted">{amount(line.unusable)} unusable</span>}</td>
                          <td className="py-2 pr-3 text-right font-medium tabular-nums">{amount(line.shortage)}</td>
                          <td className="py-2"><ResultBadge result={line.result} label={line.result === "not_required" ? line.resultLabel : `${amount(Math.min(Number(line.remaining ?? 0), Number(line.reserved) + Number(line.reservable ?? 0)))} / ${amount(line.remaining)} ${line.resultLabel}`} /></td>
                        </tr>
                        {expanded && (
                          <tr className="border-b border-border bg-surface-muted">
                            <td colSpan={9} className="px-3 py-2">
                              <ul className="flex flex-col gap-1">
                                {alternatives.map((alternative) => (
                                  <li key={alternative.warehouseId} className="flex flex-wrap items-center gap-3">
                                    <span className="min-w-32">{alternative.warehouseName}</span>
                                    <span className="tabular-nums">{withUnit(alternative.available, line.unit)} available</span>
                                    {canChangeWarehouse && <Button variant="ghost" size="compact" onPress={() => setMoving({ line, to: alternative })}>Ship from {alternative.warehouseName}</Button>}
                                  </li>
                                ))}
                              </ul>
                              <p className="mt-1 text-xs text-text-muted">Stock is never moved between warehouses from here; a transfer is an Inventory operation.</p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {otherLines.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {otherLines.map((line) => <li key={line.lineId} className="flex items-center gap-3"><span className="min-w-48">{line.itemName}</span><ResultBadge result={line.result} label={line.resultLabel} /></li>)}
            </ul>
          )}
        </>
      )}
      {moving && <ChangeWarehouseDialog orderId={orderId} line={moving.line} to={moving.to} onClose={() => setMoving(null)} onDone={() => { setMoving(null); onChanged(); }} />}
    </SalesPanel>
  );
}

function ChangeWarehouseDialog({ orderId, line, to, onClose, onDone }: { orderId: string; line: LineAvailability; to: AlternativeWarehouse; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => changeLineWarehouse(orderId, line.lineId, { warehouseId: to.warehouseId, reason: reason.trim() || undefined }), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={`Ship ${line.itemName} from ${to.warehouseName}?`}
      description={`The line will ship from ${to.warehouseName} instead of ${line.warehouseName ?? "its current warehouse"}. Stock reserved for it in ${line.warehouseName ?? "the old warehouse"} is released; reserve again afterwards.`}>
      <div className="flex flex-col gap-3">
        {save.isError && <SalesAlert>{failureText(save.error, "The warehouse could not be changed.")}</SalesAlert>}
        <TextField label="Reason" value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Change Warehouse</Button>
        </div>
      </div>
    </Dialog>
  );
}
