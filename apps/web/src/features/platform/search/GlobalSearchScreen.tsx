"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, PageHeader, SearchField } from "@vercentlabs/design-system";

import { MODULE_NAVIGATION } from "@/shell/navigation/module-navigation-registry";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

const MIN_LENGTH = 2;

// Record search is orchestrated on the server (GET /api/search): it decides
// which module sources run for this person and each source applies its
// module's own record access. The browser only renders the groups.
type Hit = { sourceKey: string; recordId: string; title: string; detail: string | null; href: string };
type Group = { sourceKey: string; sourceLabel: string; moduleKey: string; status: "ok" | "unavailable"; results: Hit[] };

async function fetchSearchResults(term: string): Promise<Group[]> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error("Search is not available right now.");
  return payload.groups ?? [];
}

function GroupResults({ group }: { group: Group }) {
  if (group.status === "unavailable") {
    return (
      <p role="status" className="text-sm text-text-secondary">
        {group.sourceLabel + " could not be searched right now."}
      </p>
    );
  }
  if (group.results.length === 0) return null;
  return (
    <section aria-label={group.sourceLabel} className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-text">{group.sourceLabel}</h2>
      <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {group.results.map((hit) => (
          <li key={hit.recordId}>
            <Link href={hit.href} className="flex flex-col gap-0.5 px-4 py-3 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-brand">
              <span className="text-sm font-medium text-text">{hit.title}</span>
              {hit.detail && <span className="text-xs text-text-secondary">{hit.detail}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function GlobalSearchScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const urlTerm = params.get("q") ?? "";
  const [text, setText] = useState(urlTerm);
  const [term, setTerm] = useState(urlTerm.trim());

  // Typing waits a moment before searching, and the address keeps the term so a search can be shared or reloaded.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = text.trim();
      setTerm(next);
      const current = new URLSearchParams(window.location.search);
      if ((current.get("q") ?? "") !== next) router.replace(next ? `/search?q=${encodeURIComponent(next)}` : "/search");
    }, 350);
    return () => clearTimeout(timer);
  }, [text, router]);

  const enabled = term.length >= MIN_LENGTH;
  const records = useQuery({
    queryKey: scopedQueryKey(workspace, "global-search", term),
    queryFn: () => fetchSearchResults(term),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
  const groups = records.data ?? [];
  const anyHits = groups.some((group) => group.results.length > 0);
  const partial = groups.some((group) => group.status === "unavailable");

  const pages = useMemo(() => {
    if (!enabled) return [];
    const needle = term.toLowerCase();
    const found: Array<{ id: string; label: string; module: string; href: string }> = [];
    for (const area of MODULE_NAVIGATION) {
      if (!workspace.accessibleModuleKeys.includes(area.moduleKey)) continue;
      for (const section of area.sections) {
        for (const item of section.items) {
          if (item.status === "PLANNED") continue;
          if (item.requiredPermission && !workspace.permissions.includes(item.requiredPermission) && !workspace.roleSlugs.includes("organization_owner")) continue;
          if (`${item.label} ${area.label}`.toLowerCase().includes(needle)) found.push({ id: `${area.moduleKey}:${item.id}`, label: item.label, module: area.label, href: item.route });
        }
      }
    }
    return found.slice(0, 12);
  }, [enabled, term, workspace.accessibleModuleKeys, workspace.permissions, workspace.roleSlugs]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Search" description="Find records and pages you can open. Results only include what your access allows." />
      <SearchField aria-label="Search records and pages" placeholder="Search records or a page" value={text} onChange={setText} autoFocus className="max-w-xl" />
      {!enabled ? (
        <p className="text-sm text-text-secondary">{`Type at least ${MIN_LENGTH} letters to search the records and pages you have access to.`}</p>
      ) : (
        <div className="flex flex-col gap-6" aria-live="polite">
          {pages.length > 0 && (
            <section aria-label="Pages" className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-text">Pages</h2>
              <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
                {pages.map((page) => (
                  <li key={page.id}>
                    <Link href={page.href} className="flex items-baseline justify-between gap-3 px-4 py-3 hover:bg-surface-muted">
                      <span className="text-sm font-medium text-text">{page.label}</span>
                      <span className="text-xs text-text-secondary">{page.module}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {records.isLoading && <p className="text-sm text-text-muted">Searching records…</p>}
          {records.isError && (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
              Records could not be searched right now.
              <Button variant="secondary" size="compact" onPress={() => void records.refetch()}>
                Try again
              </Button>
            </p>
          )}
          {groups.map((group) => (
            <GroupResults key={group.sourceKey} group={group} />
          ))}
          {!records.isLoading && !records.isError && !anyHits && pages.length === 0 && (
            <p className="text-sm text-text-secondary">{partial ? "No results in the sources that could be searched." : `Nothing matches "${term}". Try a different spelling, or part of a name or code.`}</p>
          )}
        </div>
      )}
    </div>
  );
}

