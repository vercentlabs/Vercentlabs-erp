"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/lib/client-request";

type JsonRow = Record<string, unknown>;
type Line = {
  description: string;
  quantity: string;
  unitPrice: string;
  taxAmount: string;
  purchaseOrderLineId?: string;
};

type Field = {
  key: string;
  label: string;
  type?: "text" | "date" | "datetime-local" | "select" | "textarea";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
};

type ResourceDefinition = {
  title: string;
  singular: string;
  description: string;
  basePath: string;
  fields: Field[];
  lines?: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) => {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
};
const emptyLine = (): Line => ({
  description: "",
  quantity: "1",
  unitPrice: "0",
  taxAmount: "0",
});

const PROCUREMENT_REPORTS = [
  "spend-analysis",
  "supplier-performance",
  "purchase-price-variance",
  "contract-compliance",
  "maverick-spend",
  "open-commitments",
  "overdue-orders",
  "matching-exceptions",
  "savings",
  "cycle-time",
  "supplier-risk",
  "agreement-consumption",
] as const;

const DEFINITIONS: Record<string, ResourceDefinition> = {
  suppliers: {
    title: "Suppliers",
    singular: "supplier",
    description: "Legal identity, qualification, sites, certifications, risk and performance evidence.",
    basePath: "/procurement/suppliers",
    fields: [
      { key: "supplierCode", label: "Supplier code", required: true },
      { key: "partyId", label: "Accounting business-partner ID" },
      { key: "legalName", label: "Legal name", required: true },
      { key: "displayName", label: "Display name" },
      { key: "taxRegistrationNumber", label: "Tax registration number" },
      { key: "paymentTerms", label: "Payment terms" },
      { key: "currencyCode", label: "Currency", required: true },
    ],
  },
  requisitions: {
    title: "Purchase requisitions",
    singular: "requisition",
    description: "Demand intake with line-level value, need-by dates, policy evidence and approval lifecycle.",
    basePath: "/procurement/requisitions",
    fields: [
      { key: "title", label: "Business requirement", required: true },
      { key: "needByDate", label: "Need-by date", type: "date", required: true },
      { key: "requesterDepartment", label: "Department" },
      { key: "costCenter", label: "Cost centre" },
      { key: "currencyCode", label: "Currency", required: true },
      { key: "justification", label: "Justification", type: "textarea", required: true },
    ],
    lines: true,
  },
  "sourcing-events": {
    title: "Sourcing events",
    singular: "sourcing event",
    description: "RFI, RFQ, RFP, tender and auction workflows with invitations, bids, evaluations and award.",
    basePath: "/procurement/sourcing",
    fields: [
      { key: "title", label: "Event title", required: true },
      {
        key: "eventType",
        label: "Event type",
        type: "select",
        required: true,
        options: ["rfq", "rfi", "rfp", "tender", "auction"].map((value) => ({ value, label: value.toUpperCase() })),
      },
      { key: "bidCloseAt", label: "Bid closes", type: "datetime-local", required: true },
      { key: "currencyCode", label: "Currency", required: true },
      { key: "evaluationMethod", label: "Evaluation method" },
      { key: "instructions", label: "Supplier instructions", type: "textarea" },
    ],
  },
  agreements: {
    title: "Agreements",
    singular: "agreement",
    description: "Blanket, contract and scheduling agreements with validity and consumption controls.",
    basePath: "/procurement/contracts",
    fields: [
      { key: "title", label: "Agreement title", required: true },
      { key: "supplierId", label: "Supplier", type: "select", required: true },
      { key: "validFrom", label: "Valid from", type: "date", required: true },
      { key: "validUntil", label: "Valid until", type: "date", required: true },
      { key: "currencyCode", label: "Currency", required: true },
      { key: "terms", label: "Commercial terms", type: "textarea" },
    ],
    lines: true,
  },
  "purchase-orders": {
    title: "Purchase orders",
    singular: "purchase order",
    description: "Supplier commitments with approvals, dispatch, acknowledgement, amendments, receipts and matching.",
    basePath: "/procurement/orders",
    fields: [
      { key: "title", label: "Order title", required: true },
      { key: "supplierId", label: "Supplier", type: "select", required: true },
      { key: "expectedDeliveryDate", label: "Expected delivery", type: "date", required: true },
      { key: "currencyCode", label: "Currency", required: true },
      { key: "deliveryTerms", label: "Delivery terms" },
      { key: "paymentTerms", label: "Payment terms" },
      { key: "buyerNotes", label: "Buyer notes", type: "textarea" },
    ],
    lines: true,
  },
  receipts: {
    title: "Goods receipts",
    singular: "receipt",
    description: "Record accepted and rejected quantities against acknowledged purchase orders.",
    basePath: "/procurement/receipts",
    fields: [
      { key: "purchaseOrderId", label: "Purchase order", type: "select", required: true },
      { key: "receiptDate", label: "Receipt date", type: "date", required: true },
      { key: "deliveryNoteNumber", label: "Supplier delivery note" },
      { key: "inspectionNotes", label: "Inspection notes", type: "textarea" },
      { key: "currencyCode", label: "Currency", required: true },
    ],
    lines: true,
  },
};

