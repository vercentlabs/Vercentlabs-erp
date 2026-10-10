"use client";

// Product Search and Barcode Scanning at the counter. One box for typing a name or SKU, which also takes scanner input; with no field focused
// a keyboard-wedge scanner (USB or Bluetooth) is captured anywhere on the screen. Category chips over the shared Item Categories, the outlet's
// quick tiles when the box is empty, and large product tiles showing the price for the unit sold and stock in words.
// Every completed scan is its own event, queued in order and added through the cart: the last scanned product, quantity and price stay on
// screen, problems say what to do, and a scan that needs a variant, serial number or batch asks for it. Tapping a tile adds that product.
// Keyboard: ↑ ↓ choose a product, Enter adds it (or the code typed or scanned), Esc clears, F2 or / returns to the box.
// The server decides everything that matters (identity, price, stock, permissions) when the product is added; tiles only show its answer.
import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Layers, Package, Pause, Play, ScanLine, WifiOff } from "lucide-react";
import { Button, Dialog, IconButton, SearchField, StatusBadge, TextField } from "@vercentlabs/design-system";
import type { PosCart } from "@vercentlabs/api";

import { PosApiError } from "@/features/pos/shared/http";
import { money } from "@/features/pos/shared/format";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  STOCK_LABEL, STOCK_TONE, addProductToCart, getProductDetails, getQuickProducts, listProductCategories, searchProducts, type PosProductResult,
} from "../api/products-api";
import { CameraScanButton } from "../scanner/CameraScanner";
import { DEFAULT_SCANNER_SETTINGS, getScannerSettings, stripScannerFraming } from "../scanner/scanner-api";
import { useScanQueue, useScannerCapture, type ScanPhase } from "../scanner/useBarcodeScanner";

type Message = { tone: "success" | "warning" | "danger"; text: string };
type Choice = { title: string; description?: string; products: PosProductResult[] };

const PHASE_LABEL: Record<ScanPhase, string> = {
  READY: "Ready to scan", CAPTURING: "Reading…", RESOLVING: "Finding product…", ADDING: "Adding…", SUCCESS: "Ready to scan", ERROR: "Ready to scan",
  SELECTION_REQUIRED: "Action required", PAUSED: "Scanning paused",
};
const TONE_CLASS = { success: "bg-success-soft text-success-emphasis", warning: "bg-warning-soft text-warning-emphasis", danger: "bg-danger-soft text-danger-emphasis" };

