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
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-(--color-border-default) pb-6 print:hidden">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by module">
          <button
            type="button"
            onClick={() => handleFilterChange("all")}
            aria-pressed={activeFilter === "all"}
            className={cx(
              "rounded-(--radius-control) border px-3 py-1.5 text-xs font-medium transition-colors",
              activeFilter === "all" ? "border-(--color-text-brand) bg-(--color-bg-brand) text-(--color-text-inverse)" : "border-(--color-border-default) text-(--color-text-secondary) hover:border-(--color-text-brand)",
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
                "rounded-(--radius-control) border px-3 py-1.5 text-xs font-medium transition-colors",
                activeFilter === filter.key ? "border-(--color-text-brand) bg-(--color-bg-brand) text-(--color-text-inverse)" : "border-(--color-border-default) text-(--color-text-secondary) hover:border-(--color-text-brand)",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <Text variant="caption">{hydrated ? `${checkedCount} of ${groups.length} groups reviewed` : null}</Text>
          <button type="button" onClick={handlePrint} className="text-xs font-medium text-(--color-text-brand) hover:underline underline-offset-4">
            Print this checklist
          </button>
        </div>
      </div>

      <ul className="mt-6 flex flex-col divide-y divide-(--color-border-default)">
        {visibleGroups.map((group) => (
          <li key={group.id} className="flex items-start gap-3 py-4">
            <input
              type="checkbox"
              checked={Boolean(checked[group.id])}
              onChange={(event) => setChecked((prev) => ({ ...prev, [group.id]: event.target.checked }))}
              aria-label={`Mark ${group.name} as evaluated`}
              className="mt-1 h-4 w-4 flex-none accent-(--color-text-brand)"
            />
            <div>
              <Heading level="h4" as="h3">
                {group.name}
                <span className="ml-2 text-xs font-normal text-(--color-text-muted)">
                  {group.requirementCount} requirement{group.requirementCount === 1 ? "" : "s"} · {group.filterLabel}
                </span>
              </Heading>
              <Text variant="bodySmall" className="mt-1">
                {group.description}
              </Text>
              <Link href={group.publicPage} prefetch={false} className="mt-1.5 inline-block text-xs font-medium text-(--color-text-brand) hover:underline underline-offset-4 print:hidden">
                See how Vercentlabs implements this →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
