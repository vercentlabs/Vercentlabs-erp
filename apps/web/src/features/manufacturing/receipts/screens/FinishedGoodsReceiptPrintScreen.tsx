"use client";

// The Finished-Goods Receipt Note, A4, printed (or saved as PDF) from the browser. Opening it records one copy (a reprint after the first);
// printing never posts anything. A receipt that is not posted prints as DRAFT (or CANCELLED); a reversed one as REVERSED. Value appears only
// for those who may see cost.
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, PermissionState } from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { receiptAction, type FinishedGoodsReceipt } from "../api/fgr-api";

const cell = "border border-border px-2 py-1 text-left align-top";

export function FinishedGoodsReceiptPrintScreen({ receiptId }: { receiptId: string }) {
  const workspace = useWorkspaceContext();
  // One copy counted per opening of the note (never on a refetch).
  const printed = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "finished-goods-receipt-print", receiptId), queryFn: () => receiptAction(receiptId, "print").then((r) => r.receipt),
    staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false });
  if (printed.isLoading) return <LoadingState label="Preparing the receipt note" rows={5} />;
  if (printed.isError || !printed.data) {
    if (errorStatus(printed.error) === 403) return <PermissionState title="You may not print finished-goods receipts" description="Ask an administrator for the print permission." />;
    return <ErrorState title="Could not prepare the receipt note" description={errorMessage(printed.error)} />;
  }
  return <Note receipt={printed.data} />;
}

function Note({ receipt }: { receipt: FinishedGoodsReceipt }) {
  const workspace = useWorkspaceContext();
  const place = (where: FinishedGoodsReceipt["destination"]) => `${where.warehouse?.code ?? ""} ${where.warehouse?.name ?? ""}${where.location ? ` / ${where.location.code}` : ""}`;
  const tracking = receipt.item.trackingType;
  return (
    <div className="relative mx-auto flex w-full max-w-[210mm] flex-col gap-4 bg-surface p-4 text-sm print:max-w-none print:p-0 print:text-xs">
      {receipt.print.watermark && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-bold text-text-muted opacity-20 [transform:rotate(-24deg)]">{receipt.print.watermark}</div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">{workspace.organizationName ?? ""}</p>
          <h1 className="text-lg font-semibold">Finished-Goods Receipt · {receipt.number}</h1>
          <p className="text-text-muted">{receipt.statusLabel}{receipt.print.count > 1 ? ` · copy ${receipt.print.count}` : ""} · printed {formatDateTime(new Date().toISOString())}</p>
        </div>
        <Button variant="secondary" className="print:hidden" onPress={() => window.print()}>Print</Button>
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {[
            ["Manufacturing order", `${receipt.order.number}${receipt.order.revisionNumber ? ` · BOM rev ${receipt.order.revisionNumber}` : ""}`],
            ["Product", `${receipt.item.code} · ${receipt.item.name}`],
            ["From", `Production · ${place(receipt.source)}`],
            ["Into", place(receipt.destination)],
            ["Receipt date", `${receipt.receiptDate ? formatDate(receipt.receiptDate) : ""}${receipt.postedAt ? ` · posted ${formatDateTime(receipt.postedAt)}` : ""}`],
            ["Posting", receipt.posting ? `${receipt.posting.key} · Inventory ${receipt.posting.inventoryStatus.toLowerCase()} · Finance ${receipt.posting.financeStatus.toLowerCase().replace(/_/g, " ")}` : "Not posted"],
            ...(receipt.approval.status === "APPROVED" ? [["Other warehouse", `Approved by ${receipt.approval.decidedBy} (${receipt.approval.reason})`]] : []),
          ].map(([label, value]) => <tr key={label}><th className={`${cell} w-44 font-medium`}>{label}</th><td className={cell}>{value}</td></tr>)}
        </tbody>
      </table>
      <table className="w-full border-collapse">
        <thead><tr>{["#", "Production entry / batch", "Quantity", ...(tracking === "batch" ? ["Lot"] : tracking === "serial" ? ["Serial numbers"] : []), ...(receipt.can.viewCost ? ["Value"] : [])]
          .map((label) => <th key={label} className={`${cell} font-medium`}>{label}</th>)}</tr></thead>
        <tbody>
          {receipt.lines.map((line) => (
            <tr key={line.id}>
              <td className={cell}>{line.lineNumber}</td>
              <td className={cell}>{line.entryNumber}{line.productionBatch ? ` · ${line.productionBatch}` : ""}</td>
              <td className={cell}>{qty(line.quantity)} {line.uom}{line.uom !== receipt.item.uom ? ` (${qty(line.baseQuantity)} ${receipt.item.uom})` : ""}</td>
              {tracking === "batch" && <td className={cell}>{line.lot?.number ?? line.lotNumber ?? ""}{(line.lot?.expiresOn ?? line.expiresOn) ? ` (exp ${formatDate((line.lot?.expiresOn ?? line.expiresOn)!)})` : ""}</td>}
              {tracking === "serial" && <td className={cell}>{(line.serials.length ? line.serials.map((serial) => serial.number) : line.serialNumbers).join(", ")}</td>}
              {receipt.can.viewCost && <td className={cell}>{line.totalCost ? inr(line.totalCost) : ""}</td>}
            </tr>
          ))}
          <tr><th className={`${cell} font-medium`} colSpan={2}>Total</th><td className={cell}>{qty(receipt.totals.quantity)} {receipt.totals.uom}</td>
            {tracking !== "none" && <td className={cell} />}{receipt.can.viewCost && <td className={cell}>{receipt.totals.cost ? inr(receipt.totals.cost) : ""}</td>}</tr>
        </tbody>
      </table>
      {receipt.notes && <p>Notes: {receipt.notes}</p>}
      <div className="mt-8 grid grid-cols-3 gap-6">
        {[["Handed over by (production)", ""], ["Received by (store)", receipt.postedBy ?? ""], ["Checked by", ""]].map(([label, name]) => (
          <div key={label} className="flex flex-col gap-1"><span className="h-10 border-b border-text-muted">{name}</span><span className="text-xs text-text-muted">{label}</span></div>
        ))}
      </div>
    </div>
  );
}