export function PosProductFinder({ cartId, terminalId = null, onCart, disabled = false, paused: externalPause = false }: {
  cartId: string | null; terminalId?: string | null; onCart: (cart: PosCart) => void; disabled?: boolean; paused?: boolean;
}) {
  const workspace = useWorkspaceContext();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(-1);
  const [message, setMessage] = useState<Message | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const submitted = useRef<string | null>(null);

  const refocus = () => requestAnimationFrame(() => input.current?.focus());
  const settingsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos-scanner", terminalId), queryFn: () => getScannerSettings(terminalId!), enabled: Boolean(terminalId),
    staleTime: 60_000 });
  const settings = settingsQuery.data ?? DEFAULT_SCANNER_SETTINGS;
  const scanningOff = userPaused || externalPause || !cartId || disabled;
  const scans = useScanQueue({
    cartId, settings, paused: scanningOff, onCart,
    onOutcome: (outcome) => {
      // A code typed in the box: cleared once handled, kept when nothing has that barcode so the name search below can take over.
      if (submitted.current !== null && submitted.current === outcome.barcode) {
        if (!(outcome.status === "rejected" && outcome.code === "POS_BARCODE_NOT_FOUND")) { setText(""); setTerm(""); setHighlight(-1); }
        submitted.current = null;
      }
      if (!document.querySelector("[role='dialog']")) refocus();
    },
  });
  useScannerCapture({ enabled: settings.enabled && !scanningOff, settings, onScan: (barcode) => { setMessage(null); scans.enqueue({ barcode }); }, onCapturing: setCapturing });

  // Search as you type, after a short pause (scanners are faster than the pause, and Enter goes straight to the exact barcode).
  useEffect(() => {
    const handle = setTimeout(() => { setTerm(text.trim()); setHighlight(-1); }, 180);
    return () => clearTimeout(handle);
  }, [text]);

  // F2 or / brings the cursor back to the box from anywhere on the screen.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
      if (event.key === "F2" || (event.key === "/" && !typing)) { event.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (cartId) input.current?.focus(); }, [cartId]);

  const categories = useQuery({ queryKey: scopedQueryKey(workspace, "pos-products", "categories", cartId), queryFn: () => listProductCategories(cartId), enabled: Boolean(cartId),
    staleTime: 60_000 });
  const quick = useQuery({ queryKey: scopedQueryKey(workspace, "pos-products", "quick", cartId), queryFn: () => getQuickProducts(cartId),
    enabled: Boolean(cartId) && !term && !categoryId, staleTime: 30_000 });
  const results = useInfiniteQuery({
    queryKey: scopedQueryKey(workspace, "pos-products", "search", cartId, term, categoryId),
    queryFn: ({ pageParam, signal }) => searchProducts({ cartId, q: term, categoryId, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(cartId),
    staleTime: 10_000,
  });
  const products = useMemo(() => (results.data?.pages ?? []).flatMap((page) => page.products), [results.data]);
  const unavailable = results.data?.pages.find((page) => page.unavailable)?.unavailable;
  const showQuick = !term && !categoryId && (quick.data?.products.length ?? 0) > 0;
  const keyboardList = term || categoryId ? products : [...(quick.data?.products ?? []), ...products];

  const all = categories.data?.categories ?? [];
  const current = all.find((category) => category.id === categoryId) ?? null;
  const children = all.filter((category) => category.parentId === (categoryId ?? null));
  const trail: typeof all = [];
  for (let at = current; at; at = all.find((category) => category.id === at!.parentId) ?? null) trail.unshift(at);

  // A tapped tile (or the highlighted one): that exact product, in its sale unit.
  async function add(product: PosProductResult) {
    if (!cartId || disabled) return;
    if (!product.isSellableNow) {
      setMessage({ tone: "warning", text: `${product.name}: ${product.unavailableReason?.message ?? "This product cannot be added."}` });
      refocus();
      return;
    }
    setBusy(true);
    try {
      const result = await addProductToCart(cartId, { itemId: product.itemId, uomId: product.saleUomId, idempotencyKey: crypto.randomUUID() });
      onCart(result.cart);
      setMessage({ tone: "success", text: `Added ${product.name}${product.saleUomCode && product.uomFactor !== "1" ? ` (${product.saleUomCode})` : ""}.` });
      setText(""); setTerm(""); setHighlight(-1); setChoice(null);
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof PosApiError ? error.message : "The product could not be added. Try again." });
    } finally {
      setBusy(false);
      refocus();
    }
  }

  // Enter (or the scanner's Tab / custom suffix) in the box: the highlighted product, else the code typed or scanned — the manual fallback when
  // no scanner is attached goes through exactly the same scan path.
  function submit(raw = text) {
    if (highlight >= 0 && keyboardList[highlight]) return void add(keyboardList[highlight]);
    const value = stripScannerFraming(raw, settings);
    if (!value || !cartId) return;
    if (scanningOff) { setMessage({ tone: "warning", text: "Scanning is paused. Resume scanning to add products by barcode." }); return; }
    setMessage(null);
    submitted.current = value;
    scans.enqueue({ barcode: value });
  }

  async function openOptions(product: PosProductResult) {
    try {
      const details = await getProductDetails(product.itemId, cartId);
      const options = [...details.units.filter((unit) => unit.saleUomId !== product.saleUomId || details.units.length > 1), ...details.variants.filter((variant) => variant.itemId !== product.itemId)];
      setChoice({ title: product.parentName ?? product.name, description: "Choose the unit or variant to sell.", products: options.length ? options : [details.product] });
    } catch (error) {
      setMessage({ tone: "danger", text: error instanceof PosApiError ? error.message : "The product could not be loaded." });
    }
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setHighlight((index) => Math.min(index + 1, keyboardList.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setHighlight((index) => Math.max(index - 1, -1)); }
    else if (event.key === "Tab" && settings.suffix === "tab" && text.trim()) { event.preventDefault(); submit(); }
  };
  const pending = scans.pending;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium" role="status" aria-live="polite">
          <ScanLine className="size-4 text-text-muted" aria-hidden="true" />
          {!scans.online ? <span className="flex items-center gap-1 text-danger-emphasis"><WifiOff className="size-4" aria-hidden="true" /> Offline — scans wait until the network is back</span>
            : capturing ? PHASE_LABEL.CAPTURING : !settings.enabled && !scanningOff ? "Scanner off on this terminal — type or search" : PHASE_LABEL[scans.phase]}
          {scans.queue.length > 1 && <StatusBadge tone="info">{`${scans.queue.length} waiting`}</StatusBadge>}
        </span>
        <span className="flex flex-wrap gap-2">
          <CameraScanButton isDisabled={scanningOff} onDetect={(barcode) => scans.enqueue({ barcode })} />
          <Button variant="secondary" isDisabled={!cartId || disabled} onPress={() => { setUserPaused((value) => !value); refocus(); }}>
            {userPaused ? <Play className="size-4" aria-hidden="true" /> : <Pause className="size-4" aria-hidden="true" />}
            {userPaused ? "Resume scanning" : "Pause scanning"}
          </Button>
        </span>
      </div>

      <SearchField
        ref={input}
        label="Find a product"
        placeholder="Product name, SKU or barcode"
        value={text}
        onChange={(value) => {
          setMessage(null);
          if (settings.suffix === "custom" && settings.suffixCustom && value.endsWith(settings.suffixCustom)) { setText(value); submit(value); return; }
          setText(value);
        }}
        onSubmit={() => submit()}
        onClear={() => { setText(""); setTerm(""); setHighlight(-1); setMessage(null); }}
        onKeyDown={onKeyDown}
        isDisabled={!cartId || disabled}
        autoFocus
        description="Scan or type, then Enter. ↑ ↓ to choose · Esc clears · F2 returns here."
      />

      {scans.feedback && (
        <div role="alert" className={`flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium ${TONE_CLASS[scans.feedback.tone]}`}>
          <span>{scans.feedback.text}{scans.feedback.barcode ? <span className="ml-2 font-normal opacity-80">Barcode {scans.feedback.barcode}</span> : null}</span>
          {scans.stalled && (
            <span className="flex gap-2">
              <Button size="compact" variant="secondary" onPress={scans.retryStalled}>Retry</Button>
              <Button size="compact" variant="ghost" onPress={scans.discardStalled}>Discard</Button>
            </span>
          )}
        </div>
      )}
      {scans.last && (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border px-3 py-2" aria-label="Last scanned">
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold text-text">{scans.last.product.name}</span>
            <span className="block text-xs text-text-muted">Barcode {scans.last.barcode} · Quantity {Number(scans.last.line?.quantity ?? 1)}{scans.last.line?.uomCode ? ` ${scans.last.line.uomCode}` : ""}</span>
          </span>
          <span className="shrink-0 text-base font-semibold tabular-nums">{scans.last.line ? money(scans.last.product.currency, scans.last.line.lineTotal) : null}</span>
        </div>
      )}
      {pending?.status === "serial_required" && (
        <SerialPrompt key={`${pending.scanActionId}`} product={pending.product.name} problem={pending.code === "POS_SERIAL_REQUIRED" ? null : pending.message}
          suffix={settings.suffix} onSubmit={(serialNumber) => scans.resolvePending({ serialNumber })} onCancel={() => { scans.cancelPending(); refocus(); }} />
      )}
      {pending?.status === "batch_required" && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-warning p-3" data-scan-zone="off">
          <p className="text-sm font-medium">{pending.product.name}: {pending.message}</p>
          <div className="flex flex-wrap gap-2">
            {pending.options.map((option) => (
              <Button key={option.batchId} variant="secondary" onPress={() => scans.resolvePending({ batchId: option.batchId })}>
                {option.batch}{option.expiresOn ? ` · expires ${option.expiresOn}` : ""} · {option.available}
              </Button>
            ))}
            <Button variant="ghost" onPress={() => { scans.cancelPending(); refocus(); }}>Cancel</Button>
          </div>
        </div>
      )}

      {message && (
        <p role="status" aria-live="polite" className={`rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium ${TONE_CLASS[message.tone]}`}>
          {message.text}
        </p>
      )}

      <nav aria-label="Categories" className="flex flex-wrap items-center gap-2">
        <Chip active={!categoryId} onPress={() => { setCategoryId(null); refocus(); }}>All products</Chip>
        {trail.map((category) => (
          <Chip key={category.id} active={category.id === categoryId} onPress={() => setCategoryId(category.id)}>{category.name}</Chip>
        ))}
        {children.map((category) => (
          <Chip key={category.id} onPress={() => setCategoryId(category.id)} subtle>{category.name}</Chip>
        ))}
      </nav>

      {showQuick && (
        <section aria-label="Quick products" className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Quick products</h3>
          <Grid products={quick.data!.products} offset={0} highlight={highlight} busy={busy} onAdd={add} onOptions={openOptions} />
        </section>
      )}

      <section aria-label="Products" className="flex flex-col gap-2">
        {showQuick && <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{current ? current.name : "All products"}</h3>}
        {results.isLoading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4" aria-label="Loading products">
            {Array.from({ length: 8 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-[var(--radius-control)] bg-surface-muted" />)}
          </div>
        ) : results.isError || unavailable ? (
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border p-3 text-sm">
            <span>{unavailable?.message ?? (results.error instanceof PosApiError ? results.error.message : "Search is temporarily unavailable. Please retry.")}</span>
            <Button variant="secondary" size="compact" onPress={() => void results.refetch()}>Retry</Button>
          </div>
        ) : products.length === 0 ? (
          <p className="rounded-[var(--radius-control)] border border-dashed border-border p-6 text-center text-sm text-text-muted">
            {term ? `No products match “${term}”. Try another name or code.` : "No products to show here."}
          </p>
        ) : (
          <>
            <Grid products={products} offset={showQuick ? quick.data!.products.length : 0} highlight={highlight} busy={busy} onAdd={add} onOptions={openOptions} />
            {results.hasNextPage && (
              <Button variant="secondary" isLoading={results.isFetchingNextPage} onPress={() => void results.fetchNextPage()}>Show more</Button>
            )}
          </>
        )}
      </section>

      {choice && (
        <Dialog isOpen onOpenChange={(open) => { if (!open) { setChoice(null); refocus(); } }} title={choice.title}>
          <div className="flex flex-col gap-3">
            {choice.description && <p className="text-sm text-text-secondary">{choice.description}</p>}
            <Grid products={choice.products} offset={-1000} highlight={-1} busy={busy} onAdd={add} />
          </div>
        </Dialog>
      )}
      {pending?.status === "selection_required" && (
        <Dialog isOpen onOpenChange={(open) => { if (!open) { scans.cancelPending(); refocus(); } }}
          title={pending.reason === "ambiguous" ? "This barcode matches more than one product" : pending.message}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-secondary">
              {pending.reason === "ambiguous" ? "Choose the product in the customer's hands, and ask a manager to correct the barcode in the Item Master." : "Choose the exact variant to sell."}
            </p>
            <Grid products={pending.candidates} offset={-1000} highlight={-1} busy={scans.busy}
              onAdd={(product) => (product.isSellableNow ? scans.resolvePending({ itemId: product.itemId })
                : setMessage({ tone: "warning", text: `${product.name}: ${product.unavailableReason?.message ?? "This product cannot be added."}` }))} />
          </div>
        </Dialog>
      )}
    </div>
  );
}

