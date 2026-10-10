"use client";

// The POS scanner input handler. Two parts:
//
// useScanQueue — every completed scan becomes an event with its own action id, queued in order and sent one at a time. The queue is kept in
// the browser session, so a refresh mid-scan resends the same event (the server answers with its original outcome rather than adding twice).
// A network failure retries the same event a few times, then stops and says so — never a silent success. While a scan needs a selection
// (variant, serial, batch) the next events wait.
//
// useScannerCapture — a keyboard-wedge scanner (USB or Bluetooth in keyboard mode) types the code and its suffix. When no input field has the
// focus, those keystrokes are collected and handed over at the suffix (Enter, Tab or the terminal's custom suffix), its prefix removed. Keys
// typed into any field — the search box handles its own scans, customer, payment and note fields, the serial-number box — are never taken,
// and nothing is captured while a dialog is open, inside an area marked data-scan-zone="off" (payment, customer), or while scanning is paused.
// Typing speed only helps to drop stale keystrokes; it never decides what a scan is.
import { useCallback, useEffect, useRef, useState } from "react";
import type { PosCart } from "@vercentlabs/api";

import { PosApiError } from "@/features/pos/shared/http";

import { scanIntoCart, scanTone, stripScannerFraming, type PosScanOutcome, type PosScannerSettings } from "./scanner-api";

export type ScanPhase = "READY" | "CAPTURING" | "RESOLVING" | "ADDING" | "SUCCESS" | "ERROR" | "SELECTION_REQUIRED" | "PAUSED";
export type ScanEvent = { id: string; barcode: string; itemId?: string | null; serialNumber?: string | null; batchId?: string | null; attempts: number };
export type ScanFeedback = { tone: "success" | "warning" | "danger"; text: string; barcode?: string };
type Added = Extract<PosScanOutcome, { status: "added" }>;
export type PendingScan = Exclude<PosScanOutcome, { status: "added" } | { status: "rejected" }>;

const MAX_QUEUE = 50;
const RETRY_DELAYS = [800, 2000, 4000];
const storageKey = (cartId: string) => `pos-scan-queue:${cartId}`;

function loadQueue(cartId: string | null): ScanEvent[] {
  if (!cartId) return [];
  try { return JSON.parse(sessionStorage.getItem(storageKey(cartId)) ?? "[]") as ScanEvent[]; } catch { return []; }
}

