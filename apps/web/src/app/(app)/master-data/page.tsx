import Link from "next/link";
import { notFound } from "next/navigation";

import { getBusinessDataOverview } from "@vercent/api";

import AppIcon from "@/components/app-icon";
import { requireWorkspace } from "@/lib/auth";
import {
  businessDataContext,
  businessDataDefinitions,
  businessDataGroups,
} from "@/lib/business-data";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";

export const metadata = { title: "Master data" };
export const dynamic = "force-dynamic";

const overviewKeys = {
  Partners: "parties",
  Products: "items",
  Inventory: "warehouses",
  Finance: "currencies",
} as const;

export default async function MasterDataPage() {
  const session = await requireWorkspace();

  if (!hasPermission(session, PERMISSIONS.businessDataView)) {
    notFound();
  }

  const context = businessDataContext(session);
  const overview = await tenantTransaction(context.organizationId, (client) =>
    getBusinessDataOverview(client, context),
  );

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Business Data Foundation</p>
          <h1>Govern the records every ERP module shares</h1>
          <p>
            Maintain trusted partners, products, inventory locations and finance
            defaults before transactional modules begin creating documents.
          </p>
        </div>
        <span className="status-badge success">Tenant isolation active</span>
      </section>

      <section
        className="business-data-overview"
        aria-label="Master data summary"
      >
        <article className="business-data-overview-card">
          <span aria-hidden="true">
            <AppIcon name="companies" size={21} />
          </span>
          <div>
            <small>Business partners</small>
            <strong>{Number(overview.parties || 0)}</strong>
          </div>
        </article>
        <article className="business-data-overview-card">
          <span aria-hidden="true">
            <AppIcon name="stock" size={21} />
          </span>
          <div>
            <small>Items and services</small>
            <strong>{Number(overview.items || 0)}</strong>
          </div>
        </article>
        <article className="business-data-overview-card">
          <span aria-hidden="true">
            <AppIcon name="branches" size={21} />
          </span>
          <div>
            <small>Warehouses</small>
            <strong>{Number(overview.warehouses || 0)}</strong>
          </div>
        </article>
        <article className="business-data-overview-card">
          <span aria-hidden="true">
            <AppIcon name="accounting" size={21} />
          </span>
          <div>
            <small>Enabled currencies</small>
            <strong>{Number(overview.currencies || 0)}</strong>
          </div>
        </article>
      </section>

      {businessDataGroups.map((group) => {
        const resources = Object.values(businessDataDefinitions).filter(
          (definition) => definition.group === group.name,
        );
        const overviewKey = overviewKeys[group.name];

        return (
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
                {Number(overview[overviewKey] || 0)} primary records
              </span>
            </div>

            <div className="master-data-grid">
              {resources.map((definition) => (
                <Link
                  href={`/master-data/${definition.key}`}
                  key={definition.key}
                  className="master-data-card"
                >
                  <span className="master-data-card-icon" aria-hidden="true">
                    <AppIcon
                      name={
                        definition.group === "Partners"
                          ? "companies"
                          : definition.group === "Products"
                            ? "stock"
                            : definition.group === "Inventory"
                              ? "branches"
                              : "accounting"
                      }
                      size={21}
                    />
                  </span>
                  <div>
                    <strong>{definition.title}</strong>
                    <span>{definition.description}</span>
                  </div>
                  <AppIcon name="arrow-right" size={17} />
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