const ACTIONS: Record<string, Record<string, string[]>> = {
  suppliers: {
    draft: ["submit", "cancel"],
    submitted: ["qualify", "cancel"],
    qualified: ["activate", "block"],
    active: ["suspend", "block"],
    suspended: ["activate", "block"],
    blocked: ["activate"],
  },
  requisitions: {
    draft: ["submit", "cancel"],
    submitted: ["approve", "reject", "cancel"],
    pending_approval: ["approve", "reject"],
    approved: ["close"],
    rejected: ["submit", "cancel"],
  },
  "sourcing-events": {
    draft: ["submit", "cancel"],
    submitted: ["approve", "cancel"],
    approved: ["activate", "cancel"],
    active: ["close", "award", "cancel"],
    closed: ["award"],
  },
  agreements: {
    draft: ["submit", "cancel"],
    submitted: ["approve", "cancel"],
    approved: ["activate", "cancel"],
    active: ["close"],
  },
  "purchase-orders": {
    draft: ["submit", "cancel"],
    submitted: ["approve", "reject", "cancel"],
    pending_approval: ["approve", "reject"],
    approved: ["dispatch", "amend", "cancel"],
    dispatched: ["acknowledge", "amend", "cancel"],
    acknowledged: ["amend", "close"],
    partially_received: ["amend", "close"],
    received: ["close"],
  },
  receipts: {
    draft: ["submit"],
    submitted: ["approve", "reject"],
    approved: ["reverse"],
  },
};

function titleFor(row: JsonRow) {
  return String(
    row.requisitionNumber ||
      row.purchaseOrderNumber ||
      row.receiptNumber ||
      row.eventNumber ||
      row.agreementNumber ||
      row.supplierCode ||
      row.title ||
      row.legalName ||
      row.search_text ||
      "Procurement record",
  );
}

function cleanRecord(row: JsonRow) {
  const hidden = new Set([
    "organization_id",
    "company_id",
    "branch_id",
    "created_by",
    "updated_by",
    "content_hash",
    "search_text",
    "data",
  ]);
  return Object.entries(row).filter(
    ([key, value]) => !hidden.has(key) && !Array.isArray(value) && typeof value !== "object",
  );
}

function defaultForm(resource: string) {
  const defaults: Record<string, string> = { currencyCode: "INR" };
  if (resource === "requisitions") defaults.needByDate = inDays(14);
  if (resource === "sourcing-events") defaults.bidCloseAt = `${inDays(7)}T17:00`;
  if (resource === "agreements") {
    defaults.validFrom = today();
    defaults.validUntil = inDays(365);
  }
  if (resource === "purchase-orders") defaults.expectedDeliveryDate = inDays(14);
  if (resource === "receipts") defaults.receiptDate = today();
  return defaults;
}

