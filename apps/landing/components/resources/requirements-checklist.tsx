

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cx } from "@/lib/utils";
import { Heading, Text } from "@/components/ui/text";
import { track } from "@/lib/analytics";

export interface ChecklistGroup {
  id: string;
  name: string;
  description: string;
  requirementCount: number;
  publicPage: string;
  filterKey: string;
  filterLabel: string;
}

const STORAGE_KEY = "vercentlabs-requirements-checklist-progress-v1";

/**
 * Server-rendered on first paint (every group's full text is in the initial
 * HTML regardless of filter/JS state — the filterKey === "all" default
 * means nothing is hidden before hydration). Filtering and checkbox
 * progress are a progressive-enhancement layer only: progress is
 * localStorage-only, never sent to analytics or a server (this can reveal
 * a buyer's real evaluation criteria, which is exactly the kind of
 * confidential signal .claude/rules/landing-content.md's evidence rules
 * and docs/landing-redesign/phase-6/requirements-checklist-spec.md treat
 * as private by default). Only the *filter selection itself* (which
 * module a visitor is looking at) is tracked — never which boxes are
 * checked.
 */
export function RequirementsChecklist({ groups, filters }: { groups: ChecklistGroup[]; filters: { key: string; label: string }[] }) {
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Reading localStorage can't happen during render (unavailable on the server,
    // and reading it during the client render would mismatch the SSR-rendered
    // empty state) — this is a legitimate external-system sync on mount, not
    // state that could be computed during render. See track-view.tsx for the
    // same documented exception pattern.
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setChecked(JSON.parse(raw));
    } catch {
      // localStorage can be unavailable (private browsing, disabled storage) — checklist still works, just doesn't persist.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(checked));
    } catch {
      // Same as above — persistence is best-effort.
    }
  }, [checked, hydrated]);

  const visibleGroups = useMemo(() => (activeFilter === "all" ? groups : groups.filter((g) => g.filterKey === activeFilter)), [groups, activeFilter]);

  const checkedCount = Object.values(checked).filter(Boolean).length;

  function handleFilterChange(key: string) {
    setActiveFilter(key);
    track("requirements_filter", { section: key });
  }

  function handlePrint() {
    track("requirements_print");
    window.print();
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-5 border-b border-(--color-border-strong) pb-6 print:hidden lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="grid grid-cols-2 border-l border-t border-(--color-border-default) sm:grid-cols-3 lg:flex lg:flex-wrap lg:border-0" role="group" aria-label="Filter by module">
          <button
            type="button"
            onClick={() => handleFilterChange("all")}
            aria-pressed={activeFilter === "all"}
            className={cx(
              "min-h-9 border-b border-r border-(--color-border-default) px-3 py-2 text-[0.68rem] font-bold uppercase tracking-[0.06em] transition-colors lg:rounded-[3px] lg:border",
              activeFilter === "all" ? "border-(--color-text-brand) bg-(--color-bg-brand) text-white" : "border-(--color-border-default) text-(--color-text-secondary) hover:border-(--color-text-brand)",
            )}
          >
            All ({groups.length})
          </button>
          {filters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => handleFilterChange(filter.key)}
              aria-pressed={activeFilter === filter.key}
              className={cx(
                "min-h-9 border-b border-r border-(--color-border-default) px-3 py-2 text-[0.68rem] font-bold uppercase tracking-[0.06em] transition-colors lg:rounded-[3px] lg:border",
                activeFilter === filter.key ? "border-(--color-text-brand) bg-(--color-bg-brand) text-white" : "border-(--color-border-default) text-(--color-text-secondary) hover:border-(--color-text-brand)",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <Text variant="caption">{hydrated ? `${checkedCount} of ${groups.length} groups reviewed` : null}</Text>
          <button type="button" onClick={handlePrint} className="vl-editorial-link text-xs font-bold text-(--color-text-brand)">
            Print this checklist
          </button>
        </div>
      </div>

      <ul className="mt-6 border-x border-t border-(--color-border-strong) bg-(--color-bg-elevated)">
        {visibleGroups.map((group) => (
          <li key={group.id} className="grid grid-cols-[2.5rem_1fr] gap-4 border-b border-(--color-border-default) px-4 py-5 sm:grid-cols-[2.5rem_1fr_150px] sm:px-5">
            <input
              type="checkbox"
              checked={Boolean(checked[group.id])}
              onChange={(event) => setChecked((prev) => ({ ...prev, [group.id]: event.target.checked }))}
              aria-label={`Mark ${group.name} as evaluated`}
              className="mt-1 h-4 w-4 flex-none rounded-[2px] accent-(--color-text-brand)"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Heading level="h4" as="h3">{group.name}</Heading>
                <span className="vl-index sm:hidden">{group.requirementCount} REQ</span>
              </div>
              <Text variant="bodySmall" className="mt-1">
                {group.description}
              </Text>
              <Link href={group.publicPage} prefetch={false} className="vl-editorial-link mt-2 inline-block text-xs font-bold text-(--color-text-brand) print:hidden">
                See how Vercentlabs implements this →
              </Link>
            </div>
            <div className="hidden border-l border-(--color-border-default) pl-5 sm:block">
              <span className="vl-index">{group.requirementCount} REQ</span>
              <p className="mt-2 text-xs font-semibold text-(--color-text-secondary)">{group.filterLabel}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
