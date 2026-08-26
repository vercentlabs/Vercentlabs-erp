"use client";

import { KeyboardEvent, useEffect, useId, useRef, useState } from "react";

type AccountOption = {
  id: string;
  displayName: string;
  code?: string;
  status?: string;
};

export default function ContactAccountLookup({
  initialId = "",
  initialName = "",
  initialStatus = "active",
  label = "Account",
  describedBy,
  invalid = false,
  onSelectionChange,
}: {
  initialId?: string;
  initialName?: string;
  initialStatus?: string;
  label?: string;
  describedBy?: string;
  invalid?: boolean;
  onSelectionChange?: () => void;
}) {
  const listId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedId, setSelectedId] = useState(initialId);
  const [selectedName, setSelectedName] = useState(initialName);
  const [query, setQuery] = useState(initialName);
  const [results, setResults] = useState<AccountOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const search = query.trim();
    if (selectedId && search === selectedName) {
      return;
    }
    if (search.length < 2) {
      return;
    }
    const controller = new AbortController();
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/crm/accounts?search=${encodeURIComponent(search)}&status=active&limit=8`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as {
          ok?: boolean;
          rows?: AccountOption[];
        };
        const rows = payload.ok && Array.isArray(payload.rows) ? payload.rows : [];
        setResults(rows);
        setOpen(true);
        setActiveIndex(rows.length ? 0 : -1);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, selectedId, selectedName]);

  function select(account: AccountOption) {
    setSelectedId(account.id);
    setSelectedName(account.displayName);
    setQuery(account.displayName);
    setResults([]);
    setOpen(false);
    onSelectionChange?.();
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || !results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      select(results[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="crm-contact-account-lookup">
      <label htmlFor={`${listId}-input`}>{label}</label>
      <input
        name="accountId"
        type="hidden"
        value={selectedId}
        suppressHydrationWarning
      />
      <div className="crm-contact-account-input">
        <input
          id={`${listId}-input`}
          type="search"
          suppressHydrationWarning
          role="combobox"
          value={query}
          placeholder="Search active accounts"
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-activedescendant={
            open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
          }
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            if (next.trim().length < 2) {
              setResults([]);
              setOpen(false);
            }
            if (selectedId) {
              setSelectedId("");
              setSelectedName("");
            }
          }}
          onKeyDown={keyDown}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        />
        {(selectedId || query) && (
          <button
            type="button"
            aria-label="Clear account"
            onClick={() => {
              setSelectedId("");
              setSelectedName("");
              setQuery("");
              setResults([]);
              onSelectionChange?.();
            }}
          >
            Clear
          </button>
        )}
      </div>
      {initialStatus === "inactive" && selectedId === initialId ? (
        <small>This historical account is archived. Clear it to unlink.</small>
      ) : (
        <small>Optional. Type at least two characters to search.</small>
      )}
      {open ? (
        <div className="crm-contact-account-results" id={listId} role="listbox">
          {loading ? <p role="status">Searching accounts…</p> : null}
          {!loading && !results.length ? <p>No active accounts found.</p> : null}
          {results.map((account, index) => (
            <button
              id={`${listId}-${index}`}
              key={account.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(account)}
            >
              <strong>{account.displayName}</strong>
              <span>{account.code || "Account"}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