export function ProcurementDashboard() {
  const [dashboard, setDashboard] = useState<JsonRow | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    requestJson<{ dashboard: JsonRow }>("/api/procurement/dashboard")
      .then((result) => {
        if (!result.ok) throw new Error(result.message);
        setDashboard(result.dashboard);
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Dashboard could not be loaded."));
  }, []);
  const metrics = [
    ["Pending requisitions", "pending_requisitions"],
    ["Active sourcing", "active_sourcing"],
    ["Open orders", "open_orders"],
    ["Pending receipts", "pending_receipts"],
    ["Match exceptions", "match_exceptions"],
    ["Supplier risks", "supplier_risks"],
  ];
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Source-to-pay</p>
          <h1>Procurement command centre</h1>
          <p>Control demand, suppliers, sourcing, contracts, purchase orders, receiving and invoice matching.</p>
        </div>
        <div className="page-heading-actions">
          <Link className="primary-button" href="/procurement/requisitions/new">New requisition</Link>
          <Link className="secondary-button" href="/procurement/orders/new">New purchase order</Link>
        </div>
      </section>
      {message ? <div className="form-message error">{message}</div> : null}
      <section className="procurement-grid">
        {metrics.map(([label, key]) => (
          <article className="metric-card" key={key}>
            <span>{label}</span>
            <strong>{dashboard ? String(dashboard[key] ?? 0) : "…"}</strong>
          </article>
        ))}
      </section>
      <section className="panel procurement-navigation">
        <div className="card-title-row"><div><p className="eyebrow">Operational workspaces</p><h2>Source-to-pay lifecycle</h2></div></div>
        <div className="resource-cards">
          {[
            ["Suppliers", "/procurement/suppliers", "Qualification, sites, compliance and performance"],
            ["Requisitions", "/procurement/requisitions", "Demand, budgets, policies and approvals"],
            ["Strategic sourcing", "/procurement/sourcing", "Invitations, bids, evaluations and awards"],
            ["Agreements", "/procurement/contracts", "Contract terms, validity and consumption"],
            ["Purchase orders", "/procurement/orders", "Commitments, dispatch, amendments and delivery"],
            ["Receiving", "/procurement/receipts", "Goods, services, inspection and returns"],
            ["Invoice matching", "/procurement/matching", "Two-way, three-way and four-way controls"],
            ["Analytics", "/procurement/reports", "Spend, savings, compliance, risk and cycle time"],
            ["Policies", "/procurement/settings", "Catalogs, source rules, tolerances and portal"],
          ].map(([label, href, description]) => (
            <article className="resource-card" key={href}>
              <div><strong>{label}</strong><span>{description}</span></div>
              <Link className="link-button" href={href}>Open workspace</Link>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

export function ProcurementResourceWorkspace({
  resource,
  mode = "list",
  recordId,
}: {
  resource: string;
  mode?: "list" | "create" | "detail";
  recordId?: string;
}) {
  const definition = DEFINITIONS[resource];
  const router = useRouter();
  const [rows, setRows] = useState<JsonRow[]>([]);
  const [record, setRecord] = useState<JsonRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>(() => defaultForm(resource));
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [suppliers, setSuppliers] = useState<JsonRow[]>([]);
  const [orders, setOrders] = useState<JsonRow[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    if (mode === "detail" && recordId) {
      const result = await requestJson<{ record: JsonRow }>(`/api/procurement/resources/${resource}/${recordId}`);
      if (!result.ok) throw new Error(result.message);
      setMessage("");
      setRecord(result.record);
      return;
    }
    if (mode === "list") {
      const result = await requestJson<{ rows: JsonRow[] }>(`/api/procurement/resources/${resource}?limit=100`);
      if (!result.ok) throw new Error(result.message);
      setMessage("");
      setRows(result.rows || []);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const reportError = (error: unknown) => {
      if (!cancelled) {
        setMessage(error instanceof Error ? error.message : "Procurement records could not be loaded.");
      }
    };

    if (mode === "detail" && recordId) {
      void requestJson<{ record: JsonRow }>(`/api/procurement/resources/${resource}/${recordId}`)
        .then((result) => {
          if (cancelled) return;
          if (!result.ok) {
            setMessage(result.message ?? String());
            return;
          }
          setMessage("");
          setRecord(result.record);
        })
        .catch(reportError);
    } else if (mode === "list") {
      void requestJson<{ rows: JsonRow[] }>(`/api/procurement/resources/${resource}?limit=100`)
        .then((result) => {
          if (cancelled) return;
          if (!result.ok) {
            setMessage(result.message ?? String());
            return;
          }
          setMessage("");
          setRows(result.rows || []);
        })
        .catch(reportError);
    }

    if (["agreements", "purchase-orders"].includes(resource)) {
      void requestJson<{ rows: JsonRow[] }>("/api/procurement/resources/suppliers?status=active&limit=200")
        .then((result) => {
          if (!cancelled && result.ok) setSuppliers(result.rows || []);
        })
        .catch(reportError);
    }
    if (resource === "receipts") {
      void requestJson<{ rows: JsonRow[] }>("/api/procurement/resources/purchase-orders?limit=200")
        .then((result) => {
          if (!cancelled && result.ok) {
            setOrders(
              (result.rows || []).filter((row) =>
                ["acknowledged", "partially_received", "dispatched"].includes(String(row.status)),
              ),
            );
          }
        })
        .catch(reportError);
    }

    return () => {
      cancelled = true;
    };
  }, [resource, mode, recordId]);

  const fields = useMemo(() => {
    if (!definition) return [];
    return definition.fields.map((field) => {
      if (field.key === "supplierId") {
        return { ...field, options: suppliers.map((row) => ({ value: String(row.id), label: titleFor(row) })) };
      }
      if (field.key === "purchaseOrderId") {
        return { ...field, options: orders.map((row) => ({ value: String(row.id), label: titleFor(row) })) };
      }
      return field;
    });
  }, [definition, suppliers, orders]);

  if (!definition) return <section className="panel"><h1>Unknown Procurement resource</h1></section>;

  function setLine(index: number, key: keyof Line, value: string) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line));
  }

  async function createRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const body: JsonRow = { ...form };
    if (definition.lines) body.lines = lines;
    const result = await requestJson<{ record: JsonRow }>(`/api/procurement/resources/${resource}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setPending(false);
    if (!result.ok) {
      setMessage(result.message || `The ${definition.singular} could not be created.`);
      return;
    }
    router.push(`${definition.basePath}/${result.record.id}`);
    router.refresh();
  }

  async function runAction(action: string) {
    if (!recordId) return;
    let reason = "";
    if (["reject", "cancel", "block", "suspend", "override", "reverse", "amend"].includes(action)) {
      reason = window.prompt(`Reason for ${action}`) || "";
      if (!reason) return;
    }
    const extra: JsonRow = { reason, expectedVersion: record?.version };
    if (action === "award") {
      const selectedBidId = window.prompt("Selected bid ID") || "";
      const supplierId = window.prompt("Supplier ID") || "";
      const expectedDeliveryDate = window.prompt("Expected delivery date (YYYY-MM-DD)", inDays(14)) || "";
      if (!selectedBidId || !supplierId || !expectedDeliveryDate) return;
      Object.assign(extra, { selectedBidId, supplierId, awardType: "purchase-order", expectedDeliveryDate, lines: record?.bids && Array.isArray(record.bids) ? (record.bids[0] as JsonRow)?.lines : [] });
    }
    setPending(true);
    const result = await requestJson<{ record?: JsonRow; sourceEvent?: JsonRow }>(`/api/procurement/resources/${resource}/${recordId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    setPending(false);
    setMessage(result.message || (result.ok ? `${action} completed.` : `${action} failed.`));
    if (result.ok) await load();
  }

  if (mode === "create") {
    return (
      <>
        <section className="page-heading">
          <div><p className="eyebrow">Source-to-pay</p><h1>New {definition.singular}</h1><p>{definition.description}</p></div>
        </section>
        {message ? <div className="form-message error" role="alert">{message}</div> : null}
        <form className="procurement-editor" onSubmit={createRecord}>
          <section className="panel">
            <div className="sales-form-grid">
              {fields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  {field.type === "select" ? (
                    <select required={field.required} value={form[field.key] || ""} onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}>
                      <option value="">Select</option>
                      {(field.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea required={field.required} value={form[field.key] || ""} onChange={(event) => setForm({ ...form, [field.key]: event.target.value })} />
                  ) : (
                    <input type={field.type || "text"} required={field.required} value={form[field.key] || ""} onChange={(event) => setForm({ ...form, [field.key]: event.target.value })} />
                  )}
                </label>
              ))}
            </div>
          </section>
          {definition.lines ? (
            <section className="panel">
              <div className="card-title-row">
                <div><p className="eyebrow">Line details</p><h2>{lines.length} line{lines.length === 1 ? "" : "s"}</h2></div>
                <button className="secondary-button" type="button" onClick={() => setLines([...lines, emptyLine()])}>Add line</button>
              </div>
              <div className="procurement-lines">
                {lines.map((line, index) => (
                  <div className="procurement-line" key={index}>
                    <label>Description<input required value={line.description} onChange={(event) => setLine(index, "description", event.target.value)} /></label>
                    <label>Quantity<input required inputMode="decimal" value={line.quantity} onChange={(event) => setLine(index, "quantity", event.target.value)} /></label>
                    <label>Unit price<input required inputMode="decimal" value={line.unitPrice} onChange={(event) => setLine(index, "unitPrice", event.target.value)} /></label>
                    <label>Tax amount<input inputMode="decimal" value={line.taxAmount} onChange={(event) => setLine(index, "taxAmount", event.target.value)} /></label>
                    <button className="link-button danger" type="button" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, lineIndex) => lineIndex !== index))}>Remove</button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <div className="form-row">
            <button className="primary-button" disabled={pending}>{pending ? "Saving…" : `Create ${definition.singular}`}</button>
            <Link className="secondary-button" href={definition.basePath}>Cancel</Link>
          </div>
        </form>
      </>
    );
  }

  if (mode === "detail") {
    const actions = record ? ACTIONS[resource]?.[String(record.status)] || [] : [];
    const lineRows = record && Array.isArray(record.lines) ? record.lines as JsonRow[] : [];
    return (
      <>
        <section className="page-heading">
          <div><p className="eyebrow">Procurement document</p><h1>{record ? titleFor(record) : `Loading ${definition.singular}…`}</h1><p>{definition.description}</p></div>
          <div className="page-heading-actions">
            <Link className="secondary-button" href={definition.basePath}>Back to list</Link>
            {actions.map((action) => <button className={action === "approve" || action === "activate" || action === "dispatch" ? "primary-button" : "secondary-button"} disabled={pending} key={action} onClick={() => runAction(action)}>{action.replaceAll("-", " ")}</button>)}
          </div>
        </section>
        {message ? <div className={message.includes("failed") ? "form-message error" : "notice"}>{message}</div> : null}
        {record ? (
          <>
            <section className="panel">
              <div className="procurement-detail-grid">
                {cleanRecord(record).slice(0, 24).map(([key, value]) => <dl key={key}><dt>{key.replaceAll(/([A-Z_])/g, " $1").replaceAll("_", " ")}</dt><dd>{String(value ?? "—")}</dd></dl>)}
              </div>
            </section>
            {lineRows.length ? (
              <section className="panel">
                <div className="card-title-row"><div><p className="eyebrow">Document lines</p><h2>{lineRows.length} line{lineRows.length === 1 ? "" : "s"}</h2></div></div>
                <div className="table-scroll"><table className="data-table"><thead><tr><th>Description</th><th>Quantity</th><th>Unit price</th><th>Received</th><th>Amount</th></tr></thead><tbody>{lineRows.map((line, index) => <tr key={String(line.id || index)}><td>{String(line.description || "—")}</td><td>{String(line.quantity || "—")}</td><td>{String(line.unitPrice || "—")}</td><td>{String(line.receivedQuantity || line.acceptedQuantity || "—")}</td><td>{Number(line.quantity || 0) * Number(line.unitPrice || 0)}</td></tr>)}</tbody></table></div>
              </section>
            ) : null}
          </>
        ) : <section className="panel"><p>{message || "Loading record…"}</p></section>}
      </>
    );
  }

  return (
    <>
      <section className="page-heading">
        <div><p className="eyebrow">Source-to-pay</p><h1>{definition.title}</h1><p>{definition.description}</p></div>
        <div className="page-heading-actions"><Link className="primary-button" href={`${definition.basePath}/new`}>New {definition.singular}</Link></div>
      </section>
      {message ? <div className="form-message error">{message}</div> : null}
      <section className="panel">
        <div className="card-title-row"><div><p className="eyebrow">Records</p><h2>{rows.length} loaded</h2></div><button className="secondary-button" type="button" onClick={() => load().catch(() => undefined)}>Refresh</button></div>
        <div className="resource-cards">
          {rows.map((row) => (
            <article className="resource-card" key={String(row.id)}>
              <div><strong>{titleFor(row)}</strong><span>{String(row.status || "draft")} · version {String(row.version || 1)}</span></div>
              <dl>{cleanRecord(row).slice(0, 5).map(([key, value]) => <div key={key}><dt>{key.replaceAll(/([A-Z_])/g, " $1").replaceAll("_", " ")}</dt><dd>{String(value ?? "—")}</dd></div>)}</dl>
              <Link className="link-button" href={`${definition.basePath}/${row.id}`}>Open record</Link>
            </article>
          ))}
          {!rows.length ? <div className="empty-state"><strong>No {definition.title.toLowerCase()} yet</strong><p>Create the first governed record to begin this workflow.</p></div> : null}
        </div>
      </section>
    </>
  );
}

export function ProcurementMatchingWorkspace() {
  const [orders, setOrders] = useState<JsonRow[]>([]);
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [matchMode, setMatchMode] = useState("three-way");
  const [tolerancePercent, setTolerancePercent] = useState("0");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [result, setResult] = useState<JsonRow | null>(null);
  const [vendorBillId, setVendorBillId] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    requestJson<{ rows: JsonRow[] }>("/api/procurement/resources/purchase-orders?limit=200")
      .then((response) => response.ok && setOrders(response.rows || []));
  }, []);
  async function run(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const response = await requestJson<JsonRow>("/api/procurement/matching/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseOrderId, invoiceNumber, matchMode, tolerancePercent, invoiceLines: lines }),
    });
    setPending(false);
    setMessage(response.message || (response.ok ? "Matching completed." : "Matching failed."));
    if (response.ok) {
      setResult(response);
      setVendorBillId("");
    }
  }
  async function createVendorBill() {
    const matchingRecord = result?.matchingRecord as JsonRow | undefined;
    const matchingRecordId = String(matchingRecord?.id || "");
    if (!matchingRecordId) return;
    setImporting(true);
    const response = await requestJson<{ bill: JsonRow }>(
      `/api/accounting/payables/procurement-matches/${matchingRecordId}/import`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billDate: today(), accountingDate: today() }),
      },
    );
    setImporting(false);
    if (!response.ok) {
      setMessage(response.message || "Vendor bill could not be created.");
      return;
    }
    const detail = response.bill as JsonRow;
    const header = detail.bill as JsonRow | undefined;
    const id = String(header?.id || detail.id || "");
    setVendorBillId(id);
    setMessage("Matched supplier invoice was imported into Accounting as a draft vendor bill.");
  }
  const matchingRecord = result?.matchingRecord as JsonRow | undefined;
  const canImport = matchingRecord?.status === "matched" && Boolean(matchingRecord.id);
  return (
    <>
      <section className="page-heading"><div><p className="eyebrow">Accounting control</p><h1>Invoice matching</h1><p>Run two-way, three-way or four-way matching before a supplier invoice is released to Accounting.</p></div></section>
      {message ? <div className={result ? "notice" : "form-message error"}>{message}</div> : null}
      <form className="procurement-editor" onSubmit={run}>
        <section className="panel"><div className="sales-form-grid">
          <label>Purchase order<select required value={purchaseOrderId} onChange={(event) => setPurchaseOrderId(event.target.value)}><option value="">Select</option>{orders.map((row) => <option key={String(row.id)} value={String(row.id)}>{titleFor(row)}</option>)}</select></label>
          <label>Invoice number<input required value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} /></label>
          <label>Match mode<select value={matchMode} onChange={(event) => setMatchMode(event.target.value)}><option value="two-way">Two-way</option><option value="three-way">Three-way</option><option value="four-way">Four-way</option></select></label>
          <label>Tolerance %<input inputMode="decimal" value={tolerancePercent} onChange={(event) => setTolerancePercent(event.target.value)} /></label>
        </div></section>
        <section className="panel"><div className="card-title-row"><div><p className="eyebrow">Supplier invoice</p><h2>Invoice lines</h2></div><button className="secondary-button" type="button" onClick={() => setLines([...lines, emptyLine()])}>Add line</button></div>
          <div className="procurement-lines">{lines.map((line, index) => <div className="procurement-line" key={index}><label>Description<input required value={line.description} onChange={(event) => setLines(lines.map((entry, lineIndex) => lineIndex === index ? { ...entry, description: event.target.value } : entry))} /></label><label>Quantity<input required value={line.quantity} onChange={(event) => setLines(lines.map((entry, lineIndex) => lineIndex === index ? { ...entry, quantity: event.target.value } : entry))} /></label><label>Unit price<input required value={line.unitPrice} onChange={(event) => setLines(lines.map((entry, lineIndex) => lineIndex === index ? { ...entry, unitPrice: event.target.value } : entry))} /></label><label>Tax<input value={line.taxAmount} onChange={(event) => setLines(lines.map((entry, lineIndex) => lineIndex === index ? { ...entry, taxAmount: event.target.value } : entry))} /></label><button className="link-button danger" type="button" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, lineIndex) => lineIndex !== index))}>Remove</button></div>)}</div>
        </section>
        <button className="primary-button" disabled={pending}>{pending ? "Matching…" : "Run invoice match"}</button>
      </form>
      {result ? (
        <section className="panel">
          <div className="card-title-row">
            <div><p className="eyebrow">Match result</p><h2>{String(matchingRecord?.status || "completed")}</h2></div>
            {canImport && !vendorBillId ? (
              <button className="primary-button" type="button" disabled={importing} onClick={() => createVendorBill().catch(() => undefined)}>
                {importing ? "Creating vendor bill…" : "Create Accounting vendor bill"}
              </button>
            ) : null}
            {vendorBillId ? <Link className="primary-button" href={`/accounting/payables/${vendorBillId}`}>Open vendor bill</Link> : null}
          </div>
          {matchingRecord?.status === "exception" ? <p className="form-message error">Resolve the matching exception before the invoice can enter Accounting.</p> : null}
          <pre className="procurement-json">{JSON.stringify(result, null, 2)}</pre>
        </section>
      ) : null}
    </>
  );
}

