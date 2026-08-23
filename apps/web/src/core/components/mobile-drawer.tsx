"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

// Replaces the previous <details>/<summary> "mobile menu" hack, which had
// no real dialog semantics, no focus trap, no body-scroll lock, no
// Escape-to-close, and (since AppShell's layout persists across client-side
// navigations) could stay stuck open after following a link. This is a
// real dialog: role="dialog", aria-modal, a focus trap, body scroll lock
// while open, Escape support, backdrop-click-to-close, and it closes
// itself automatically whenever the route changes.
export default function MobileDrawer({
  brand,
  children,
}: {
  brand: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    lastFocusedRef.current?.focus();
  }, []);

  const openDrawer = useCallback(() => {
    lastFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
    setOpen(true);
  }, []);

  // Closes automatically on navigation — the drawer's own <Link>s trigger
  // this via a pathname change, covering every navigation path (click,
  // keyboard activation, browser back/forward) without each nav item
  // needing its own onClick handler.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    function handleExternalOpen() {
      openDrawer();
    }
    window.addEventListener("vercentlabs:open-mobile-drawer", handleExternalOpen);
    return () => window.removeEventListener("vercentlabs:open-mobile-drawer", handleExternalOpen);
  }, [openDrawer]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!panelRef.current.contains(activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [open, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="mobile-menu-trigger"
        aria-label="Open navigation menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openDrawer}
      >
        <span aria-hidden="true" className="menu-lines">
          <i />
          <i />
          <i />
        </span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="mobile-drawer-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) close();
              }}
            >
              <div
                ref={panelRef}
                className="mobile-drawer-panel"
                role="dialog"
                aria-modal="true"
                aria-label="Navigation menu"
                tabIndex={-1}
              >
                <div className="mobile-drawer-header">
                  {brand}
                  <button
                    type="button"
                    className="mobile-drawer-close"
                    aria-label="Close navigation menu"
                    onClick={close}
                  >
                    <span aria-hidden="true">Esc</span>
                  </button>
                </div>
                <nav className="mobile-drawer-nav" aria-label="Mobile workspace navigation">
                  {children}
                </nav>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