export function useScanQueue({ cartId, settings, paused, onCart, onOutcome }: {
  cartId: string | null; settings: PosScannerSettings; paused: boolean; onCart: (cart: PosCart) => void; onOutcome?: (outcome: PosScanOutcome) => void;
}) {
  const [queue, setQueue] = useState<ScanEvent[]>(() => loadQueue(cartId));
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ScanPhase>("READY");
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [last, setLast] = useState<Added | null>(null);
  const [pending, setPending] = useState<PendingScan | null>(null);
  const [stalled, setStalled] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const callbacks = useRef({ onCart, onOutcome, settings });
  useEffect(() => { callbacks.current = { onCart, onOutcome, settings }; });

  // A new cart starts with whatever this browser session still had queued for it.
  const [queueCart, setQueueCart] = useState(cartId);
  if (queueCart !== cartId) { setQueueCart(cartId); setQueue(loadQueue(cartId)); }
  useEffect(() => {
    if (!cartId) return;
    try { if (queue.length) sessionStorage.setItem(storageKey(cartId), JSON.stringify(queue)); else sessionStorage.removeItem(storageKey(cartId)); } catch { /* private mode */ }
  }, [cartId, queue]);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  const enqueue = useCallback((event: Omit<ScanEvent, "id" | "attempts">, { front = false } = {}) => {
    if (!event.barcode) return false;
    let accepted = true;
    setQueue((current) => {
      if (current.length >= MAX_QUEUE) { accepted = false; return current; }
      const next = { ...event, id: crypto.randomUUID(), attempts: 0 };
      return front ? [next, ...current] : [...current, next];
    });
    if (!accepted) setFeedback({ tone: "danger", text: "Too many scans are waiting. Let the current ones finish." });
    return accepted;
  }, []);

  const tone = (kind: "success" | "error") => {
    const { settings: current } = callbacks.current;
    if (kind === "success" ? current.successSound : current.errorSound) scanTone(kind);
  };

  // One event at a time, in order.
  useEffect(() => {
    const head = queue[0];
    if (!cartId || !head || busy || pending || stalled || paused || !online) return;
    let cancelled = false;
    // Started from a timer (not synchronously in the effect), and cancelled if the queue changes first.
    const timer = setTimeout(() => {
    setBusy(true);
    setPhase("ADDING");
    scanIntoCart(cartId, { barcode: head.barcode, scanActionId: head.id, itemId: head.itemId ?? null, serialNumber: head.serialNumber ?? null, batchId: head.batchId ?? null })
      .then((outcome) => {
        if (cancelled) return;
        setQueue((current) => current.filter((event) => event.id !== head.id));
        callbacks.current.onOutcome?.(outcome);
        if (outcome.status === "added") {
          if (outcome.cart) callbacks.current.onCart(outcome.cart);
          setLast(outcome);
          setFeedback({ tone: "success", text: outcome.message, barcode: outcome.barcode });
          setPhase("SUCCESS");
          tone("success");
        } else if (outcome.status === "rejected") {
          setFeedback({ tone: "danger", text: outcome.message, barcode: outcome.barcode });
          setPhase("ERROR");
          tone("error");
        } else {
          setPending(outcome);
          setFeedback({ tone: "warning", text: outcome.message, barcode: outcome.barcode });
          setPhase("SELECTION_REQUIRED");
          tone("error");
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const transient = !(error instanceof PosApiError) || error.status >= 500 || error.status === 429;
        if (transient && head.attempts < RETRY_DELAYS.length) {
          setFeedback({ tone: "warning", text: "Connection problem — retrying the scan…", barcode: head.barcode });
          setTimeout(() => setQueue((current) => current.map((event) => (event.id === head.id ? { ...event, attempts: event.attempts + 1 } : event))), RETRY_DELAYS[head.attempts]);
          return;
        }
        if (transient) {
          setStalled(true);
          setFeedback({ tone: "danger", text: "Could not add the product. Please retry.", barcode: head.barcode });
        } else {
          setQueue((current) => current.filter((event) => event.id !== head.id));
          setFeedback({ tone: "danger", text: error instanceof PosApiError ? error.message : "Could not add the product. Please retry.", barcode: head.barcode });
        }
        setPhase("ERROR");
        tone("error");
      })
      .finally(() => { if (!cancelled) setBusy(false); });
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [cartId, queue, busy, pending, stalled, paused, online]);

  // A follow-up to a pending scan (the chosen product, serial or batch) goes first, as its own new event for the same barcode.
  const resolvePending = useCallback((extra: { itemId?: string; serialNumber?: string; batchId?: string }) => {
    if (!pending) return;
    const barcode = pending.barcode;
    setPending(null);
    setPhase("READY");
    enqueue({ barcode, ...extra }, { front: true });
  }, [pending, enqueue]);
  const cancelPending = useCallback(() => { setPending(null); setPhase("READY"); setFeedback(null); }, []);
  const retryStalled = useCallback(() => { setStalled(false); setQueue((current) => current.map((event, index) => (index === 0 ? { ...event, attempts: 0 } : event))); }, []);
  const discardStalled = useCallback(() => { setStalled(false); setQueue((current) => current.slice(1)); setFeedback(null); }, []);

  const shownPhase: ScanPhase = paused ? "PAUSED" : pending ? "SELECTION_REQUIRED" : busy ? "ADDING" : phase === "ADDING" ? "READY" : phase;
  return { enqueue, queue, phase: shownPhase, feedback, setFeedback, last, pending, resolvePending, cancelPending, stalled, retryStalled, discardStalled, online, busy };
}

const editable = (target: EventTarget | null) => target instanceof HTMLElement
  && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || Boolean(target.closest("[role='combobox'], [role='textbox']")));

export function useScannerCapture({ enabled, settings, onScan, onCapturing }: {
  enabled: boolean; settings: PosScannerSettings; onScan: (barcode: string) => void; onCapturing?: (capturing: boolean) => void;
}) {
  const handlers = useRef({ onScan, onCapturing, settings });
  useEffect(() => { handlers.current = { onScan, onCapturing, settings }; });
  useEffect(() => {
    if (!enabled) return;
    let buffer = "";
    let lastKey = 0;
    const finish = () => {
      const { settings: current, onScan: emit, onCapturing: capturing } = handlers.current;
      const value = stripScannerFraming(buffer, current);
      buffer = "";
      capturing?.(false);
      if (value) emit(value);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (editable(event.target) || document.querySelector("[role='dialog'], [role='alertdialog']")) return;
      if (event.target instanceof HTMLElement && event.target.closest("[data-scan-zone='off']")) return;
      const now = performance.now();
      if (now - lastKey > 1000) buffer = "";
      lastKey = now;
      const { settings: current } = handlers.current;
      const isSuffix = (current.suffix === "enter" && event.key === "Enter") || (current.suffix === "tab" && event.key === "Tab");
      if (isSuffix) {
        if (buffer) { event.preventDefault(); finish(); }
        return;
      }
      if (event.key.length !== 1) return;
      buffer += event.key;
      handlers.current.onCapturing?.(true);
      if (current.suffix === "custom" && current.suffixCustom && buffer.endsWith(current.suffixCustom)) { event.preventDefault(); finish(); }
      // A plain Enter after a code also ends it when the scanner is set to a custom suffix but sends Enter too.
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
