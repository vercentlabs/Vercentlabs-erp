"use client";

import { OperationsWorkspaceArchetype } from "@/shared/design";
import { useEffect, useMemo, useState } from "react";

type Row = Record<string, unknown>;
type Options = { items: Row[]; warehouses: Row[]; locations: Row[]; batches: Row[] };

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || "Request failed.");
  return body;
}

const emptyOptions: Options = { items: [], warehouses: [], locations: [], batches: [] };

export default function StockOperationsWorkspace() {
  const [options, setOptions] = useState<Options>(emptyOptions);
  const [movements, setMovements] = useState<Row[]>([]);
  const [transfers, setTransfers] = useState<Row[]>([]);
  const [action, setAction] = useState("receipt");
  const [form, setForm] = useState<Record<string, string>>({ adjustmentDirection: "increase" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const [optionBody, movementBody, transferBody] = await Promise.all([
      requestJson("/api/stock/options"),
      requestJson("/api/stock/resources/movements?limit=50"),
      requestJson("/api/stock/resources/transfers?limit=50"),
    ]);
    setOptions({ ...emptyOptions, ...(optionBody.options || {}) });
    setMovements(movementBody.rows || []);
    setTransfers(transferBody.rows || []);
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void Promise.all([
      requestJson("/api/stock/options", { signal: controller.signal }),
      requestJson("/api/stock/resources/movements?limit=50", { signal: controller.signal }),
      requestJson("/api/stock/resources/transfers?limit=50", { signal: controller.signal }),
    ])
      .then(([optionBody, movementBody, transferBody]) => {
        if (cancelled) return;
        setOptions({ ...emptyOptions, ...(optionBody.options || {}) });
        setMovements(movementBody.rows || []);
        setTransfers(transferBody.rows || []);
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setMessage(error instanceof Error ? error.message : "Stock operations could not be loaded.");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const itemLocations = useMemo(
    () => options.locations.filter((row) => !form.warehouseId || String(row.warehouse_id) === form.warehouseId),
    [options.locations, form.warehouseId],
  );
  const sourceLocations = useMemo(
    () => options.locations.filter((row) => !form.sourceWarehouseId || String(row.warehouse_id) === form.sourceWarehouseId),
    [options.locations, form.sourceWarehouseId],
  );
  const destinationLocations = useMemo(
    () => options.locations.filter((row) => !form.destinationWarehouseId || String(row.warehouse_id) === form.destinationWarehouseId),
    [options.locations, form.destinationWarehouseId],
  );
  const itemBatches = useMemo(
    () => options.batches.filter((row) => !form.itemId || String(row.item_id) === form.itemId),
    [options.batches, form.itemId],
  );

  function set(name: string, value: string) { setForm((current) => ({ ...current, [name]: value })); }
  function select(name: string, label: string, rows: Row[], optional = false) {
    return <label className="field"><span>{label}</span><select value={form[name] || ""} onChange={(event) => set(name, event.target.value)}><option value="">{optional ? "None" : "Select…"}</option>{rows.map((row) => <option key={String(row.id)} value={String(row.id)}>{String(row.code || "")} · {String(row.name || row.id)}</option>)}</select></label>;
  }

  async function submit() {
    setBusy(true); setMessage("");
    try {
      if (action === "transfer") {
        const body = {
          itemId: form.itemId,
          sourceWarehouseId: form.sourceWarehouseId,
          sourceLocationId: form.sourceLocationId || undefined,
          destinationWarehouseId: form.destinationWarehouseId,
          destinationLocationId: form.destinationLocationId || undefined,
          batchId: form.batchId || undefined,
          quantity: Number(form.quantity),
          idempotencyKey: form.idempotencyKey || crypto.randomUUID(),
        };
        const result = await requestJson("/api/stock/transfers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        setMessage(result.transfer?.replayed ? "Existing transfer replayed safely." : "Transfer created.");
      } else {
        const body = {
          movementType: action,
          adjustmentDirection: action === "adjustment" ? form.adjustmentDirection : undefined,
          itemId: form.itemId,
          warehouseId: form.warehouseId,
          warehouseLocationId: form.warehouseLocationId || undefined,
          batchId: form.batchId || undefined,
          quantity: Number(form.quantity),
          unitCost: form.unitCost === "" || form.unitCost == null ? undefined : Number(form.unitCost),
          reason: form.reason || undefined,
          idempotencyKey: form.idempotencyKey || crypto.randomUUID(),
        };
        const result = await requestJson("/api/stock/movements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        setMessage(result.movement?.replayed ? "Existing movement replayed safely." : `${action === "receipt" ? "Receipt" : action === "issue" ? "Issue" : "Adjustment"} posted.`);
      }
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Stock operation failed."); }
    finally { setBusy(false); }
  }

  async function completeTransfer(id: string) {
    setBusy(true); setMessage("");
    try {
      const result = await requestJson(`/api/stock/transfers/${id}/complete`, { method: "POST" });
      setMessage(result.transfer?.replayed ? "Transfer was already completed." : "Transfer completed and both ledger movements posted.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Transfer completion failed."); }
    finally { setBusy(false); }
  }

  return <OperationsWorkspaceArchetype className="stack-list" aria-label="Stock operations workspace">
    <section className="panel">
      <p className="eyebrow">F108–F111</p><h1>Stock operations</h1>
      <p>Post governed receipts, issues, signed adjustments and internal transfers. Every write is company-scoped, permission-gated, audited and replay-safe.</p>
      <div className="button-row" role="group" aria-label="Stock operation type">
        {[['receipt','Goods receipt'],['issue','Goods issue'],['adjustment','Adjustment'],['transfer','Internal transfer']].map(([key,label]) => <button key={key} type="button" className={action === key ? "primary-button" : "secondary-button"} onClick={() => { setAction(key); setMessage(""); }}>{label}</button>)}
      </div>
      <div className="form-grid">
        {select("itemId", "Item", options.items)}
        {action === "transfer" ? <>
          {select("sourceWarehouseId", "Source warehouse", options.warehouses)}
          {select("sourceLocationId", "Source bin/location", sourceLocations, true)}
          {select("destinationWarehouseId", "Destination warehouse", options.warehouses)}
          {select("destinationLocationId", "Destination bin/location", destinationLocations, true)}
        </> : <>
          {select("warehouseId", "Warehouse", options.warehouses)}
          {select("warehouseLocationId", "Bin/location", itemLocations, true)}
        </>}
        {select("batchId", "Batch", itemBatches, true)}
        <label className="field"><span>Quantity</span><input required type="number" min="0.000001" step="0.000001" value={form.quantity || ""} onChange={(event) => set("quantity", event.target.value)} /></label>
        {action === "adjustment" ? <label className="field"><span>Adjustment direction</span><select value={form.adjustmentDirection || "increase"} onChange={(event) => set("adjustmentDirection", event.target.value)}><option value="increase">Increase</option><option value="decrease">Decrease</option></select></label> : null}
        {action !== "transfer" ? <label className="field"><span>Unit cost (optional)</span><input type="number" min="0" step="0.000001" value={form.unitCost || ""} onChange={(event) => set("unitCost", event.target.value)} /></label> : null}
        {action !== "transfer" ? <label className="field"><span>Reason</span><input value={form.reason || ""} onChange={(event) => set("reason", event.target.value)} /></label> : null}
        <label className="field"><span>Idempotency key (optional)</span><input value={form.idempotencyKey || ""} onChange={(event) => set("idempotencyKey", event.target.value)} /></label>
      </div>
      <div className="button-row"><button type="button" className="primary-button" disabled={busy} onClick={() => void submit()}>{busy ? "Working…" : "Post operation"}</button></div>
      {message ? <p className="notice" role="status">{message}</p> : null}
    </section>

    <section className="panel"><p className="eyebrow">Movement ledger</p><h2>Recent stock movements</h2><div className="table-panel"><table><thead><tr><th>Movement</th><th>Type</th><th>Quantity</th><th>Item</th><th>Occurred</th></tr></thead><tbody>{movements.map((row) => <tr key={String(row.id)}><td><code>{String(row.movement_number || row.id)}</code></td><td>{String(row.movement_type)}</td><td>{String(row.quantity)}</td><td><code>{String(row.item_id)}</code></td><td>{String(row.occurred_at || row.created_at || "")}</td></tr>)}</tbody></table></div></section>

    <section className="panel"><p className="eyebrow">Transfer register</p><h2>Internal transfers</h2><div className="table-panel"><table><thead><tr><th>Transfer</th><th>Quantity</th><th>Status</th><th>Action</th></tr></thead><tbody>{transfers.map((row) => <tr key={String(row.id)}><td><code>{String(row.transfer_number || row.id)}</code></td><td>{String(row.quantity)}</td><td>{String(row.status)}</td><td>{row.status === "draft" ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void completeTransfer(String(row.id))}>Complete</button> : null}</td></tr>)}</tbody></table></div></section>
  </OperationsWorkspaceArchetype>;
}
