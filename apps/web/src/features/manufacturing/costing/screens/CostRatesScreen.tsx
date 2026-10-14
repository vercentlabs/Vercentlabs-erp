"use client";

// Production Costing setup: whether labor and overhead are applied; the overhead categories, each a cost pool of the company's own expense
// accounts; the rates they are applied at — company defaults, or a product's own replacing the default of the same category — per accepted
// unit, per real production batch, or a percent of consumed material, each set by one person and approved by another, in force from a date;
// and the month's reconciliation of each pool against the overhead applied. Orders keep the rates they were released under. Material is
// always valued by Inventory's own method; nothing here changes it.
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ComboBox, ErrorState, PageHeader, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { bomOptions } from "@/features/manufacturing/boms/api/bom-api";
import { errorMessage, errorStatus, inr } from "@/features/manufacturing/orders/api/mo-api";
import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import {
  costRates, createCostRate, decideCostRate, overheadCategories, overheadReconciliation, reconcileOverhead, retireCostRate, saveOverheadCategory, setCostingSettings, submitCostRate,
  type CostRateStatus,
} from "../api/costing-api";

type Section = "rates" | "categories" | "reconciliation";
const SECTIONS: Array<{ value: Section; label: string }> = [{ value: "rates", label: "Rates" }, { value: "categories", label: "Overhead categories" }, { value: "reconciliation", label: "Overhead reconciliation" }];
const STATUS_TONE: Record<CostRateStatus, "neutral" | "info" | "success" | "warning"> = { DRAFT: "neutral", PENDING_APPROVAL: "warning", ACTIVE: "success", RETIRED: "neutral" };
type Say = (tone: "success" | "danger", text: string) => void;

export function CostRatesScreen() {
  const params = useSearchParams();
  const initial = SECTIONS.find((row) => row.value === params.get("section"))?.value ?? "rates";
  const [section, setSection] = useState<Section>(initial);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const say: Say = (tone, text) => setMessage({ tone, text });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Production Costing" description="Material is valued by Inventory. Labor and overhead are applied to work in progress only at approved rates set here — never assumed from salaries or bills — and finished goods carry their share." />
      <div className="max-w-xs"><Select label="Show" selectedKey={section} onSelectionChange={(value) => { setSection(value as Section); setMessage(null); }} options={SECTIONS} /></div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {section === "rates" && <RatesSection say={say} />}
      {section === "categories" && <CategoriesSection say={say} />}
      {section === "reconciliation" && <ReconciliationSection say={say} />}
    </div>
  );
}

function useRefresh() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") });
}

