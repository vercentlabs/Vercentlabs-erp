import { listBusinessDataRecords, listCrmRecords } from "@vercentlabs/api";
import Link from "next/link";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { businessDataContext } from "@/core/master-data";
import { crmContext } from "@/modules/crm";
import { query, tenantTransaction } from "@/core/db";

export const metadata = { title: "Search" };

type SearchResult = {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireWorkspace();
  const { q = "" } = await searchParams;
  const term = q.trim();
  const results: SearchResult[] = [];

  if (term.length >= 2) {
    const coreSearches: Array<Promise<SearchResult[]>> = [];
    if (hasPermission(session, PERMISSIONS.companyManage)) {
      coreSearches.push(
        query<SearchResult>(
          `SELECT 'Company' AS type,id,name AS title,code AS subtitle,
             '/settings/companies' AS href
           FROM companies
           WHERE organization_id=$1
             AND (name ILIKE '%'||$2||'%' OR code ILIKE '%'||$2||'%')
           ORDER BY name LIMIT 20`,
          [session.organizationId, term],
        ),
      );
    }
    if (hasPermission(session, PERMISSIONS.branchManage)) {
      coreSearches.push(
        query<SearchResult>(
          `SELECT 'Branch' AS type,id,name AS title,code AS subtitle,
             '/settings/branches' AS href
           FROM branches
           WHERE organization_id=$1
             AND (name ILIKE '%'||$2||'%' OR code ILIKE '%'||$2||'%')
           ORDER BY name LIMIT 20`,
          [session.organizationId, term],
        ),
      );
    }
    if (hasPermission(session, PERMISSIONS.departmentManage)) {
      coreSearches.push(
        query<SearchResult>(
          `SELECT 'Department' AS type,id,name AS title,code AS subtitle,
             '/settings/departments' AS href
           FROM departments
           WHERE organization_id=$1
             AND (name ILIKE '%'||$2||'%' OR code ILIKE '%'||$2||'%')
           ORDER BY name LIMIT 20`,
          [session.organizationId, term],
        ),
      );
    }
    if (hasPermission(session, PERMISSIONS.usersView)) {
      coreSearches.push(
        query<SearchResult>(
          `SELECT 'User' AS type,u.id,u.full_name AS title,u.email AS subtitle,
             '/settings/users' AS href
           FROM users u
           JOIN organization_memberships membership ON membership.user_id=u.id
           WHERE membership.organization_id=$1
             AND membership.status='active'
             AND (u.full_name ILIKE '%'||$2||'%' OR u.email ILIKE '%'||$2||'%')
           ORDER BY u.full_name LIMIT 20`,
          [session.organizationId, term],
        ),
      );
    }
    for (const rows of await Promise.all(coreSearches)) results.push(...rows);

    if (hasPermission(session, PERMISSIONS.crmView)) {
      const context = crmContext(session);
      const crm = await tenantTransaction(
        context.organizationId,
        async (client) => {
          const leads = await listCrmRecords(client, context, "leads", {
            search: term,
            limit: 20,
          });
          const opportunities = await listCrmRecords(
            client,
            context,
            "opportunities",
            { search: term, limit: 20 },
          );
          return { leads: leads.rows, opportunities: opportunities.rows };
        },
      );
      results.push(
        ...crm.leads.map((lead) => ({
          type: "Lead",
          id: String(lead.id),
          title: String(lead.fullName || lead.companyName || lead.code),
          subtitle: [lead.code, lead.email, lead.companyName]
            .filter(Boolean)
            .join(" · "),
          href: `/crm/leads/${String(lead.id)}`,
        })),
        ...crm.opportunities.map((opportunity) => ({
          type: "Opportunity",
          id: String(opportunity.id),
          title: String(opportunity.name || opportunity.code),
          subtitle: [opportunity.code, opportunity.status]
            .filter(Boolean)
            .join(" · "),
          href: `/crm/opportunities/${String(opportunity.id)}`,
        })),
      );
    }

    if (hasPermission(session, PERMISSIONS.businessDataView)) {
      const context = businessDataContext(session);
      const masterData = await tenantTransaction(
        context.organizationId,
        async (client) => {
          const parties = await listBusinessDataRecords(
            client,
            context,
            "parties",
            { search: term, limit: 20 },
          );
          const items = await listBusinessDataRecords(
            client,
            context,
            "items",
            { search: term, limit: 20 },
          );
          return { parties: parties.rows, items: items.rows };
        },
      );
      results.push(
        ...masterData.parties.map((party) => ({
          type: "Business partner",
          id: String(party.id),
          title: String(party.displayName || party.code),
          subtitle: [party.code, party.partyType].filter(Boolean).join(" · "),
          href: "/master-data/parties",
        })),
        ...masterData.items.map((item) => ({
          type: "Item",
          id: String(item.id),
          title: String(item.name || item.code),
          subtitle: [item.code, item.itemType].filter(Boolean).join(" · "),
          href: "/master-data/items",
        })),
      );
    }
  }

  const visibleResults = results.slice(0, 100);
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Global search</p>
          <h1>{term ? `Results for “${term}”` : "Search the workspace"}</h1>
          <p>
            Search only the organisation, master-data and CRM records your role
            is permitted to access.
          </p>
        </div>
      </section>
      {term.length < 2 ? (
        <section className="panel">
          <p>Enter at least two characters in the search field above.</p>
        </section>
      ) : (
        <section className="search-results">
          {visibleResults.map((result) => (
            <Link
              className="search-result"
              href={result.href}
              key={`${result.type}-${result.id}`}
            >
              <span>{result.type}</span>
              <strong>{result.title}</strong>
              <small>{result.subtitle}</small>
            </Link>
          ))}
          {!visibleResults.length ? (
            <div className="empty-state">
              <strong>No matching records</strong>
              <p>Try a lead, opportunity, company, user, partner or item.</p>
            </div>
          ) : null}
        </section>
      )}
    </>
  );
}
