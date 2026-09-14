import { useEffect } from "react";

/**
 * Warns before a browser tab close/reload when there are unsaved changes.
 * Does not cover in-app route navigation (Cancel/Close/Back) — those are
 * framework-specific (e.g. Next.js router events) and belong in the
 * feature screen that owns the router, not in this framework-agnostic
 * package. Per the HCI standard: never show this warning after a
 * successful save, so callers must flip `isDirty` off (or unmount this
 * hook) once the save completes — don't leave it wired to raw form dirty
 * state that lingers post-submit.
 */
export function useUnsavedChangesWarning(isDirty: boolean, message = "You have unsaved changes. Leave anyway?") {
  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = message;
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, message]);
}
