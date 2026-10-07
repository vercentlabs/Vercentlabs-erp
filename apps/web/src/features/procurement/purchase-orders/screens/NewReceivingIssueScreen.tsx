"use client";

// Report a receiving issue: goods refused at the dock (before custody — against the purchase order only, no goods receipt is created) or
// goods rejected after they were received (after custody — against the posted goods receipt). The source chosen here only prefills; the
// server checks what may be refused or rejected.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { ErrorState, PageHeader, Select } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { ProcPanel } from "@/features/procurement/shared/ProcUi";

import { getGoodsReceipt, getPurchaseOrder, listGoodsReceipts, listPurchaseOrders } from "../api/purchase-orders-api";
import { DockRejectionDialog, ReceiptRejectionDialog } from "./RejectionScreens";

export function NewReceivingIssueScreen({ purchaseOrderId, goodsReceiptId }: { purchaseOrderId?: string; goodsReceiptId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [stage, setStage] = useState(goodsReceiptId ? "after_custody" : "before_custody");
  const [orderId, setOrderId] = useState(purchaseOrderId ?? "");
  const [receiptId, setReceiptId] = useState(goodsReceiptId ?? "");
  const orders = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "issue-orders"), queryFn: () => listPurchaseOrders({ view: "confirmed", limit: 200 }), enabled: stage === "before_custody" });
  const receipts = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "issue-receipts"), queryFn: () => listGoodsReceipts({ view: "posted" }), enabled: stage === "after_custody" });
  const order = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "purchase-order", orderId), queryFn: () => getPurchaseOrder(orderId), enabled: stage === "before_custody" && Boolean(orderId) });
  const receipt = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "goods-receipt", receiptId), queryFn: () => getGoodsReceipt(receiptId), enabled: stage === "after_custody" && Boolean(receiptId) });
  const done = () => router.push("/procurement/goods-receipts?view=receiving-issues");
  const back = () => router.push("/procurement/goods-receipts?view=receiving-issues");
  return (
    <div className="flex flex-col gap-4">
      <Link href="/procurement/goods-receipts?view=receiving-issues" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"><ArrowLeft className="size-3.5" aria-hidden="true" />Receiving issues</Link>
      <PageHeader title="Report Receiving Issue" description="A refusal at the dock is recorded against the purchase order and creates no goods receipt; a rejection after receipt is recorded against the posted goods receipt. Neither moves stock twice." />
      <ProcPanel title="What happened">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Custody stage" selectedKey={stage} onSelectionChange={(value) => setStage(String(value))}
            options={[{ value: "before_custody", label: "Refused at the dock (before custody)" }, { value: "after_custody", label: "Rejected after receipt (after custody)" }]} />
          {stage === "before_custody" ? (
            <Select label="Purchase order" selectedKey={orderId || null} onSelectionChange={(value) => setOrderId(String(value))} isDisabled={orders.isLoading}
              options={(orders.data?.rows ?? []).map((row) => ({ value: row.id, label: `${row.purchaseOrderNumber} · ${row.supplierName}` }))} />
          ) : (
            <Select label="Goods receipt" selectedKey={receiptId || null} onSelectionChange={(value) => setReceiptId(String(value))} isDisabled={receipts.isLoading}
              options={(receipts.data ?? []).map((row) => ({ value: row.id, label: `${row.receiptNumber} · ${row.supplierName} · ${row.purchaseOrderNumber}` }))} />
          )}
        </div>
      </ProcPanel>
      {(order.isLoading || receipt.isLoading) && <LoadingState label="Loading the document" />}
      {(order.isError || receipt.isError) && <ErrorState title="Could not load the document" description={((order.error ?? receipt.error) as Error | null)?.message} />}
      {stage === "before_custody" && order.data && <DockRejectionDialog orderId={order.data.order.id} lines={order.data.lines} onClose={back} onDone={done} />}
      {stage === "after_custody" && receipt.data && <ReceiptRejectionDialog detail={receipt.data} onClose={back} onDone={done} />}
    </div>
  );
}
