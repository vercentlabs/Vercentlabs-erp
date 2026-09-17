"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

import { MODULE_NAVIGATION } from "@/shell/navigation/module-navigation-registry";
import type { ModuleNavigation } from "@/shell/navigation/navigation-types";

const PIN_STORAGE_KEY = "vercentlabs.secondarySidebar.pinned";
// A same-tab write to localStorage doesn't fire a "storage" event (only
// other tabs get that) — this custom event is what lets
// useSyncExternalStore notice this tab's own togglePinned() write, in
// addition to the real "storage" event for cross-tab sync.
const PINNED_CHANGE_EVENT = "vercentlabs:secondarySidebarPinnedChange";

function subscribeToPinned(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(PINNED_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(PINNED_CHANGE_EVENT, callback);
  };
}
function getPinnedSnapshot() {
  try {
    return window.localStorage.getItem(PIN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
function getPinnedServerSnapshot() {
  return false;
}

function isActiveRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function findActiveModule(pathname: string): ModuleNavigation | undefined {
  return MODULE_NAVIGATION.find((entry) => {
    const overview = entry.sections[0]?.items[0]?.route;
    return overview ? isActiveRoute(pathname, overview) : false;
  });
}

interface SecondarySidebarContextValue {
  activeModule: ModuleNavigation | undefined;
  /** Persisted (localStorage) — the sidebar stays open as part of the
   * layout regardless of hover/focus. */
  pinned: boolean;
  togglePinned: () => void;
  /** True whenever the flyout should be visible: pinned, hovered,
   * keyboard-focused within the rail/flyout region, or click-opened. */
  open: boolean;
  regionHandlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: (event: FocusEvent<HTMLElement>) => void;
    onBlur: (event: FocusEvent<HTMLElement>) => void;
  };
  toggleClickOpen: () => void;
  closeClickOpen: () => void;
}

const SecondarySidebarContext =
  createContext<SecondarySidebarContextValue | null>(null);

// Desktop-only interaction model for the module secondary sidebar (UI
// refinement addendum, requirement #1): hidden by default, revealed as a
// flyover on hover/keyboard-focus of the rail+flyout region, click-openable
// via the handle in ModuleRail for non-hover input, and pinnable (persisted
// per-browser) for anyone who wants it permanently in the layout flow
// instead of floating. Mobile/tablet never mounts this — MobileNav's
// drawer is a completely separate component tree.
export function SecondarySidebarProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeModule = findActiveModule(pathname);

  const pinned = useSyncExternalStore(subscribeToPinned, getPinnedSnapshot, getPinnedServerSnapshot);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [clickOpen, setClickOpen] = useState(false);
  const leaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resets clickOpen when the route changes, without an effect — the
  // React-documented pattern for "adjust state when a value changes"
  // (react.dev, "You Might Not Need an Effect"): compare against the
  // previous render's value during render itself and call setState
  // conditionally, which React explicitly allows here (it bails out
  // before committing/painting the stale render), rather than committing
  // a stale frame and cleaning it up one effect-cycle later.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setClickOpen(false);
  }

  function togglePinned() {
    const next = !pinned;
    try {
      window.localStorage.setItem(PIN_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // best-effort persistence only
    }
    window.dispatchEvent(new Event(PINNED_CHANGE_EVENT));
    setClickOpen(false);
  }

  function onMouseEnter() {
    if (leaveTimeout.current) clearTimeout(leaveTimeout.current);
    setHovering(true);
  }
  function onMouseLeave() {
    // Small delay so moving the cursor across the gap between the rail
    // and the flyout doesn't flicker it closed mid-transit.
    leaveTimeout.current = setTimeout(() => setHovering(false), 150);
  }
  function onFocus() {
    setFocused(true);
  }
  function onBlur(event: FocusEvent<HTMLElement>) {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setFocused(false);
  }
  function toggleClickOpen() {
    setClickOpen((prev) => !prev);
  }
  function closeClickOpen() {
    setClickOpen(false);
  }

  const open = pinned || hovering || focused || clickOpen;

  return (
    <SecondarySidebarContext.Provider
      value={{
        activeModule,
        pinned,
        togglePinned,
        open,
        regionHandlers: { onMouseEnter, onMouseLeave, onFocus, onBlur },
        toggleClickOpen,
        closeClickOpen,
      }}
    >
      {children}
    </SecondarySidebarContext.Provider>
  );
}

export function useSecondarySidebarState() {
  const ctx = useContext(SecondarySidebarContext);
  if (!ctx) {
    throw new Error(
      "useSecondarySidebarState must be used within SecondarySidebarProvider",
    );
  }
  return ctx;
}
