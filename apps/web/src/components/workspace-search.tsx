"use client";

import { useEffect, useRef } from "react";

import AppIcon from "@/components/app-icon";

export default function WorkspaceSearch() {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }

    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <form action="/search" className="global-search" role="search">
      <label className="sr-only" htmlFor="global-search">
        Search workspace
      </label>
      <span className="global-search-icon" aria-hidden="true">
        <AppIcon name="search" size={18} />
      </span>
      <input
        autoComplete="off"
        id="global-search"
        name="q"
        placeholder="Search records, people and transactions"
        ref={inputRef}
        type="search"
      />
      <kbd className="search-shortcut" aria-hidden="true">
        Ctrl K
      </kbd>
    </form>
  );
}
