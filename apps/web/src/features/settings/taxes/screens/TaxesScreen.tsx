"use client";

// Settings → Taxes. The tax set-up every module shares: tax categories (what
// a product points at) with their dated rates, the company's GST
// registrations, the organization's tax defaults and the audit trail.
//
// A rate is never edited: "Change rate" ends the current rate the day before
// and starts the new one, so earlier documents keep the rate they were made
// with. Categories and registrations are deactivated, not deleted.
//
// Built like every other module's lists (CRM's style): the tabs are links (?tab=), each list a toolbar card over a data grid, the rest panels.
import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  Button, Dialog, EmptyState, EnterpriseDataGrid, ErrorState, NoResultsState, PageHeader, PermissionState, SearchField, Select, StatusBadge, Switch, TextArea, TextField,
} from "@vercentlabs/design-system";

import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { requestJson } from "@/shared/http/request-json";
import { ListToolbar, filterBarOf } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { RouteTabs } from "@/shared/ui/RouteTabs";

import { TAX_TABS, type TaxTab } from "../tabs";

type Choice = { code: string; label: string };
type TaxCategory = {
  id: string; code: string; name: string; description: string | null; taxType: string; taxTypeLabel: string; treatment: string; treatmentLabel: string;
  appliesTo: string; appliesToLabel: string; reverseCharge: boolean; isActive: boolean; rate: number | null; cessRate: number; effectiveFrom: string | null;
  components: Array<{ when: string; parts: string[] }>; nextRate: { rate: number; cessRate: number; effectiveFrom: string } | null; productCount: number;
  rates?: Array<{ id: string; rate: number; cessRate: number; effectiveFrom: string; effectiveTo: string | null; isActive: boolean; createdByName: string | null }>;
};
type Registration = {
  id: string; code: string; name: string; legalName: string | null; registrationNumber: string | null; stateCode: string | null; stateName: string | null;
  addressLine1: string | null; city: string | null; postalCode: string | null; isDefault: boolean; isActive: boolean;
  registrationType: string; validFrom: string | null; validUntil: string | null;
};
type ValidationIssue = { severity: "error" | "warning"; code: string; message: string };
type Validation = { checkedAt: string; today: string; ok: boolean; errors: number; warnings: number; issues: ValidationIssue[] };
type Preview = {
  classification: string; placeOfSupply: string | null; placeOfSupplyName: string | null; supplyNature: string | null; taxableAmount: string; taxAmount: string; total: string;
  components: Array<{ type: string; label: string; rate: string; taxAmount: string }>;
};
type Payload = {
  options: {
    taxTypes: Choice[]; treatments: Choice[]; appliesTo: Choice[]; states: Array<{ code: string; name: string }>; registrationTypes?: Choice[];
    settings: { countryCode: string | null; taxEnabled: boolean; defaultTaxCategoryId: string | null };
    capabilities: Record<"manageCategories" | "manageRates" | "manageRegistrations" | "viewAudit", boolean>;
  };
  categories: TaxCategory[];
  registrations: Registration[];
};
type HistoryEntry = { id: string; entityType: string; eventType: string; summary: string; at: string; actorName: string | null };

const ANY = "any";
const API = "/api/settings/taxes";
const BASE = "/settings/taxes";
const STATUS_LABEL: Record<string, string> = { active: "Active", inactive: "Inactive" };
const failure = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const rateLabel = (category: TaxCategory) =>
  category.rate === null ? "—" : `${category.rate}%${category.cessRate ? ` + CESS ${category.cessRate}%` : ""}`;
