"use client";

// Settings → Finance & Commercial → Exchange Rates: the dated rates that convert another currency into the base currency. Totals across
// deals in different currencies (pipeline, dashboards, reports) use the latest active rate on or before each deal's date; a currency with
// no rate is left out of those totals. Setting a day's rate again replaces it; rates are deactivated, never deleted.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, ErrorState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { ExchangeRateApiError, errorMessage, listExchangeRates, setExchangeRate, setExchangeRateStatus, type ExchangeRate } from "../api/exchange-rates-api";

const VIEWS = [{ id: "active", label: "Active" }, { id: "inactive", label: "Inactive" }, { id: "all", label: "All Rates" }];
const day = (value: string | null | undefined) => (value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const today = () => new Date().toLocaleDateString("en-CA");

export function ExchangeRatesScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [view, setView] = useState("active");
  const [adding, setAdding] = useState<{ fromCurrencyCode?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "settings", "exchange-rates", view), queryFn: () => listExchangeRates(view) });
  const refresh = () => { setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "settings", "exchange-rates") }); };
  const status = useMutation({
    mutationFn: ({ id, next }: { id: string; next: "active" | "inactive" }) => setExchangeRateStatus(id, next),
    onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)),
  });
  const data = query.data;
  const rows = data?.rates ?? [];
  const missing = (data?.currencies ?? []).filter((currency) => currency.currentRate === null);
  const canManage = data?.can.manage ?? false;
  const columns = useMemo<ColumnDef<ExchangeRate, unknown>[]>(() => [
    { id: "currency", header: "Currency", cell: ({ row }) => <span className="font-medium">{row.original.fromCurrencyCode}{row.original.fromCurrencyName && <span className="ml-1 font-normal text-text-secondary">{row.original.fromCurrencyName}</span>}</span> },
    { id: "rate", header: "Rate", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">1 {row.original.fromCurrencyCode} = {row.original.rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} {row.original.toCurrencyCode}</span> },
    { id: "from", header: "Applies from", cell: ({ row }) => <span className="whitespace-nowrap">{day(row.original.rateDate)}</span> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.status === "active" ? "success" : "neutral"}>{row.original.status === "active" ? "Active" : "Inactive"}</StatusBadge> },
    { id: "updated", header: "Updated", cell: ({ row }) => <span className="whitespace-nowrap text-text-secondary">{day(row.original.updatedAt)}{row.original.updatedByName ? ` · ${row.original.updatedByName}` : ""}</span> },
    { id: "actions", header: "", cell: ({ row }) => canManage ? (
      <span className="flex justify-end">
        <Button size="compact" variant="ghost" isDisabled={status.isPending} onPress={() => status.mutate({ id: row.original.id, next: row.original.status === "active" ? "inactive" : "active" })}>
          {row.original.status === "active" ? "Deactivate" : "Activate"}</Button>
      </span>
    ) : null },
  ], [canManage, status]);
  return (
    <EnterpriseListPage header={{ title: "Exchange Rates",
      description: `Rates into ${data?.baseCurrency ?? "the base currency"}. Totals across deals in different currencies use the latest active rate on or before each deal's date; a currency with no rate is left out of those totals.`,
      primaryAction: data?.can.manage ? <Button variant="primary" onPress={() => setAdding({})}><Plus className="size-4" aria-hidden="true" />Set Rate</Button> : undefined }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: setView }}>
      {error && <Notice>{error}</Notice>}
      {missing.length > 0 && (
        <Notice tone="warning">
          No rate yet for {missing.map((currency) => currency.code).join(", ")}: amounts in {missing.length === 1 ? "this currency" : "these currencies"} are left out of totals.
          {data?.can.manage && <Button className="ml-2" size="compact" variant="outline" onPress={() => setAdding({ fromCurrencyCode: missing[0].code })}>Set a rate</Button>}
        </Notice>
      )}
      <EnterpriseDataGrid<ExchangeRate> aria-label="Exchange rates" columns={columns} data={rows} getRowId={(row) => row.id}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<LoadingState label="Loading exchange rates" rows={6} />}
        errorContent={<ErrorState title="Could not load exchange rates" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
        emptyContent={<p className="p-6 text-sm text-text-secondary">No {view === "all" ? "" : `${view} `}exchange rates yet.</p>} />
      {adding && data && (
        <RateDialog baseCurrency={data.baseCurrency} currencies={data.currencies} initialCurrency={adding.fromCurrencyCode}
          onClose={() => setAdding(null)} onSaved={() => { setAdding(null); refresh(); }} />
      )}
    </EnterpriseListPage>
  );
}

function RateDialog({ baseCurrency, currencies, initialCurrency, onClose, onSaved }: {
  baseCurrency: string; currencies: Array<{ code: string; name: string; currentRate: number | null }>; initialCurrency?: string; onClose: () => void; onSaved: () => void;
}) {
  const [currency, setCurrency] = useState(initialCurrency ?? currencies[0]?.code ?? "");
  const [rateDate, setRateDate] = useState(today());
  const [rate, setRate] = useState("");
  const save = useMutation({ mutationFn: () => setExchangeRate({ fromCurrencyCode: currency, rateDate, rate }), onSuccess: onSaved });
  const field = save.error instanceof ExchangeRateApiError ? save.error.field : undefined;
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title="Set exchange rate">
      <div className="flex flex-col gap-3">
        {currencies.length === 0 && <Notice tone="info">Add another currency first: only {baseCurrency} is active.</Notice>}
        <Select label="Currency" selectedKey={currency || null} onSelectionChange={(key) => setCurrency(String(key))}
          options={currencies.map((entry) => ({ value: entry.code, label: `${entry.code} · ${entry.name}` }))} isInvalid={field === "fromCurrencyCode"} />
        <TextField label={`Rate (1 ${currency || "unit"} in ${baseCurrency})`} inputMode="decimal" value={rate} onChange={setRate}
          isInvalid={field === "rate"} errorMessage={field === "rate" ? errorMessage(save.error) : undefined} />
        <TextField label="Applies from" type="date" value={rateDate} onChange={setRateDate}
          description="Used for deals valued on or after this date, until a later rate." isInvalid={field === "rateDate"} />
        {save.error && !field && <Notice>{errorMessage(save.error)}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!currency || !rate || !rateDate} onPress={() => save.mutate()}>Save rate</Button>
        </div>
      </div>
    </Dialog>
  );
}
