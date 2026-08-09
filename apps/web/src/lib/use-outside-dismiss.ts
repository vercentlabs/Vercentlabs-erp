"use client";

import { useEffect, type RefObject } from "react";

// Shared dismiss behavior for the topbar's small anchored popovers
// (profile menu, notifications preview, Quick Create) — click/tap outside
// or Escape closes. Kept as one hook rather than three near-identical
// implementations (the same "avoid duplicated logic" principle Prompt 6
// applied to active-route matching).
export function useOutsideDismiss(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!active) return;
    function handlePointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
    }
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [active, ref, onDismiss]);
}