const stateLabel = (registration: Registration) => (registration.stateName ? `${registration.stateName} (${registration.stateCode})` : registration.stateCode ?? "—");
const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function TaxesScreen({ canView, tab = "categories" }: { canView: boolean; tab?: TaxTab }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [status, setStatus] = useState("active");
  const [treatment, setTreatment] = useState(ANY);
  const [rate, setRate] = useState(ANY);
  const [dialog, setDialog] = useState<{ kind: "category"; category: TaxCategory | null } | { kind: "rate"; category: TaxCategory } | { kind: "registration"; registration: Registration | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSubmitted(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams();
  if (submitted) params.set("search", submitted);
  if (status !== ANY) params.set("status", status);
  if (treatment !== ANY) params.set("treatment", treatment);
  if (rate !== ANY) params.set("rate", rate);
  const key = ["settings", "taxes", params.toString()];
  const query = useQuery({ queryKey: key, queryFn: () => requestJson<Payload>(`${API}?${params}`), enabled: canView, placeholderData: (previous) => previous });
  const refresh = () => { setError(null); void queryClient.invalidateQueries({ queryKey: ["settings", "taxes"] }); };
  const setCategoryStatus = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => requestJson(`${API}/categories/${id}/status`, { method: "POST", json: { active } }),
    onSuccess: refresh, onError: (failed) => setError(failure(failed, "The tax category could not be changed.")),
  });
  const updateRegistration = useMutation({
    mutationFn: ({ id, ...json }: { id: string; isDefault?: boolean; isActive?: boolean }) => requestJson(`${API}/registrations/${id}`, { method: "PATCH", json }),
    onSuccess: refresh, onError: (failed) => setError(failure(failed, "The registration could not be changed.")),
  });
  const rates = useMemo(() => [...new Set((query.data?.categories ?? []).map((category) => category.rate).filter((value): value is number => value !== null))].sort((a, b) => a - b), [query.data]);
  const options = query.data?.options;
  const can = options?.capabilities;

  const categoryColumns = useMemo<ColumnDef<TaxCategory, unknown>[]>(() => [
    { id: "code", header: "Code", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.code}</span> },
    { id: "name", header: "Name", cell: ({ row }) => <span>{row.original.name}{row.original.reverseCharge ? <span className="text-text-muted"> · reverse charge</span> : null}</span> },
    { id: "treatment", header: "Treatment", cell: ({ row }) => row.original.treatmentLabel },
    { id: "rate", header: "Rate", cell: ({ row }) => (
      <span className="flex flex-col tabular-nums">
        {rateLabel(row.original)}
        {row.original.effectiveFrom && <span className="text-xs text-text-muted">from {row.original.effectiveFrom}</span>}
        {row.original.nextRate && <span className="text-xs text-warning">{row.original.nextRate.rate}% from {row.original.nextRate.effectiveFrom}</span>}
      </span>
    ) },
    { id: "charged", header: "How it is charged", cell: ({ row }) => (
      <span className="flex flex-col text-xs text-text-secondary">
        {row.original.components.length ? row.original.components.map((entry) => <span key={entry.when}>{entry.when}: {entry.parts.join(" + ")}</span>) : "No tax charged"}
      </span>
    ) },
    { id: "for", header: "For", cell: ({ row }) => row.original.appliesToLabel },
    { id: "products", header: "Products", cell: ({ row }) => <span className="tabular-nums">{row.original.productCount}</span> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.isActive ? "success" : "neutral"}>{row.original.isActive ? "Active" : "Inactive"}</StatusBadge> },
  ], []);
  const registrationColumns = useMemo<ColumnDef<Registration, unknown>[]>(() => [
    { id: "code", header: "Code", cell: ({ row }) => <span className="font-medium">{row.original.code}</span> },
    { id: "name", header: "Name", cell: ({ row }) => (
      <span className="flex flex-col">
        {row.original.name}
        {row.original.legalName && row.original.legalName !== row.original.name && <span className="text-xs text-text-muted">{row.original.legalName}</span>}
      </span>
    ) },
    { id: "gstin", header: "GSTIN", cell: ({ row }) => row.original.registrationNumber ? <span className="tabular-nums">{row.original.registrationNumber}</span> : <span className="text-text-muted">Not entered</span> },
    { id: "state", header: "State", cell: ({ row }) => stateLabel(row.original) },
    { id: "status", header: "Status", cell: ({ row }) => (
      <span className="flex flex-wrap items-center gap-1">
        <StatusBadge tone={row.original.isActive ? "success" : "neutral"}>{row.original.isActive ? "Active" : "Inactive"}</StatusBadge>
        {row.original.isDefault && <StatusBadge tone="info">Default</StatusBadge>}
        {row.original.registrationType !== "regular" && (
          <StatusBadge tone="warning">{options?.registrationTypes?.find((type) => type.code === row.original.registrationType)?.label ?? row.original.registrationType}</StatusBadge>
        )}
        {(row.original.validFrom || row.original.validUntil) && <span className="text-xs text-text-muted">{row.original.validFrom ?? "…"} – {row.original.validUntil ?? "open"}</span>}
      </span>
    ) },
  ], [options]);

  if (!canView) return <PermissionState title="You can't view tax configuration" description="Ask an administrator for the View tax configuration permission." />;
  if (query.isError && !query.data)
    return <ErrorState title="Could not load tax configuration" description={failure(query.error, "Try again.")} action={{ label: "Try again", onPress: () => void query.refetch() }} />;

  const categories = query.data?.categories ?? [];
  const registrations = query.data?.registrations ?? [];
  const tabs = TAX_TABS.filter((entry) => entry.id !== "history" || can?.viewAudit !== false);
  const categoryActions = (category: TaxCategory) => [
    ...(can?.manageRates && category.isActive && category.treatment === "taxable" && category.taxType !== "none" ? [{ id: "rate", label: "Change rate", onAction: () => setDialog({ kind: "rate", category }) }] : []),
    ...(can?.manageCategories ? [
      { id: "edit", label: "Edit", onAction: () => setDialog({ kind: "category", category }) },
      { id: "status", label: category.isActive ? "Deactivate" : "Activate", isDisabled: setCategoryStatus.isPending, onAction: () => setCategoryStatus.mutate({ id: category.id, active: !category.isActive }) },
    ] : []),
  ];
  const registrationActions = (registration: Registration) => can?.manageRegistrations ? [
    { id: "edit", label: "Edit", onAction: () => setDialog({ kind: "registration", registration }) },
    ...(registration.isActive && !registration.isDefault ? [{ id: "default", label: "Make default", onAction: () => updateRegistration.mutate({ id: registration.id, isDefault: true }) }] : []),
    { id: "status", label: registration.isActive ? "Deactivate" : "Activate", onAction: () => updateRegistration.mutate({ id: registration.id, isActive: !registration.isActive }) },
  ] : [];
  const filterBar = filterBarOf([
    { id: "status", active: status !== ANY, label: `Status: ${STATUS_LABEL[status] ?? status}`, clear: () => setStatus(ANY) },
    { id: "treatment", active: treatment !== ANY, label: `Treatment: ${options?.treatments.find((entry) => entry.code === treatment)?.label ?? treatment}`, clear: () => setTreatment(ANY) },
    { id: "rate", active: rate !== ANY, label: `Rate: ${rate}%`, clear: () => setRate(ANY) },
  ]);
  const gridState = (count: number, filtered: boolean) =>
    (query.isLoading ? "loading" : query.isError ? "error" : count === 0 ? (filtered ? "no-results" : "empty") : "ready") as "loading" | "error" | "no-results" | "empty" | "ready";

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Taxes" description="Tax categories, rates and company registrations used by Sales, POS, Procurement and Finance. A product points at a tax category; the rate in force on the document date is charged." />
      <div className="flex flex-col gap-3">
        <RouteTabs label="Tax configuration" base={BASE} tabs={tabs} current={tab} />
        {error && <Notice>{error}</Notice>}
        {options && !options.settings.taxEnabled && <Notice tone="warning">Tax is switched off: no document is taxed. Turn it on under Defaults.</Notice>}

        {tab === "categories" && (
          <>
            <ListToolbar
              actionBar={{
                start: (
                  <>
                    <SearchField aria-label="Search tax categories" placeholder="Search code or name" className="w-full sm:w-72" value={search} onChange={setSearch} />
                    <Select aria-label="Status" size="compact" selectedKey={status} onSelectionChange={(value) => setStatus(String(value))}
                      options={[{ value: ANY, label: "Active and inactive" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
                    <Select aria-label="Treatment" size="compact" selectedKey={treatment} onSelectionChange={(value) => setTreatment(String(value))}
                      options={[{ value: ANY, label: "Any treatment" }, ...(options?.treatments ?? []).map((entry) => ({ value: entry.code, label: entry.label }))]} />
                    <Select aria-label="Rate" size="compact" selectedKey={rate} onSelectionChange={(value) => setRate(String(value))}
                      options={[{ value: ANY, label: "Any rate" }, ...(rate !== ANY && !rates.includes(Number(rate)) ? [Number(rate)] : []).concat(rates).map((value) => ({ value: String(value), label: `${value}%` }))]} />
                  </>
                ),
                end: can?.manageCategories && <Button variant="primary" onPress={() => setDialog({ kind: "category", category: null })}><Plus className="size-4" aria-hidden="true" />New tax category</Button>,
              }}
              filterBar={filterBar}
            />
            <EnterpriseDataGrid<TaxCategory>
              aria-label="Tax categories"
              columns={categoryColumns}
              data={categories}
              getRowId={(row) => row.id}
              state={gridState(categories.length, Boolean(submitted) || Boolean(filterBar))}
              loadingContent={<LoadingState label="Loading tax categories" rows={6} />}
              errorContent={<ErrorState title="Could not load tax categories" description={failure(query.error, "Try again.")} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
              emptyContent={<EmptyState title="No tax categories yet" description="Add the categories products point at, such as GST 18%." />}
              noResultsContent={<NoResultsState title="No tax categories match" description="Try a different search or filter." />}
              rowActions={(row) => <RowActions items={categoryActions(row)} label={`Actions for ${row.code}`} />}
              renderMobileCard={(row) => (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">{row.code} · {row.name}</span>
                    <span className="text-sm tabular-nums text-text-secondary">{rateLabel(row)} · {row.treatmentLabel}</span>
                    <span className="text-xs text-text-muted">{row.isActive ? "Active" : "Inactive"} · {row.productCount} {row.productCount === 1 ? "product" : "products"}</span>
                  </div>
                  <div className="shrink-0" onClick={(event) => event.stopPropagation()}><MoreMenu label={`Actions for ${row.code}`} items={categoryActions(row)} /></div>
                </div>
              )}
            />
          </>
        )}

        {tab === "registrations" && (
          <>
            <ListToolbar
              actionBar={{
                start: <p className="text-sm text-text-secondary">One GST registration per state the company sells from. Its state and the place of supply decide CGST + SGST or IGST.</p>,
                end: can?.manageRegistrations && <Button variant="primary" onPress={() => setDialog({ kind: "registration", registration: null })}><Plus className="size-4" aria-hidden="true" />Add registration</Button>,
              }}
            />
            <EnterpriseDataGrid<Registration>
              aria-label="Company tax registrations"
              columns={registrationColumns}
              data={registrations}
              getRowId={(row) => row.id}
              state={gridState(registrations.length, false)}
              loadingContent={<LoadingState label="Loading registrations" rows={3} />}
              errorContent={<ErrorState title="Could not load registrations" description={failure(query.error, "Try again.")} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
              emptyContent={<EmptyState title="No company registration yet" description="Add the company's GST registration so GST can be calculated on documents and POS sales."
                action={can?.manageRegistrations ? { label: "Add registration", onPress: () => setDialog({ kind: "registration", registration: null }) } : undefined} />}
              rowActions={(row) => <RowActions items={registrationActions(row)} label={`Actions for ${row.code}`} />}
              renderMobileCard={(row) => (
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium">{row.code} · {row.name}</span>
                    <span className="text-sm text-text-secondary">{stateLabel(row)}{row.registrationNumber ? ` · ${row.registrationNumber}` : ""}</span>
                    <span className="text-xs text-text-muted">{row.isActive ? "Active" : "Inactive"}{row.isDefault ? " · Default" : ""}</span>
                  </div>
                  <div className="shrink-0" onClick={(event) => event.stopPropagation()}><MoreMenu label={`Actions for ${row.code}`} items={registrationActions(row)} /></div>
                </div>
              )}
            />
          </>
        )}

        {tab === "defaults" && (query.data ? <Defaults payload={query.data} onSaved={refresh} /> : <LoadingState label="Loading defaults" rows={3} />)}
        {tab === "check" && (query.data ? <SetupCheck payload={query.data} /> : <LoadingState label="Loading" rows={3} />)}
        {tab === "history" && can?.viewAudit !== false && <History />}
      </div>

      {options && dialog?.kind === "category" && <CategoryDialog options={options} category={dialog.category} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); }} />}
      {dialog?.kind === "rate" && <RateDialog category={dialog.category} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); }} />}
      {options && dialog?.kind === "registration" && <RegistrationDialog options={options} registration={dialog.registration} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); }} />}
    </div>
  );
}

