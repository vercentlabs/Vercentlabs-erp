"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import AppIcon from "@/shared/components/app-icon";
import { PageHeader, StatusBadge } from "@/shared/design";
import { CRM_FEATURE_SURFACES, type CrmSurfaceGroup } from "./crm-surface-registry";

const GROUP_ORDER: readonly CrmSurfaceGroup[] = ["Customers", "Pipeline", "Work", "Engagement", "Insights", "Data", "Setup"];

export default function CrmFeatureDirectory({ accessibleFeatureIds }: { accessibleFeatureIds: readonly string[] }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const accessible = useMemo(() => new Set(accessibleFeatureIds), [accessibleFeatureIds]);
  const visible = useMemo(
    () =>
      CRM_FEATURE_SURFACES.filter((feature) =>
        !normalized ||
        [feature.id, feature.label, feature.group, feature.description, feature.discoverability]
          .join(" ")
          .toLowerCase()
          .includes(normalized),
      ),
    [normalized],
  );

  return (
    <div className="crm-feature-directory">
      <PageHeader
        eyebrow="CRM · Discoverability"
        title="All CRM features"
        description="Every customer-facing CRM capability has a deliberate place in the product. Search by feature, task or destination, then open the correct workspace directly."
        context={<StatusBadge tone="neutral">{CRM_FEATURE_SURFACES.length}/30 mapped</StatusBadge>}
      />

      <label className="crm-feature-directory__search">
        <span className="sr-only">Search CRM features</span>
        <AppIcon name="search" size={18} />
        <input
          type="search"
          value={query}
          placeholder="Search leads, qualification, import, reports…"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear feature search">×</button> : null}
      </label>

      {visible.length ? (
        <div className="crm-feature-directory__groups">
          {GROUP_ORDER.map((group) => {
            const features = visible.filter((feature) => feature.group === group);
            if (!features.length) return null;
            return (
              <section className="crm-feature-directory__group" key={group} aria-labelledby={`crm-feature-group-${group}`}>
                <header>
                  <h2 id={`crm-feature-group-${group}`}>{group}</h2>
                  <span>{features.length} feature{features.length === 1 ? "" : "s"}</span>
                </header>
                <div className="crm-feature-directory__grid">
                  {features.map((feature) => {
                    const canOpen = accessible.has(feature.id);
                    const content = (
                      <>
                        <span className="crm-feature-card__icon" aria-hidden="true"><AppIcon name={feature.icon} size={19} /></span>
                        <span className="crm-feature-card__copy">
                          <small>{feature.group} · {feature.placement}</small>
                          <strong>{feature.label}</strong>
                          <span>{feature.description}</span>
                          <em>{canOpen ? feature.discoverability : "Visible for discovery · access requires additional permission"}</em>
                        </span>
                        <AppIcon name={canOpen ? "arrow-right" : "roles"} size={16} />
                      </>
                    );
                    return canOpen ? (
                      <Link className="crm-feature-card" href={feature.href} key={feature.id}>{content}</Link>
                    ) : (
                      <div className="crm-feature-card crm-feature-card--restricted" key={feature.id} aria-disabled="true">{content}</div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="crm-feature-directory__empty" role="status">
          <AppIcon name="search" size={22} />
          <strong>No CRM feature matches “{query}”</strong>
          <span>Try the user task, object name, or setup concept.</span>
        </div>
      )}
    </div>
  );
}
