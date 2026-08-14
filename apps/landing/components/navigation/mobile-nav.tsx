
"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MODULE_NAV_GROUPS, LANDING_MODULES, PRIMARY_NAV, CTAS } from "@vercentlabs/landing-content";
import { ButtonLink } from "@/components/ui/button";
import { APP_URL } from "@/lib/site";
import { cx } from "@/lib/utils";
import { useOpenTransition } from "@/components/motion/use-open-transition";

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
  const { rendered, visible } = useOpenTransition(open, 200);

  useEffect(() => {
    if (open) onClose();
    // Only re-run when the route actually changes, not when onClose identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Focus the close button once the panel has actually mounted (`rendered`),
  // not merely once `open` is requested. On the render where `open` first
  // flips true, `rendered` is still stale-false for one commit (state
  // updates from useOpenTransition's own effect are async) — the portal, and
  // therefore closeButtonRef.current, doesn't exist yet in that commit, so a
  // focus() call keyed on `open` alone would silently no-op.
  useEffect(() => {
    if (!rendered) return;
    closeButtonRef.current?.focus();
  }, [rendered]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
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

  if (!rendered) return null;

  // Portalled to document.body: a dialog's `fixed` positioning must be relative
  // to the viewport, not whatever ancestor happens to render it. Rendering
  // in-place previously broke when the header gained a `backdrop-filter`
  // (any transform/filter/backdrop-filter/contain ancestor creates a new CSS
  // containing block for `fixed` descendants) — portalling makes this robust
  // against that entire class of future ancestor-style regressions.
  return createPortal(
    <div id="mobile-nav" role="dialog" aria-modal="true" aria-label="Site navigation" className="fixed inset-0 z-50 lg:hidden">
      <div
        className={cx(
          "absolute inset-0 bg-black/45 transition-opacity duration-(--duration-base) ease-(--ease-standard)",
          visible ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={cx(
          "absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto border-l border-(--color-border-strong) bg-(--color-bg-elevated) shadow-[-18px_0_45px_rgba(23,24,23,.12)] transition-transform duration-(--duration-base) ease-(--ease-standard)",
          visible ? "translate-x-0" : "translate-x-full",
          !visible && "pointer-events-none",
        )}
      >
        <div className="flex min-h-[68px] items-center justify-between border-b border-(--color-border-strong) px-5 py-4">
          <span className="vl-kicker before:hidden">Navigation</span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-[3px] border border-(--color-border-default) text-(--color-text-primary) hover:border-(--color-border-strong) hover:bg-(--color-bg-subtle) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)"
          >
            <span className="sr-only">Close menu</span>
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
              <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 px-5 py-6">
          <p className="mb-3 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-(--color-text-muted)">Product</p>
          <ul className="mb-6 flex flex-col gap-1">
            {productItem?.children?.map((child) => (
              <li key={child.href}>
                <Link href={child.href} prefetch={false} className="block border-b border-(--color-border-subtle) px-0 py-3 text-sm font-semibold text-(--color-text-primary) hover:text-(--color-text-brand)">
                  {child.label}
                </Link>
              </li>
            ))}
          </ul>

          <p className="mb-3 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-(--color-text-muted)">Modules</p>
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
                    className="flex w-full items-center justify-between border-b border-(--color-border-subtle) px-0 py-3 text-left text-sm font-semibold text-(--color-text-primary) hover:text-(--color-text-brand)"
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
                              className="flex min-h-11 items-center gap-3 border-b border-(--color-border-subtle) px-0 py-2 text-sm text-(--color-text-secondary) hover:text-(--color-text-brand)"
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
                <Link href={item.href} prefetch={false} className="block min-h-11 border-b border-(--color-border-subtle) px-0 py-3 text-sm font-semibold text-(--color-text-primary) hover:text-(--color-text-brand)">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href={APP_URL.toString()} className="block min-h-11 border-b border-(--color-border-subtle) px-0 py-3 text-sm font-semibold text-(--color-text-secondary) hover:text-(--color-text-brand)">
                Sign in
              </Link>
            </li>
          </ul>
        </nav>

        <div className="border-t border-(--color-border-strong) bg-(--color-bg-subtle) px-5 py-5">
          <ButtonLink href={CTAS.primary.href} className="w-full">
            {CTAS.primary.label}
          </ButtonLink>
        </div>
      </div>
    </div>,
    document.body,
  );
}
