import { notFound } from "next/navigation";
import { listCrmMeetings } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { crmApiContext } from "@/modules/crm";
import CrmCalendarWorkspace from "@/modules/crm/ui/crm-calendar-workspace";

export const metadata = { title: "CRM calendar" };
export const dynamic = "force-dynamic";

const DUE = ["all", "today", "upcoming", "overdue"] as const;
type Due = (typeof DUE)[number];

export default async function CrmCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();
  const query = await searchParams;
  const rawDue = Array.isArray(query.due) ? query.due[0] : query.due;
  const due: Due = DUE.includes(String(rawDue || "all") as Due) ? (String(rawDue || "all") as Due) : "all";
  const context = await crmApiContext(session);
  const records = await tenantTransaction(context.organizationId, (client) =>
    listCrmMeetings(client, context, { limit: 150, offset: 0, status: "all", due }),
  );
  return (
    <CrmCalendarWorkspace
      meetings={JSON.parse(JSON.stringify(records.rows))}
      due={due}
      locale={session.locale}
      canManage={hasPermission(session, PERMISSIONS.crmActivitiesManage)}
    />
  );
}
