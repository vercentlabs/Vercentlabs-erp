"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { PageHeader, SearchField } from "@vercentlabs/design-system";

import { listAccounts } from "@/features/crm/accounts/api/accounts-api";
import { listContacts } from "@/features/crm/contacts/api/contacts-api";
import { listLeads } from "@/features/crm/leads/api/leads-api";
import { listOpportunities } from "@/features/crm/opportunities/api/opportunities-api";
import { listCustomers, listItems } from "@/features/sales/master/api/master-api";
import { MODULE_NAVIGATION } from "@/shell/navigation/module-navigation-registry";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

const MIN_LENGTH = 2;
const PER_SOURCE = 6;

type Hit = { id: string; title: string; detail?: string; href: string };
type Source = {
  key: string;
  label: string;
  moduleKey: string;
  run: (term: string) => Promise<Hit[]>;
};

// Each source asks the module's own list endpoint, which applies the caller's permissions and scope on the server, so a
// result can only ever be something the person is allowed to open. A source that fails is reported on its own line and
// never hides the others.
const SOURCES: Source[] = [
  {
    key: "leads",
    label: "Leads",
    moduleKey: "crm",
    run: async (term) =>
      (await listLeads({ search: term, limit: PER_SOURCE } as never)).rows.map((row) => ({
        id: row.id,
        title: row.fullName || `${row.firstName} ${row.lastName ?? ""}`.trim(),
        detail: row.companyName ?? undefined,
        href: `/crm/leads/${row.id}`,
      })),
  },
  {
    key: "accounts",
    label: "Accounts",
    moduleKey: "crm",
    run: async (term) =>
      (await listAccounts({ search: term, limit: PER_SOURCE, status: "active" })).rows.map((row) => ({
        id: row.id,
        title: row.displayName,
        href: `/crm/accounts/${row.id}`,
      })),
  },
  {
    key: "contacts",
    label: "Contacts",
    moduleKey: "crm",
    run: async (term) =>
      (await listContacts({ search: term, limit: PER_SOURCE, status: "active" })).rows.map((row) => ({
        id: row.id,
        title: `${row.firstName} ${row.lastName ?? ""}`.trim(),
        detail: row.email ?? undefined,
        href: `/crm/contacts/${row.id}`,
      })),
  },
  {
    key: "opportunities",
    label: "Opportunities",
    moduleKey: "crm",
    run: async (term) =>
      (await listOpportunities({ search: term, limit: PER_SOURCE } as never)).rows.map((row) => ({
        id: row.id,
        title: row.name,
        detail: row.code,
        href: `/crm/opportunities/${row.id}`,
      })),
  },
  {
    key: "customers",
    label: "Customers",
    moduleKey: "sales",
    run: async (term) =>
      (await listCustomers({ search: term, status: "active" })).rows.slice(0, PER_SOURCE).map((row) => ({
        id: row.id,
        title: row.displayName,
        detail: row.code,
        href: `/sales/customers/${row.id}`,
      })),
  },
  {
    key: "products",
    label: "Products and services",
    moduleKey: "sales",
    run: async (term) =>
      (await listItems({ search: term, status: "active" })).rows.slice(0, PER_SOURCE).map((row) => ({
        id: row.id,
        title: row.name,
        detail: row.code,
        href: `/sales/products`,
      })),
  },
];

function SourceResults({ source, hits, loading, failed, onRetry }: { source: Source; hits: Hit[]; loading: boolean; failed: boolean; onRetry: () => void }) {
  if (loading) return <p className="text-sm text-text-muted">{"Searching " + source.label.toLowerCase() + "…"}</p>;
  if (failed) {
    return (
      <p role="alert" className="text-sm text-danger">
        {source.label + " could not be searched. "}
        <button type="button" className="underline" onClick={onRetry}>Try again</button>
      </p>
    );
  }
  if (hits.length === 0) return null;
  return (
    <section aria-label={source.label} className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-text">{source.label}</h2>
      <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {hits.map((hit) => (
          <li key={hit.id}>
            <Link href={hit.href} className="flex flex-col gap-0.5 px-4 py-3 hover:bg-surface-muted">
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
  const sources = useMemo(() => SOURCES.filter((source) => workspace.accessibleModuleKeys.includes(source.moduleKey)), [workspace.accessibleModuleKeys]);

  const answers = useQueries({
    queries: sources.map((source) => ({
      queryKey: scopedQueryKey(workspace, "global-search", source.key, term),
      queryFn: () => source.run(term),
      enabled,
      retry: false,
      staleTime: 30_000,
    })),
  });
  const stillLoading = enabled && answers.some((answer) => answer.isLoading);
  const anyFailed = answers.some((answer) => answer.isError);
  const anyHits = answers.some((answer) => (answer.data?.length ?? 0) > 0);

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
      <SearchField aria-label="Search records and pages" placeholder="Search leads, accounts, customers, products or a page" value={text} onChange={setText} autoFocus className="max-w-xl" />
      {!enabled ? (
        <p className="text-sm text-text-secondary">{`Type at least ${MIN_LENGTH} letters. Searches ${sources.length > 0 ? "CRM and Sales records" : "the pages"} you have access to.`}</p>
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
          {sources.map((source, index) => (
            <SourceResults key={source.key} source={source} hits={answers[index]?.data ?? []} loading={Boolean(answers[index]?.isLoading)} failed={Boolean(answers[index]?.isError)} onRetry={() => void answers[index]?.refetch()} />
          ))}
          {!stillLoading && !anyFailed && !anyHits && pages.length === 0 && (
            <p className="text-sm text-text-secondary">{"Nothing matches \"" + term + "\". Try a different spelling, or part of a name, code or email."}</p>
          )}
        </div>
      )}
    </div>
  );
}

