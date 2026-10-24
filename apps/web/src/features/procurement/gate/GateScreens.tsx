"use client";

// Receive at the gate (Procurement report Phase 4): a phone screen for the security or stores person. Today's expected deliveries (and the
// late ones) first; scan the order's number or type it; enter what arrived, the batch and expiry (scanned from the carton), what is damaged,
// photos; finalise. Offline at the gate it keeps working from the orders saved on the phone and keeps finished receipts until the network
// is back, then sends them once each.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudOff, ImagePlus, Minus, Plus, RefreshCw } from "lucide-react";
import { Button, ErrorState, LinkButton, PageHeader, SearchField, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { CameraScanButton } from "@/shared/ui/CameraCodeScanner";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { calendarDate, quantity } from "@/features/procurement/shared/format";
import { ProcApiError } from "@/features/procurement/shared/http";
import {
  createGoodsReceipt, errorMessage, getReceivable, listPurchaseOrders, uploadReceiptFile, type PurchaseOrderRow, type Receivable,
} from "@/features/procurement/purchase-orders/api/purchase-orders-api";

import { dropQueued, isNetworkError, listQueued, queueReceipt, readBatchCode, readCache, saveCache, shrinkPhoto, type GateCache, type QueuedPhoto, type QueuedReceipt } from "./offline";

const CODE_FORMATS = ["qr_code", "code_128", "code_39", "ean_13", "data_matrix"];
const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
const subscribe = (notify: () => void) => { window.addEventListener("online", notify); window.addEventListener("offline", notify); return () => { window.removeEventListener("online", notify); window.removeEventListener("offline", notify); }; };
function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
const canPost = (workspace: ReturnType<typeof useWorkspaceContext>) => workspace.roleSlugs.some((slug) => ["organization_owner", "system_administrator"].includes(slug))
  || workspace.permissions.includes("procurement.receipts.post");

// Sends one waiting receipt: the receipt (once, by its key), then its photos. Returns the entry as it now stands, or null when done.
async function sendQueued(entry: QueuedReceipt, post: boolean): Promise<QueuedReceipt | null> {
  let current = entry;
  if (!current.receiptId) {
    const created = await createGoodsReceipt(current.orderId, { ...current.payload, post, idempotencyKey: current.key });
    current = { ...current, receiptId: created.id, receiptNumber: created.receiptNumber, error: undefined };
    await queueReceipt(current);
  }
  const left: QueuedPhoto[] = [...current.photos];
  while (left.length) {
    const photo = left[0];
    await uploadReceiptFile(current.receiptId!, new File([photo.data], photo.name, { type: photo.type }));
    left.shift();
    current = { ...current, photos: [...left] };
    await queueReceipt(current);
  }
  await dropQueued(current.key);
  return null;
}

function useQueue(organizationId: string) {
  const [queue, setQueue] = useState<QueuedReceipt[]>([]);
  const [sending, setSending] = useState(false);
  const workspace = useWorkspaceContext();
  const refresh = useCallback(async () => setQueue(await listQueued(organizationId)), [organizationId]);
  const sendAll = useCallback(async () => {
    setSending(true);
    try {
      for (const entry of await listQueued(organizationId)) {
        try { await sendQueued(entry, canPost(workspace)); }
        catch (error) {
          if (isNetworkError(error)) break;
          await queueReceipt({ ...entry, error: errorMessage(error) });
        }
      }
    } finally {
      setSending(false);
      await refresh();
    }
  }, [organizationId, refresh, workspace]);
  const online = useOnline();
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (online) void sendAll(); }, [online, sendAll]);
  return { queue, sending, refresh, sendAll };
}