// The serial number of a serial-tracked product just scanned: scanner input goes into this box (it has the focus), never to the product lookup.
function SerialPrompt({ product, problem, suffix, onSubmit, onCancel }: {
  product: string; problem: string | null; suffix: "enter" | "tab" | "custom"; onSubmit: (serialNumber: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const send = () => { if (value.trim()) onSubmit(value.trim()); };
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-warning p-3" data-scan-zone="off">
      <p className="text-sm font-medium">Scan or select the serial number of {product}.</p>
      {problem && <p className="text-sm text-danger-emphasis">{problem}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="Serial number" value={value} onChange={setValue} autoFocus className="min-w-56 flex-1"
          onKeyDown={(event) => { if (event.key === "Enter" || (event.key === "Tab" && suffix === "tab" && value.trim())) { event.preventDefault(); send(); } }} />
        <Button variant="primary" isDisabled={!value.trim()} onPress={send}>Add</Button>
        <Button variant="ghost" onPress={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function Chip({ active = false, subtle = false, onPress, children }: { active?: boolean; subtle?: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onPress} aria-pressed={active}
      className={`min-h-10 rounded-full border px-4 text-sm font-medium transition-colors ${active ? "border-brand bg-brand text-white" : subtle ? "border-dashed border-border text-text-secondary hover:bg-surface-muted" : "border-border text-text hover:bg-surface-muted"}`}>
      {children}
    </button>
  );
}

function Grid({ products, offset, highlight, busy, onAdd, onOptions }: {
  products: PosProductResult[]; offset: number; highlight: number; busy: boolean; onAdd: (product: PosProductResult) => void; onOptions?: (product: PosProductResult) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      {products.map((product, index) => (
        <li key={`${product.itemId}:${product.saleUomId}`} className="relative">
          <Tile product={product} active={offset + index === highlight} busy={busy} onAdd={() => onAdd(product)} />
          {onOptions && (
            <IconButton variant="ghost" size="compact" className="absolute right-1 top-1" aria-label={`Units and variants of ${product.name}`} onPress={() => onOptions(product)}>
              <Layers className="size-4" aria-hidden="true" />
            </IconButton>
          )}
        </li>
      ))}
    </ul>
  );
}

function Tile({ product, active, busy, onAdd }: { product: PosProductResult; active: boolean; busy: boolean; onAdd: () => void }) {
  const unit = product.saleUomCode ? ` / ${product.saleUomCode}` : "";
  return (
    <button type="button" onClick={onAdd} disabled={busy} aria-disabled={!product.isSellableNow}
      aria-label={`${product.name}, ${product.displayPrice === null ? "price not set" : money(product.currency, product.displayPrice)}${product.isSellableNow ? "" : `, ${product.unavailableReason?.message ?? "cannot be added"}`}`}
      className={`flex h-full min-h-28 w-full flex-col gap-1 rounded-[var(--radius-control)] border p-3 pr-9 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${active ? "border-brand ring-2 ring-brand" : "border-border"} ${product.isSellableNow ? "hover:bg-surface-muted" : "bg-surface-muted/60 text-text-muted"}`}>
      <span className="flex items-start gap-2">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt="" className="size-10 shrink-0 rounded-[var(--radius-control)] border border-border object-cover" />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-surface-muted text-text-muted"><Package className="size-5" aria-hidden="true" /></span>
        )}
        <span className="min-w-0">
          <span className="line-clamp-2 text-base font-medium leading-snug text-text">{product.name}</span>
          <span className="block truncate text-xs text-text-muted">{product.sku}{product.variantLabel ? ` · ${product.variantLabel}` : ""}</span>
        </span>
      </span>
      <span className="mt-auto flex flex-wrap items-center justify-between gap-1">
        <span className="text-base font-semibold tabular-nums text-text">{product.displayPrice === null ? "Price not set" : `${money(product.currency, product.displayPrice)}${unit}`}</span>
        {product.stockStatus && (
          <StatusBadge tone={STOCK_TONE[product.stockStatus]}>{stockText(product)}</StatusBadge>
        )}
      </span>
    </button>
  );
}

// Stock in words (never colour alone); the exact figure only for people allowed to see stock.
function stockText(product: PosProductResult) {
  if (!product.stockStatus) return "";
  if (product.stockStatus === "unavailable") return product.unavailableReason?.message.replace(/.$/, "") ?? STOCK_LABEL.unavailable;
  return product.availableQuantity !== null ? `${STOCK_LABEL[product.stockStatus]} · ${Number(product.availableQuantity)}` : STOCK_LABEL[product.stockStatus];
}
