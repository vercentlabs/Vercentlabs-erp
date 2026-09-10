"use client";

import { KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import { requestJson } from "@/shared/http/client-request";

export type LeadAssigneeOption = {
  id: string;
  name: string;
  email: string;
};

export default function LeadAssigneeCombobox({
  name,
  purpose = "assignment",
  value = null,
  onChange,
  allowUnassigned = false,
  disabled = false,
}: {
  name?: string;
  purpose?: "assignment" | "rule";
  value?: LeadAssigneeOption | null;
  onChange?: (value: LeadAssigneeOption | null) => void;
  allowUnassigned?: boolean;
  disabled?: boolean;
}) {
  const listId = useId();
  const [query, setQuery] = useState(value?.name || "");
  const [selected, setSelected] = useState<LeadAssigneeOption | null>(value);
  const [items, setItems] = useState<LeadAssigneeOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const requestSequence = useRef(0);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          purpose,
          search: query.trim(),
          limit: "20",
        });
        const result = await requestJson<{
          ok?: boolean;
          items?: LeadAssigneeOption[];
        }>(`/api/crm/leads/assignees?${params}`, {
          signal: controller.signal,
        });
        if (sequence === requestSequence.current)
          setItems(result.ok ? result.items || [] : []);
      } catch {
        if (!controller.signal.aborted && sequence === requestSequence.current)
          setItems([]);
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [purpose, query]);

  function choose(next: LeadAssigneeOption | null) {
    setSelected(next);
    setQuery(next?.name || "");
    setOpen(false);
    setActiveIndex(-1);
    onChange?.(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        const total = items.length + (allowUnassigned ? 1 : 0);
        if (!total) return -1;
        return (current + direction + total) % total;
      });
      return;
    }
    if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      choose(
        allowUnassigned && activeIndex === 0
          ? null
          : items[activeIndex - (allowUnassigned ? 1 : 0)] || null,
      );
    }
  }

  return (
    <div className="crm-assignee-combobox">
      {name ? (
        <input type="hidden" name={name} value={selected?.id || ""} />
      ) : null}
      <input
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-activedescendant={
          activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
        }
        autoComplete="off"
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setSelected(null);
          onChange?.(null);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search by name or email"
        role="combobox"
        value={query}
      />
      {open ? (
        <div className="crm-assignee-combobox__list" id={listId} role="listbox">
          {allowUnassigned ? (
            <button
              aria-selected={!selected}
              className={activeIndex === 0 ? "is-active" : ""}
              id={`${listId}-0`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(null)}
              role="option"
              type="button"
            >
              <strong>Unassigned</strong>
              <span>Keep this Lead in the unassigned queue</span>
            </button>
          ) : null}
          {items.map((item, index) => {
            const optionIndex = index + (allowUnassigned ? 1 : 0);
            return (
              <button
                aria-selected={selected?.id === item.id}
                className={activeIndex === optionIndex ? "is-active" : ""}
                id={`${listId}-${optionIndex}`}
                key={item.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(item)}
                role="option"
                type="button"
              >
                <strong>{item.name}</strong>
                <span>{item.email}</span>
              </button>
            );
          })}
          {loading ? <p role="status">Searching team members…</p> : null}
          {!loading && !items.length && !allowUnassigned ? (
            <p>No eligible CRM members found.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
