"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MODULE_NAV_GROUPS, LANDING_MODULES, PRIMARY_NAV, CTAS } from "@vercentlabs/landing-content";
import { ButtonLink } from "@/components/ui/button";
import { APP_URL } from "@/lib/site";

const productItem = PRIMARY_NAV.find((item) => item.label === "Product");
const simpleLinks = PRIMARY_NAV.filter((item) => item.label !== "Product" && item.label !== "Modules");

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

/**
 * A dedicated mobile experience, not a shrunk mega menu: module groups collapse
 * into a two-level accordion (group -> module, matching the brief's "maximum
 * practical depth should be two levels"), focus moves in on open and returns to
 * the trigger on close, and background scroll is locked while open.
 */
export function MobileNav({ open, onClose }: MobileNavProps) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (open) onClose();
    // Only re-run when the route actually changes, not when onClose identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      // Trap Tab/Shift+Tab inside the panel — without this, a keyboard user
      // can tab out of the full-screen dialog into header/content elements
      // sitting behind the semi-transparent overlay.
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  // Portalled to document.body: a dialog's `fixed` positioning must be relative
  // to the viewport, not whatever ancestor happens to render it. Rendering
  // in-place previously broke when the header gained a `backdrop-filter`
  // (any transform/filter/backdrop-filter/contain ancestor creates a new CSS
  // containing block for `fixed` descendants) — portalling makes this robust
  // against that entire class of future ancestor-style regressions.
  return createPortal(
    <div id="mobile-nav" role="dialog" aria-modal="true" aria-label="Site navigation" className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col overflow-y-auto bg-(--color-bg-elevated) shadow-(--shadow-panel)"
      >
        <div className="flex items-center justify-between border-b border-(--color-border-default) px-5 py-4">
          <span className="text-sm font-semibold text-(--color-text-primary)">Menu</span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-(--radius-control) text-(--color-text-primary) hover:bg-(--color-bg-subtle) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)"
          >
            <span className="sr-only">Close menu</span>
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
              <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 px-5 py-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-(--color-text-muted)">Product</p>
          <ul className="mb-6 flex flex-col gap-1">
            {productItem?.children?.map((child) => (
              <li key={child.href}>
                <Link href={child.href} prefetch={false} className="block rounded-(--radius-control) px-2 py-2.5 text-sm font-medium text-(--color-text-primary) hover:bg-(--color-bg-subtle)">
                  {child.label}
                </Link>
              </li>
            ))}
          </ul>

          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-(--color-text-muted)">Modules</p>
          <ul className="mb-6 flex flex-col gap-1">
            {MODULE_NAV_GROUPS.map((group) => {
              const isExpanded = expandedGroup === group.key;
              return (
                <li key={group.key}>
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={`mobile-group-${group.key}`}
                    onClick={() => setExpandedGroup(isExpanded ? null : group.key)}
                    className="flex w-full items-center justify-between rounded-(--radius-control) px-2 py-2.5 text-left text-sm font-medium text-(--color-text-primary) hover:bg-(--color-bg-subtle)"
                  >
                    {group.label}
                    <svg viewBox="0 0 12 12" width="10" height="10" className={isExpanded ? "rotate-180" : ""} aria-hidden="true">
                      <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {isExpanded ? (
                    <ul id={`mobile-group-${group.key}`} className="mb-1 mt-1 flex flex-col gap-0.5 pl-4">
                      {group.moduleKeys.map((key) => {
                        const moduleInfo = LANDING_MODULES.find((candidate) => candidate.key === key);
                        if (!moduleInfo) return null;
                        return (
                          <li key={moduleInfo.key}>
                            <Link
                              href={`/modules/${moduleInfo.key}`}
                              prefetch={false}
                              className="flex min-h-11 items-center gap-2 rounded-(--radius-control) px-2 py-2 text-sm text-(--color-text-secondary) hover:bg-(--color-bg-subtle) hover:text-(--color-text-brand)"
                            >
                              <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: moduleInfo.accentColor.hex }} aria-hidden="true" />
                              {moduleInfo.name}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <ul className="flex flex-col gap-1">
            {simpleLinks.map((item) => (
              <li key={item.href}>
                <Link href={item.href} prefetch={false} className="block min-h-11 rounded-(--radius-control) px-2 py-2.5 text-sm font-medium text-(--color-text-primary) hover:bg-(--color-bg-subtle)">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href={APP_URL.toString()} className="block min-h-11 rounded-(--radius-control) px-2 py-2.5 text-sm font-medium text-(--color-text-secondary) hover:bg-(--color-bg-subtle)">
                Sign in
              </Link>
            </li>
          </ul>
        </nav>

        <div className="border-t border-(--color-border-default) px-5 py-4">
          <ButtonLink href={CTAS.primary.href} className="w-full">
            {CTAS.primary.label}
          </ButtonLink>
        </div>
      </div>
    </div>,
    document.body,
  );
}
