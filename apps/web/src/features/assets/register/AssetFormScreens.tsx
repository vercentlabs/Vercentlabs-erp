"use client";

// Assets — adding to the register, in words a non-accountant understands: what it is, how it should be tracked (a fixed asset Finance
// confirms, or tracked equipment), where it came from, where it is and who looks after it. Register from purchase turns the units on one
// purchase line into individual assets. Plus the register's reports. A category's
// rules (serial, tag, location, custodian) show on the form and are checked on the server. Every save runs once (useSubmitKey); a created asset opens in place of the form.
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, LinkButton, PageHeader, PermissionState, Select, Tab, TabList, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { useSubmitKey } from "@/shared/http/submit-once";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  ASSETS_BASE, REGISTER_BASE, assetAction, call, createAsset, errorDetails, errorMessage, errorStatus, getOptions, getReport, money, newKey, qs, registerAction, type OptionCategory, type Source,
} from "./register-api";

// ------------------------------------------------------------------ add one asset
const identificationNote = (c: OptionCategory) => [c.serial_number_policy === "REQUIRED" ? "This category needs a serial number." : c.serial_number_policy === "NOT_APPLICABLE" ? "Assets of this category have no serial number." : "Serial number optional.",
  c.asset_tag_policy === "REQUIRED" ? "An asset tag is required." : ""].filter(Boolean).join(" ");
