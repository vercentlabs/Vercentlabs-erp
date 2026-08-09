"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import AppIcon, { type AppIconName } from "@/components/app-icon";

export type MasterDataCatalogueEntry = {
  key: string;
  title: string;
  description: string;
  href: string;
  group: string;
  icon: AppIconName;
  canManage: boolean;
};

export type MasterDataCatalogueGroup = {
  name: string;
  title: string;
  description: string;
  overviewLabel: string;
  overviewCount: number;
};

// Client-side catalogue search over the resource CARDS themselves (Part
// 25) — not record search, not a per-keystroke server query. Filters the
// already permission-filtered `entries` array the server passed down; it
// never widens what's visible, only narrows a list the server already
// decided the caller may see.
export default function MasterDataCatalogue({
  entries,
  groups,
}: {
  entries: MasterDataCatalogueEntry[];
  groups: MasterDataCatalogueGroup[];
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return entries;
    return entries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(trimmed) ||
        entry.description.toLowerCase().includes(trimmed) ||
        entry.group.toLowerCase().includes(trimmed),
    );
  }, [entries, query]);

  const isSearching = query.trim().length > 0;

  return (
    <>
      <div className="master-data-search">
        <AppIcon name="search" size={17} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search master data (e.g. warehouses, tax rates, price lists)"
          aria-label="Search master data resources"
        />
      </div>

      {isSearching ? (
        <section className="dashboard-section" aria-label="Search results">
          <div className="master-data-grid">
            {filtered.map((entry) => (
              <Link href={entry.href} key={entry.key} className="master-data-card">
                <span className="master-data-card-icon" aria-hidden="true">
                  <AppIcon name={entry.icon} size={21} />
                </span>
                <div>
                  <strong>{entry.title}</strong>
                  <span>{entry.description}</span>
                  <small className="master-data-card-access">
                    {entry.canManage ? "Manage access" : "View only"}
                  </small>
                </div>
                <AppIcon name="arrow-right" size={17} />
              </Link>
            ))}
          </div>
          {!filtered.length ? (
            <div className="empty-state compact">
              <span className="empty-state-icon" aria-hidden="true">
                <AppIcon name="search" size={20} />
              </span>
              <div>
                <strong>No matching master data</strong>
                <p>Try a different resource name.</p>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        groups.map((group) => (
          <section
            className="dashboard-section"
            key={group.name}
            aria-labelledby={`master-data-${group.name.toLowerCase()}`}
          >
            <div className="section-title-row">
              <div>
                <p className="eyebrow">{group.name}</p>
                <h2 id={`master-data-${group.name.toLowerCase()}`}>
                  {group.title}
                </h2>
                <p>{group.description}</p>
              </div>
              <span className="status-badge neutral">
                {group.overviewCount} {group.overviewLabel}
              </span>
            </div>
            <div className="master-data-grid">
              {entries
                .filter((entry) => entry.group === group.name)
                .map((entry) => (
                  <Link
                    href={entry.href}
                    key={entry.key}
                    className="master-data-card"
                  >
                    <span className="master-data-card-icon" aria-hidden="true">
                      <AppIcon name={entry.icon} size={21} />
                    </span>
                    <div>
                      <strong>{entry.title}</strong>
                      <span>{entry.description}</span>
                    </div>
                    <AppIcon name="arrow-right" size={17} />
                  </Link>
                ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
