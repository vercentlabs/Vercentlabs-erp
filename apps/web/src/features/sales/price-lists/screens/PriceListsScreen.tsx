"use client";

// Sales → Price Lists: every list with its currency, tax mode, validity,
// number of products, default flag and status.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Badge, EmptyState, ErrorState, PageHeader, PermissionState, SearchField, Select, Button } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorCode, listPriceLists, type PriceList } from "../api/price-lists-api";
import { PriceListFormDialog } from "../components/PriceListDialogs";

const ANY = "any";
export const validity = (list: Pick<PriceList, "validFrom" | "validTo">) =>
  list.validFrom || list.validTo ? [list.validFrom ? `from ${formatDate(list.validFrom)}` : null, list.validTo ? `until ${formatDate(list.validTo)}` : null].filter(Boolean).join(" ") : "Always";

export function PriceListsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ANY);
  const [currency, setCurrency] = useState(ANY);
  const [creating, setCreating] = useState(false);
  const filters = { search: search.trim() || undefined, status: status === ANY ? undefined : status, currencyCode: currency === ANY ? undefined : currency };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "price-lists", filters), queryFn: () => listPriceLists(filters) });
  if (query.isError && errorCode(query.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to price lists" description="Ask an administrator for access." />;
  const data = query.data;
  const can = data?.capabilities;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Price Lists" description="The prices quotations and orders start from. A customer uses its own price list, else the default list for the document's currency."
        primaryAction={can?.create ? <Button variant="primary" onPress={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />New price list</Button> : undefined} />
      <div className="flex flex-wrap gap-2">
        <SearchField aria-label="Search price lists" placeholder="Search code or name" className="w-full sm:w-72" value={search} onChange={setSearch} />
        <Select aria-label="Status" size="compact" selectedKey={status} onSelectionChange={(key) => setStatus(String(key))} options={[{ value: ANY, label: "Any status" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
        {data && <Select aria-label="Currency" size="compact" selectedKey={currency} onSelectionChange={(key) => setCurrency(String(key))} options={[{ value: ANY, label: "Any currency" }, ...data.currencies.map((entry) => ({ value: entry.code, label: entry.code }))]} />}
      </div>
      {query.isLoading ? <LoadingState label="Loading price lists" rows={5} />
        : query.isError || !data ? <ErrorState title="Could not load price lists" action={{ label: "Try again", onPress: () => void query.refetch() }} />
        : data.priceLists.length === 0 ? <EmptyState title="No price lists yet" description="Create a list such as Standard India, add prices, and quotations will price from it." />
        : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-text-secondary">
                <tr>{["Code", "Name", "Currency", "Tax mode", "Validity", "Products", "Customers", "Default", "Status"].map((heading) => <th key={heading} scope="col" className="px-3 py-2 font-medium">{heading}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.priceLists.map((list) => (
                  <tr key={list.id} className="cursor-pointer hover:bg-surface-muted" onClick={() => router.push(`/sales/price-lists/${list.id}`)}>
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{list.code}</td>
                    <td className="px-3 py-2">{list.name}</td>
                    <td className="px-3 py-2">{list.currencyCode}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{list.taxModeLabel}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{validity(list)}{list.isActive && !list.isCurrent ? <span className="text-xs text-warning"> · not valid today</span> : null}</td>
                    <td className="px-3 py-2 tabular-nums">{list.productCount}</td>
                    <td className="px-3 py-2 tabular-nums">{list.customerCount}</td>
                    <td className="px-3 py-2">{list.isDefault ? <Badge tone="info">Default {list.currencyCode}</Badge> : ""}</td>
                    <td className="px-3 py-2"><Badge tone={list.isActive ? "success" : "neutral"}>{list.isActive ? "Active" : "Inactive"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {creating && data && (
        <PriceListFormDialog mode="new" currencies={data.currencies} capabilities={data.capabilities} onClose={() => setCreating(false)}
          onSaved={(list) => { setCreating(false); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "price-lists") }); router.push(`/sales/price-lists/${list.id}`); }} />
      )}
    </div>
  );
}