export function ProcurementReportsWorkspace() {
  const [report, setReport] = useState<string>(PROCUREMENT_REPORTS[0]);
  const [rows, setRows] = useState<JsonRow[]>([]);
  const [message, setMessage] = useState("");
  async function load(selected = report) {
    const response = await requestJson<{ rows: JsonRow[] }>(`/api/procurement/reports/${selected}`);
    if (!response.ok) setMessage(response.message || "Report could not be loaded.");
    else { setMessage(""); setRows(response.rows || []); }
  }
  useEffect(() => {
    let cancelled = false;
    void requestJson<{ rows: JsonRow[] }>(`/api/procurement/reports/${PROCUREMENT_REPORTS[0]}`)
      .then((response) => {
        if (cancelled) return;
        if (!response.ok) {
          setMessage(response.message || "Report could not be loaded.");
          return;
        }
        setMessage("");
        setRows(response.rows || []);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "Report could not be loaded.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <>
      <section className="page-heading"><div><p className="eyebrow">Source-to-pay intelligence</p><h1>Procurement analytics</h1><p>Live spend, savings, compliance, variance, commitment, cycle-time and supplier-risk reporting.</p></div></section>
      <section className="panel"><div className="form-row"><label>Report<select value={report} onChange={(event) => { setReport(event.target.value); load(event.target.value).catch(() => undefined); }}>{PROCUREMENT_REPORTS.map((key) => <option key={key} value={key}>{key.replaceAll("-", " ")}</option>)}</select></label><button className="secondary-button" type="button" onClick={() => load().catch(() => undefined)}>Refresh</button></div>{message ? <p className="form-message error">{message}</p> : null}<div className="table-scroll"><table className="data-table"><thead><tr><th>Dimension</th><th>Documents</th><th>Metric value</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><td>{String(row.dimension_value || row.dimensionValue || "—")}</td><td>{String(row.document_count || "—")}</td><td>{String(row.metric_value || "—")}</td></tr>)}</tbody></table></div></section>
    </>
  );
}
