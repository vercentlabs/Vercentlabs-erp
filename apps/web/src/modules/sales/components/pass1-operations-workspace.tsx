"use client";

import { useEffect, useMemo, useState } from "react";

import {
  ActionButton,
  EnterpriseDataGrid,
  FormField,
  StatePanel,
  type DataGridColumn,
} from "@/shared/design";

type Row = Record<string, unknown>;
type Options = {
  orders: Row[];
  lines: Row[];
  suppliers: Row[];
  commissionRules: Row[];
  priceLists: Row[];
  items: Row[];
  customers: Row[];
  uoms: Row[];
  users: Row[];
};

const emptyOptions: Options = {
  orders: [],
  lines: [],
  suppliers: [],
  commissionRules: [],
  priceLists: [],
  items: [],
  customers: [],
  uoms: [],
  users: [],
};

const actions = [
  ["check-availability", "Check line availability"],
  ["reserve-stock", "Reserve stock for line"],
  ["record-advance", "Record advance payment"],
  ["request-adjustment", "Request credit note / refund"],
  ["create-drop-ship", "Create drop-ship request"],
  ["create-commission-rule", "Create commission rule"],
  ["accrue-commission", "Accrue commission"],
  ["upsert-price-list-item", "Maintain price-list rate"],
  ["upsert-customer-price", "Maintain customer-specific price"],
] as const;

const resources = [
  ["advances", "Advances"],
  ["adjustments", "Credit/refund requests"],
  ["drop-ships", "Drop ships"],
  ["commission-rules", "Commission rules"],
  ["commissions", "Commission entries"],
  ["price-list-items", "Price-list rates"],
  ["pricing-rules", "Customer pricing rules"],
] as const;

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || "Request failed.");
  return body;
}

async function fetchSalesOptions(signal?: AbortSignal): Promise<Options> {
  const body = await requestJson("/api/sales/pass1-options", { signal });
  return { ...emptyOptions, ...(body.options || {}) };
}

async function fetchSalesRows(kind: string, signal?: AbortSignal): Promise<Row[]> {
  const body = await requestJson(
    `/api/sales/pass1-operations?kind=${encodeURIComponent(kind)}`,
    { signal },
  );
  return body.rows || [];
}

