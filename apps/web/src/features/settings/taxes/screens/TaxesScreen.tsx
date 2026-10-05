"use client";

// Settings → Taxes. The tax set-up every module shares: tax categories (what
// a product points at) with their dated rates, the company's GST
// registrations, the organization's tax defaults and the audit trail.
//
// A rate is never edited: "Change rate" ends the current rate the day before
// and starts the new one, so earlier documents keep the rate they were made
// with. Categories and registrations are deactivated, not deleted.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  Button, Dialog, EmptyState, ErrorState, PageHeader, PermissionState, SearchField, Select, StatusBadge, Switch, Tab, TabList, TabPanel, Table, TableBody, TableCell,
  TableHead, TableHeaderCell, TableRow, Tabs, TextArea, TextField,
} from "@vercentlabs/design-system";

import { requestJson } from "@/shared/http/request-json";

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
};
type Payload = {
  options: {
    taxTypes: Choice[]; treatments: Choice[]; appliesTo: Choice[]; states: Array<{ code: string; name: string }>;
    settings: { countryCode: string | null; taxEnabled: boolean; defaultTaxCategoryId: string | null };
    capabilities: Record<"manageCategories" | "manageRates" | "manageRegistrations" | "viewAudit", boolean>;
  };
  categories: TaxCategory[];
  registrations: Registration[];
};
type HistoryEntry = { id: string; entityType: string; eventType: string; summary: string; at: string; actorName: string | null };

const ANY = "any";
const API = "/api/settings/taxes";
const failure = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const rateLabel = (category: TaxCategory) =>
  category.rate === null ? "—" : `${category.rate}%${category.cessRate ? ` + CESS ${category.cessRate}%` : ""}`;
