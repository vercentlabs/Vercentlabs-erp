"use client";

import { useEffect, useState } from "react";

type Row = Record<string, unknown>;
type Options = { items: Row[]; warehouses: Row[] };

const emptyOptions: Options = { items: [], warehouses: [] };

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || "Request failed.");
  return body;
}

async function fetchAvailabilityWorkspaceData(signal?: AbortSignal) {
  const [optionsBody, reservationBody] = await Promise.all([
    requestJson("/api/stock/options", { signal }),
    requestJson("/api/stock/resources/reservations", { signal }),
  ]);
  return {
    options: { ...emptyOptions, ...(optionsBody.options || {}) } as Options,
    reservations: (reservationBody.rows || []) as Row[],
  };
}

export default function StockAvailabilityWorkspace() {
  const [options, setOptions] = useState<Options>(emptyOptions);
  const [form, setForm] = useState<Record<string, string>>({ referenceType: "manual" });
  const [availability, setAvailability] = useState<Row | null>(null);
  const [reservations, setReservations] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void fetchAvailabilityWorkspaceData(controller.signal)
      .then((data) => {
        if (cancelled) return;
        setOptions(data.options);
        setReservations(data.reservations);
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setMessage(error instanceof Error ? error.message : "Availability data could not be loaded.");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  async function load() {
    const data = await fetchAvailabilityWorkspaceData();
    setOptions(data.options);
    setReservations(data.reservations);
  }

  function select(name: string, label: string, rows: Row[]) {
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
          {rows.map((row) => (
            <option key={String(row.id)} value={String(row.id)}>
              {String(row.code || "")} · {String(row.name || row.id)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  async function check() {
    setBusy(true);
    setMessage("");
    try {
      const query = new URLSearchParams({
        itemId: form.itemId || "",
        warehouseId: form.warehouseId || "",
        requestedQuantity: form.quantity || "",
      });
      const body = await requestJson(`/api/stock/availability?${query}`);
      setAvailability(body.availability);
      setMessage(
        body.availability?.canPromise === false
          ? "Requested quantity is not currently available."
          : "Availability checked.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Check failed.");
    } finally {
      setBusy(false);
    }
  }

  async function reserve() {
    setBusy(true);
    setMessage("");
    try {
      const input = {
        ...form,
        quantity: Number(form.quantity),
        idempotencyKey: form.idempotencyKey || crypto.randomUUID(),
      };
      const body = await requestJson("/api/stock/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      setMessage(
        body.reservation?.replayed
          ? "Existing reservation replayed safely."
          : "Stock reserved.",
      );
      await Promise.all([check(), load()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reservation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function release(id: string) {
    setBusy(true);
    try {
      await requestJson(`/api/stock/reservations/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "released" }),
      });
      setMessage("Reservation released.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Release failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-list">
      <section className="panel">
        <p className="eyebrow">F112–F114</p>
        <h1>Availability & reservations</h1>
        <p>Check real-time on-hand, reserved, available and available-to-promise quantity before committing stock.</p>
        <div className="form-grid">
          {select("itemId", "Item", options.items)}
          {select("warehouseId", "Warehouse", options.warehouses)}
          <label className="field"><span>Quantity</span><input type="number" min="0" step="0.000001" value={form.quantity || ""} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} /></label>
          <label className="field"><span>Reference type</span><input value={form.referenceType || ""} onChange={(event) => setForm((current) => ({ ...current, referenceType: event.target.value }))} /></label>
          <label className="field"><span>Reference record ID</span><input value={form.referenceId || ""} onChange={(event) => setForm((current) => ({ ...current, referenceId: event.target.value }))} /></label>
          <label className="field"><span>Idempotency key (optional)</span><input value={form.idempotencyKey || ""} onChange={(event) => setForm((current) => ({ ...current, idempotencyKey: event.target.value }))} /></label>
        </div>
        <div className="button-row">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void check()}>Check availability</button>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void reserve()}>Reserve stock</button>
        </div>
        {availability ? <div className="metric-grid"><article><small>On hand</small><strong>{String(availability.onHandQuantity || 0)}</strong></article><article><small>Reserved</small><strong>{String(availability.reservedQuantity || 0)}</strong></article><article><small>Available</small><strong>{String(availability.availableQuantity || 0)}</strong></article><article><small>ATP</small><strong>{String(availability.availableToPromise || 0)}</strong></article></div> : null}
        {message ? <p className="notice" role="status">{message}</p> : null}
      </section>
      <section className="panel">
        <p className="eyebrow">Reservation ledger</p><h2>Active and historical reservations</h2>
        <div className="table-panel"><table><thead><tr><th>Item / reference</th><th>Quantity</th><th>Status</th><th>Action</th></tr></thead><tbody>{reservations.map((row) => <tr key={String(row.id)}><td><code>{String(row.item_id)}</code><br /><small>{String(row.reference_type)} · {String(row.reference_id)}</small></td><td>{String(row.quantity)}</td><td>{String(row.status)}</td><td>{row.status === "active" ? <button className="danger-link" type="button" disabled={busy} onClick={() => void release(String(row.id))}>Release</button> : null}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}
