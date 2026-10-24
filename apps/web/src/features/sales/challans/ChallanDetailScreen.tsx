"use client";

// A delivery challan: the goods and their value, the consignee, the vehicle; issue it to print (three copies) and make its e-way bill.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, ErrorState, LinkButton, PageHeader, StatusBadge, TextArea } from "@vercentlabs/design-system";

import { Facts, Panel } from "@/shared/ui/Panel";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError } from "@/features/sales/shared/http";
import { money } from "@/features/sales/shared/format";

import { challanPdfUrl, getChallan, setChallanStatus } from "./challans-api";

const TONE = { draft: "neutral", issued: "success", cancelled: "danger" } as const;

export function ChallanDetailScreen({ challanId }: { challanId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "sales", "challan", challanId);
  const query = useQuery({ queryKey: key, queryFn: () => getChallan(challanId) });
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const change = useMutation({
    mutationFn: ({ action, why }: { action: "issue" | "cancel"; why?: string }) => setChallanStatus(challanId, action, why),
    onSuccess: () => { setCancelling(false); void queryClient.invalidateQueries({ queryKey: key }); },
  });
  const manage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.delivery.dispatch");
  if (query.isLoading) return <LoadingState label="Loading the challan" rows={5} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load this challan" action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const challan = query.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={challan.challanNumber} description={`${challan.purposeLabel} · ${challan.challanDate}`}
        primaryAction={manage && challan.status === "draft" ? <Button variant="primary" isLoading={change.isPending} onPress={() => change.mutate({ action: "issue" })}>Issue</Button> : undefined}
        secondaryActions={(
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={TONE[challan.status]}>{challan.statusLabel}</StatusBadge>
            {challan.status !== "cancelled" && <LinkButton variant="secondary" href={challanPdfUrl(challan.id)} download>PDF</LinkButton>}
            {challan.status === "issued" && <LinkButton variant="secondary" href={`${challanPdfUrl(challan.id, true)}&copies=3`} target="_blank">Print 3 copies</LinkButton>}
            {manage && challan.status !== "cancelled" && <Button variant="ghost" onPress={() => setCancelling(true)}>Cancel challan</Button>}
          </span>
        )} />
      {change.isError && !cancelling && <p role="alert" className="text-sm text-danger">{change.error instanceof SalesApiError ? change.error.message : "That could not be done."}</p>}
      <Panel title="Details">
        <Facts items={[
          { label: "Ship to", value: challan.customer.displayName ?? "Own branch" },
          { label: "GSTIN", value: challan.customer.gstin ?? "—" },
          { label: "Deliver to", value: [challan.shipTo.line1, challan.shipTo.city, challan.shipTo.state].filter(Boolean).join(", ") || "—" },
          { label: "Sales order", value: challan.salesOrderId ? <Link className="hover:underline" href={`/sales/orders/${challan.salesOrderId}`}>{challan.salesOrderNumber}</Link> : "—" },
          { label: "Vehicle", value: challan.vehicleNumber ?? "—" },
          { label: "Value of goods", value: money("INR", challan.totalValue) },
          ...(challan.cancelReason ? [{ label: "Cancelled because", value: challan.cancelReason }] : []),
        ]} />
      </Panel>
      <Panel title="Goods">
        <ul className="flex flex-col divide-y divide-border text-sm">
          {(challan.lines ?? []).map((line) => (
            <li key={line.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>{line.description}{line.hsnSacCode ? <span className="text-xs text-text-muted"> · HSN {line.hsnSacCode}</span> : null}</span>
              <span className="tabular-nums">{line.quantity} {line.unit ?? ""} × {money("INR", line.unitValue)} = {money("INR", line.value)}</span>
            </li>
          ))}
        </ul>
      </Panel>
      {cancelling && (
        <Dialog isOpen onOpenChange={(open) => !open && setCancelling(false)} title={`Cancel ${challan.challanNumber}`} size="sm">
          <div className="flex flex-col gap-4">
            {change.isError && <p role="alert" className="text-sm text-danger">{change.error instanceof SalesApiError ? change.error.message : "The challan could not be cancelled."}</p>}
            <TextArea label="Why" isRequired value={reason} onChange={setReason} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setCancelling(false)}>Keep it</Button>
              <Button variant="danger" isLoading={change.isPending} isDisabled={reason.trim().length < 5} onPress={() => change.mutate({ action: "cancel", why: reason.trim() })}>Cancel challan</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