export function GateScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const online = useOnline();
  const [search, setSearch] = useState("");
  const [scanned, setScanned] = useState<string | null>(null);
  const [cache, setCache] = useState<GateCache | null>(null);
  const { queue, sending, sendAll, refresh } = useQueue(workspace.organizationId);
  useEffect(() => { void readCache(workspace.organizationId).then(setCache); }, [workspace.organizationId]);
  const live = useQuery({ queryKey: ["procurement", "gate", workspace.organizationId], enabled: online, retry: 1,
    queryFn: async () => {
      const orders = (await listPurchaseOrders({ view: "receivable", limit: 200 })).rows;
      // The orders due by today, with their lines, saved for when the network drops.
      const receivables: Record<string, Receivable> = {};
      for (const order of orders.filter((row) => !row.expectedDeliveryDate || row.expectedDeliveryDate <= today()).slice(0, 40))
        receivables[order.id] = await queryClient.fetchQuery({ queryKey: ["procurement", "gate", "receivable", order.id], queryFn: () => getReceivable(order.id) });
      const saved = { savedAt: new Date().toISOString(), orders, receivables };
      await saveCache(workspace.organizationId, saved);
      setCache(saved);
      return saved;
    } });
  const data = live.data ?? cache;
  const orders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.orders ?? []).filter((order) => !term || `${order.purchaseOrderNumber} ${order.supplierName}`.toLowerCase().includes(term));
  }, [data, search]);
  const due = orders.filter((order) => order.expectedDeliveryDate && order.expectedDeliveryDate <= today());
  const later = orders.filter((order) => !order.expectedDeliveryDate || order.expectedDeliveryDate > today());
  const onScan = (code: string) => {
    const value = code.trim().toUpperCase();
    const match = (data?.orders ?? []).find((order) => value.includes(order.purchaseOrderNumber.toUpperCase()) || value.includes(order.id.toUpperCase()));
    if (match) router.push(`/procurement/gate/${match.id}`);
    else { setScanned(code); setSearch(code); }
  };
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <PageHeader title="Receive at the gate" description="Today's deliveries. Scan the order, or choose it." />
      {!online && <Notice tone="warning"><span className="inline-flex items-center gap-1"><CloudOff className="size-4" aria-hidden="true" />Offline: showing the orders saved {data ? `at ${new Date(data.savedAt).toLocaleTimeString()}` : "earlier"}. Receipts wait on this phone.</span></Notice>}
      {queue.length > 0 && (
        <Panel title={`Waiting to send (${queue.length})`} description="Sent by themselves when the network is back."
          actions={<Button size="compact" variant="secondary" isDisabled={!online} isLoading={sending} onPress={() => void sendAll()}><RefreshCw className="size-4" aria-hidden="true" />Send now</Button>}>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {queue.map((entry) => (
              <li key={entry.key} className="flex flex-col gap-1 py-2">
                <span className="font-medium">{`${entry.orderNumber} · ${entry.supplierName}`}</span>
                <span className="text-xs text-text-muted">{`Received ${new Date(entry.createdAt).toLocaleString()}${entry.receiptNumber ? ` · ${entry.receiptNumber}, photos left ${entry.photos.length}` : ""}`}</span>
                {entry.error && <span className="text-xs text-danger">{entry.error}</span>}
                {entry.error && <span><Button size="compact" variant="ghost" onPress={() => void dropQueued(entry.key).then(refresh)}>Discard</Button></span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <SearchField aria-label="Find an order" placeholder="Order number or supplier" className="w-full" value={search} onChange={(value) => { setSearch(value); setScanned(null); }} />
        <CameraScanButton formats={CODE_FORMATS} label="Scan order" title="Scan the purchase order" onDetect={onScan} />
      </div>
      {scanned && <Notice tone="warning">{`No open order matches ${scanned}. Choose it below, or ask stores.`}</Notice>}
      {!data && live.isLoading && <LoadingState label="Loading today's deliveries" rows={4} />}
      {!data && live.isError && <ErrorState title="Could not load the orders" description={errorMessage(live.error)} action={{ label: "Try again", onPress: () => void live.refetch() }} />}
      {data && <OrderList title="Expected today or late" orders={due} empty="Nothing is expected today." />}
      {data && later.length > 0 && <OrderList title="Expected later" orders={later} empty="" />}
    </div>
  );
}

function OrderList({ title, orders, empty }: { title: string; orders: PurchaseOrderRow[]; empty: string }) {
  return (
    <Panel title={title}>
      {!orders.length ? <p className="text-sm text-text-muted">{empty}</p> : (
        <ul className="flex flex-col divide-y divide-border">
          {orders.map((order) => (
            <li key={order.id}>
              <Link href={`/procurement/gate/${order.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{order.supplierName}</span>
                  <span className="text-xs text-text-muted">{`${order.purchaseOrderNumber}${order.expectedDeliveryDate ? ` · ${calendarDate(order.expectedDeliveryDate)}` : ""}`}</span>
                </span>
                {order.overdueReceipt ? <StatusBadge tone="danger">Late</StatusBadge> : <StatusBadge tone="info">{order.receiptLabel}</StatusBadge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

type LineEntry = { received: string; damaged: string; showDamage: boolean; batch: string; expiry: string; serials: string };

export function GateReceiveScreen({ orderId }: { orderId: string }) {
  const workspace = useWorkspaceContext();
  const online = useOnline();
  const [cached, setCached] = useState<Receivable | null | undefined>(undefined);
  useEffect(() => { void readCache(workspace.organizationId).then((cache) => setCached(cache?.receivables[orderId] ?? null)); }, [workspace.organizationId, orderId]);
  const live = useQuery({ queryKey: ["procurement", "gate", "receivable", orderId], queryFn: () => getReceivable(orderId), enabled: online, retry: 1 });
  const receivable = live.data ?? cached ?? null;
  if (!receivable && (live.isLoading || cached === undefined)) return <LoadingState label="Loading the order" />;
  if (!receivable) return <ErrorState title="This order is not on the phone" description={online ? errorMessage(live.error) : "Open it once while online so it is saved for the gate."} />;
  return <ReceiveForm receivable={receivable} />;
}

function ReceiveForm({ receivable }: { receivable: Receivable }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const online = useOnline();
  const lines = receivable.lines.filter((line) => line.receiptRequired && Number(line.remaining) > 0);
  const [entries, setEntries] = useState<Record<string, LineEntry>>(() => Object.fromEntries(lines.map((line) => [line.purchaseOrderLineId,
    { received: "", damaged: "", showDamage: false, batch: "", expiry: "", serials: "" }])));
  const [challan, setChallan] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<Array<QueuedPhoto & { url: string }>>([]);
  const [state, setState] = useState<{ busy: boolean; error: string | null; done: { kind: "sent" | "queued" | "draft"; number?: string; id?: string } | null }>({ busy: false, error: null, done: null });
  const key = useRef(crypto.randomUUID());
  const photoInput = useRef<HTMLInputElement>(null);
  const set = (id: string, change: Partial<LineEntry>) => setEntries((current) => ({ ...current, [id]: { ...current[id], ...change } }));
  const step = (id: string, by: number, max: number) => {
    const next = Math.max(0, Math.min(max, (Number(entries[id]?.received) || 0) + by));
    set(id, { received: String(next) });
  };
  const chosen = lines.filter((line) => Number(entries[line.purchaseOrderLineId]?.received) > 0);
  const missing = chosen.filter((line) => (line.trackingType === "batch" && !entries[line.purchaseOrderLineId]?.batch.trim()) || (line.requiresExpiryDate && !entries[line.purchaseOrderLineId]?.expiry));
  const payload = () => ({
    receiptDate: today(), physicalReceivedAt: new Date().toISOString(), supplierChallanNumber: challan.trim() || null, vehicleNumber: vehicle.trim() || null,
    notes: notes.trim() || "Received at the gate",
    lines: chosen.map((line) => {
      const entry = entries[line.purchaseOrderLineId];
      return { purchaseOrderLineId: line.purchaseOrderLineId, productId: line.productId ?? undefined, receivedQuantity: entry.received, damagedQuantity: entry.damaged || "0",
        batchNumber: entry.batch.trim() || undefined, expiryDate: entry.expiry || undefined, serialNumbers: entry.serials.trim() || undefined };
    }),
  });
  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const shrunk = await Promise.all([...files].slice(0, 8).map(shrinkPhoto));
    setPhotos((current) => [...current, ...shrunk.map((photo) => ({ ...photo, url: URL.createObjectURL(photo.data) }))].slice(0, 8));
  };
  const finalise = async () => {
    const entry: QueuedReceipt = { key: key.current, organizationId: workspace.organizationId, orderId: receivable.order.id, orderNumber: receivable.order.purchaseOrderNumber,
      supplierName: receivable.order.supplierName, payload: payload(), photos: photos.map(({ name, type, data }) => ({ name, type, data })), createdAt: new Date().toISOString() };
    setState({ busy: true, error: null, done: null });
    const post = canPost(workspace);
    if (!online) {
      await queueReceipt(entry);
      setState({ busy: false, error: null, done: { kind: "queued" } });
      return;
    }
    try {
      await queueReceipt(entry);
      const created = await createGoodsReceipt(entry.orderId, { ...entry.payload, post, idempotencyKey: entry.key });
      const sent = { ...entry, receiptId: created.id, receiptNumber: created.receiptNumber };
      await queueReceipt(sent);
      await sendQueued(sent, post);
      setState({ busy: false, error: null, done: { kind: post ? "sent" : "draft", number: created.receiptNumber, id: created.id } });
    } catch (error) {
      if (isNetworkError(error)) { setState({ busy: false, error: null, done: { kind: "queued" } }); return; }
      // The server refused the receipt: not kept waiting, the person corrects it here. Refused after it was made (a photo): kept, to retry.
      if (error instanceof ProcApiError) {
        const kept = (await listQueued(workspace.organizationId)).find((queued) => queued.key === entry.key);
        if (kept?.receiptId) await queueReceipt({ ...kept, error: errorMessage(error) }); else await dropQueued(entry.key);
      }
      setState({ busy: false, error: errorMessage(error), done: null });
    }
  };
  if (state.done) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <Notice tone="success">{state.done.kind === "queued" ? "Saved on this phone. It is sent by itself when the network is back."
          : state.done.kind === "draft" ? `Saved as ${state.done.number}, a draft: stores check and finalise it.` : `Received: ${state.done.number} is final.`}</Notice>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="primary" className="w-full sm:w-auto" onPress={() => router.push("/procurement/gate")}>Next delivery</Button>
          {state.done.id && <LinkButton variant="secondary" className="w-full sm:w-auto" href={`/procurement/goods-receipts/${state.done.id}`}>Open the receipt</LinkButton>}
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-24">
      <PageHeader title={receivable.order.supplierName} description={`${receivable.order.purchaseOrderNumber}${receivable.order.expectedDeliveryDate ? ` · expected ${calendarDate(receivable.order.expectedDeliveryDate)}` : ""}`}
        secondaryActions={<LinkButton variant="secondary" href="/procurement/gate">Back</LinkButton>} />
      {!online && <Notice tone="warning">Offline: this receipt is kept on the phone and sent when the network is back.</Notice>}
      {state.error && <Notice>{state.error}</Notice>}
      <Panel title="Delivery">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-end gap-2">
            <TextField label="Supplier's challan" className="flex-1" value={challan} onChange={setChallan} />
            <CameraScanButton formats={CODE_FORMATS} label="Scan" title="Scan the challan" onDetect={(code) => setChallan(code.trim().slice(0, 60))} />
          </div>
          <TextField label="Vehicle number" value={vehicle} onChange={(value) => setVehicle(value.toUpperCase())} />
        </div>
      </Panel>
      {lines.length === 0 && <Notice tone="info">Nothing is left to receive on this order.</Notice>}
      {lines.map((line) => {
        const entry = entries[line.purchaseOrderLineId];
        const remaining = Number(line.remaining);
        return (
          <Panel key={line.purchaseOrderLineId} title={line.product?.name ?? line.description} description={`${quantity(line.remaining)} ${line.uom.code} still to come`}>
            <div className="flex flex-col gap-3">
              <div className="flex items-end gap-2">
                <Button variant="secondary" aria-label={`Less ${line.description}`} onPress={() => step(line.purchaseOrderLineId, -1, remaining)}><Minus className="size-4" aria-hidden="true" />Less</Button>
                <TextField label="Arrived" className="flex-1" inputMode="decimal" value={entry.received} onChange={(value) => set(line.purchaseOrderLineId, { received: value.replace(/[^0-9.]/g, "") })} />
                <Button variant="secondary" aria-label={`More ${line.description}`} onPress={() => step(line.purchaseOrderLineId, 1, remaining)}><Plus className="size-4" aria-hidden="true" />More</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="compact" variant="ghost" onPress={() => set(line.purchaseOrderLineId, { received: String(remaining) })}>{`All ${quantity(line.remaining)}`}</Button>
                {line.productType === "stock" && line.trackingType !== "serial" && (
                  <Button size="compact" variant="ghost" onPress={() => set(line.purchaseOrderLineId, { showDamage: !entry.showDamage })}>{entry.showDamage ? "No damage" : "Some damaged"}</Button>
                )}
              </div>
              {entry.showDamage && <TextField label="Damaged (of what arrived)" inputMode="decimal" value={entry.damaged} onChange={(value) => set(line.purchaseOrderLineId, { damaged: value.replace(/[^0-9.]/g, "") })} />}
              {(line.trackingType === "batch" || line.requiresExpiryDate) && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                  {line.trackingType === "batch" && <TextField label="Batch" isRequired value={entry.batch} onChange={(value) => set(line.purchaseOrderLineId, { batch: value })} />}
                  <TextField label="Expiry" type="date" isRequired={line.requiresExpiryDate} value={entry.expiry} onChange={(value) => set(line.purchaseOrderLineId, { expiry: value })} />
                  <CameraScanButton formats={["code_128", "data_matrix", "qr_code", "ean_13"]} label="Scan carton" title="Scan the carton's batch barcode"
                    onDetect={(code) => { const read = readBatchCode(code); set(line.purchaseOrderLineId, { ...(read.batch ? { batch: read.batch } : {}), ...(read.expiry ? { expiry: read.expiry } : {}) }); }} />
                </div>
              )}
              {line.trackingType === "serial" && <TextArea label="Serial numbers" description="One per line, or separated by commas." rows={2} value={entry.serials} onChange={(value) => set(line.purchaseOrderLineId, { serials: value })} />}
            </div>
          </Panel>
        );
      })}
      <Panel title="Photos" description="Damage, the challan, the seal.">
        <div className="flex flex-col gap-3">
          <input ref={photoInput} type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(event) => { void addPhotos(event.target.files); event.target.value = ""; }} />
          <div><Button variant="secondary" onPress={() => photoInput.current?.click()}><ImagePlus className="size-4" aria-hidden="true" />Take a photo</Button></div>
          {photos.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {photos.map((photo, index) => (
                <li key={photo.url} className="flex flex-col gap-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt={`Photo ${index + 1}`} className="aspect-square w-full rounded-[var(--radius-control)] object-cover" />
                  <Button size="compact" variant="ghost" onPress={() => setPhotos((current) => current.filter((entry) => entry.url !== photo.url))}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
          <TextArea label="Notes" rows={2} value={notes} onChange={setNotes} />
        </div>
      </Panel>
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface p-3 sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <div className="mx-auto flex max-w-2xl flex-col gap-1">
          {missing.length > 0 && <p className="text-xs text-danger">{`Enter the ${missing.map((line) => (line.trackingType === "batch" ? "batch" : "expiry")).join(", ")} for ${missing.map((line) => line.product?.name ?? line.description).join(", ")}.`}</p>}
          <Button variant="primary" className="w-full" isDisabled={!chosen.length || missing.length > 0 || state.busy} isLoading={state.busy} onPress={() => void finalise()}>
            {online ? (canPost(workspace) ? "Finalise receipt" : "Save for stores") : "Save on this phone"}
          </Button>
        </div>
      </div>
    </div>
  );
}
