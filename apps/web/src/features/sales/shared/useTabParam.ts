"use client";

// The open tab of a record page lives in the address (?tab=items): Refresh and Back keep it, and a link can open a record on its
// Payments or History tab (Line-by-line audit, navigation).
import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useTabParam(defaultTab = "overview"): [string, (tab: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get("tab") || defaultTab;
  const setTab = useCallback((next: string) => {
    const search = new URLSearchParams(params.toString());
    if (next === defaultTab) search.delete("tab"); else search.set("tab", next);
    const query = search.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [defaultTab, params, pathname, router]);
  return [tab, setTab];
}
