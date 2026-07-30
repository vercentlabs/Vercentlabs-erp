"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import AppIcon, { type AppIconName } from "@/components/app-icon";
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
    pending_amendment_approval: ["approve-amendment", "reject-amendment"],
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

const formatCurrency = (value: unknown, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const humanize = (value: string) =>
  value
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/^./, (character) => character.toUpperCase());

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  if (typeof value === "object") return "Configured";
  return String(value).replaceAll("_", " ");
}

const resourceIcon: Record<string, AppIconName> = {
  suppliers: "companies",
  requisitions: "procurement",
  "sourcing-events": "sparkles",
  agreements: "audit",
  "purchase-orders": "procurement",
  receipts: "check",
};

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
    let cancelled = false;
    void requestJson<{ dashboard: JsonRow }>("/api/procurement/dashboard")
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) throw new Error(result.message);
        setDashboard(result.dashboard);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Dashboard could not be loaded.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const metrics = [
    {
      label: "Open commitments",
      value: dashboard ? formatCurrency(dashboard.open_commitment_value) : "…",
      meta: `${String(dashboard?.open_orders ?? 0)} purchase orders in flight`,
      href: "/procurement/orders",
      icon: "procurement" as const,
      tone: "indigo",
    },
    {
      label: "Pending requisitions",
      value: dashboard ? String(dashboard.pending_requisitions ?? 0) : "…",
      meta: "Demand waiting for review or approval",
      href: "/procurement/requisitions",
      icon: "approvals" as const,
      tone: "cyan",
    },
    {
      label: "Active sourcing",
      value: dashboard ? String(dashboard.active_sourcing ?? 0) : "…",
      meta: "Live RFQ, RFP, tender and auction events",
      href: "/procurement/sourcing",
      icon: "sparkles" as const,
      tone: "emerald",
    },
    {
      label: "Control exceptions",
      value: dashboard
        ? String(
            Number(dashboard.match_exceptions || 0) +
              Number(dashboard.supplier_risks || 0),
          )
        : "…",
      meta: "Matching exceptions and supplier risks",
      href: "/procurement/matching",
      icon: "security" as const,
      tone: "amber",
    },
  ];

  return (
    <div className="module-workbench procurement-workbench">
      <section className="module-hero">
        <div className="module-hero-copy">
          <span className="module-hero-icon" aria-hidden="true">
            <AppIcon name="procurement" size={22} />
          </span>
          <div>
            <p className="eyebrow">Source-to-pay</p>
            <h1>Procurement operations workspace</h1>
            <p>
              Turn internal demand into compliant supplier commitments while
              keeping approvals, receipts, matching and risk visible.
            </p>
          </div>
        </div>
        <div className="module-hero-actions">
          <Link className="primary-button" href="/procurement/requisitions/new">
            New requisition
          </Link>
          <Link className="secondary-button" href="/procurement/orders/new">
            New purchase order
          </Link>
          <Link className="secondary-button" href="/procurement/suppliers/new">
            Add supplier
          </Link>
        </div>
      </section>

      {message ? (
        <div className="form-message error" role="alert">
          {message}
        </div>
      ) : null}

      <section className="module-metric-grid" aria-label="Procurement performance">
        {metrics.map((metric) => (
          <Link
            className={`module-metric-card tone-${metric.tone}`}
            href={metric.href}
            key={metric.label}
          >
            <span className="module-metric-icon" aria-hidden="true">
              <AppIcon name={metric.icon} size={18} />
            </span>
            <span className="module-metric-label">{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.meta}</small>
            <span className="module-card-arrow" aria-hidden="true">→</span>
          </Link>
        ))}
      </section>

      <section className="attention-strip" aria-label="Procurement attention queue">
        <Link href="/procurement/requisitions">
          <span className="attention-dot warning" />
          <strong>{String(dashboard?.pending_requisitions ?? 0)}</strong>
          <span>Requisitions awaiting action</span>
        </Link>
        <Link href="/procurement/receipts">
          <span className="attention-dot info" />
          <strong>{String(dashboard?.pending_receipts ?? 0)}</strong>
          <span>Receipts pending confirmation</span>
        </Link>
        <Link href="/procurement/matching">
          <span className="attention-dot danger" />
          <strong>{String(dashboard?.match_exceptions ?? 0)}</strong>
          <span>Invoice matching exceptions</span>
        </Link>
        <Link href="/procurement/suppliers">
          <span className="attention-dot danger" />
          <strong>{String(dashboard?.supplier_risks ?? 0)}</strong>
          <span>Suppliers requiring risk review</span>
        </Link>
      </section>

      <section className="process-rail procurement-process-rail" aria-label="Source-to-pay lifecycle">
        {[
          ["01", "Request", "Business demand", "/procurement/requisitions"],
          ["02", "Source", "Competitive event", "/procurement/sourcing"],
          ["03", "Contract", "Agreement control", "/procurement/contracts"],
          ["04", "Order", "Supplier commitment", "/procurement/orders"],
          ["05", "Receive", "Goods and services", "/procurement/receipts"],
          ["06", "Match", "Invoice control", "/procurement/matching"],
          ["07", "Pay", "Accounting handoff", "/accounting/payables"],
        ].map(([number, label, description, href], index) => (
          <Link href={href} key={href}>
            <span className="process-rail-number">{number}</span>
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            {index < 6 ? <i aria-hidden="true">→</i> : null}
          </Link>
        ))}
      </section>

      <section className="panel module-panel workflow-overview-panel procurement-navigation">
        <div className="module-section-heading">
          <div>
            <p className="eyebrow">Operational workspaces</p>
            <h2>Work by source-to-pay responsibility</h2>
            <p>Each workspace keeps its own actions, evidence and exceptions visible.</p>
          </div>
          <Link className="link-button" href="/procurement/reports">
            Open analytics
          </Link>
        </div>
        <div className="workflow-overview-grid procurement-workspace-grid">
          {[
            ["Suppliers", "/procurement/suppliers", "Qualification, compliance, sites, risk and performance.", "companies" as const],
            ["Requisitions", "/procurement/requisitions", "Demand, cost ownership, policies and approvals.", "approvals" as const],
            ["Strategic sourcing", "/procurement/sourcing", "Invitations, bids, evaluations and awards.", "sparkles" as const],
            ["Agreements", "/procurement/contracts", "Commercial terms, validity and consumption.", "audit" as const],
            ["Purchase orders", "/procurement/orders", "Commitments, dispatch, acknowledgement and amendments.", "procurement" as const],
            ["Receiving", "/procurement/receipts", "Accepted quantities, inspection evidence and returns.", "check" as const],
            ["Invoice matching", "/procurement/matching", "Two-way, three-way and four-way controls.", "accounting" as const],
            ["Analytics", "/procurement/reports", "Spend, savings, compliance, variance and risk.", "dashboard" as const],
          ].map(([label, href, description, icon]) => (
            <Link href={href} key={href}>
              <span aria-hidden="true"><AppIcon name={icon as AppIconName} size={19} /></span>
              <strong>{label}</strong>
              <small>{description}</small>
              <b>Open workspace →</b>
            </Link>
          ))}
        </div>
      </section>
    </div>
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
  const [search, setSearch] = useState("");

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
            setMessage(result.message || "Procurement records could not be loaded.");
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
            setMessage(result.message || "Procurement records could not be loaded.");
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

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      [titleFor(row), String(row.status || ""), ...cleanRecord(row).map(([, value]) => String(value || ""))]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [rows, search]);

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
    if (["reject", "reject-amendment", "cancel", "block", "suspend", "override", "reverse", "amend"].includes(action)) {
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
      <div className="module-workbench procurement-document-workbench">
        <section className="page-heading module-page-heading">
          <div>
            <p className="eyebrow">Source-to-pay · {definition.title}</p>
            <h1>New {definition.singular}</h1>
            <p>{definition.description}</p>
          </div>
          <Link className="secondary-button" href={definition.basePath}>
            Cancel
          </Link>
        </section>

        {message ? (
          <div className="form-message error" role="alert">
            {message}
          </div>
        ) : null}

        <form className="enterprise-document-editor" onSubmit={createRecord}>
          <div className="enterprise-document-main">
            <section className="panel module-panel document-section">
              <div className="module-section-heading">
                <div>
                  <p className="eyebrow">Document header</p>
                  <h2>Business context</h2>
                  <p>Capture the minimum information required to route and govern this record.</p>
                </div>
                <span className="document-section-index">01</span>
              </div>
              <div className="enterprise-form-grid">
                {fields.map((field) => (
                  <label
                    className={field.type === "textarea" ? "field-span-2" : undefined}
                    key={field.key}
                  >
                    <span>
                      {field.label}
                      {field.required ? <b aria-hidden="true">*</b> : null}
                    </span>
                    {field.type === "select" ? (
                      <select
                        required={field.required}
                        value={form[field.key] || ""}
                        onChange={(event) =>
                          setForm({ ...form, [field.key]: event.target.value })
                        }
                      >
                        <option value="">Select {field.label.toLowerCase()}</option>
                        {(field.options || []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : field.type === "textarea" ? (
                      <textarea
                        required={field.required}
                        rows={4}
                        value={form[field.key] || ""}
                        onChange={(event) =>
                          setForm({ ...form, [field.key]: event.target.value })
                        }
                      />
                    ) : (
                      <input
                        type={field.type || "text"}
                        required={field.required}
                        value={form[field.key] || ""}
                        onChange={(event) =>
                          setForm({ ...form, [field.key]: event.target.value })
                        }
                      />
                    )}
                  </label>
                ))}
              </div>
            </section>

            {definition.lines ? (
              <section className="panel module-panel document-section">
                <div className="module-section-heading">
                  <div>
                    <p className="eyebrow">Line details</p>
                    <h2>{lines.length} line{lines.length === 1 ? "" : "s"}</h2>
                    <p>Keep quantities, commercial value and tax visible on one line.</p>
                  </div>
                  <div className="section-heading-actions">
                    <span className="document-section-index">02</span>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setLines([...lines, emptyLine()])}
                    >
                      Add line
                    </button>
                  </div>
                </div>
                <div className="enterprise-line-editor">
                  <div className="enterprise-line-head" aria-hidden="true">
                    <span>Description</span>
                    <span>Quantity</span>
                    <span>Unit price</span>
                    <span>Tax</span>
                    <span />
                  </div>
                  {lines.map((line, index) => (
                    <div className="enterprise-line-row" key={index}>
                      <label>
                        <span className="mobile-field-label">Description</span>
                        <input
                          required
                          value={line.description}
                          onChange={(event) =>
                            setLine(index, "description", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        <span className="mobile-field-label">Quantity</span>
                        <input
                          required
                          inputMode="decimal"
                          value={line.quantity}
                          onChange={(event) =>
                            setLine(index, "quantity", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        <span className="mobile-field-label">Unit price</span>
                        <input
                          required
                          inputMode="decimal"
                          value={line.unitPrice}
                          onChange={(event) =>
                            setLine(index, "unitPrice", event.target.value)
                          }
                        />
                      </label>
                      <label>
                        <span className="mobile-field-label">Tax amount</span>
                        <input
                          inputMode="decimal"
                          value={line.taxAmount}
                          onChange={(event) =>
                            setLine(index, "taxAmount", event.target.value)
                          }
                        />
                      </label>
                      <button
                        className="icon-button danger"
                        type="button"
                        aria-label={`Remove line ${index + 1}`}
                        disabled={lines.length === 1}
                        onClick={() =>
                          setLines(
                            lines.filter((_, lineIndex) => lineIndex !== index),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <aside className="enterprise-document-aside">
            <section className="panel document-assurance-card">
              <span className="assurance-icon" aria-hidden="true">
                <AppIcon name={resourceIcon[resource] || "procurement"} size={20} />
              </span>
              <p className="eyebrow">Governed creation</p>
              <h2>Before you save</h2>
              <ul>
                <li>Confirm the active company and operating context.</li>
                <li>Use clear business evidence instead of internal shorthand.</li>
                {definition.lines ? <li>Check quantity, price and tax on every line.</li> : null}
                <li>Submission and approval actions remain separate after creation.</li>
              </ul>
            </section>
            <div className="sticky-document-actions">
              <button className="primary-button" disabled={pending}>
                {pending ? "Saving…" : `Create ${definition.singular}`}
              </button>
              <Link className="secondary-button" href={definition.basePath}>
                Cancel
              </Link>
            </div>
          </aside>
        </form>
      </div>
    );
  }

  if (mode === "detail") {
    const actions = record ? ACTIONS[resource]?.[String(record.status)] || [] : [];
    const lineRows = record && Array.isArray(record.lines) ? (record.lines as JsonRow[]) : [];
    const status = String(record?.status || "loading");
    return (
      <div className="module-workbench procurement-document-workbench">
        <section className="object-page-header">
          <div className="object-page-identity">
            <span className="object-page-icon" aria-hidden="true">
              <AppIcon name={resourceIcon[resource] || "procurement"} size={22} />
            </span>
            <div>
              <p className="eyebrow">{definition.title}</p>
              <h1>{record ? titleFor(record) : `Loading ${definition.singular}…`}</h1>
              <p>{definition.description}</p>
            </div>
          </div>
          <div className="object-page-status">
            <span className={`status-badge status-${status}`}>{humanize(status)}</span>
            {record?.version ? <small>Version {String(record.version)}</small> : null}
          </div>
        </section>

        <section className="object-action-bar" aria-label="Document actions">
          <Link className="secondary-button" href={definition.basePath}>
            ← Back to list
          </Link>
          <div>
            {actions.map((action) => (
              <button
                className={
                  ["approve", "activate", "dispatch", "acknowledge"].includes(action)
                    ? "primary-button"
                    : ["reject", "cancel", "block", "reverse"].includes(action)
                      ? "danger-button"
                      : "secondary-button"
                }
                disabled={pending}
                key={action}
                onClick={() => runAction(action)}
              >
                {humanize(action)}
              </button>
            ))}
          </div>
        </section>

        {message ? (
          <div
            className={message.toLowerCase().includes("failed") ? "form-message error" : "notice"}
            role="status"
          >
            {message}
          </div>
        ) : null}

        {record ? (
          <div className="object-page-layout">
            <div className="object-page-main">
              <section className="panel module-panel">
                <div className="module-section-heading">
                  <div>
                    <p className="eyebrow">Document facts</p>
                    <h2>Business and control context</h2>
                  </div>
                </div>
                <div className="document-fact-grid">
                  {cleanRecord(record)
                    .slice(0, 24)
                    .map(([key, value]) => (
                      <dl key={key}>
                        <dt>{humanize(key)}</dt>
                        <dd>{displayValue(value)}</dd>
                      </dl>
                    ))}
                </div>
              </section>

              {lineRows.length ? (
                <section className="panel module-panel">
                  <div className="module-section-heading">
                    <div>
                      <p className="eyebrow">Document lines</p>
                      <h2>{lineRows.length} line{lineRows.length === 1 ? "" : "s"}</h2>
                    </div>
                  </div>
                  <div className="table-scroll enterprise-table-wrap">
                    <table className="data-table enterprise-data-table">
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th className="numeric-column">Quantity</th>
                          <th className="numeric-column">Unit price</th>
                          <th className="numeric-column">Received</th>
                          <th className="numeric-column">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lineRows.map((line, index) => {
                          const amount = Number(line.quantity || 0) * Number(line.unitPrice || 0);
                          return (
                            <tr key={String(line.id || index)}>
                              <td>
                                <strong>{String(line.description || "Untitled line")}</strong>
                                {line.itemCode ? <small>{String(line.itemCode)}</small> : null}
                              </td>
                              <td className="numeric-column">{displayValue(line.quantity)}</td>
                              <td className="numeric-column">{formatCurrency(line.unitPrice, String(record.currencyCode || "INR"))}</td>
                              <td className="numeric-column">{displayValue(line.receivedQuantity || line.acceptedQuantity)}</td>
                              <td className="numeric-column"><strong>{formatCurrency(amount, String(record.currencyCode || "INR"))}</strong></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
            </div>

            <aside className="object-page-aside">
              <section className="panel object-status-card">
                <p className="eyebrow">Lifecycle</p>
                <h2>{humanize(status)}</h2>
                <p>Available actions are controlled by the current state and your permissions.</p>
                <div className="object-status-meta">
                  <span><small>Record type</small><strong>{definition.singular}</strong></span>
                  <span><small>Version</small><strong>{String(record.version || 1)}</strong></span>
                  <span><small>Lines</small><strong>{String(lineRows.length)}</strong></span>
                </div>
              </section>
              <section className="panel object-guidance-card">
                <p className="eyebrow">Control guidance</p>
                <ul>
                  <li>Use approval actions only after reviewing supporting evidence.</li>
                  <li>Reasons are required for rejection, cancellation and overrides.</li>
                  <li>Every transition is preserved in the procurement audit trail.</li>
                </ul>
              </section>
            </aside>
          </div>
        ) : (
          <section className="panel module-loading-state">
            <span className="loading-spinner" aria-hidden="true" />
            <p>{message || "Loading record…"}</p>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="module-workbench procurement-resource-workbench">
      <section className="page-heading module-page-heading">
        <div>
          <p className="eyebrow">Source-to-pay · {definition.title}</p>
          <h1>{definition.title}</h1>
          <p>{definition.description}</p>
        </div>
        <Link className="primary-button" href={`${definition.basePath}/new`}>
          New {definition.singular}
        </Link>
      </section>

      {message ? <div className="form-message error">{message}</div> : null}

      <section className="panel module-panel module-list-panel">
        <div className="module-list-toolbar">
          <label className="module-list-search">
            <span className="sr-only">Search {definition.title.toLowerCase()}</span>
            <AppIcon name="search" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${definition.title.toLowerCase()}`}
            />
          </label>
          <div className="module-list-summary">
            <span><strong>{filteredRows.length}</strong> shown</span>
            <span><strong>{rows.length}</strong> total</span>
            <button
              className="secondary-button"
              type="button"
              onClick={() => load().catch(() => undefined)}
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="enterprise-record-list">
          {filteredRows.map((row) => {
            const facts = cleanRecord(row).slice(0, 3);
            const status = String(row.status || "draft");
            return (
              <Link href={`${definition.basePath}/${row.id}`} key={String(row.id)}>
                <span className="record-list-icon" aria-hidden="true">
                  <AppIcon name={resourceIcon[resource] || "procurement"} size={18} />
                </span>
                <span className="record-list-primary">
                  <strong>{titleFor(row)}</strong>
                  <small>{humanize(definition.singular)} · Version {String(row.version || 1)}</small>
                </span>
                <span className="record-list-facts">
                  {facts.map(([key, value]) => (
                    <span key={key}>
                      <small>{humanize(key)}</small>
                      <strong>{displayValue(value)}</strong>
                    </span>
                  ))}
                </span>
                <span className={`status-badge status-${status}`}>{humanize(status)}</span>
                <span className="record-list-open" aria-hidden="true">→</span>
              </Link>
            );
          })}

          {!filteredRows.length ? (
            <div className="module-empty-state">
              <span className="module-empty-icon" aria-hidden="true">
                <AppIcon name={search ? "search" : resourceIcon[resource] || "procurement"} size={22} />
              </span>
              <strong>{search ? "No matching records" : `No ${definition.title.toLowerCase()} yet`}</strong>
              <p>
                {search
                  ? "Try a broader search term or clear the current query."
                  : `Create the first governed ${definition.singular} to begin this workflow.`}
              </p>
              {!search ? (
                <Link className="primary-button" href={`${definition.basePath}/new`}>
                  New {definition.singular}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
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
    let cancelled = false;
    void requestJson<{ rows: JsonRow[] }>(
      "/api/procurement/resources/purchase-orders?limit=200",
    ).then((response) => {
      if (!cancelled && response.ok) setOrders(response.rows || []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult(null);
    const response = await requestJson<JsonRow>("/api/procurement/matching/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purchaseOrderId,
        invoiceNumber,
        matchMode,
        tolerancePercent,
        invoiceLines: lines,
      }),
    });
    setPending(false);
    setMessage(
      response.message ||
        (response.ok ? "Matching completed." : "Matching failed."),
    );
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
    setMessage(
      "Matched supplier invoice was imported into Accounting as a draft vendor bill.",
    );
  }

  const matchingRecord = result?.matchingRecord as JsonRow | undefined;
  const matchingData = (matchingRecord?.data || matchingRecord?.match_data || {}) as JsonRow;
  const exceptions = Array.isArray(result?.exceptions)
    ? (result?.exceptions as unknown[])
    : Array.isArray(matchingData.exceptions)
      ? (matchingData.exceptions as unknown[])
      : [];
  const checks = Array.isArray(matchingData.checks)
    ? (matchingData.checks as unknown[])
    : [];
  const canImport = matchingRecord?.status === "matched" && Boolean(matchingRecord.id);
  const selectedOrder = orders.find((order) => String(order.id) === purchaseOrderId);
  const invoiceTotal = lines.reduce(
    (total, line) =>
      total +
      Number(line.quantity || 0) * Number(line.unitPrice || 0) +
      Number(line.taxAmount || 0),
    0,
  );

  return (
    <div className="module-workbench procurement-workbench matching-workbench">
      <section className="module-hero compact-module-hero">
        <div className="module-hero-copy">
          <span className="module-hero-icon" aria-hidden="true">
            <AppIcon name="procurement" size={22} />
          </span>
          <div>
            <p className="eyebrow">Procurement · Accounting control</p>
            <h1>Invoice matching</h1>
            <p>
              Compare the supplier invoice with the commercial commitment,
              received quantity and inspection evidence before creating a payable.
            </p>
          </div>
        </div>
        <div className="matching-mode-summary" aria-label="Available matching modes">
          <span className={matchMode === "two-way" ? "active" : ""}>2-way</span>
          <span className={matchMode === "three-way" ? "active" : ""}>3-way</span>
          <span className={matchMode === "four-way" ? "active" : ""}>4-way</span>
        </div>
      </section>

      {message ? (
        <div
          className={
            matchingRecord?.status === "exception"
              ? "form-message error"
              : "notice"
          }
          role="status"
        >
          {message}
        </div>
      ) : null}

      <form className="enterprise-document-editor" onSubmit={run}>
        <div className="enterprise-editor-main">
          <section className="enterprise-editor-section">
            <header className="enterprise-section-heading">
              <span>01</span>
              <div>
                <p className="eyebrow">Control context</p>
                <h2>Invoice and purchase order</h2>
                <p>Select the governed commitment and define the allowed variance.</p>
              </div>
            </header>
            <div className="enterprise-form-grid">
              <label className="field-span-2">
                Purchase order
                <select
                  required
                  value={purchaseOrderId}
                  onChange={(event) => setPurchaseOrderId(event.target.value)}
                >
                  <option value="">Select purchase order</option>
                  {orders.map((row) => (
                    <option key={String(row.id)} value={String(row.id)}>
                      {titleFor(row)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Supplier invoice number
                <input
                  required
                  value={invoiceNumber}
                  onChange={(event) => setInvoiceNumber(event.target.value)}
                  placeholder="For example, INV-2026-1042"
                />
              </label>
              <label>
                Match mode
                <select
                  value={matchMode}
                  onChange={(event) => setMatchMode(event.target.value)}
                >
                  <option value="two-way">Two-way · PO and invoice</option>
                  <option value="three-way">Three-way · PO, receipt and invoice</option>
                  <option value="four-way">Four-way · Include inspection</option>
                </select>
              </label>
              <label>
                Tolerance percentage
                <input
                  inputMode="decimal"
                  value={tolerancePercent}
                  onChange={(event) => setTolerancePercent(event.target.value)}
                />
                <small>Variance outside this threshold creates an exception.</small>
              </label>
            </div>
          </section>

          <section className="enterprise-editor-section">
            <header className="enterprise-section-heading with-action">
              <span>02</span>
              <div>
                <p className="eyebrow">Supplier invoice</p>
                <h2>Invoice lines</h2>
                <p>Capture the quantities, prices and tax exactly as invoiced.</p>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setLines([...lines, emptyLine()])}
              >
                Add line
              </button>
            </header>
            <div className="enterprise-line-editor">
              <div className="enterprise-line-header" aria-hidden="true">
                <span>Description</span>
                <span>Quantity</span>
                <span>Unit price</span>
                <span>Tax</span>
                <span />
              </div>
              {lines.map((line, index) => (
                <div className="enterprise-line-row compact-line-row" key={index}>
                  <label>
                    <span className="mobile-field-label">Description</span>
                    <input
                      required
                      value={line.description}
                      onChange={(event) =>
                        setLines(
                          lines.map((entry, lineIndex) =>
                            lineIndex === index
                              ? { ...entry, description: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    <span className="mobile-field-label">Quantity</span>
                    <input
                      required
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(event) =>
                        setLines(
                          lines.map((entry, lineIndex) =>
                            lineIndex === index
                              ? { ...entry, quantity: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    <span className="mobile-field-label">Unit price</span>
                    <input
                      required
                      inputMode="decimal"
                      value={line.unitPrice}
                      onChange={(event) =>
                        setLines(
                          lines.map((entry, lineIndex) =>
                            lineIndex === index
                              ? { ...entry, unitPrice: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    <span className="mobile-field-label">Tax</span>
                    <input
                      inputMode="decimal"
                      value={line.taxAmount}
                      onChange={(event) =>
                        setLines(
                          lines.map((entry, lineIndex) =>
                            lineIndex === index
                              ? { ...entry, taxAmount: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    className="line-remove-button"
                    type="button"
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines(lines.filter((_, lineIndex) => lineIndex !== index))
                    }
                    aria-label={`Remove invoice line ${index + 1}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="enterprise-editor-aside">
          <section className="assurance-card matching-control-card">
            <p className="eyebrow">Control sequence</p>
            <h2>Ready to match</h2>
            <ol className="control-checklist">
              <li className={purchaseOrderId ? "complete" : ""}>
                <span>{purchaseOrderId ? "✓" : "1"}</span>
                Purchase order selected
              </li>
              <li className={invoiceNumber ? "complete" : ""}>
                <span>{invoiceNumber ? "✓" : "2"}</span>
                Invoice identified
              </li>
              <li className={lines.every((line) => line.description && line.quantity) ? "complete" : ""}>
                <span>{lines.every((line) => line.description && line.quantity) ? "✓" : "3"}</span>
                Invoice lines captured
              </li>
            </ol>
            <dl className="document-summary-list">
              <div>
                <dt>Purchase order</dt>
                <dd>{selectedOrder ? titleFor(selectedOrder) : "Not selected"}</dd>
              </div>
              <div>
                <dt>Invoice total</dt>
                <dd>{formatCurrency(invoiceTotal, String(selectedOrder?.currency_code || "INR"))}</dd>
              </div>
              <div>
                <dt>Variance tolerance</dt>
                <dd>{tolerancePercent || "0"}%</dd>
              </div>
            </dl>
            <button className="primary-button full-width-button" disabled={pending}>
              {pending ? "Running controls…" : "Run invoice match"}
            </button>
          </section>
        </aside>
      </form>

      {result ? (
        <section className={`match-result-card status-${String(matchingRecord?.status || "completed")}`}>
          <header className="match-result-header">
            <div className="match-result-identity">
              <span className="match-result-icon" aria-hidden="true">
                <AppIcon
                  name={matchingRecord?.status === "matched" ? "check" : "audit"}
                  size={22}
                />
              </span>
              <div>
                <p className="eyebrow">Control outcome</p>
                <h2>{humanize(String(matchingRecord?.status || "completed"))}</h2>
                <p>
                  {matchingRecord?.status === "matched"
                    ? "The invoice passed the selected controls and can enter Accounts Payable."
                    : "The invoice needs review before a payable can be created."}
                </p>
              </div>
            </div>
            <div className="match-result-actions">
              {canImport && !vendorBillId ? (
                <button
                  className="primary-button"
                  type="button"
                  disabled={importing}
                  onClick={() => createVendorBill().catch(() => undefined)}
                >
                  {importing ? "Creating vendor bill…" : "Create Accounting vendor bill"}
                </button>
              ) : null}
              {vendorBillId ? (
                <Link className="primary-button" href={`/accounting/payables/${vendorBillId}`}>
                  Open vendor bill
                </Link>
              ) : null}
            </div>
          </header>

          <div className="match-result-grid">
            <dl className="object-facts-grid match-facts-grid">
              <div>
                <dt>Invoice</dt>
                <dd>{invoiceNumber}</dd>
              </div>
              <div>
                <dt>Match mode</dt>
                <dd>{humanize(matchMode)}</dd>
              </div>
              <div>
                <dt>Purchase order</dt>
                <dd>{selectedOrder ? titleFor(selectedOrder) : purchaseOrderId}</dd>
              </div>
              <div>
                <dt>Invoice value</dt>
                <dd>{formatCurrency(invoiceTotal, String(selectedOrder?.currency_code || "INR"))}</dd>
              </div>
            </dl>

            <div className="match-evidence-grid">
              <section>
                <p className="eyebrow">Checks completed</p>
                {checks.length ? (
                  <ul className="evidence-list success-list">
                    {checks.map((check, index) => (
                      <li key={index}>{displayValue(check)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-copy">The control engine completed the selected matching policy.</p>
                )}
              </section>
              <section>
                <p className="eyebrow">Exceptions</p>
                {exceptions.length ? (
                  <ul className="evidence-list exception-list">
                    {exceptions.map((exception, index) => (
                      <li key={index}>{displayValue(exception)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="success-copy">No unresolved exceptions were returned.</p>
                )}
              </section>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

const PROCUREMENT_REPORT_META: Record<
  (typeof PROCUREMENT_REPORTS)[number],
  { title: string; description: string; signal: string }
> = {
  "spend-analysis": { title: "Spend analysis", description: "Understand expenditure by supplier, category and operating dimension.", signal: "Spend visibility" },
  "supplier-performance": { title: "Supplier performance", description: "Compare delivery, quality and commercial performance across suppliers.", signal: "Supplier health" },
  "purchase-price-variance": { title: "Purchase price variance", description: "Identify movement between expected and actual procurement value.", signal: "Cost control" },
  "contract-compliance": { title: "Contract compliance", description: "Review purchasing aligned to active agreements and negotiated terms.", signal: "Policy compliance" },
  "maverick-spend": { title: "Maverick spend", description: "Surface purchasing outside approved sourcing and agreement channels.", signal: "Leakage risk" },
  "open-commitments": { title: "Open commitments", description: "Measure outstanding purchase-order value and delivery obligations.", signal: "Cash planning" },
  "overdue-orders": { title: "Overdue orders", description: "Prioritise supplier commitments that have missed expected delivery.", signal: "Supply risk" },
  "matching-exceptions": { title: "Matching exceptions", description: "Resolve invoice variances before they become Accounts Payable liabilities.", signal: "Payment control" },
  savings: { title: "Sourcing savings", description: "Track negotiated and realised savings from sourcing activity.", signal: "Value creation" },
  "cycle-time": { title: "Procurement cycle time", description: "Measure how quickly demand moves from request to commitment.", signal: "Process speed" },
  "supplier-risk": { title: "Supplier risk", description: "Review qualification, compliance and operational risk indicators.", signal: "Continuity" },
  "agreement-consumption": { title: "Agreement consumption", description: "Monitor usage, remaining value and expiry of procurement agreements.", signal: "Contract utilisation" },
};

export function ProcurementReportsWorkspace() {
  const [report, setReport] = useState<(typeof PROCUREMENT_REPORTS)[number]>(
    PROCUREMENT_REPORTS[0],
  );
  const [rows, setRows] = useState<JsonRow[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function load(selected = report) {
    setPending(true);
    const response = await requestJson<{ rows: JsonRow[] }>(
      `/api/procurement/reports/${selected}`,
    );
    setPending(false);
    if (!response.ok) setMessage(response.message || "Report could not be loaded.");
    else {
      setMessage("");
      setRows(response.rows || []);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void requestJson<{ rows: JsonRow[] }>(
      `/api/procurement/reports/${PROCUREMENT_REPORTS[0]}`,
    )
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
          setMessage(
            error instanceof Error ? error.message : "Report could not be loaded.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const columns = Array.from(
    rows.reduce<Set<string>>((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>()),
  ).slice(0, 8);
  const meta = PROCUREMENT_REPORT_META[report];

  return (
    <div className="module-workbench procurement-workbench report-workbench">
      <section className="module-hero compact-module-hero">
        <div className="module-hero-copy">
          <span className="module-hero-icon" aria-hidden="true">
            <AppIcon name="procurement" size={22} />
          </span>
          <div>
            <p className="eyebrow">Source-to-pay intelligence</p>
            <h1>Procurement analytics</h1>
            <p>
              Live spend, supplier, compliance and cycle-time signals organised
              for action rather than raw database inspection.
            </p>
          </div>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={pending}
          onClick={() => load().catch(() => undefined)}
        >
          {pending ? "Refreshing…" : "Refresh report"}
        </button>
      </section>

      <div className="enterprise-report-layout">
        <nav className="enterprise-report-nav" aria-label="Procurement reports">
          <p className="eyebrow">Report library</p>
          {PROCUREMENT_REPORTS.map((key) => (
            <button
              className={key === report ? "active" : ""}
              key={key}
              type="button"
              onClick={() => {
                setReport(key);
                load(key).catch(() => undefined);
              }}
            >
              <span>{PROCUREMENT_REPORT_META[key].title}</span>
              <small>{PROCUREMENT_REPORT_META[key].signal}</small>
            </button>
          ))}
        </nav>

        <section className="enterprise-report-surface">
          <header className="enterprise-report-header">
            <div>
              <p className="eyebrow">{meta.signal}</p>
              <h2>{meta.title}</h2>
              <p>{meta.description}</p>
            </div>
            <span className="record-count-pill">
              {rows.length} {rows.length === 1 ? "record" : "records"}
            </span>
          </header>
          {message ? <p className="form-message error">{message}</p> : null}
          {rows.length ? (
            <div className="table-scroll enterprise-table-frame">
              <table className="data-table enterprise-data-table">
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <th key={column}>{humanize(column)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={String(row.id || index)}>
                      {columns.map((column) => (
                        <td key={column} data-label={humanize(column)}>
                          {displayValue(row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="module-empty-state report-empty-state">
              <span className="module-empty-icon" aria-hidden="true">
                <AppIcon name="procurement" size={22} />
              </span>
              <strong>No report records yet</strong>
              <p>
                This report will populate as procurement transactions move through
                governed source-to-pay workflows.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