export function NewAssetScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000 });
  const submit = useSubmitKey();
  const [form, setForm] = useState<Record<string, string>>({ name: "", categoryId: "", tracking: "PENDING", ownership: "owned", origin: "PURCHASE", assetType: "", manufacturer: "", model: "", serialNumber: "", tagCode: "",
    purchaseDate: "", receivedDate: "", supplierId: "", locationId: "", departmentId: "", custodianUserId: "", condition: "NEW", warrantyProvider: "", warrantyStartDate: "", warrantyEndDate: "", openingCost: "", reason: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const o = options.data;
  const category = o?.categories.find((c) => c.id === form.categoryId);
  const save = async (registerNow: boolean) => {
    setBusy(true); setError(null);
    const optional = (k: string) => (form[k] ? form[k] : undefined);
    try {
      const made = await submit.run(() => createAsset({
        name: form.name, categoryId: form.categoryId, capitalizationClass: form.tracking, ownership: form.ownership, acquisitionMethod: form.origin === "PURCHASE" ? "PURCHASE" : form.origin === "OPENING_BALANCE" ? "OPENING_BALANCE" : "OTHER",
        assetType: optional("assetType"), manufacturer: optional("manufacturer"), model: optional("model"), serialNumber: optional("serialNumber"), tagCode: optional("tagCode"), purchaseDate: optional("purchaseDate"),
        receivedDate: optional("receivedDate"), supplierId: optional("supplierId"), locationId: optional("locationId"), departmentId: optional("departmentId"), custodianUserId: optional("custodianUserId"),
        condition: optional("condition"), warrantyProvider: optional("warrantyProvider"), warrantyStartDate: optional("warrantyStartDate"), warrantyEndDate: optional("warrantyEndDate"), description: optional("description"),
        acquisition: form.origin === "OPENING_BALANCE" ? { sourceType: "OPENING_BALANCE", openingCost: optional("openingCost") } : form.origin === "OTHER" ? { sourceType: "MANUAL_EXCEPTION", reason: form.reason } : undefined,
      }));
      if (registerNow) await assetAction(made.assetId, "register").catch(() => null);
      setDone(true);
      router.replace(`${REGISTER_BASE}/${made.assetId}`);
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  if (options.isError && errorStatus(options.error) === 403) return <PermissionState title="You can't add assets" description="Adding assets needs the create permission." />;
  if (options.isLoading) return <LoadingState label="Preparing the form" rows={6} />;
  const valid = form.name.trim().length >= 2 && form.categoryId && (form.origin !== "OTHER" || form.reason.trim().length >= 3);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Add an asset" description="One physical unit. Asset code: generated automatically when saved — you never type it. Finance confirms capitalization; choosing “fixed asset” never posts anything." />
      {error && <Notice tone="danger">{error}</Notice>}
      {form.origin === "PURCHASE" && <Notice tone="info">Bought on a supplier bill or goods receipt? <Link className="font-medium text-brand underline" href={`${REGISTER_BASE}/from-purchase`}>Register from purchase</Link> links each unit to its purchase line, so the same purchase is never registered twice.</Notice>}
      <FormSection title="What are you adding?">
        <TextField label="Asset name" value={form.name} onChange={set("name")} isRequired placeholder="e.g. Dell Latitude 5450" />
        <Select label="Category" selectedKey={form.categoryId || null} onSelectionChange={(k) => { const c = o?.categories.find((x) => x.id === String(k)); setForm((f) => ({ ...f, categoryId: String(k ?? ""), tracking: c?.capitalization_guidance === "TRACK_ONLY" ? "TRACKED_ONLY" : f.tracking,
          condition: c?.suggested_condition ?? f.condition, departmentId: f.departmentId || (c?.default_department_id ?? "") })); }}
          options={(o?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))} isRequired />
        <TextArea label="Description" value={form.description} onChange={set("description")} maxLength={4000} />
      </FormSection>
      <FormSection title="How should it be tracked?">
        <Select label="Tracking" selectedKey={form.tracking} onSelectionChange={(k) => set("tracking")(String(k))} options={[{ value: "PENDING", label: "Fixed asset — Finance confirms capitalization; depreciation may apply" },
          { value: "TRACKED_ONLY", label: "Tracked equipment — custody only, never depreciated" }]} />
        <Select label="Ownership" selectedKey={form.ownership} onSelectionChange={(k) => set("ownership")(String(k))} options={Object.entries(o?.labels.ownership ?? {}).map(([value, label]) => ({ value, label }))} />
        <Select label="Kind" selectedKey={form.assetType || null} onSelectionChange={(k) => set("assetType")(String(k ?? ""))} placeholder={category ? `As the category (${o?.labels.assetType?.[category.asset_type] ?? category.asset_type})` : "As the category"}
          options={Object.entries(o?.labels.assetType ?? {}).map(([value, label]) => ({ value, label }))} />
      </FormSection>
      <FormSection title="Where did it come from?">
        <Select label="Source" selectedKey={form.origin} onSelectionChange={(k) => set("origin")(String(k))} options={[{ value: "PURCHASE", label: "Purchased from a supplier" }, { value: "OPENING_BALANCE", label: "We already owned it" },
          { value: "OTHER", label: "Other approved source (no purchase document)" }]} />
        <Select label="Supplier" selectedKey={form.supplierId || null} onSelectionChange={(k) => set("supplierId")(String(k ?? ""))} options={(o?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <TextField label="Purchase date" type="date" value={form.purchaseDate} onChange={set("purchaseDate")} />
        <TextField label="Received" type="date" value={form.receivedDate} onChange={set("receivedDate")} />
        {form.origin === "OPENING_BALANCE" && <TextField label="Original cost (Finance validates it)" inputMode="decimal" value={form.openingCost} onChange={set("openingCost")} />}
        {form.origin === "OTHER" && <TextArea label="Why there is no purchase document" value={form.reason} onChange={set("reason")} isRequired />}
      </FormSection>
      <FormSection title="Identification" description={category ? identificationNote(category) : "Skip what does not apply — furniture often has no serial."}>
        <TextField label="Manufacturer" value={form.manufacturer} onChange={set("manufacturer")} />
        <TextField label="Model" value={form.model} onChange={set("model")} />
        {category?.serial_number_policy !== "NOT_APPLICABLE" && <TextField label="Serial number" value={form.serialNumber} onChange={set("serialNumber")} isRequired={category?.serial_number_policy === "REQUIRED"} />}
        <TextField label="Asset tag (company label)" value={form.tagCode} onChange={set("tagCode")} isRequired={category?.asset_tag_policy === "REQUIRED"} />
      </FormSection>
      <FormSection title="Where is it, and who looks after it?" description="The initial assignment. Once the asset is commissioned, assignments and transfers change it.">
        <Select label="Location" selectedKey={form.locationId || null} onSelectionChange={(k) => set("locationId")(String(k ?? ""))} options={(o?.locations ?? []).map((l) => ({ value: l.id, label: l.name }))} isRequired={Boolean(category?.location_required)} />
        <Select label="Department" selectedKey={form.departmentId || null} onSelectionChange={(k) => set("departmentId")(String(k ?? ""))} options={(o?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))} />
        {category?.custodian_policy !== "NOT_APPLICABLE" && <Select label="Custodian" description={category?.custodian_policy === "REQUIRED" ? "Needed before the asset is commissioned." : undefined} selectedKey={form.custodianUserId || null}
          onSelectionChange={(k) => set("custodianUserId")(String(k ?? ""))} options={(o?.users ?? []).map((u) => ({ value: u.id, label: u.name }))} />}
        <Select label="Condition" selectedKey={form.condition || null} onSelectionChange={(k) => set("condition")(String(k ?? ""))} options={Object.entries(o?.labels.condition ?? {}).map(([value, label]) => ({ value, label }))} />
      </FormSection>
      <FormSection title="Warranty" description="Optional. Add the invoice, warranty card and photos on the asset's Documents tab after saving.">
        <TextField label="Warranty provider" value={form.warrantyProvider} onChange={set("warrantyProvider")} />
        <TextField label="Warranty from" type="date" value={form.warrantyStartDate} onChange={set("warrantyStartDate")} />
        <TextField label="Warranty until" type="date" value={form.warrantyEndDate} onChange={set("warrantyEndDate")} />
      </FormSection>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" isDisabled={busy} onPress={() => router.replace(REGISTER_BASE)}>Cancel</Button>
        <Button variant="secondary" isLoading={busy && !done} isDisabled={busy || done || !valid} onPress={() => save(false)}>Save draft</Button>
        <Button variant="primary" isLoading={busy} isDisabled={busy || done || !valid} onPress={() => save(true)}>Save and register</Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ register the units of a purchase line
type Unit = { serialNumber: string; tagCode: string; locationId: string; custodianUserId: string; departmentId: string };
const blankUnit = (): Unit => ({ serialNumber: "", tagCode: "", locationId: "", custodianUserId: "", departmentId: "" });
export function RegisterFromPurchaseScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const sources = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "sources", search), queryFn: () => call<{ rows: Source[] }>(`/actions/sources${qs({ search })}`).then((r) => r.rows), retry: false });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "options"), queryFn: getOptions, staleTime: 60_000 });
  const [picked, setPicked] = useState<Source | null>(null);
  const [form, setForm] = useState({ name: "", categoryId: "", tracking: "PENDING", manufacturer: "", model: "", purchaseDate: "", warrantyEndDate: "" });
  const [units, setUnits] = useState<Unit[]>([blankUnit()]);
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; units?: Array<{ unit: number; errors: string[] }> } | null>(null);
  const [result, setResult] = useState<{ created: Array<{ assetId: string; assetNumber: string }>; remaining: number } | null>(null);
  if (sources.isError && errorStatus(sources.error) === 403) return <PermissionState title="You can't register assets in bulk" description="It needs the bulk registration permission." />;
  const o = options.data;
  const pick = (s: Source) => { setPicked(s); setResult(null); setError(null); setKey(newKey()); setForm((f) => ({ ...f, name: f.name || (s.description ?? ""), purchaseDate: f.purchaseDate || (s.date ?? "") })); setUnits([blankUnit()]); };
  const setUnit = (i: number, k: keyof Unit) => (v: string) => setUnits((list) => list.map((u, j) => (j === i ? { ...u, [k]: v } : u)));
  const count = (n: number) => setUnits((list) => (n > list.length ? [...list, ...Array.from({ length: n - list.length }, blankUnit)] : list.slice(0, Math.max(1, n))));
  const save = async () => {
    if (!picked) return;
    setBusy(true); setError(null);
    try {
      const made = await registerAction<{ created: Array<{ assetId: string; assetNumber: string }>; remaining: number }>("register-from-source", {
        sourceType: picked.sourceType, sourceLineId: picked.sourceLineId, name: form.name, categoryId: form.categoryId, capitalizationClass: form.tracking, manufacturer: form.manufacturer || undefined, model: form.model || undefined,
        purchaseDate: form.purchaseDate || undefined, warrantyEndDate: form.warrantyEndDate || undefined,
        units: units.map((u) => Object.fromEntries(Object.entries(u).filter(([, v]) => v))), idempotencyKey: key });
      setResult(made);
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") });
    } catch (failure) { setError({ text: errorMessage(failure), units: errorDetails(failure).units as Array<{ unit: number; errors: string[] }> | undefined }); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Register from purchase" description="Each unit on a supplier bill or goods receipt becomes its own asset, linked to that line. A purchase can never be registered beyond its quantity — not through its receipt and its bill together." />
      {!picked ? (
        <Panel title="Choose the purchase line">
          <TextField label="Search" value={search} onChange={setSearch} placeholder="Bill or receipt number, description or supplier" />
          {sources.isLoading ? <LoadingState label="Loading purchase lines" rows={4} /> : (
            <LinesTable columns={["Document", "Date", "Line", "Supplier", { label: "Units", numeric: true }, { label: "Registered", numeric: true }, { label: "Left", numeric: true }, ""]} empty={(sources.data ?? []).length ? undefined : "No purchase line has units left to register."}>
              {(sources.data ?? []).map((s) => <tr key={s.sourceLineId}><Cell>{s.document}<span className="block text-xs text-text-muted">{s.sourceLabel}</span></Cell><Cell>{s.date ?? "—"}</Cell><Cell>{s.description ?? "—"}</Cell><Cell>{s.supplier ?? "—"}</Cell>
                <Cell numeric>{s.quantity}</Cell><Cell numeric>{s.registered}</Cell><Cell numeric>{s.available}</Cell><Cell><Button size="compact" variant="secondary" onPress={() => pick(s)}>Register units</Button></Cell></tr>)}
            </LinesTable>
          )}
        </Panel>
      ) : result ? (
        <Panel title={`${result.created.length} asset(s) registered`}>
          <Notice tone="success">{`Each has its own code and is linked to ${picked.document}. ${result.remaining} unit(s) of the line are still unregistered.`}</Notice>
          <ul className="flex flex-wrap gap-2 text-sm">{result.created.map((a) => <li key={a.assetId}><Link className="text-brand hover:underline" href={`${REGISTER_BASE}/${a.assetId}`}>{a.assetNumber}</Link></li>)}</ul>
          <div className="flex flex-wrap gap-2"><LinkButton variant="primary" href={`${REGISTER_BASE}/labels?assetIds=${result.created.map((a) => a.assetId).join(",")}`}>{`Print ${result.created.length} label(s)`}</LinkButton>
            <Button variant="secondary" onPress={() => { setPicked(null); setResult(null); }}>Register another line</Button><LinkButton variant="secondary" href={REGISTER_BASE}>Asset Register</LinkButton></div>
        </Panel>
      ) : (
        <>
          <Notice tone="info">{`${picked.document} · ${picked.description ?? ""} — ${picked.available} of ${picked.quantity} unit(s) left to register.${picked.proposedUnitCost ? ` Proposed cost ${money(picked.proposedUnitCost)} per unit, before tax; Finance confirms it.` : ""}`}</Notice>
          {error && <Notice tone="danger">{error.text}{error.units && <ul className="mt-1 list-disc pl-5">{error.units.map((u) => <li key={u.unit}>{`Unit ${u.unit}: ${u.errors.join("; ")}`}</li>)}</ul>}</Notice>}
          <FormSection title="What these units are">
            <TextField label="Asset name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} isRequired />
            <Select label="Category" selectedKey={form.categoryId || null} onSelectionChange={(k) => setForm({ ...form, categoryId: String(k ?? "") })} options={(o?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))} isRequired />
            <Select label="Tracking" selectedKey={form.tracking} onSelectionChange={(k) => setForm({ ...form, tracking: String(k) })} options={[{ value: "PENDING", label: "Fixed asset — Finance confirms" }, { value: "TRACKED_ONLY", label: "Tracked equipment only" }]} />
            <TextField label="Manufacturer" value={form.manufacturer} onChange={(v) => setForm({ ...form, manufacturer: v })} />
            <TextField label="Model" value={form.model} onChange={(v) => setForm({ ...form, model: v })} />
            <TextField label="Warranty until" type="date" value={form.warrantyEndDate} onChange={(v) => setForm({ ...form, warrantyEndDate: v })} />
          </FormSection>
          <Panel title="The units" description="One row per physical unit; serials, tags, locations and custodians may differ." actions={<TextField label="How many now" inputMode="numeric" value={String(units.length)} onChange={(v) => count(Math.min(Number(v) || 1, picked.available))} />}>
            <LinesTable columns={["Unit", "Serial number", "Asset tag", "Location", "Custodian"]}>
              {units.map((u, i) => <tr key={i}><Cell>{i + 1}</Cell><Cell><TextField aria-label={`Serial ${i + 1}`} value={u.serialNumber} onChange={setUnit(i, "serialNumber")} /></Cell><Cell><TextField aria-label={`Tag ${i + 1}`} value={u.tagCode} onChange={setUnit(i, "tagCode")} /></Cell>
                <Cell><Select aria-label={`Location ${i + 1}`} selectedKey={u.locationId || null} onSelectionChange={(k) => setUnit(i, "locationId")(String(k ?? ""))} options={(o?.locations ?? []).map((l) => ({ value: l.id, label: l.name }))} /></Cell>
                <Cell><Select aria-label={`Custodian ${i + 1}`} selectedKey={u.custodianUserId || null} onSelectionChange={(k) => setUnit(i, "custodianUserId")(String(k ?? ""))} options={(o?.users ?? []).map((x) => ({ value: x.id, label: x.name }))} /></Cell></tr>)}
            </LinesTable>
          </Panel>
          <div className="flex justify-end gap-2"><Button variant="ghost" isDisabled={busy} onPress={() => setPicked(null)}>Back</Button>
            <Button variant="primary" isLoading={busy} isDisabled={busy || !form.name.trim() || !form.categoryId} onPress={save}>{`Register ${units.length} asset(s)`}</Button></div>
        </>
      )}
      {!picked && <p className="text-sm"><button type="button" className="text-brand underline" onClick={() => router.push(`${REGISTER_BASE}/new`)}>Add one asset by hand</button> instead.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ reports
const REPORTS = [{ id: "register", label: "Asset register" }, { id: "by-category", label: "By category" }, { id: "by-location", label: "By location" }, { id: "by-department", label: "By department" },
  { id: "by-custodian", label: "By custodian" }, { id: "by-lifecycle", label: "By status" }, { id: "unassigned", label: "Unassigned" }, { id: "available", label: "Available" }, { id: "maintenance", label: "Under maintenance" },
  { id: "acquisition-history", label: "Acquisition history" }, { id: "missing-identifiers", label: "Missing serial / tag" }, { id: "duplicate-exceptions", label: "Duplicate registration" },
  { id: "warranty-expiry", label: "Warranty expiry" }, { id: "verification-exceptions", label: "Verification exceptions" }, { id: "capitalized-vs-tracked", label: "Capitalized vs tracked" },
  { id: "financial-summary", label: "Financial summary" }, { id: "import-reconciliation", label: "Imports and registrations" },
  { id: "identification", label: "Asset identification" }, { id: "missing-serials", label: "Missing serial numbers" }, { id: "duplicate-serials", label: "Duplicate serial warnings" },
  { id: "missing-labels", label: "Missing tags / labels" }, { id: "legacy-mapping", label: "Previous code mapping" }, { id: "identifier-corrections", label: "Identifier corrections" },
  { id: "ended-identification", label: "Lost / retired / disposed identification" }, { id: "identification-exceptions", label: "Identification exceptions" },
  { id: "by-availability", label: "By availability" }, { id: "by-condition", label: "By condition" }, { id: "on-hold", label: "Assets on hold" }, { id: "long-holds", label: "Long-standing holds" },
  { id: "missing-reports", label: "Missing reports" }, { id: "lost", label: "Lost assets" }, { id: "retired", label: "Retired assets" }, { id: "ready-for-commissioning", label: "Ready for commissioning" },
  { id: "finance-review", label: "Status needing Finance review" }, { id: "status-conflicts", label: "Status conflicts" }, { id: "status-history", label: "Status change history" },
  { id: "assets-by-location", label: "Assets by location" }, { id: "assets-by-site", label: "Assets by site" }, { id: "no-location", label: "Assets without a location" }, { id: "external-whereabouts", label: "At external sites / repair" },
  { id: "pending-transfers", label: "Pending transfers" }, { id: "location-discrepancies", label: "Location discrepancies" }, { id: "inactive-with-assets", label: "Inactive locations with assets" },
  { id: "location-history", label: "Location history" }, { id: "lost-by-last-location", label: "Lost assets by last location" }, { id: "utilization-by-category", label: "Location use by category" },
  { id: "location-change-audit", label: "Location change audit" },
  { id: "custody-by-custodian", label: "Assets by custodian" }, { id: "custody-by-employee", label: "Assets by employee" }, { id: "custody-by-department", label: "Custody by department" },
  { id: "store-custody", label: "Assets in store custody" }, { id: "pending-handovers", label: "Pending handovers" }, { id: "unacknowledged", label: "Unacknowledged assignments" },
  { id: "overdue-returns", label: "Overdue returns" }, { id: "employee-clearance", label: "Employee asset clearance" }, { id: "custody-history", label: "Custody history" },
  { id: "damaged-lost-by-custodian", label: "Damaged / lost by custodian" }, { id: "custody-disputes", label: "Custody disputes" }, { id: "no-accountable", label: "Custody without an accountable person" },
  { id: "inactive-with-assets", label: "Inactive employees with assets" }, { id: "custody-trend", label: "Assignments and returns by month" }];
type Row = Record<string, unknown>;
const v = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));
export function AssetReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const kind = REPORTS.some((r) => r.id === params.get("report")) ? params.get("report")! : "register";
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "report", kind), queryFn: () => getReport<Row>(kind), retry: false });
  const rows = q.data ?? [];
  const columns = rows[0] ? Object.keys(rows[0]).filter((k) => !["id", "assetId", "href"].includes(k)) : [];
  if (q.isError && errorStatus(q.error) === 403) return <PermissionState title="These reports are restricted" description="Asset reports need register access; the financial summary needs financial access." />;
  const nice = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Asset reports" description="The register by category, location, department and custodian; data quality, duplicates, warranty and verification exceptions." />
      <Tabs selectedKey={kind} onSelectionChange={(key) => router.replace(`${ASSETS_BASE}/reports?report=${String(key)}`)}>
        <TabList aria-label="Reports">{REPORTS.map((r) => <Tab key={r.id} id={r.id}>{r.label}</Tab>)}</TabList>
      </Tabs>
      {q.isLoading ? <LoadingState label="Preparing the report" rows={6} /> : q.isError ? <ErrorState title="Could not load the report" description={errorMessage(q.error)} /> : (
        <Panel title={REPORTS.find((r) => r.id === kind)?.label}>
          <LinesTable columns={columns.map(nice)} empty={rows.length ? undefined : "Nothing to report."}>
            {rows.map((row, i) => <tr key={i}>{columns.map((k, j) => <Cell key={k}>{j === 0 && typeof row.href === "string" ? <Link className="text-brand hover:underline" href={row.href}>{v(row[k])}</Link>
              : k === "carryingAmount" ? money(row[k] as string | null) : typeof row[k] === "boolean" ? (row[k] ? "Yes" : "No") : v(row[k])}</Cell>)}</tr>)}
          </LinesTable>
        </Panel>
      )}
    </div>
  );
}
