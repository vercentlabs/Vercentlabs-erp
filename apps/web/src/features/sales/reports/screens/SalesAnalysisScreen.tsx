"use client";

// Sales › Reports › Analysis (Sales report Phase 3): what was billed, grouped by any one or two of customer, product, salesperson, beat,
// state and month, with totals each way and an Excel copy (the pivot is shared/ui/PivotAnalysis).
import { PermissionState } from "@vercentlabs/design-system";

import { PivotAnalysis, type PivotResult } from "@/shared/ui/PivotAnalysis";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { SalesApiError, request } from "@/features/sales/shared/http";
import { money } from "@/features/sales/shared/format";

const DIMENSIONS = [
  { value: "customer", label: "Customer" }, { value: "product", label: "Product" }, { value: "salesperson", label: "Salesperson" }, { value: "beat", label: "Beat" },
  { value: "state", label: "State" }, { value: "month", label: "Month" },
];
const MEASURES = [{ value: "amount", label: "Billed (taxable value)" }, { value: "quantity", label: "Quantity" }, { value: "invoices", label: "Invoices" }];
const load = (params: URLSearchParams) => request<{ analysis: PivotResult }>(`/analysis?${params}`).then((result) => result.analysis);

export function SalesAnalysisScreen() {
  const workspace = useWorkspaceContext();
  return (
    <PivotAnalysis title="Sales analysis" description="What was billed, grouped the way you choose. Credit notes are taken off." queryKey={scopedQueryKey(workspace, "sales", "analysis")}
      dimensions={DIMENSIONS} measures={MEASURES} initialRows="customer" load={load} downloadUrl={(params) => `/api/sales/analysis?${params}&format=xlsx`}
      empty={{ title: "Nothing billed in these dates", description: "Choose other dates." }} format={(value) => money("INR", value)}
      failed={(error) => (error instanceof SalesApiError && error.status === 403
        ? <PermissionState title="You don't have access to Sales reports" description="Ask an administrator for the Sales reports permission." /> : null)} />
  );
}
