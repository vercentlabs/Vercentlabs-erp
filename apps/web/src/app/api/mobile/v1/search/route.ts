import { listBusinessDataRecords, listCrmRecords } from "@vercent/api";

import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { businessDataContext } from "@/lib/business-data";
import { crmContext } from "@/lib/crm";
import { query, tenantTransaction } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requireMobileSession } from "@/lib/mobile-session";

type Result = {
  resource: string;
  record: Record<string, unknown>;
  title: string;
  subtitle: string;
  href: string;
};

export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    if (!session.organizationId) throw new HttpError(401, "Workspace required.");
    const search = new URL(request.url).searchParams.get("q")?.trim() || "";
    if (search.length < 2 || search.length > 100) {
      throw new HttpError(400, "Search must contain 2 to 100 characters.");
    }
    const results: Result[] = [];

    const foundation = await query<Record<string, unknown>>(
      `SELECT 'company' AS resource,id,name AS title,concat_ws(' · ',code,status) AS subtitle
       FROM companies WHERE organization_id=$1 AND (name ILIKE '%' || $2 || '%' OR code ILIKE '%' || $2 || '%')
       UNION ALL
       SELECT 'branch',id,name,concat_ws(' · ',code,status)
       FROM branches WHERE organization_id=$1 AND (name ILIKE '%' || $2 || '%' OR code ILIKE '%' || $2 || '%')
       UNION ALL
       SELECT 'user',u.id,u.full_name,concat_ws(' · ',u.email,m.status)
       FROM users u JOIN organization_memberships m ON m.user_id=u.id
       WHERE m.organization_id=$1 AND (u.full_name ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%')
       LIMIT 40`,
      [session.organizationId, search],
    );
    for (const row of foundation) {
      const resource = String(row.resource);
      const allowed =
        resource === "company"
          ? hasPermission(session, PERMISSIONS.companyManage)
          : resource === "branch"
            ? hasPermission(session, PERMISSIONS.branchManage)
            : hasPermission(session, PERMISSIONS.usersView);
      if (!allowed) continue;
      results.push({
        resource,
        record: row,
        title: String(row.title),
        subtitle: String(row.subtitle || ""),
        href:
          resource === "user"
            ? "/(protected)/workspace/users"
            : `/(protected)/workspace/settings/${resource === "company" ? "companies" : "branches"}`,
      });
    }

    if (hasPermission(session, PERMISSIONS.crmView)) {
      const context = crmContext(session);
      const crm = await tenantTransaction(context.organizationId, async (client) => {
        const output: Result[] = [];
        for (const resource of ["leads", "opportunities", "activities"] as const) {
          const found = await listCrmRecords(client, context, resource, { search, limit: 12 });
          output.push(...found.rows.map((record) => ({
            resource,
            record,
            title: String(record.fullName || record.name || record.subject || record.code),
            subtitle: [record.code, record.email, record.companyName, record.status].filter(Boolean).join(" · "),
            href: `/(protected)/crm/${resource}/${String(record.id)}`,
          })));
        }
        return output;
      });
      results.push(...crm);
    }

    if (hasPermission(session, PERMISSIONS.businessDataView)) {
      const context = businessDataContext(session);
      const master = await tenantTransaction(context.organizationId, async (client) => {
        const parties = await listBusinessDataRecords(client, context, "parties", { search, limit: 20 });
        const items = await listBusinessDataRecords(client, context, "items", { search, limit: 20 });
        return { parties: parties.rows, items: items.rows };
      });
      results.push(
        ...master.parties.map((record) => ({ resource: "parties", record, title: String(record.displayName || record.code), subtitle: [record.code, record.partyType].filter(Boolean).join(" · "), href: "/(protected)/workspace/master-data/parties" })),
        ...master.items.map((record) => ({ resource: "items", record, title: String(record.name || record.code), subtitle: [record.code, record.itemType].filter(Boolean).join(" · "), href: "/(protected)/workspace/master-data/items" })),
      );
    }

    return mobileOk(request, { results: results.slice(0, 100) });
  } catch (error) {
    return mobileError(request, error);
  }
}