export default function SalesPass1OperationsWorkspace() {
  const [options, setOptions] = useState<Options>(emptyOptions);
  const [action, setAction] = useState("record-advance");
  const [resource, setResource] = useState("advances");
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState<Record<string, string>>({
    adjustmentType: "credit_note",
    basis: "net_sales",
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const order = options.orders.find((row) => String(row.id) === form.salesOrderId);
  const lines = useMemo(
    () =>
      options.lines.filter(
        (line) =>
          String(line.sales_order_version_id) ===
          String(order?.current_version_id || ""),
      ),
    [options.lines, order],
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void Promise.all([
      fetchSalesOptions(controller.signal),
      fetchSalesRows("advances", controller.signal),
    ])
      .then(([nextOptions, nextRows]) => {
        if (cancelled) return;
        setOptions(nextOptions);
        setRows(nextRows);
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setMessage(error instanceof Error ? error.message : "Sales operations could not be loaded.");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  async function loadOptions() {
    setOptions(await fetchSalesOptions());
  }

  async function loadRows(kind = resource) {
    setRows(await fetchSalesRows(kind));
  }

  function field(
    name: string,
    label: string,
    type = "text",
    items?: Row[],
    labelKey = "label",
  ) {
    const id = `pass1-field-${name}`;
    if (items) {
      return (
        <FormField label={label} htmlFor={id}>
          <select
            id={id}
            value={form[name] || ""}
            onChange={(event) =>
              setForm((current) => ({ ...current, [name]: event.target.value }))
            }
          >
            <option value="">Select…</option>
            {items.map((item) => (
              <option key={String(item.id)} value={String(item.id)}>
                {String(
                  item[labelKey] ??
                    item.sales_order_number ??
                    item.name ??
                    item.id,
                )}
              </option>
            ))}
          </select>
        </FormField>
      );
    }
    return (
      <FormField label={label} htmlFor={id}>
        <input
          id={id}
          type={type}
          value={form[name] || ""}
          onChange={(event) =>
            setForm((current) => ({ ...current, [name]: event.target.value }))
          }
        />
      </FormField>
    );
  }

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const input: Record<string, unknown> = { ...form };
      for (const key of [
        "amount",
        "quantity",
        "ratePercent",
        "minimumQuantity",
        "rate",
        "fixedRate",
      ]) {
        if (input[key] !== undefined && input[key] !== "") input[key] = Number(input[key]);
      }
      await requestJson("/api/sales/pass1-operations", {
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
        <p className="eyebrow">Pass 1 commercial operations</p>
        <h1>Sales operations</h1>
        <p>
          Advance payments, credit/refund handoffs, drop shipping and commissions
          use governed server workflows.
        </p>
        <FormField label="Action" htmlFor="pass1-action">
          <select
            id="pass1-action"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setForm({ adjustmentType: "credit_note", basis: "net_sales" });
            }}
          >
            {actions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </FormField>
        <div className="form-grid">
          {![
            "create-commission-rule",
            "upsert-price-list-item",
            "upsert-customer-price",
          ].includes(action) &&
            field("salesOrderId", "Sales order", "text", options.orders, "sales_order_number")}
          {(action === "check-availability" || action === "reserve-stock") && (
            <>
              {field("salesOrderLineId", "Order line", "text", lines, "item_name_snapshot")}
              {field("quantity", "Quantity", "number")}
              {action === "reserve-stock" && field("idempotencyKey", "Reservation key")}
            </>
          )}
          {action === "record-advance" && (
            <>
              {field("amount", "Amount", "number")}
              {field("paymentReference", "Payment reference")}
              {field("receivedAt", "Received at", "datetime-local")}
              {field("note", "Note")}
            </>
          )}
          {action === "request-adjustment" && (
            <>
              <FormField label="Adjustment" htmlFor="pass1-adjustment-type">
                <select
                  id="pass1-adjustment-type"
                  value={form.adjustmentType || "credit_note"}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, adjustmentType: event.target.value }))
                  }
                >
                  <option value="credit_note">Credit note</option>
                  <option value="refund">Refund</option>
                </select>
              </FormField>
              {field("amount", "Amount", "number")}
              {field("reason", "Reason")}
            </>
          )}
          {action === "create-drop-ship" && (
            <>
              {field("salesOrderLineId", "Order line", "text", lines, "item_name_snapshot")}
              {field("supplierId", "Supplier", "text", options.suppliers, "label")}
              {field("quantity", "Quantity", "number")}
              {field("idempotencyKey", "Request key")}
            </>
          )}
          {action === "create-commission-rule" && (
            <>
              {field("name", "Rule name")}
              {field("ownerUserId", "Salesperson", "text", options.users, "name")}
              {field("ratePercent", "Rate %", "number")}
              <FormField label="Basis" htmlFor="pass1-basis">
                <select
                  id="pass1-basis"
                  value={form.basis || "net_sales"}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, basis: event.target.value }))
                  }
                >
                  <option value="net_sales">Net sales</option>
                  <option value="gross_margin">Gross margin</option>
                </select>
              </FormField>
              {field("validFrom", "Valid from", "date")}
              {field("validTo", "Valid to", "date")}
            </>
          )}
          {action === "accrue-commission" && (
            <>
              {field("ruleId", "Commission rule", "text", options.commissionRules, "name")}
              {field("ownerUserId", "Salesperson", "text", options.users, "name")}
            </>
          )}
          {action === "upsert-price-list-item" && (
            <>
              {field("priceListId", "Sales price list", "text", options.priceLists, "name")}
              {field("itemId", "Item", "text", options.items, "name")}
              {field("uomId", "UOM (optional)", "text", options.uoms, "name")}
              {field("minimumQuantity", "Minimum quantity", "number")}
              {field("rate", "Rate", "number")}
              {field("validFrom", "Valid from", "date")}
              {field("validTo", "Valid to", "date")}
            </>
          )}
          {action === "upsert-customer-price" && (
            <>
              {field("partyId", "Customer", "text", options.customers, "display_name")}
              {field("itemId", "Item", "text", options.items, "name")}
              {field("priceListId", "Sales price list (optional)", "text", options.priceLists, "name")}
              {field("minimumQuantity", "Minimum quantity", "number")}
              {field("fixedRate", "Fixed customer rate", "number")}
              {field("reason", "Reason (required)", "text")}
              {field("validFrom", "Valid from", "date")}
              {field("validTo", "Valid to", "date")}
            </>
          )}
        </div>
        <ActionButton
          tone="primary"
          type="button"
          busy={busy}
          onClick={() => void submit()}
        >
          {busy ? "Saving…" : "Run operation"}
        </ActionButton>
        {message ? <p className="notice" role="status">{message}</p> : null}
      </section>

      <section className="panel">
        <div className="card-title-row">
          <div>
            <p className="eyebrow">Operational register</p>
            <h2>Recent records</h2>
          </div>
          <FormField label="Resource" htmlFor="pass1-resource">
            <select
              id="pass1-resource"
              value={resource}
              onChange={(event) => {
                const nextResource = event.target.value;
                setResource(nextResource);
                void loadRows(nextResource);
              }}
            >
              {resources.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </FormField>
        </div>
        {(() => {
          const columns: DataGridColumn<Row>[] = [
            {
              id: "reference",
              header: "Reference",
              cell: (row) => (
                <code>
                  {String(
                    row.payment_reference || row.name || row.sales_order_id || row.id,
                  )}
                </code>
              ),
            },
            {
              id: "status",
              header: "Status",
              cell: (row) => String(row.status || row.basis || ""),
            },
            {
              id: "amount",
              header: "Amount / quantity",
              cell: (row) =>
                String(
                  row.amount || row.commission_amount || row.quantity || row.rate_percent || "",
                ),
            },
            {
              id: "created",
              header: "Created",
              cell: (row) => String(row.created_at || ""),
            },
          ];
          return (
            <EnterpriseDataGrid
              caption="Operational register"
              rows={rows}
              rowKey={(row) => String(row.id)}
              columns={columns}
              emptyState={<StatePanel title="No records yet" />}
            />
          );
        })()}
      </section>
    </div>
  );
}