function RatesSection({ say }: { say: Say }) {
  const workspace = useWorkspaceContext();
  const refresh = useRefresh();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "cost-rates"), queryFn: costRates });
  const categories = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "overhead-categories"), queryFn: overheadCategories });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "bom-options"), queryFn: bomOptions, staleTime: 60_000 });
  const [component, setComponent] = useState("OVERHEAD");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [basis, setBasis] = useState("PER_GOOD_UNIT");
  const [rate, setRate] = useState("");
  const [zeroReason, setZeroReason] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  if (query.isLoading) return <LoadingState label="Loading rates" rows={5} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to production costing" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load rates" description={errorMessage(query.error)} />;
  }
  const data = query.data;
  const run = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true);
    try { await work(); await refresh(); say("success", text); } catch (failure) { say("danger", errorMessage(failure)); } finally { setBusy(false); }
  };
  const zero = rate.trim() !== "" && Number(rate) === 0;
  const ready = rate.trim() !== "" && (component === "LABOR" || categoryId) && (!zero || zeroReason.trim().length >= 3);
  const save = (submit: boolean) => run(async () => {
    await createCostRate({ component, basis, rate: rate.trim(), categoryId: component === "OVERHEAD" ? categoryId : null, finishedItemId: productId, effectiveFrom: from || null,
      effectiveUntil: until || null, zeroReason: zero ? zeroReason.trim() : null, submit });
    setRate(""); setZeroReason("");
  }, submit ? "Rate submitted for approval." : "Rate saved as a draft.");
  const order: CostRateStatus[] = ["PENDING_APPROVAL", "DRAFT", "ACTIVE", "RETIRED"];
  return (
    <>
      <Panel title="What is applied" description="A component that is not enabled shows as not enabled, never as a zero cost. An enabled component needs an approved rate before an order is released.">
        <Checkbox isDisabled={busy || !data.can.manage} isSelected={data.laborEnabled} onChange={(value) => run(() => setCostingSettings({ laborEnabled: value }), value ? "Labor application enabled." : "Labor application turned off.")}>Apply direct labor</Checkbox>
        <Checkbox isDisabled={busy || !data.can.manage} isSelected={data.overheadEnabled} onChange={(value) => run(() => setCostingSettings({ overheadEnabled: value }), value ? "Overhead application enabled." : "Overhead application turned off.")}>Apply manufacturing overhead</Checkbox>
      </Panel>
      {data.can.manage && (
        <Panel title="Set a rate" description="A product's own rate replaces the company default of the same category — they never add up. A new rate is in force once someone else approves it; the rate it takes over from ends the day before.">
          <div className="grid gap-3 sm:grid-cols-4">
            <Select label="Component" selectedKey={component} onSelectionChange={(value) => setComponent(String(value))} options={[{ value: "OVERHEAD", label: "Manufacturing overhead" }, { value: "LABOR", label: "Direct labor" }]} />
            {component === "OVERHEAD" && <Select label="Category" placeholder="Choose" selectedKey={categoryId} onSelectionChange={(value) => {
              const id = value ? String(value) : null; setCategoryId(id);
              const chosen = categories.data?.categories.find((row) => row.id === id); if (chosen) setBasis(chosen.defaultBasis);
            }} options={(categories.data?.categories ?? []).filter((row) => row.status === "ACTIVE").map((row) => ({ value: row.id, label: row.name }))} />}
            <Select label="Applied" selectedKey={basis} onSelectionChange={(value) => setBasis(String(value))}
              options={[{ value: "PER_GOOD_UNIT", label: "Per accepted unit" }, { value: "PER_BATCH", label: "Per production batch" }, { value: "PCT_OF_MATERIAL", label: "Percent of consumed material" }]} />
            <TextField label={basis === "PCT_OF_MATERIAL" ? "Rate (%)" : "Rate (₹)"} inputMode="decimal" value={rate} onChange={setRate} />
            <ComboBox label="For product" placeholder="Every product (company default)" selectedKey={productId} onSelectionChange={(value) => setProductId(value ? String(value) : null)}
              options={(options.data?.products ?? []).map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` }))} description={basis === "PER_GOOD_UNIT" ? "Per the product's base unit." : undefined} />
            <TextField label="In force from" type="date" value={from} onChange={setFrom} description="Today if left empty." />
            <TextField label="Until" type="date" value={until} onChange={setUntil} description="Open-ended if left empty." />
            {zero && <TextField label="Why zero" value={zeroReason} onChange={setZeroReason} description="A zero rate is a decision: say why." />}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" isDisabled={!ready || busy} onPress={() => save(false)}>Save draft</Button>
            <Button variant="primary" isLoading={busy} isDisabled={!ready || busy} onPress={() => save(true)}>Submit for approval</Button>
          </div>
        </Panel>
      )}
      <Panel title="Rates">
        {data.rates.length === 0 ? <p className="text-sm text-text-muted">No rates set.</p> : (
          <LinesTable columns={["Rate", "Applied", { label: "Rate", numeric: true }, "Product", "In force", "Status", ""]}>
            {[...data.rates].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)).map((row) => (
              <tr key={row.id}>
                <Cell>{row.category ?? row.componentLabel} <span className="text-xs text-text-muted">{row.code}{row.version ? ` v${row.version}` : ""}</span>
                  {row.zeroReason && <span className="block text-xs text-text-muted">Zero: {row.zeroReason}</span>}
                  {row.decisionNote && row.status === "DRAFT" && <span className="block text-xs text-text-muted">Returned: {row.decisionNote}</span>}</Cell>
                <Cell>{row.basisLabel}</Cell><Cell numeric>{row.basis === "PCT_OF_MATERIAL" ? `${row.rate}%` : inr(row.rate)}{row.uom ? ` / ${row.uom}` : ""}</Cell>
                <Cell>{row.product ?? "Company default"}</Cell>
                <Cell>{row.effectiveFrom}{row.effectiveUntil ? ` – ${row.effectiveUntil}` : " onwards"}</Cell>
                <Cell><StatusBadge tone={STATUS_TONE[row.status]}>{row.statusLabel}</StatusBadge>
                  <span className="block text-xs text-text-muted">{[row.createdBy && `Set by ${row.createdBy}`, row.approvedBy && `approved by ${row.approvedBy}`].filter(Boolean).join(", ")}</span></Cell>
                <Cell><span className="flex flex-wrap gap-1">
                  {row.can.submit && <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => run(() => submitCostRate(row.id), `${row.code} submitted for approval.`)}>Submit</Button>}
                  {row.can.decide && <Button size="compact" variant="primary" isDisabled={busy} onPress={() => run(() => decideCostRate(row.id, "APPROVE"), `${row.code} is in force.`)}>Approve</Button>}
                  {row.can.decide && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: `Return ${row.code}`, confirm: "Return", fields: [{ name: "note", label: "Why", kind: "textarea", required: true }],
                    run: async (values) => { await decideCostRate(row.id, "REJECT", String(values.note)); await refresh(); say("success", `${row.code} returned to its author.`); } })}>Return</Button>}
                  {row.can.retire && <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => run(() => retireCostRate(row.id), `${row.code} retired.`)}>Retire</Button>}
                </span></Cell>
              </tr>
            ))}
          </LinesTable>
        )}
      </Panel>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </>
  );
}

function CategoriesSection({ say }: { say: Say }) {
  const workspace = useWorkspaceContext();
  const refresh = useRefresh();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "overhead-categories"), queryFn: overheadCategories });
  const rates = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "cost-rates"), queryFn: costRates });
  const [ask, setAsk] = useState<Ask | null>(null);
  if (query.isLoading) return <LoadingState label="Loading categories" rows={5} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load categories" description={errorMessage(query.error)} />;
  const { categories, accounts } = query.data;
  const manage = rates.data?.can.manage ?? false;
  const accountOptions = accounts.map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` }));
  const save = async (input: Record<string, unknown>, text: string) => { await saveOverheadCategory(input); await refresh(); say("success", text); };
  return (
    <Panel title="Overhead categories" description="Each category is a cost pool: the company's expense accounts where its actual cost is booked. One expense account belongs to one pool, so nothing is pooled twice."
      actions={manage ? <Button size="compact" variant="primary" onPress={() => setAsk({ title: "New overhead category", confirm: "Create", fields: [
        { name: "name", label: "Name", kind: "text", required: true }, { name: "defaultBasis", label: "Usually applied", kind: "select", initial: "PER_GOOD_UNIT", options: [{ value: "PER_GOOD_UNIT", label: "Per accepted unit" }, { value: "PER_BATCH", label: "Per production batch" }] },
        { name: "account", label: "Expense account", kind: "select", options: accountOptions }, { name: "description", label: "Description", kind: "textarea" }],
        run: (values) => save({ name: values.name, defaultBasis: values.defaultBasis, description: values.description || null, costPoolAccountIds: values.account ? [values.account] : [] }, "Category created.") })}>New category</Button> : undefined}>
      <LinesTable columns={["Category", "Usually applied", "Cost pool", "Status", ""]}>
        {categories.map((row) => (
          <tr key={row.id}>
            <Cell>{row.name} <span className="text-xs text-text-muted">{row.code}</span>{row.description && <span className="block text-xs text-text-muted">{row.description}</span>}</Cell>
            <Cell>{row.defaultBasisLabel}</Cell>
            <Cell>{row.costPoolAccounts.length ? row.costPoolAccounts.join(", ") : <span className="text-text-muted">Not named — the pool cannot be reconciled</span>}</Cell>
            <Cell><StatusBadge tone={row.status === "ACTIVE" ? "success" : "neutral"}>{row.status === "ACTIVE" ? "Active" : "Inactive"}</StatusBadge></Cell>
            <Cell>{manage && <span className="flex flex-wrap gap-1">
              <Button size="compact" variant="ghost" onPress={() => setAsk({ title: `Add an account to ${row.name}`, confirm: "Add", fields: [{ name: "account", label: "Expense account", kind: "select", required: true,
                options: accountOptions.filter((option) => !row.costPoolAccountIds.includes(option.value)) }],
                run: (values) => save({ id: row.id, name: row.name, defaultBasis: row.defaultBasis, description: row.description, costPoolNote: row.costPoolNote, status: row.status,
                  costPoolAccountIds: [...row.costPoolAccountIds, String(values.account)] }, `${row.name}: account added to its cost pool.`) })}>Add account</Button>
              {row.costPoolAccountIds.length > 0 && <Button size="compact" variant="ghost" onPress={() => save({ id: row.id, name: row.name, defaultBasis: row.defaultBasis, description: row.description,
                costPoolNote: row.costPoolNote, status: row.status, costPoolAccountIds: [] }, `${row.name}: cost pool cleared.`).catch((failure) => say("danger", errorMessage(failure)))}>Clear pool</Button>}
              <Button size="compact" variant="ghost" onPress={() => save({ id: row.id, name: row.name, defaultBasis: row.defaultBasis, description: row.description, costPoolNote: row.costPoolNote,
                status: row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }, row.status === "ACTIVE" ? `${row.name} deactivated.` : `${row.name} reactivated.`).catch((failure) => say("danger", errorMessage(failure)))}>
                {row.status === "ACTIVE" ? "Deactivate" : "Reactivate"}</Button>
            </span>}</Cell>
          </tr>
        ))}
      </LinesTable>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </Panel>
  );
}

