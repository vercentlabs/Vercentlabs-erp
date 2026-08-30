"use client";

import { useEffect, useState } from "react";

type Row = Record<string, unknown>;
type Options = {
  suppliers: Row[];
  purchaseOrders: Row[];
  receipts: Row[];
  items: Row[];
  warehouses: Row[];
  sourcingEvents: Row[];
  uoms: Row[];
};

const emptyOptions: Options = {
  suppliers: [],
  purchaseOrders: [],
  receipts: [],
  items: [],
  warehouses: [],
  sourcingEvents: [],
  uoms: [],
};

const actions = [
  ["upsert-supplier-price", "Maintain supplier purchase price"],
  ["create-landed-cost", "Record landed cost"],
  ["upsert-lead-time", "Set supplier lead time"],
  ["create-sourcing-invitation", "Invite supplier to sourcing event"],
  ["record-supplier-bid", "Record supplier quotation / bid"],
  ["record-sourcing-evaluation", "Record bid evaluation"],
  ["record-supplier-scorecard", "Record supplier performance score"],
  ["create-purchase-return", "Create purchase return"],
  ["generate-reorders", "Generate reorder purchasing"],
  ["create-subcontract", "Create subcontract order"],
] as const;

const resources = [
  ["supplier-prices", "Supplier purchase prices"],
  ["sourcing-invitations", "RFQ invitations"],
  ["sourcing-bids", "Supplier quotations / bids"],
  ["sourcing-evaluations", "Bid evaluations"],
  ["supplier-scorecards", "Supplier scorecards"],
  ["returns", "Purchase returns"],
  ["landed-costs", "Landed costs"],
  ["supplier-lead-times", "Supplier lead times"],
  ["reorder-requests", "Reorder requests"],
  ["subcontract-orders", "Subcontract orders"],
] as const;

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || "Request failed.");
  return body;
}

async function fetchProcurementOptions(signal?: AbortSignal): Promise<Options> {
  const body = await requestJson("/api/procurement/pass1-options", { signal });
  return { ...emptyOptions, ...(body.options || {}) };
}

async function fetchProcurementRows(kind: string, signal?: AbortSignal): Promise<Row[]> {
  const body = await requestJson(
    `/api/procurement/pass1-operations?kind=${encodeURIComponent(kind)}`,
    { signal },
  );
  return body.rows || [];
}

