"use client";

// After a create form saves in its modal: the list stays, and a short notice offers to open what was made.
import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, X } from "lucide-react";

import { FORM_SAVED_EVENT } from "./FormModal";

export function SavedNotice() {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (event: Event) => {
      setHref((event as CustomEvent<{ href: string }>).detail.href);
      clearTimeout(timer);
      timer = setTimeout(() => setHref(null), 7000);
    };
    window.addEventListener(FORM_SAVED_EVENT, show);
    return () => { window.removeEventListener(FORM_SAVED_EVENT, show); clearTimeout(timer); };
  }, []);
  if (!href) return null;
  return (
    <div role="status" className="fixed right-4 bottom-4 z-[var(--z-modal)] flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface-raised px-4 py-3 text-sm shadow-overlay">
      <CheckCircle2 aria-hidden className="size-4 text-success" />
      <span className="text-text">Saved.</span>
      <Link className="font-medium text-brand hover:underline" href={href} onClick={() => setHref(null)}>Open</Link>
      <button type="button" aria-label="Dismiss" className="text-text-muted hover:text-text" onClick={() => setHref(null)}><X aria-hidden className="size-4" /></button>
    </div>
  );
}
