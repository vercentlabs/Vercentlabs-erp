import { notFound } from "next/navigation";

import { getBusinessDataOverview } from "@vercentlabs/api";

import AppIcon from "@/components/app-icon";
import MasterDataCatalogue, {
  type MasterDataCatalogueEntry,
} from "@/components/master-data-catalogue";
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

const GROUP_ICON = {
  Partners: "companies",
  Products: "stock",
  Inventory: "branches",
  Finance: "accounting",
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

  // Every card still passes through businessDataView above (Master Data's
  // single shared read gate — all 16 resources are readable at the same
  // permission, confirmed by audit, so there is no per-resource *view*
  // permission to further split on). "Permission-aware" here means each
  // card additionally reflects its own resource's *manage* permission
  // (partiesManage/itemsManage/inventorySetupManage/financeSetupManage all
  // differ), so a user only sees "Manage access" where they actually have
  // write rights to that specific resource, never a blanket assumption.
  const entries: MasterDataCatalogueEntry[] = Object.values(
    businessDataDefinitions,
  ).map((definition) => ({
    key: definition.key,
    title: definition.title,
    description: definition.description,
    href: `/master-data/${definition.key}`,
    group: definition.group,
    icon: GROUP_ICON[definition.group],
    canManage: hasPermission(session, definition.managePermission),
  }));

  const groups = businessDataGroups.map((group) => ({
    name: group.name,
    title: group.title,
    description: group.description,
    overviewLabel: "primary records",
    overviewCount: Number(overview[overviewKeys[group.name]] || 0),
  }));

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

      <MasterDataCatalogue entries={entries} groups={groups} />
    </>
  );
}
