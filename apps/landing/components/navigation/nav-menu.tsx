"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/utils";

interface NavMenuProps {
  label: string;
  children: ReactNode;
  panelClassName?: string;
}

/**
 * Accessible disclosure for header dropdowns/mega menus. Deliberately uses plain
 * buttons + a labelled region rather than ARIA menu/menuitem roles — mega menus
 * with heterogeneous link groups are widely documented as working better for
 * screen-reader and keyboard users as a disclosure pattern (normal Tab order
 * through real links) than as a strict ARIA menu widget (which mandates arrow-key
 * navigation). Closes on Escape (returning focus to the trigger), on click
 * outside, and on route change.
 */
export function NavMenu({ label, children, panelClassName }: NavMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const pathname = usePathname();

  // Close on route change without an effect: adjusting state during render (the
  // pattern React itself recommends over useEffect+setState for "reset on prop
  // change") avoids the extra cascading render an effect-based reset causes.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cx(
          "flex items-center gap-1.5 rounded-(--radius-control) px-3 py-2 text-sm font-medium text-(--color-text-primary) transition-colors hover:bg-(--color-bg-subtle) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus)",
          open && "bg-(--color-bg-subtle)",
        )}
      >
        {label}
        <svg
          viewBox="0 0 12 12"
          width="10"
          height="10"
          className={cx("transition-transform duration-(--duration-fast)", open && "rotate-180")}
          aria-hidden="true"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div
          id={panelId}
          ref={panelRef}
          role="region"
          aria-label={label}
          className={cx(
            // Centered under the trigger (not left-anchored) so wide panels like
            // the Modules mega menu don't overflow the viewport when their
            // trigger isn't near the left edge of the header.
            "absolute left-1/2 top-full z-40 mt-2 -translate-x-1/2 rounded-(--radius-panel) border border-(--color-border-default) bg-(--color-bg-elevated) p-5 shadow-(--shadow-panel)",
            panelClassName,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
