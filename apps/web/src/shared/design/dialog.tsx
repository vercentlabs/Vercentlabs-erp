"use client";

import { ReactNode, useEffect, useId, useRef } from "react";

import { cx } from "./cx";
import styles from "./dialog.module.css";

export type DialogVariant = "centered" | "drawer-end";

/**
 * Canonical accessible overlay primitive (Experience Kernel). Generalizes
 * the focus-trap/Escape/background-inert/scroll-lock/focus-restoration
 * behavior already proven in
 * apps/web/src/modules/crm/components/lead-workspace-drawer.tsx into a
 * shared component other CRM (and future non-CRM) dialogs/drawers can
 * adopt instead of each maintaining their own partial implementation —
 * see docs/03-modules/crm/CRM_VNEXT_IMPLEMENTATION_REGISTER.md
 * CRM-VNEXT-021.
 *
 * `variant="centered"` renders a centered modal dialog (confirmations,
 * compact editors); `variant="drawer-end"` renders a full-height panel
 * anchored to the inline-end edge (record create/edit workflows).
 */
export function Dialog({
  title,
  description,
  children,
  onClose,
  variant = "centered",
  canDismiss = true,
  className,
  busy = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  variant?: DialogVariant;
  canDismiss?: boolean;
  className?: string;
  busy?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
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
    const layer = dialogRef.current?.closest(`.${styles.layer}`);
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
    headingRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      // A nested Dialog owns Escape/Tab while it is open — don't let this
      // outer instance also react and produce a double-dismiss.
      if (dialogRef.current?.querySelector(`.${styles.dialog}`)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (canDismissRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
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
        (active === first || active === dialogRef.current || active === headingRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
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
    <div className={styles.layer} role="presentation">
      <button
        className={styles.backdrop}
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        aria-disabled={!canDismiss}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          if (canDismiss) onClose();
          else if (!dialogRef.current?.contains(document.activeElement)) headingRef.current?.focus();
        }}
      />
      <div
        ref={dialogRef}
        className={cx(styles.dialog, styles[`variant_${variant}`], className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy || !canDismiss || undefined}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <div>
            <h2 ref={headingRef} id={titleId} tabIndex={-1}>
              {title}
            </h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label={typeof title === "string" ? `Close ${title}` : "Close dialog"}
            disabled={!canDismiss}
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}

/** Canonical destructive/confirmation dialog built on Dialog. */
export function ConfirmDialog({
  title,
  description,
  children,
  onClose,
  onConfirm,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
}) {
  return (
    <Dialog title={title} description={description} onClose={onClose} variant="centered" canDismiss={!busy} busy={busy}>
      {children}
      <div className={styles.confirmActions}>
        <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={tone === "danger" ? "danger-button" : "primary-button"}
          onClick={onConfirm}
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