const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function TaxesScreen({ canView }: { canView: boolean }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("categories");
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

  if (!canView) return <PermissionState title="You can't view tax configuration" description="Ask an administrator for the View tax configuration permission." />;
  if (query.isLoading) return <p className="text-sm text-text-secondary">Loading…</p>;
  if (query.isError || !query.data)
    return <ErrorState title="Could not load tax configuration" description={failure(query.error, "Try again.")} action={{ label: "Retry", onPress: () => query.refetch() }} />;

  const { options, categories, registrations } = query.data;
  const can = options.capabilities;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Taxes" description="Tax categories, rates and company registrations used by Sales, POS, Procurement and Finance. A product points at a tax category; the rate in force on the document date is charged." />
      {error && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {!options.settings.taxEnabled && <p className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm text-warning">Tax is switched off: no document is taxed. Turn it on under Defaults.</p>}
      <Tabs selectedKey={tab} onSelectionChange={(selected) => setTab(String(selected))}>
        <TabList aria-label="Tax configuration">
          <Tab id="categories">Tax categories</Tab>
          <Tab id="registrations">Company registrations</Tab>
          <Tab id="defaults">Defaults</Tab>
          {can.viewAudit && <Tab id="history">History</Tab>}
        </TabList>

        <TabPanel id="categories">
          <div className="flex flex-col gap-3 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <SearchField aria-label="Search tax categories" placeholder="Search code or name" className="w-full sm:w-72" value={search} onChange={setSearch} />
              <Select aria-label="Status" size="compact" selectedKey={status} onSelectionChange={(value) => setStatus(String(value))}
                options={[{ value: ANY, label: "Active and inactive" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
              <Select aria-label="Treatment" size="compact" selectedKey={treatment} onSelectionChange={(value) => setTreatment(String(value))}
                options={[{ value: ANY, label: "Any treatment" }, ...options.treatments.map((entry) => ({ value: entry.code, label: entry.label }))]} />
              <Select aria-label="Rate" size="compact" selectedKey={rate} onSelectionChange={(value) => setRate(String(value))}
                options={[{ value: ANY, label: "Any rate" }, ...(rate !== ANY && !rates.includes(Number(rate)) ? [Number(rate)] : []).concat(rates).map((value) => ({ value: String(value), label: `${value}%` }))]} />
              <span className="flex-1" />
              {can.manageCategories && <Button variant="primary" onPress={() => setDialog({ kind: "category", category: null })}><Plus className="size-4" aria-hidden="true" />New tax category</Button>}
            </div>
            {categories.length === 0 ? <EmptyState title="No tax categories match" description="Change the filters, or add a tax category." /> : (
              <Table aria-label="Tax categories">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Code</TableHeaderCell><TableHeaderCell>Name</TableHeaderCell><TableHeaderCell>Treatment</TableHeaderCell><TableHeaderCell>Rate</TableHeaderCell>
                    <TableHeaderCell>How it is charged</TableHeaderCell><TableHeaderCell>For</TableHeaderCell><TableHeaderCell>Products</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell> </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {categories.map((category) => (
                    <TableRow key={category.id}>
                      <TableCell><span className="font-medium tabular-nums">{category.code}</span></TableCell>
                      <TableCell>{category.name}{category.reverseCharge ? " · reverse charge" : ""}</TableCell>
                      <TableCell>{category.treatmentLabel}</TableCell>
                      <TableCell>
                        <span className="flex flex-col tabular-nums">
                          {rateLabel(category)}
                          {category.effectiveFrom && <span className="text-xs text-text-muted">from {category.effectiveFrom}</span>}
                          {category.nextRate && <span className="text-xs text-warning">{category.nextRate.rate}% from {category.nextRate.effectiveFrom}</span>}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-col text-xs text-text-secondary">
                          {category.components.length ? category.components.map((entry) => <span key={entry.when}>{entry.when}: {entry.parts.join(" + ")}</span>) : "No tax charged"}
                        </span>
                      </TableCell>
                      <TableCell>{category.appliesToLabel}</TableCell>
                      <TableCell><span className="tabular-nums">{category.productCount}</span></TableCell>
                      <TableCell><StatusBadge tone={category.isActive ? "success" : "neutral"}>{category.isActive ? "Active" : "Inactive"}</StatusBadge></TableCell>
                      <TableCell>
                        <span className="flex flex-wrap justify-end gap-1">
                          {can.manageRates && category.isActive && category.treatment === "taxable" && category.taxType !== "none" && (
                            <Button variant="secondary" size="compact" onPress={() => setDialog({ kind: "rate", category })}>Change rate</Button>
                          )}
                          {can.manageCategories && <Button variant="ghost" size="compact" onPress={() => setDialog({ kind: "category", category })}>Edit</Button>}
                          {can.manageCategories && (
                            <Button variant="ghost" size="compact" isLoading={setCategoryStatus.isPending && setCategoryStatus.variables?.id === category.id}
                              onPress={() => setCategoryStatus.mutate({ id: category.id, active: !category.isActive })}>{category.isActive ? "Deactivate" : "Activate"}</Button>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabPanel>

        <TabPanel id="registrations">
          <div className="flex flex-col gap-3 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-text-secondary">The company&apos;s GST registrations, one per state it sells from. A document is issued by one of them; its state and the place of supply decide CGST + SGST or IGST.</p>
              {can.manageRegistrations && <Button variant="primary" onPress={() => setDialog({ kind: "registration", registration: null })}><Plus className="size-4" aria-hidden="true" />Add registration</Button>}
            </div>
            {registrations.length === 0 ? <EmptyState title="No company registration yet" description="Add the company's GST registration so GST can be calculated on documents." /> : (
              <Table aria-label="Company tax registrations">
                <TableHead>
                  <TableRow><TableHeaderCell>Code</TableHeaderCell><TableHeaderCell>Name</TableHeaderCell><TableHeaderCell>GSTIN</TableHeaderCell><TableHeaderCell>State</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell> </TableHeaderCell></TableRow>
                </TableHead>
                <TableBody>
                  {registrations.map((registration) => (
                    <TableRow key={registration.id}>
                      <TableCell><span className="font-medium">{registration.code}</span></TableCell>
                      <TableCell>{registration.name}{registration.legalName && registration.legalName !== registration.name ? ` · ${registration.legalName}` : ""}</TableCell>
                      <TableCell><span className="tabular-nums">{registration.registrationNumber ?? "—"}</span></TableCell>
                      <TableCell>{registration.stateName ? `${registration.stateName} (${registration.stateCode})` : registration.stateCode ?? "—"}</TableCell>
                      <TableCell>
                        <span className="flex flex-wrap gap-1">
                          <StatusBadge tone={registration.isActive ? "success" : "neutral"}>{registration.isActive ? "Active" : "Inactive"}</StatusBadge>
                          {registration.isDefault && <StatusBadge tone="info">Default</StatusBadge>}
                        </span>
                      </TableCell>
                      <TableCell>
                        {can.manageRegistrations && (
                          <span className="flex flex-wrap justify-end gap-1">
                            <Button variant="ghost" size="compact" onPress={() => setDialog({ kind: "registration", registration })}>Edit</Button>
                            {registration.isActive && !registration.isDefault && <Button variant="ghost" size="compact" onPress={() => updateRegistration.mutate({ id: registration.id, isDefault: true })}>Make default</Button>}
                            <Button variant="ghost" size="compact" onPress={() => updateRegistration.mutate({ id: registration.id, isActive: !registration.isActive })}>{registration.isActive ? "Deactivate" : "Activate"}</Button>
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabPanel>

        <TabPanel id="defaults"><Defaults payload={query.data} onSaved={refresh} /></TabPanel>
        {can.viewAudit && <TabPanel id="history"><History active={tab === "history"} /></TabPanel>}
      </Tabs>

      {dialog?.kind === "category" && <CategoryDialog options={options} category={dialog.category} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); }} />}
      {dialog?.kind === "rate" && <RateDialog category={dialog.category} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); }} />}
      {dialog?.kind === "registration" && <RegistrationDialog options={options} registration={dialog.registration} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); }} />}
    </div>
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
        {save.isError && <p role="alert" className="text-sm text-danger">{failure(save.error, "The tax category could not be saved.")}</p>}
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
        {save.isError && <p role="alert" className="text-sm text-danger">{failure(save.error, "The rate could not be changed.")}</p>}
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
  const json = { code, name, legalName: legalName || null, registrationNumber: gstin || null, stateCode: stateCode || null, addressLine1: addressLine1 || null, city: city || null, postalCode: postalCode || null };
  const save = useMutation({
    mutationFn: () => registration ? requestJson(`${API}/registrations/${registration.id}`, { method: "PATCH", json }) : requestJson(`${API}/registrations`, { method: "POST", json }),
    onSuccess: onSaved,
  });
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={registration ? `Edit ${registration.name}` : "Add a company registration"} size="lg"
      description="The GSTIN and state the company issues documents from. The first two digits of a GSTIN are its state code.">
      <div className="flex flex-col gap-3">
        {save.isError && <p role="alert" className="text-sm text-danger">{failure(save.error, "The registration could not be saved.")}</p>}
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
    <div className="flex max-w-2xl flex-col gap-4 pt-4">
      {save.isError && <p role="alert" className="text-sm text-danger">{failure(save.error, "The defaults could not be saved.")}</p>}
      <Switch isSelected={taxEnabled} onChange={(value) => { setSaved(false); setTaxEnabled(value); }} isDisabled={!canManage}>Charge tax on documents</Switch>
      <p className="text-sm text-text-secondary">Switch this off only if the business charges no tax at all. Documents are then calculated without tax and need no place of supply.</p>
      <Select label="Default tax category" description="Used for a product that has no tax category of its own."
        options={[{ value: "", label: "None: a product without a tax category is not taxed" }, ...categories.filter((category) => category.isActive).map((category) => ({ value: category.id, label: `${category.name} (${category.code})` }))]}
        selectedKey={defaultCategory} onSelectionChange={(value) => { setSaved(false); setDefaultCategory(String(value ?? "")); }} isDisabled={!canManage} />
      <p className="text-sm text-text-secondary">Whether prices include tax is set on each price list. Amounts are rounded per line to the currency&apos;s decimals; a document&apos;s tax is the sum of its lines.</p>
      {canManage && <div className="flex items-center gap-3"><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save defaults</Button>{saved && <span className="text-sm text-success">Saved</span>}</div>}
    </div>
  );
}

function History({ active }: { active: boolean }) {
  const query = useQuery({ queryKey: ["settings", "taxes", "history"], queryFn: () => requestJson<{ history: HistoryEntry[] }>(`${API}/history`), enabled: active });
  if (query.isLoading) return <p className="pt-4 text-sm text-text-secondary">Loading…</p>;
  if (query.isError) return <p role="alert" className="pt-4 text-sm text-danger">{failure(query.error, "The history could not be loaded.")}</p>;
  const history = query.data?.history ?? [];
  if (!history.length) return <div className="pt-4"><EmptyState title="No changes yet" description="Changes to tax categories, rates, registrations and defaults are listed here." /></div>;
  return (
    <ol className="flex flex-col divide-y divide-border pt-4 text-sm">
      {history.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-0.5 py-2">
          <span className="font-medium">{entry.summary}</span>
          <span className="text-xs text-text-muted">{when.format(new Date(entry.at))}{entry.actorName ? ` · ${entry.actorName}` : ""}</span>
        </li>
      ))}
    </ol>
  );
}
