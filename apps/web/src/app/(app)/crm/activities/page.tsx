import { notFound, redirect } from "next/navigation";
import { getCrmOptions, getCrmRecord, listCrmCalls, listCrmMeetings, listCrmRecords } from "@vercentlabs/api";

import { PageHeader, StatusBadge, Tabs } from "@/shared/design";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { crmContext, crmDefinitions } from "@/modules/crm";
import CrmResourceManager from "@/modules/crm/components/resource-manager";
import CallsWorkspace from "@/modules/crm/components/calls-workspace";
import MeetingsWorkspace from "@/modules/crm/components/meetings-workspace";

export const metadata = { title: "CRM activities" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const TYPES = ["all", "call", "meeting", "task", "email", "whatsapp", "sms"] as const;
const DUE = ["all", "today", "overdue", "upcoming"] as const;

type ActivityType = (typeof TYPES)[number];
type DueFilter = (typeof DUE)[number];

function enumValue<T extends readonly string[]>(value: string | undefined, values: T, fallback: T[number]) {
  const normalized = String(value || fallback).trim().toLowerCase();
  return values.includes(normalized as T[number]) ? (normalized as T[number]) : fallback;
}

function activityUrl({
  activityType,
  due,
  search = "",
  status = "all",
  page = 1,
  direction = "all",
}: {
  activityType: ActivityType;
  due: DueFilter;
  search?: string;
  status?: string;
  page?: number;
  direction?: string;
}) {
  const query = new URLSearchParams();
  if (activityType !== "all") query.set("activityType", activityType);
  if (due !== "all") query.set("due", due);
  if (search) query.set("search", search);
  if (status !== "all") query.set("status", status);
  if (direction !== "all") query.set("direction", direction);
  if (page > 1) query.set("page", String(page));
  const suffix = query.toString();
  return `/crm/activities${suffix ? `?${suffix}` : ""}`;
}

const title = (value: string) => value.replace(/^./, (character) => character.toUpperCase());

export default async function CrmActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{
    activityType?: string;
    due?: string;
    search?: string;
    status?: string;
    page?: string;
    create?: string;
    edit?: string;
    direction?: string;
  }>;
}) {
  const [session, query] = await Promise.all([requireWorkspace(), searchParams]);
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();

  const activityType = enumValue(query.activityType, TYPES, "all");
  const due = enumValue(query.due, DUE, "all");
  const search = String(query.search || "").trim().slice(0, 200);
  const status = String(query.status || "all").trim().slice(0, 80) || "all";
  const direction = ["all", "inbound", "outbound"].includes(String(query.direction || "all").toLowerCase())
    ? String(query.direction || "all").toLowerCase()
    : "all";
  const parsedPage = Math.trunc(Number(query.page) || 1);
  const page = Math.max(1, Math.min(1_000_000, parsedPage));
  const editId = String(query.edit || "").trim().slice(0, 80);
  const canManage = hasPermission(session, PERMISSIONS.crmActivitiesManage);
  const context = crmContext(session);

  const result = await tenantTransaction(context.organizationId, async (client) => ({
    records: activityType === "call"
      ? await listCrmCalls(client, context, {
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
          search,
          status,
          direction,
          due,
        })
      : activityType === "meeting"
        ? await listCrmMeetings(client, context, {
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
            search,
            status,
            due,
          })
        : await listCrmRecords(client, context, "activities", {
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
            search,
            status,
            activityType,
            due,
          }),
    options: await getCrmOptions(client, context),
    editingRecord:
      !["call", "meeting"].includes(activityType) && editId && canManage
        ? await getCrmRecord(client, context, "activities", editId).catch(() => null)
        : null,
  }));

  const totalPages = Math.max(1, Math.ceil(result.records.total / PAGE_SIZE));
  if (page > totalPages) {
    redirect(activityUrl({ activityType, due, search, status, direction, page: totalPages }));
  }

  return (
    <div className="crm-activity-page">
      <PageHeader
        eyebrow="CRM · Daily work"
        title="Activities"
        description="One work queue for calls, meetings, tasks and follow-ups. Focus the queue by what you need to do now instead of navigating between separate activity screens."
        context={<StatusBadge tone="neutral">{result.records.total} matching</StatusBadge>}
      />

      <Tabs
        label="Activity type"
        items={TYPES.map((type) => ({
          href: activityUrl({ activityType: type, due, search, status, direction: type === "call" ? direction : "all" }),
          label: type === "all" ? "All activity" : `${title(type)}s`,
          current: activityType === type,
        }))}
      />

      <Tabs
        label="Activity urgency"
        items={DUE.map((value) => ({
          href: activityUrl({ activityType, due: value, search, status, direction }),
          label: value === "all" ? "Any date" : title(value),
          current: due === value,
        }))}
      />

      {activityType === "call" ? (
        <CallsWorkspace
          rows={JSON.parse(JSON.stringify(result.records.rows))}
          total={result.records.total}
          page={page}
          pageSize={PAGE_SIZE}
          search={search}
          status={status}
          direction={direction}
          due={due}
          options={JSON.parse(JSON.stringify(result.options))}
          canManage={canManage}
          startCreating={query.create === "1" && canManage}
        />
      ) : activityType === "meeting" ? (
        <MeetingsWorkspace
          rows={JSON.parse(JSON.stringify(result.records.rows))}
          total={result.records.total}
          page={page}
          pageSize={PAGE_SIZE}
          search={search}
          status={status}
          due={due}
          options={JSON.parse(JSON.stringify(result.options))}
          canManage={canManage}
          startCreating={query.create === "1" && canManage}
        />
      ) : (
        <CrmResourceManager
          key={[activityType, due, page, search, status, query.create || "", editId].join(":")}
          definition={crmDefinitions.activities}
          rows={JSON.parse(JSON.stringify(result.records.rows))}
          total={result.records.total}
          page={page}
          pageSize={PAGE_SIZE}
          initialSearch={search}
          initialStatus={status}
          options={JSON.parse(JSON.stringify(result.options))}
          canManage={canManage}
          startCreating={query.create === "1" && canManage}
          startEditing={JSON.parse(JSON.stringify(result.editingRecord))}
          canImport={false}
          canExport={false}
          preservedQuery={{
            activityType: activityType === "all" ? "" : activityType,
            due: due === "all" ? "" : due,
          }}
        />
      )}
    </div>
  );
}
