"use client";

// ?form=/x/new on a list (or /x/[id]/edit on a record) — where an old create / edit address lands — opens that form in the modal.
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function OpenFormFromAddress() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const form = params.get("form");
  useEffect(() => {
    if (!form || !form.startsWith("/") || form.startsWith("//") || !/\/(new|edit)(\?|$)/.test(form)) return;
    const rest = new URLSearchParams(params.toString());
    rest.delete("form");
    // the list's own address first, without ?form (so closing the form comes back to it and doesn't reopen it), then the form over it
    window.history.replaceState(window.history.state, "", `${pathname}${rest.size ? `?${rest}` : ""}`);
    router.push(form);
  }, [form, params, pathname, router]);
  return null;
}
