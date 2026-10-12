"use client";

// Live stock for a POS terminal: one server stream (Server-Sent Events) of "availability changed" notices for the warehouses this user's
// outlets use. A notice only says which item changed and its new version: the screen fetches the authoritative figure again. Versions are
// kept per warehouse and item, so a repeated or late notice never brings an older figure back; changes arriving together refresh once.
// When the stream drops, stock on screen is marked as possibly out of date; when it returns, everything visible is fetched again.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@vercentlabs/design-system";

import { streamUrl, type AvailabilityChange } from "@/features/pos/live-inventory/api/live-inventory-api";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline" | "denied";
type LiveInventory = { status: LiveStatus; lastChangeAt: string | null; stale: boolean; versionOf: (warehouseId: string, itemId: string) => number };

const LiveInventoryContext = createContext<LiveInventory>({ status: "offline", lastChangeAt: null, stale: true, versionOf: () => 0 });
export const useLiveInventory = () => useContext(LiveInventoryContext);

// The queries whose figures come from Inventory: product lists and details, a bill's stock, a checkout's reservation.
const STOCK_KEYS = [["pos-products"], ["pos", "cart-availability"], ["pos", "item-stock"], ["pos", "checkout-stock"]] as const;

export function LiveInventoryProvider({ terminalId, children }: { terminalId: string | null; children: ReactNode }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [lastChangeAt, setLastChangeAt] = useState<string | null>(null);
  const versions = useRef(new Map<string, number>());
  const pending = useRef<Set<string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback((itemIds: Set<string> | "all") => {
    for (const key of STOCK_KEYS) {
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const k = query.queryKey as readonly unknown[];
          if (k[0] !== workspace.organizationId || !key.every((part, index) => k[index + 1] === part)) return false;
          // A product list shows many items: refreshed whenever anything changed. An item's detail only when that item changed.
          if (itemIds === "all" || key[1] !== "item-stock") return true;
          return itemIds.has(String(k[3]));
        },
      });
    }
  }, [queryClient, workspace.organizationId]);

  // Changes arriving within a moment of each other are applied together (a busy item refreshes once, not once per sale).
  const schedule = useCallback((itemId: string) => {
    (pending.current ??= new Set()).add(itemId);
    if (timer.current) return;
    timer.current = setTimeout(() => {
      const items = pending.current ?? new Set<string>();
      pending.current = null;
      timer.current = null;
      refresh(items);
    }, 250);
  }, [refresh]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let everConnected = false;
    let stopped = false;
    // Where this terminal is in the change feed: a new stream resumes after it (nothing missed across a reconnection).
    let cursor: number | null = null;
    const connect = () => {
      if (stopped) return;
      source = new EventSource(streamUrl(terminalId, cursor), { withCredentials: true });
      source.addEventListener("ready", (message) => {
        const ready = JSON.parse((message as MessageEvent).data) as { cursor: number };
        cursor = Math.max(cursor ?? 0, ready.cursor);
        setStatus("live");
        // First connection: the screen already fetched fresh figures. A reconnection: anything may have changed meanwhile.
        if (everConnected) refresh("all");
        everConnected = true;
      });
      source.addEventListener("availability", (message) => {
        const change = JSON.parse((message as MessageEvent).data) as AvailabilityChange;
        cursor = Math.max(cursor ?? 0, change.sequence);
        const key = `${change.warehouseId}:${change.itemId}`;
        if ((versions.current.get(key) ?? 0) >= change.inventoryVersion) return;
        versions.current.set(key, change.inventoryVersion);
        setLastChangeAt(change.occurredAt);
        schedule(change.itemId);
      });
      // The server ends each stream after a few minutes; the browser reconnects through the full session checks and resumes after the last event.
      source.addEventListener("rotate", () => { source?.close(); connect(); });
      source.addEventListener("denied", () => { source?.close(); setStatus("denied"); });
      source.addEventListener("unavailable", () => { source?.close(); setStatus("reconnecting"); retry = setTimeout(connect, 3000); });
      source.onerror = () => {
        if (source?.readyState === EventSource.CLOSED) { setStatus("reconnecting"); retry = setTimeout(connect, 3000); }
        else setStatus(navigator.onLine ? "reconnecting" : "offline");
      };
    };
    const offline = () => setStatus("offline");
    const online = () => { setStatus("reconnecting"); source?.close(); connect(); };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    connect();
    return () => {
      stopped = true;
      source?.close();
      if (retry) clearTimeout(retry);
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [terminalId, refresh, schedule]);

  const value = useMemo<LiveInventory>(() => ({
    status, lastChangeAt, stale: status !== "live",
    versionOf: (warehouseId, itemId) => versions.current.get(`${warehouseId}:${itemId}`) ?? 0,
  }), [status, lastChangeAt]);
  return <LiveInventoryContext.Provider value={value}>{children}</LiveInventoryContext.Provider>;
}

const INDICATOR: Record<LiveStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  connecting: { label: "Checking Stock", tone: "neutral" },
  live: { label: "Stock: Live", tone: "success" },
  reconnecting: { label: "Reconnecting stock…", tone: "warning" },
  offline: { label: "Connection Lost", tone: "danger" },
  denied: { label: "Stock not available here", tone: "danger" },
};

// The terminal's live-stock state in plain words.
export function LiveStockIndicator() {
  const { status } = useLiveInventory();
  const entry = INDICATOR[status];
  return <StatusBadge tone={entry.tone}>{entry.label}</StatusBadge>;
}