const thisMonth = () => new Date().toISOString().slice(0, 7);
const RECON_LABEL: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = { POOL_NOT_MAPPED: { label: "Pool not named", tone: "neutral" },
  BALANCED: { label: "Balanced", tone: "success" }, REVIEW_REQUIRED: { label: "Finance review needed", tone: "warning" }, RECONCILED: { label: "Reconciled", tone: "success" }, EXCEPTION: { label: "Exception", tone: "danger" } };

function ReconciliationSection({ say }: { say: Say }) {
  const workspace = useWorkspaceContext();
  const refresh = useRefresh();
  const [period, setPeriod] = useState(thisMonth);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "overhead-reconciliation", period), queryFn: () => overheadReconciliation(period), enabled: /^\d{4}-\d{2}$/.test(period) });
  const [ask, setAsk] = useState<Ask | null>(null);
  return (
    <Panel title="Overhead reconciliation" description={query.data?.note ?? "Each category's actual cost for the month against the overhead applied to orders."}
      actions={<TextField aria-label="Month" type="month" value={period} onChange={setPeriod} />}>
      {query.isLoading ? <LoadingState label="Reconciling" rows={4} /> : query.isError || !query.data ? <Notice tone="danger">{errorMessage(query.error)}</Notice> : query.data.rows.length === 0 ? (
        <p className="text-sm text-text-muted">No overhead was applied or pooled in {period}.</p>
      ) : (
        <LinesTable columns={["Category", { label: "Actual pool", numeric: true }, { label: "Applied", numeric: true }, { label: "Difference", numeric: true }, "Status", ""]}>
          {query.data.rows.map((row) => (
            <tr key={row.categoryId}>
              <Cell>{row.category}</Cell><Cell numeric>{row.actual === null ? "—" : inr(row.actual)}</Cell><Cell numeric>{inr(row.applied)}</Cell>
              <Cell numeric>{row.difference === null ? "—" : `${inr(row.difference)}${Number(row.difference) > 0 ? " under-applied" : Number(row.difference) < 0 ? " over-applied" : ""}`}</Cell>
              <Cell><StatusBadge tone={RECON_LABEL[row.status].tone}>{RECON_LABEL[row.status].label}</StatusBadge>
                {row.lastReview && <span className="block text-xs text-text-muted">{row.lastReview.note}{row.lastReview.financeReference ? ` · ${row.lastReview.financeReference}` : ""}{row.lastReview.by ? ` · ${row.lastReview.by}` : ""}</span>}</Cell>
              <Cell>{query.data.can.reconcile && row.actual !== null && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: `Review ${row.category} for ${period}`, confirm: "Record review",
                description: `Actual ${inr(row.actual ?? "0")} against applied ${inr(row.applied)}. Any correcting journal is posted in Finance; name it here.`,
                fields: [{ name: "note", label: "What was found", kind: "textarea", required: true }, { name: "financeReference", label: "Finance journal or reference", kind: "text" }],
                run: async (values) => { await reconcileOverhead({ period, categoryId: row.categoryId, note: values.note, financeReference: values.financeReference || undefined }); await refresh(); say("success", `${row.category}: review recorded.`); } })}>Review</Button>}</Cell>
            </tr>
          ))}
          <tr><Cell><span className="font-medium">Total</span></Cell><Cell numeric>{inr(query.data.totals.actual)}</Cell><Cell numeric>{inr(query.data.totals.applied)}</Cell><Cell numeric>{inr(query.data.totals.difference)}</Cell><Cell>{""}</Cell><Cell>{""}</Cell></tr>
        </LinesTable>
      )}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </Panel>
  );
}
