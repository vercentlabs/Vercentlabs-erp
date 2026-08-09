import Link from "next/link";

import WorkItemList from "@/components/work-item-list";
import { requireWorkspace } from "@/lib/auth";
import { listMyExceptions } from "@/lib/my-work/exceptions";
import type { WorkItem } from "@/lib/my-work/types";

export const metadata = { title: "Exceptions" };
export const dynamic = "force-dynamic";

type CategoryKey =
  | "all"
  | "sla"
  | "quality"
  | "finance"
  | "workflow";

const CATEGORIES: Array<{ key: CategoryKey; label: string; match: (item: WorkItem) => boolean }> = [
  { key: "all", label: "All exceptions", match: () => true },
  { key: "sla", label: "SLA breaches", match: (item) => item.id.startsWith("sla-breach:") },
  { key: "quality", label: "Quality holds", match: (item) => item.id.startsWith("quality-hold:") },
  {
    key: "finance",
    label: "Finance exceptions",
    match: (item) =>
      item.id.startsWith("receivable-exception:") ||
      item.id.startsWith("payable-exception:") ||
      item.id.startsWith("reconciliation-exception:"),
  },
  {
    key: "workflow",
    label: "Workflow exceptions",
    match: (item) => item.id.startsWith("procurement-exception:"),
  },
];

function resolveCategory(value: string | undefined): CategoryKey {
  return CATEGORIES.some((category) => category.key === value)
    ? (value as CategoryKey)
    : "all";
}

export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const session = await requireWorkspace();
  const { category: rawCategory } = await searchParams;
  const category = resolveCategory(rawCategory);
  const exceptions = await listMyExceptions(session, 50);
  const activeCategory = CATEGORIES.find((entry) => entry.key === category) || CATEGORIES[0];
  const visible = exceptions.filter(activeCategory.match);

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">My work</p>
          <h1>Exceptions</h1>
          <p>
            Governance exceptions from Accounting, Procurement, Support and
            Quality — only the categories with a real, already-computed
            source. Each item still follows its own module&apos;s
            permissions.
          </p>
        </div>
      </section>

      <nav className="tab-strip" aria-label="Exception categories">
        {CATEGORIES.map((entry) => (
          <Link
            key={entry.key}
            href={entry.key === "all" ? "/exceptions" : `/exceptions?category=${entry.key}`}
            className={`tab-strip-item${category === entry.key ? " active" : ""}`}
          >
            {entry.label}
            <span className="tab-strip-count">
              {exceptions.filter(entry.match).length}
            </span>
          </Link>
        ))}
      </nav>

      <section className="panel activity-panel">
        <WorkItemList
          items={visible}
          emptyTitle="No open exceptions"
          emptyDescription="Nothing in this category requires attention right now."
          emptyIcon="security"
        />
      </section>
    </>
  );
}
