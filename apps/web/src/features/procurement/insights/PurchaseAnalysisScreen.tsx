"use client";

// Procurement › Reports › Purchase analysis (report Phase 3): what suppliers billed, grouped by any one or two of supplier, item, category,
// buyer, supplier's state and month, with totals each way and an Excel copy (the pivot is shared/ui/PivotAnalysis).
import { PermissionState } from "@vercentlabs/design-system";

import { PivotAnalysis, type PivotResult } from "@/shared/ui/PivotAnalysis";
import { ProcApiError, request } from "@/features/procurement/shared/http";
import { money } from "@/features/procurement/shared/format";

const DIMENSIONS = [
  { value: "supplier", label: "Supplier" }, { value: "item", label: "Item" }, { value: "category", label: "Category" }, { value: "buyer", label: "Buyer" },
  { value: "state", label: "Supplier's state" }, { value: "month", label: "Month" },
];
const MEASURES = [{ value: "amount", label: "Billed (taxable value)" }, { value: "quantity", label: "Quantity" }, { value: "bills", label: "Bills" }];
const load = (params: URLSearchParams) => request<{ analysis: PivotResult }>(`/purchase-analysis?${params}`).then((result) => result.analysis);

export function PurchaseAnalysisScreen() {
  return (
    <PivotAnalysis title="Purchase analysis" description="What suppliers billed, grouped the way you choose. Credit notes are taken off." queryKey={["procurement", "purchase-analysis"]}
      dimensions={DIMENSIONS} measures={MEASURES} initialRows="supplier" load={load} downloadUrl={(params) => `/api/procurement/purchase-analysis?${params}&format=xlsx`}
      empty={{ title: "Nothing billed in these dates", description: "Choose other dates." }} format={(value) => money("INR", String(value))}
      failed={(error) => (error instanceof ProcApiError && error.status === 403
        ? <PermissionState title="You don't have access to purchase reports" description="Ask an administrator for a buyer or accounts role." /> : null)} />
  );
}
