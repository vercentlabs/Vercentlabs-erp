"use client";

// Create and edit forms open in a modal over the page they were opened from (the list, or the record for an edit), never as a page of
// their own. The form itself is unchanged: it still "navigates" when it is done (to the record it saved, or back when cancelled) —
// useFormRouter turns that into closing the modal, refreshing the page underneath, and (after a save) a short "Saved · Open" notice.
// A form that moves to another form (for example a quotation re-opened for another customer) stays in the modal. Escape or the X closes
// it; a click outside doesn't, so a half-filled form isn't lost by accident.
import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { X } from "lucide-react";

export const FORM_SAVED_EVENT = "vercentlabs:form-saved";
type Host = { leave: (href: string | null) => void };
const FormHostContext = createContext<Host | null>(null);
const isFormUrl = (href: string) => /\/(new|edit)(\?|$)/.test(href.split("#")[0]);

// The form's router: the real one on a full page; inside the modal, leaving the form closes the modal instead.
export function useFormRouter(): ReturnType<typeof useRouter> {
  const router = useRouter();
  const host = useContext(FormHostContext);
  return useMemo(() => (host ? {
    ...router,
    push: (href: string) => host.leave(href),
    replace: (href: string) => host.leave(href),
    back: () => host.leave(null),
  } : router), [router, host]);
}

export function FormModal({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const closing = useRef(false);
  const close = useCallback((savedHref: string | null) => {
    if (closing.current) return;
    closing.current = true;
    router.back();
    // the page underneath shows what was saved
    setTimeout(() => {
      router.refresh();
      void queryClient.invalidateQueries();
      if (savedHref) window.dispatchEvent(new CustomEvent(FORM_SAVED_EVENT, { detail: { href: savedHref } }));
    }, 60);
  }, [router, queryClient]);
  const host = useMemo<Host>(() => ({
    leave: (href) => {
      if (href && isFormUrl(href)) { router.replace(href); return; }
      const here = window.location.pathname;
      const parent = here.replace(/\/(new|edit)$/, "");
      // back to the list or the record it came from (a cancel), or on to a record (a save)
      const saved = href && href.split("?")[0] !== parent && href.split("?")[0] !== here ? href : null;
      close(saved);
    },
  }), [router, close]);
  return (
    <FormHostContext.Provider value={host}>
      <ModalOverlay isOpen isDismissable={false} onOpenChange={(open) => { if (!open) close(null); }}
        className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center overflow-y-auto bg-overlay-backdrop p-4 sm:p-8">
        <Modal className="w-full max-w-6xl">
          <Dialog aria-label={title} className="relative rounded-[var(--radius-panel)] border border-border bg-canvas p-4 shadow-overlay outline-none sm:p-6">
            <button type="button" aria-label="Close" onClick={() => close(null)}
              className="absolute top-3 right-3 z-10 rounded p-1.5 text-text-muted hover:bg-surface hover:text-text">
              <X aria-hidden className="size-4" />
            </button>
            {children}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </FormHostContext.Provider>
  );
}
