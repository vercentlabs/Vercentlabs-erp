"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { BillingApiError, getOverview, syncNow } from "../api/billing-api";
import { BillingDetailsForm } from "../components/BillingDetailsForm";
import { BillingHealthPanel } from "../components/BillingHealthPanel";
import { BillingNotice } from "../components/BillingPanel";
import { CurrentPlanPanel } from "../components/CurrentPlanPanel";
import { PaymentHistory } from "../components/PaymentHistory";
import { PlansPanel } from "../components/PlansPanel";

const QUERY_KEY = ["settings", "billing"];

export type BillingAbilities = { canView: boolean; canManage: boolean; canCheckout: boolean; canAudit: boolean };
type Report = { tone: "success" | "info" | "warning" | "danger"; text: string };

export function BillingScreen({ abilities }: { abilities: BillingAbilities }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getOverview,
    enabled: abilities.canView,
    // While a payment is being verified or a change confirmed, keep the page current.
    refetchInterval: (current) => {
      const data = current.state.data;
      return data && (data.checkout?.phase === "verifying" || data.pendingSeatChange || data.subscription.cancellationPending) ? 5_000 : false;
    },
  });
  const [report, setReport] = useState<Report | null>(null);
  const onResult = (next: Report) => {
    setReport(next);
    void queryClient.invalidateQueries({ queryKey: ["settings", "billing"] });
  };
  const refresh = useMutation({
    mutationFn: syncNow,
    onSuccess: () => onResult({ tone: "info", text: "Status refreshed from the payment provider." }),
    onError: (error) => onResult({ tone: "danger", text: error instanceof Error ? error.message : "Status could not be refreshed." }),
  });

  if (!abilities.canView) {
    return <PermissionState title="You don't have access to Billing" description="Ask an administrator for access to view billing." />;
  }
  if (query.isLoading) return <p className="text-sm text-text-secondary">Loading…</p>;
  if (query.isError || !query.data) {
    if (query.error instanceof BillingApiError && query.error.status === 403) {
      return <PermissionState title="You don't have access to Billing" description="Ask an administrator for access to view billing." />;
    }
    return <ErrorState title="Could not load billing" description="Something went wrong." action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }
  const overview = query.data;
  const canRefresh = abilities.canManage && (overview.subscription.hasProviderSubscription || overview.checkout?.phase === "verifying");

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Billing and plan"
        description="Your plan, users and payments."
        primaryAction={
          canRefresh ? (
            <Button variant="secondary" isLoading={refresh.isPending} onPress={() => refresh.mutate()}>
              Refresh status
            </Button>
          ) : undefined
        }
      />
      {report && (
        <BillingNotice tone={report.tone} testId="billing-report">
          {report.text}
        </BillingNotice>
      )}
      {overview.checkout?.phase === "verifying" && <BillingNotice tone="info" testId="verifying-notice">Verifying your payment. This page updates automatically; do not pay again.</BillingNotice>}
      {overview.checkout?.phase === "attention" && (
        <BillingNotice tone="warning">A recent checkout needs a check by Vercentlabs billing support. Please do not pay again; we will contact you.</BillingNotice>
      )}
      <CurrentPlanPanel overview={overview} />
      {abilities.canAudit && <BillingHealthPanel />}
      <PlansPanel overview={overview} canCheckout={abilities.canCheckout} canManage={abilities.canManage} onResult={onResult} />
      {abilities.canManage && <BillingDetailsForm overview={overview} onResult={onResult} />}
      <PaymentHistory overview={overview} />
    </div>
  );
}