export default function ProcurementPass1OperationsWorkspace() {
  const [options, setOptions] = useState<Options>(emptyOptions);
  const [action, setAction] = useState("upsert-supplier-price");
  const [resource, setResource] = useState("supplier-prices");
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState<Record<string, string>>({ allocationMethod: "value" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void Promise.all([
      fetchProcurementOptions(controller.signal),
      fetchProcurementRows("supplier-prices", controller.signal),
    ])
      .then(([nextOptions, nextRows]) => {
        if (cancelled) return;
        setOptions(nextOptions);
        setRows(nextRows);
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setMessage(error instanceof Error ? error.message : "Procurement operations could not be loaded.");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  async function loadOptions() {
    setOptions(await fetchProcurementOptions());
  }

  async function loadRows(kind = resource) {
    setRows(await fetchProcurementRows(kind));
  }

  function field(
    name: string,
    label: string,
    type = "text",
    items?: Row[],
    labelKey = "label",
  ) {
    if (items) {
      return (
        <label className="field">
          <span>{label}</span>
          <select
            value={form[name] || ""}
            onChange={(event) =>
              setForm((current) => ({ ...current, [name]: event.target.value }))
            }
          >
            <option value="">Select…</option>
            {items.map((item) => (
              <option key={String(item.id)} value={String(item.id)}>
                {String(item[labelKey] ?? item.name ?? item.code ?? item.id)}
              </option>
            ))}
          </select>
        </label>
      );
    }
    return (
      <label className="field">
        <span>{label}</span>
        <input
          type={type}
          value={form[name] || ""}
          onChange={(event) =>
            setForm((current) => ({ ...current, [name]: event.target.value }))
          }
        />
      </label>
    );
  }

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const input: Record<string, unknown> = { ...form };
      for (const key of [
        "amount",
        "leadTimeDays",
        "quantity",
        "limit",
        "minimumQuantity",
        "rate",
        "score",
        "totalAmount",
        "overallScore",
        "qualityScore",
        "deliveryScore",
        "commercialScore",
        "deliveryDays",
        "unitPrice",
      ]) {
        if (input[key] !== undefined && input[key] !== "") input[key] = Number(input[key]);
      }
      if (action === "create-purchase-return") {
        input.lines = [
          {
            description: String(input.description || "Returned goods"),
            quantity: Number(input.quantity || 0),
            unitPrice: Number(input.unitPrice || 0),
            taxAmount: 0,
          },
        ];
      }
      await requestJson("/api/procurement/pass1-operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, input }),
      });
      setMessage("Saved successfully.");
      await Promise.all([loadOptions(), loadRows()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-list">
      <section className="panel">
        <p className="eyebrow">Pass 1 procurement operations</p>
        <h1>Purchasing controls</h1>
        <p>
          Landed cost, supplier lead-time, automatic replenishment and subcontract
          purchasing are now governed workflows.
        </p>
        <label className="field">
          <span>Action</span>
          <select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setForm({ allocationMethod: "value" });
            }}
          >
            {actions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          {action === "upsert-supplier-price" && <>{field("supplierId", "Supplier", "text", options.suppliers)}{field("itemId", "Item", "text", options.items, "name")}{field("uomId", "UOM (optional)", "text", options.uoms, "name")}{field("minimumQuantity", "Minimum quantity", "number")}{field("rate", "Purchase rate", "number")}{field("currencyCode", "Currency code")}{field("validFrom", "Valid from", "date")}{field("validTo", "Valid to", "date")}</>}
          {action === "create-landed-cost" && <>{field("purchaseOrderId", "Purchase order", "text", options.purchaseOrders)}{field("receiptId", "Goods receipt", "text", options.receipts)}{field("costType", "Cost type")}{field("amount", "Amount", "number")}{field("currencyCode", "Currency code")}<label className="field"><span>Allocate by</span><select value={form.allocationMethod || "value"} onChange={(event) => setForm((current) => ({ ...current, allocationMethod: event.target.value }))}><option value="value">Value</option><option value="quantity">Quantity</option><option value="weight">Weight</option><option value="manual">Manual</option></select></label>{field("note", "Note")}</>}
          {action === "upsert-lead-time" && <>{field("supplierId", "Supplier", "text", options.suppliers)}{field("itemId", "Item (optional)", "text", options.items, "name")}{field("leadTimeDays", "Lead time days", "number")}{field("effectiveFrom", "Effective from", "date")}{field("effectiveTo", "Effective to", "date")}</>}
          {action === "create-sourcing-invitation" && <>{field("parentId", "Sourcing event", "text", options.sourcingEvents)}{field("supplierId", "Supplier", "text", options.suppliers)}{field("contactEmail", "Supplier contact email", "email")}{field("note", "Invitation note")}</>}
          {action === "record-supplier-bid" && <>{field("parentId", "Sourcing event", "text", options.sourcingEvents)}{field("supplierId", "Supplier", "text", options.suppliers)}{field("quotationNumber", "Supplier quotation number")}{field("totalAmount", "Quoted total", "number")}{field("currencyCode", "Currency code")}{field("deliveryDays", "Delivery days", "number")}{field("note", "Bid note")}</>}
          {action === "record-sourcing-evaluation" && <>{field("parentId", "Sourcing event", "text", options.sourcingEvents)}{field("bidId", "Bid ID")}{field("score", "Evaluation score", "number")}{field("recommendation", "Recommendation")}{field("note", "Evaluation note")}</>}
          {action === "record-supplier-scorecard" && <>{field("parentId", "Supplier", "text", options.suppliers)}{field("overallScore", "Overall score", "number")}{field("qualityScore", "Quality score", "number")}{field("deliveryScore", "Delivery score", "number")}{field("commercialScore", "Commercial score", "number")}{field("period", "Review period")}{field("note", "Performance note")}</>}
          {action === "create-purchase-return" && <>{field("receiptId", "Approved receipt", "text", options.receipts)}{field("reason", "Return reason")}{field("description", "Returned item description")}{field("quantity", "Return quantity", "number")}{field("unitPrice", "Unit price", "number")}</>}
          {action === "generate-reorders" && <>{field("limit", "Maximum proposals", "number")}<p>This action reads Stock reorder rules and available quantity, then creates idempotent Procurement proposals. It requires both Stock view and Procurement PO-create access.</p></>}
          {action === "create-subcontract" && <>{field("supplierId", "Supplier", "text", options.suppliers)}{field("purchaseOrderId", "Purchase order (optional)", "text", options.purchaseOrders)}{field("itemId", "Item", "text", options.items, "name")}{field("quantity", "Quantity", "number")}{field("expectedReturnDate", "Expected return", "date")}{field("referenceType", "Source type")}{field("referenceId", "Source record ID")}{field("note", "Note")}</>}
        </div>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : "Run operation"}</button>
        {message ? <p className="notice" role="status">{message}</p> : null}
      </section>

      <section className="panel">
        <div className="card-title-row">
          <div><p className="eyebrow">Operational register</p><h2>Recent records</h2></div>
          <select
            value={resource}
            onChange={(event) => {
              const nextResource = event.target.value;
              setResource(nextResource);
              void loadRows(nextResource);
            }}
          >
            {resources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="table-panel">
          <table>
            <thead><tr><th>Reference</th><th>Status</th><th>Value</th><th>Created</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.id)}>
                  <td><code>{String(row.quotationNumber || row.quotation_number || row.returnNumber || row.return_number || row.cost_type || row.supplier_id || row.item_id || row.id)}</code></td>
                  <td>{String(row.status || "")}</td>
                  <td>{String(row.totalAmount || row.total_amount || row.overallScore || row.overall_score || row.amount || row.rate || row.lead_time_days || row.quantity || "")}</td>
                  <td>{String(row.created_at || "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
