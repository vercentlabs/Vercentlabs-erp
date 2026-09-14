"use client";

import { useEffect } from "react";
import type { FormEvent, ReactNode } from "react";

import { FormActions } from "../enterprise/FormField";
import { PageHeader } from "../enterprise/PageHeader";
import { PageShell } from "../enterprise/PageShell";
import { cn } from "../utils/cn";

// Canonical Create/Edit form archetype (docs/ux/UI_REWRITE_TRACKER.md
// Phase 3/5) -- the page chrome + unsaved-change protection + server-error
// surface every module's create/edit screen needs, wrapping whatever
// FormField-based fields (from ../form/fields.tsx) the caller renders as
// `children`. Deliberately does NOT own field layout or validation --
// that's FormSection/the useAppForm field components -- only the
// surrounding contract: warn before an accidental tab close/navigation
// while dirty, show one real space for a server-rejected submit's error,
// and a consistent Cancel/Save action row.
export function RecordFormSurface({
  title,
  description,
  isDirty = false,
  isSubmitting = false,
  serverError,
  onSubmit,
  onCancel,
  cancelLabel = "Cancel",
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** True once any field differs from its initial value -- gates the native beforeunload warning and the Cancel-button discard confirmation. */
  isDirty?: boolean;
  isSubmitting?: boolean;
  /** A rejected submit's message (validation the client didn't catch, a stale-version conflict, a permission change mid-edit, ...) -- rendered once, above the fields, never silently swallowed. */
  serverError?: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel?: () => void;
  cancelLabel?: string;
  /** The form's primary action (typically `<form.AppForm><form.FormSubmitButton>Save</form.FormSubmitButton></form.AppForm>`) -- rendered after Cancel. */
  actions: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  function handleCancel() {
    if (isDirty && !window.confirm("Discard your unsaved changes?")) return;
    onCancel?.();
  }

  return (
    <PageShell className={className}>
      <PageHeader title={title} description={description} />
      {serverError ? (
        <div role="alert" className="rounded-[var(--radius-card)] border border-[var(--color-state-danger-soft)] bg-[var(--color-state-danger-soft)] px-4 py-3 text-[length:var(--text-sm)] text-[var(--color-state-danger)]">
          {serverError}
        </div>
      ) : null}
      <form onSubmit={onSubmit} className={cn("flex flex-col gap-6", isSubmitting && "pointer-events-none opacity-70")} noValidate>
        {children}
        <FormActions>
          {onCancel ? (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-[var(--radius-control)] border border-[var(--color-border-default)] px-4 py-2 text-[length:var(--text-sm)] text-[var(--color-text-primary)] hover:bg-[var(--color-canvas-strong)]"
            >
              {cancelLabel}
            </button>
          ) : null}
          {actions}
        </FormActions>
      </form>
    </PageShell>
  );
}