// A row's actions in the grid, as CRM's settings lists show them: the first one or two as buttons, any others in a menu.
function RowActions({ items, label }: { items: Array<{ id: string; label: string; isDisabled?: boolean; onAction: () => void }>; label: string }) {
  if (!items.length) return null;
  const shown = items.length > 2 ? items.slice(0, 1) : items;
  const rest = items.length > 2 ? items.slice(1) : [];
  return (
    <span className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
      {shown.map((item) => <Button key={item.id} variant="ghost" size="compact" isDisabled={item.isDisabled} onPress={item.onAction}>{item.label}</Button>)}
      {rest.length > 0 && <MoreMenu label={label} items={rest} />}
    </span>
  );
}

function Footer({ onClose, label, isLoading, isDisabled, onPress }: { onClose: () => void; label: string; isLoading: boolean; isDisabled?: boolean; onPress: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onPress={onClose}>Close</Button>
      <Button variant="primary" isLoading={isLoading} isDisabled={isDisabled} onPress={onPress}>{label}</Button>
    </div>
  );
}
const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value));
const digits = (value: string) => value.replace(/[^0-9.]/g, "");

function CategoryDialog({ options, category, onClose, onSaved }: { options: Payload["options"]; category: TaxCategory | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(category?.code ?? "");
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [taxType, setTaxType] = useState(category?.taxType ?? (options.settings.countryCode === "IN" ? "gst" : "vat"));
  const [treatment, setTreatment] = useState(category?.treatment ?? "taxable");
  const [appliesTo, setAppliesTo] = useState(category?.appliesTo ?? "all");
  const [reverseCharge, setReverseCharge] = useState(category?.reverseCharge ?? false);
  const [rate, setRate] = useState("");
  const [cessRate, setCessRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const charges = treatment === "taxable" && taxType !== "none";
  const used = Boolean(category && category.productCount > 0);
  const save = useMutation({
    mutationFn: () => category
      ? requestJson(`${API}/categories/${category.id}`, { method: "PATCH", json: { name, description: description || null, appliesTo, reverseCharge, ...(used ? {} : { code, taxType, treatment }) } })
      : requestJson(`${API}/categories`, { method: "POST", json: { code, name, description: description || null, taxType, treatment, appliesTo, reverseCharge,
          ...(charges ? { rate: numberOrNull(rate), cessRate: numberOrNull(cessRate), effectiveFrom: effectiveFrom || null } : {}) } }),
    onSuccess: onSaved,
  });
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={category ? `Edit ${category.code}` : "New tax category"} size="lg"
      description={category ? "The rate is changed with Change rate. The code, tax type and treatment can change only while no product uses the category." : "What products and services point at. GST is split into CGST + SGST or IGST automatically."}>
      <div className="flex flex-col gap-3">
        {save.isError && <Notice>{failure(save.error, "The tax category could not be saved.")}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Code" description="A stable code, such as GST-18." isRequired value={code} onChange={(value) => setCode(value.toUpperCase())} isDisabled={used} />
          <TextField label="Name" isRequired value={name} onChange={setName} />
          <Select label="Tax type" options={options.taxTypes.map((entry) => ({ value: entry.code, label: entry.label }))} selectedKey={taxType} onSelectionChange={(value) => setTaxType(String(value))} isDisabled={used} />
          <Select label="Treatment" description="Zero rated, exempt and non-taxable all charge nothing but are reported differently."
            options={options.treatments.map((entry) => ({ value: entry.code, label: entry.label }))} selectedKey={treatment} onSelectionChange={(value) => setTreatment(String(value))} isDisabled={used} />
          <Select label="For" options={options.appliesTo.map((entry) => ({ value: entry.code, label: entry.label }))} selectedKey={appliesTo} onSelectionChange={(value) => setAppliesTo(String(value))} />
          <Switch isSelected={reverseCharge} onChange={setReverseCharge}>Reverse charge applies</Switch>
          {!category && charges && (
            <>
              <TextField label="Rate (%)" isRequired inputMode="decimal" value={rate} onChange={(value) => setRate(digits(value))} />
              <TextField label="CESS (%)" description="Optional, charged on top." inputMode="decimal" value={cessRate} onChange={(value) => setCessRate(digits(value))} />
              <TextField label="Effective from" type="date" description="Leave empty to apply to all dates." value={effectiveFrom} onChange={setEffectiveFrom} />
            </>
          )}
        </div>
        <TextArea label="Description" value={description} onChange={setDescription} />
        <Footer onClose={onClose} label={category ? "Save" : "Create tax category"} isLoading={save.isPending} isDisabled={!code.trim() || !name.trim() || (!category && charges && rate.trim() === "")} onPress={() => save.mutate()} />
      </div>
    </Dialog>
  );
}

function RateDialog({ category, onClose, onSaved }: { category: TaxCategory; onClose: () => void; onSaved: () => void }) {
  const [rate, setRate] = useState("");
  const [cessRate, setCessRate] = useState(category.cessRate ? String(category.cessRate) : "");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const detail = useQuery({ queryKey: ["settings", "taxes", "category", category.id], queryFn: () => requestJson<{ category: TaxCategory }>(`${API}/categories/${category.id}`) });
  const save = useMutation({
    mutationFn: () => requestJson(`${API}/categories/${category.id}/rate`, { method: "POST", json: { rate: Number(rate), cessRate: numberOrNull(cessRate), effectiveFrom } }),
    onSuccess: onSaved,
  });
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={`Change the rate of ${category.code}`} size="lg"
      description={`The current rate (${rateLabel(category)}) ends the day before the new one starts. Documents dated earlier keep the old rate; existing documents never change.`}>
      <div className="flex flex-col gap-3">
        {save.isError && <Notice>{failure(save.error, "The rate could not be changed.")}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField label="New rate (%)" isRequired inputMode="decimal" value={rate} onChange={(value) => setRate(digits(value))} />
          <TextField label="CESS (%)" inputMode="decimal" value={cessRate} onChange={(value) => setCessRate(digits(value))} />
          <TextField label="Effective from" type="date" isRequired value={effectiveFrom} onChange={setEffectiveFrom} />
        </div>
        {detail.data?.category.rates && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-text-muted">Rate history</span>
            {detail.data.category.rates.map((entry) => (
              <span key={entry.id} className={`tabular-nums ${entry.isActive ? "" : "text-text-muted line-through"}`}>
                {entry.rate}%{entry.cessRate ? ` + CESS ${entry.cessRate}%` : ""} · from {entry.effectiveFrom}{entry.effectiveTo ? ` to ${entry.effectiveTo}` : ""}{entry.createdByName ? ` · ${entry.createdByName}` : ""}
              </span>
            ))}
          </div>
        )}
        <Footer onClose={onClose} label="Change rate" isLoading={save.isPending} isDisabled={rate.trim() === "" || !effectiveFrom} onPress={() => save.mutate()} />
      </div>
    </Dialog>
  );
}

function RegistrationDialog({ options, registration, onClose, onSaved }: { options: Payload["options"]; registration: Registration | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(registration?.code ?? "");
  const [name, setName] = useState(registration?.name ?? "");
  const [legalName, setLegalName] = useState(registration?.legalName ?? "");
  const [gstin, setGstin] = useState(registration?.registrationNumber ?? "");
  const [stateCode, setStateCode] = useState(registration?.stateCode ?? "");
  const [addressLine1, setAddressLine1] = useState(registration?.addressLine1 ?? "");
  const [city, setCity] = useState(registration?.city ?? "");
  const [postalCode, setPostalCode] = useState(registration?.postalCode ?? "");
  const [registrationType, setRegistrationType] = useState(registration?.registrationType ?? "regular");
  const [validFrom, setValidFrom] = useState(registration?.validFrom ?? "");
  const [validUntil, setValidUntil] = useState(registration?.validUntil ?? "");
  const json = { code, name, legalName: legalName || null, registrationNumber: gstin || null, stateCode: stateCode || null, addressLine1: addressLine1 || null, city: city || null, postalCode: postalCode || null,
    registrationType, validFrom: validFrom || null, validUntil: validUntil || null };
  const save = useMutation({
    mutationFn: () => registration ? requestJson(`${API}/registrations/${registration.id}`, { method: "PATCH", json }) : requestJson(`${API}/registrations`, { method: "POST", json }),
    onSuccess: onSaved,
  });
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={registration ? `Edit ${registration.name}` : "Add a company registration"} size="lg"
      description="The GSTIN and state the company issues documents from. The first two digits of a GSTIN are its state code.">
      <div className="flex flex-col gap-3">
        {save.isError && <Notice>{failure(save.error, "The registration could not be saved.")}</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Code" description="Short, such as MH." isRequired value={code} onChange={(value) => setCode(value.toUpperCase())} />
          <TextField label="Name" description="Such as Maharashtra or Head office." isRequired value={name} onChange={setName} />
          <TextField label="GSTIN" value={gstin} onChange={(value) => { const next = value.toUpperCase().replace(/\s/g, ""); setGstin(next); if (/^[0-9]{2}/.test(next) && options.states.some((state) => state.code === next.slice(0, 2))) setStateCode(next.slice(0, 2)); }} />
          <Select label="State" isRequired options={options.states.map((state) => ({ value: state.code, label: `${state.name} (${state.code})` }))} selectedKey={stateCode || null}
            onSelectionChange={(value) => setStateCode(String(value ?? ""))} placeholder="Choose the state" />
          <TextField label="Legal name" description="As printed on documents, if different." value={legalName} onChange={setLegalName} />
          <TextField label="Address" value={addressLine1} onChange={setAddressLine1} />
          <TextField label="City" value={city} onChange={setCity} />
          <TextField label="PIN code" value={postalCode} onChange={setPostalCode} />
          <Select label="Registration type" description="Only a regular registration bills GST at POS." options={(options.registrationTypes ?? [{ code: "regular", label: "Regular" }]).map((type) => ({ value: type.code, label: type.label }))}
            selectedKey={registrationType} onSelectionChange={(value) => setRegistrationType(String(value ?? "regular"))} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Valid from" type="date" value={validFrom} onChange={setValidFrom} />
            <TextField label="Valid until" type="date" value={validUntil} onChange={setValidUntil} />
          </div>
        </div>
        <Footer onClose={onClose} label={registration ? "Save" : "Add registration"} isLoading={save.isPending} isDisabled={!code.trim() || !name.trim() || !stateCode} onPress={() => save.mutate()} />
      </div>
    </Dialog>
  );
}

function Defaults({ payload, onSaved }: { payload: Payload; onSaved: () => void }) {
  const { options, categories } = payload;
  const [taxEnabled, setTaxEnabled] = useState(options.settings.taxEnabled);
  const [defaultCategory, setDefaultCategory] = useState(options.settings.defaultTaxCategoryId ?? "");
  const [saved, setSaved] = useState(false);
  const canManage = options.capabilities.manageRegistrations;
  const save = useMutation({
    mutationFn: () => requestJson(`${API}/defaults`, { method: "PUT", json: { taxEnabled, defaultTaxCategoryId: defaultCategory || null } }),
    onSuccess: () => { setSaved(true); onSaved(); },
  });
  return (
    <Panel title="Tax on documents" description="Applies to every module: Sales, POS, Procurement and Finance." className="max-w-3xl">
      {save.isError && <Notice>{failure(save.error, "The defaults could not be saved.")}</Notice>}
      <Switch isSelected={taxEnabled} onChange={(value) => { setSaved(false); setTaxEnabled(value); }} isDisabled={!canManage}>Charge tax on documents</Switch>
      <p className="text-sm text-text-secondary">Switch this off only if the business charges no tax at all. Documents are then calculated without tax and need no place of supply.</p>
      <Select label="Default tax category" description="Used for a product that has no tax category of its own."
        options={[{ value: "", label: "None: a product needs its own tax category to be sold" }, ...categories.filter((category) => category.isActive).map((category) => ({ value: category.id, label: `${category.name} (${category.code})` }))]}
        selectedKey={defaultCategory} onSelectionChange={(value) => { setSaved(false); setDefaultCategory(String(value ?? "")); }} isDisabled={!canManage} />
      <p className="text-sm text-text-secondary">Whether prices include tax is set on each price list. Amounts are rounded per line to the currency&apos;s decimals; a document&apos;s tax is the sum of its lines.</p>
      {canManage && <div className="flex items-center gap-3"><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save defaults</Button>{saved && <span className="text-sm text-success">Saved</span>}</div>}
    </Panel>
  );
}

// What in the set-up would stop a sale or make its tax wrong, and a sample calculation through the same engine every document uses.
function SetupCheck({ payload }: { payload: Payload }) {
  const query = useQuery({ queryKey: ["settings", "taxes", "validation"], queryFn: () => requestJson<{ validation: Validation }>(`${API}/validation`).then((response) => response.validation) });
  const validation = query.data;
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Setup check" description="Registrations, outlets, rates in force today and every sellable product's tax category and HSN / SAC."
        actions={<Button variant="secondary" size="compact" isLoading={query.isFetching} onPress={() => void query.refetch()}>Check again</Button>}>
        {query.isLoading ? <LoadingState label="Checking the tax set-up" rows={3} />
          : query.isError || !validation ? <Notice>{failure(query.error, "The check could not run.")}</Notice>
            : validation.issues.length === 0 ? (
              <Notice tone="success">Everything checks out: sales can be taxed correctly.</Notice>
            ) : (
              <ul className="flex flex-col gap-2">
                {validation.issues.map((issue, index) => (
                  <li key={index} className={`flex items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-sm ${issue.severity === "error" ? "border-danger/30 bg-danger-soft text-danger" : "border-warning-emphasis/30 bg-warning-soft text-warning"}`}>
                    <StatusBadge tone={issue.severity === "error" ? "danger" : "warning"}>{issue.severity === "error" ? "Blocks sales" : "Check"}</StatusBadge>
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            )}
      </Panel>
      <PreviewCalculator payload={payload} />
    </div>
  );
}

function PreviewCalculator({ payload }: { payload: Payload }) {
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("1000");
  const [inclusive, setInclusive] = useState(false);
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const preview = useMutation({
    mutationFn: () => requestJson<{ preview: Preview }>(`${API}/preview`, { method: "POST", json: { taxCategoryId: categoryId, amount, priceIncludesTax: inclusive, placeOfSupply: placeOfSupply || null } })
      .then((response) => response.preview),
  });
  const result = preview.data;
  return (
    <Panel title="Try a calculation" description="Runs one amount through the shared tax engine, exactly as a document would. Nothing is saved." className="max-w-3xl">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select label="Tax category" options={payload.categories.filter((category) => category.isActive).map((category) => ({ value: category.id, label: `${category.name} (${category.code})` }))}
          selectedKey={categoryId || null} onSelectionChange={(value) => setCategoryId(String(value ?? ""))} placeholder="Choose a category" />
        <TextField label="Amount" inputMode="decimal" value={amount} onChange={setAmount} />
        <Select label="Place of supply" options={[{ value: "", label: "The registration's own state" }, ...payload.options.states.map((state) => ({ value: state.code, label: `${state.name} (${state.code})` }))]}
          selectedKey={placeOfSupply} onSelectionChange={(value) => setPlaceOfSupply(String(value ?? ""))} />
        <div className="flex items-end pb-2"><Switch isSelected={inclusive} onChange={setInclusive}>The amount includes tax</Switch></div>
      </div>
      <div><Button variant="secondary" isDisabled={!categoryId || !amount.trim()} isLoading={preview.isPending} onPress={() => preview.mutate()}>Calculate</Button></div>
      {preview.isError && <Notice>{failure(preview.error, "The calculation failed.")}</Notice>}
      {result && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-[var(--radius-control)] border border-border p-3 text-sm">
          <dt className="text-text-secondary">Treatment</dt><dd>{result.classification.replace(/_/g, " ")}{result.supplyNature ? ` · ${result.supplyNature.replace(/_/g, "-")}` : ""}</dd>
          <dt className="text-text-secondary">Taxable value</dt><dd className="tabular-nums">{result.taxableAmount}</dd>
          {result.components.map((component) => (
            <Fragment key={component.type}><dt className="text-text-secondary">{component.label} {Number(component.rate)}%</dt><dd className="tabular-nums">{component.taxAmount}</dd></Fragment>
          ))}
          <dt className="text-text-secondary">Tax</dt><dd className="tabular-nums">{result.taxAmount}</dd>
          <dt className="font-medium">Total</dt><dd className="font-medium tabular-nums">{result.total}</dd>
        </dl>
      )}
    </Panel>
  );
}

function History() {
  const query = useQuery({ queryKey: ["settings", "taxes", "history"], queryFn: () => requestJson<{ history: HistoryEntry[] }>(`${API}/history`) });
  if (query.isLoading) return <LoadingState label="Loading the history" rows={5} />;
  if (query.isError) return <ErrorState title="Could not load the history" description={failure(query.error, "Try again.")} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const history = query.data?.history ?? [];
  if (!history.length) return <EmptyState title="No changes yet" description="Changes to tax categories, rates, registrations and defaults are listed here." />;
  return (
    <Panel title="Changes" description="Every change to tax categories, rates, registrations and defaults, newest first.">
    <ol className="flex flex-col divide-y divide-border text-sm">
      {history.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-0.5 py-2">
          <span className="font-medium">{entry.summary}</span>
          <span className="text-xs text-text-muted">{when.format(new Date(entry.at))}{entry.actorName ? ` · ${entry.actorName}` : ""}</span>
        </li>
      ))}
    </ol>
    </Panel>
  );
}
