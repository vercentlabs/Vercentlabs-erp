"use client";

import { ReactNode, useEffect, useId, useRef } from "react";

export default function LeadWorkspaceDrawer({
  title,
  description,
  children,
  onClose,
  width = "wide",
  canDismiss = true,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  width?: "form" | "wide";
  canDismiss?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  const canDismissRef = useRef(canDismiss);

  useEffect(() => {
    onCloseRef.current = onClose;
    canDismissRef.current = canDismiss;
  }, [canDismiss, onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const layer = drawerRef.current?.closest(".crm-lead-drawer-layer");
    const backgroundSiblings = layer?.parentElement
      ? [...layer.parentElement.children].filter((element) => element !== layer)
      : [];
    const backgroundState = backgroundSiblings.map((element) => ({
      element: element as HTMLElement,
      inert: (element as HTMLElement).inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    for (const { element } of backgroundState) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    document.body.style.overflow = "hidden";
    // Announce record context before exposing any action or contact link.
    // The heading remains inside the focus trap and Shift+Tab reaches Close.
    headingRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      // A nested native dialog owns Escape and Tab while it is open. Closing
      // the parent drawer here would discard dialog focus restoration and
      // make one Escape key perform two dismissals.
      if (drawerRef.current?.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (canDismissRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const controls = [
        ...drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter(
        (control) =>
          control.getClientRects().length > 0 &&
          control.getAttribute("aria-hidden") !== "true" &&
          !control.closest("[inert]"),
      );
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = document.activeElement;
      if (
        event.shiftKey &&
        (active === first ||
          active === drawerRef.current ||
          active === headingRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !drawerRef.current.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      for (const { element, inert, ariaHidden } of backgroundState) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className="crm-lead-drawer-layer" role="presentation">
      <button
        className="crm-lead-drawer-backdrop"
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        aria-disabled={!canDismiss}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          if (canDismiss) {
            onClose();
            window.requestAnimationFrame(() => {
              if (drawerRef.current) {
                headingRef.current?.focus();
              }
            });
          } else {
            const active = document.activeElement;
            if (!drawerRef.current?.contains(active)) {
              headingRef.current?.focus();
            }
          }
        }}
      />
      <div
        ref={drawerRef}
        className={`crm-lead-drawer crm-lead-drawer--${width}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={!canDismiss}
        tabIndex={-1}
      >
        <header className="crm-lead-drawer-header">
          <div>
            <h2 ref={headingRef} id={titleId} tabIndex={-1}>
              {title}
            </h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={`Close ${title}`}
            disabled={!canDismiss}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="crm-lead-drawer-body">{children}</div>
      </div>
    </div>
  );
}
