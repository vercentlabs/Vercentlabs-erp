"use client";

// A rate contract: its products, rates and how much each has drawn; activate a draft, close an active one.
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader, ProgressBar, StatusBadge } from "@vercentlabs/design-system";

import { Facts, Panel } from "@/shared/ui/Panel";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { post, request, SalesApiError } from "@/features/sales/shared/http";
import { money } from "@/features/sales/shared/format";

import { TONE, type RateContract } from "./RateContractsScreen";

export function RateContractDetailScreen({ contractId }: { contractId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "sales", "rate-contract", contractId);
  const query = useQuery({ queryKey: key, queryFn: () => request<{ contract: RateContract }>(`/rate-contracts/${contractId}`).then((r) => r.contract) });
  const change = useMutation({
    mutationFn: (action: "activate" | "close" | "cancel") => post(`/rate-contracts/${contractId}`, { action }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
  const manage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("sales.price_lists.manage_prices");
  if (query.isLoading) return <LoadingState label="Loading the contract" rows={5} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load this contract" action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const contract = query.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${contract.contractNumber} · ${contract.name}`} description={`${contract.validFrom} to ${contract.validTo}`}
        primaryAction={manage && contract.status === "draft" ? <Button variant="primary" isLoading={change.isPending} onPress={() => change.mutate("activate")}>Activate</Button> : undefined}
        secondaryActions={(
          <span className="flex items-center gap-2">
            <StatusBadge tone={TONE[contract.status]}>{contract.statusLabel}</StatusBadge>
            {manage && contract.status === "active" && <Button variant="ghost" onPress={() => change.mutate("close")}>Close contract</Button>}
            {manage && contract.status === "draft" && <Button variant="ghost" onPress={() => change.mutate("cancel")}>Cancel draft</Button>}
          </span>
        )} />
      {change.isError && <p role="alert" className="text-sm text-danger">{change.error instanceof SalesApiError ? change.error.message : "That could not be done."}</p>}
      <Panel title="Contract">
        <Facts items={[
          { label: "Customer", value: <Link className="hover:underline" href={`/sales/customers/${contract.partyId}`}>{contract.customerName}</Link> },
          { label: "Currency", value: contract.currencyCode },
          { label: "Customer's reference", value: contract.customerReference ?? "—" },
        ]} />
      </Panel>
      <Panel title="Products" description="Orders for the customer draw on these at the agreed rate while quantity remains; beyond it, the price list applies.">
        <ul className="flex flex-col divide-y divide-border text-sm">
          {(contract.lines ?? []).map((line) => (
            <li key={line.id} className="flex flex-col gap-1 py-2">
              <span className="flex flex-wrap justify-between gap-2"><span className="font-medium">{line.itemName} <span className="text-xs text-text-muted">{line.itemCode}</span></span>
                <span className="tabular-nums">{money(contract.currencyCode, line.rate)} per {line.unit ?? "unit"}</span></span>
              <ProgressBar label={`${line.drawnQuantity} of ${line.contractedQuantity} drawn · ${line.remainingQuantity} left`}
                value={line.contractedQuantity ? Math.min(100, (line.drawnQuantity / line.contractedQuantity) * 100) : 0} />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
