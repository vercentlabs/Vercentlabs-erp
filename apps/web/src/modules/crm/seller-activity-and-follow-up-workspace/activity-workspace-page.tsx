import { notFound, redirect } from "next/navigation";
import { getCommunicationsDashboard, getCrmOptions, getCrmRecord, listCrmCalls, listCrmFollowUps, listCrmMeetings, listCrmRecords, listCrmTasks, listMyTaskTeams } from "@vercentlabs/api";

import { PageHeader, StatusBadge, Tabs } from "@/shared/design";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { crmApiContext, crmDefinitions } from "@/modules/crm";
import CrmResourceManager from "@/modules/crm/crm-data-operations-and-customization/resource-manager";
import CallsWorkspace from "@/modules/crm/seller-activity-and-follow-up-workspace/calls-workspace";
import MeetingsWorkspace from "@/modules/crm/seller-activity-and-follow-up-workspace/meetings-workspace";
import FollowUpsWorkspace from "@/modules/crm/seller-activity-and-follow-up-workspace/follow-ups-workspace";
import InboxWorkspace from "@/modules/crm/seller-activity-and-follow-up-workspace/inbox-workspace";
import TasksWorkspace from "@/modules/crm/seller-activity-and-follow-up-workspace/tasks-workspace";

const PAGE_SIZE = 25;
const TYPES = ["all", "call", "meeting", "task", "follow_up", "email", "whatsapp", "sms"] as const;
const DUE = ["all", "today", "overdue", "upcoming"] as const;

type ActivityType = (typeof TYPES)[number];
type DueFilter = (typeof DUE)[number];

function enumValue<T extends readonly string[]>(value: string | undefined, values: T, fallback: T[number]) {
  const normalized = String(value || fallback).trim().toLowerCase();
  return values.includes(normalized as T[number]) ? (normalized as T[number]) : fallback;
}

function activityUrl({
  basePath,
  activityType,
  due,
  search = "",
  status = "all",
  page = 1,
  direction = "all",
}: {
  basePath: string;
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
  return `${basePath}${suffix ? `?${suffix}` : ""}`;
}

const title = (value: string) => value.replace(/^./, (character) => character.toUpperCase());

const TYPE_LABELS: Partial<Record<ActivityType, string>> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Team inbox",
  // Deliberately not "Follow-ups" — /follow-ups already owns that name for
  // the pre-existing AI-recommended lead-nurture queue (a distinct
  // capability: system-ranked next actions, not user-scheduled ones). This
  // tab is a record-scoped, user-created scheduling primitive with its own
  // reason/channel/reminders/escalation — see CRM-VNEXT-128.
  follow_up: "Scheduled Follow-ups",
};

function typeLabel(type: ActivityType) {
  if (type === "all") return "All activity";
  return TYPE_LABELS[type] || `${title(type)}s`;
}

export type CrmActivityWorkspaceKind = Exclude<ActivityType, "all" | "whatsapp" | "sms">;

export async function CrmActivityWorkspacePage({
  searchParams,
  fixedType = null,
  basePath = "/crm/activities",
  pageTitle = "Activities",
  pageDescription = "One work queue for calls, meetings, tasks, follow-ups and the shared team inbox.",
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
    view?: string;
    teamId?: string;
  }>;
  fixedType?: CrmActivityWorkspaceKind | null;
  basePath?: string;
  pageTitle?: string;
  pageDescription?: string;
}) {
  const [session, query] = await Promise.all([requireWorkspace(), searchParams]);
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();

  const activityType: ActivityType = fixedType ?? enumValue(query.activityType, TYPES, "all");
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
  const context = await crmApiContext(session);

  // F018 closeout (§33) — the shared Team inbox lives here as the
  // canonical Email tab (the dossier's own wording), not a separate nav
  // destination or generic-resource fallback. crm_email_threads is a
  // fundamentally different shape (threads, not crm_activities rows), so
  // it bypasses the shared records/pagination fetch below entirely.
  if (activityType === "email") {
    const canManageInbox = hasPermission(session, PERMISSIONS.crmCommunicationsManage);
    const dashboard = canManageInbox
      ? await tenantTransaction(context.organizationId, (client) => getCommunicationsDashboard(client, context))
      : null;
    return (
      <div className="crm-activity-page">
        <PageHeader
          eyebrow="CRM · Daily work"
          title={pageTitle}
          description={pageDescription}
          context={dashboard ? <StatusBadge tone="neutral">{Number(dashboard.summary.open_threads || 0)} open</StatusBadge> : null}
        />
        {!fixedType ? (
          <Tabs
            label="Activity type"
            items={TYPES.map((type) => ({
              href: activityUrl({ basePath, activityType: type, due, search, status, direction: type === "call" ? direction : "all" }),
              label: typeLabel(type),
              current: activityType === type,
            }))}
          />
        ) : null}
        {dashboard ? (
          <InboxWorkspace
            currentUserId={session.userId}
            inboxes={JSON.parse(JSON.stringify(dashboard.inboxes))}
            initialThreads={JSON.parse(JSON.stringify(dashboard.threads))}
          />
        ) : (
          <p>You do not have permission to view the team inbox.</p>
        )}
      </div>
    );
  }

  // F015 closeout — the Tasks workspace is the canonical Experience-Kernel
  // surface for My Tasks/Team-Queue/claim/release/recurrence/dependencies,
  // not the generic resource manager the fallback branch below still uses
  // for every OTHER activity type. Needs its own data shape (myTeams,
  // view/teamId-scoped listing) so it bypasses the shared `result` fetch.
  if (activityType === "task") {
    const view = ["mine", "team", "all"].includes(String(query.view || "")) ? (query.view as "mine" | "team" | "all") : "mine";
    const teamId = String(query.teamId || "").trim();
    const taskData = await tenantTransaction(context.organizationId, async (client) => ({
      records: await listCrmTasks(client, context, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        search,
        status,
        due,
        mine: view === "mine",
        teamId: view === "team" ? teamId : undefined,
      }),
      options: await getCrmOptions(client, context),
      myTeams: await listMyTaskTeams(client, context),
    }));
    const totalTaskPages = Math.max(1, Math.ceil(taskData.records.total / PAGE_SIZE));
    if (page > totalTaskPages) {
      const redirectQuery = new URLSearchParams();
      if (!fixedType) redirectQuery.set("activityType", "task");
      if (view !== "mine") redirectQuery.set("view", view);
      if (view === "team" && teamId) redirectQuery.set("teamId", teamId);
      if (status !== "all") redirectQuery.set("status", status);
      if (due !== "all") redirectQuery.set("due", due);
      if (search) redirectQuery.set("search", search);
      if (totalTaskPages > 1) redirectQuery.set("page", String(totalTaskPages));
      redirect(`${basePath}${redirectQuery.size ? `?${redirectQuery.toString()}` : ""}`);
    }
    return (
      <div className="crm-activity-page">
        <PageHeader
          eyebrow="CRM · Daily work"
          title={pageTitle}
          description={pageDescription}
          context={<StatusBadge tone="neutral">{taskData.records.total} matching</StatusBadge>}
        />
        {!fixedType ? (
          <Tabs
            label="Activity type"
            items={TYPES.map((type) => ({
              href: activityUrl({ basePath, activityType: type, due, search, status, direction: type === "call" ? direction : "all" }),
              label: typeLabel(type),
              current: activityType === type,
            }))}
          />
        ) : null}
        <Tabs
          label="Activity urgency"
          items={DUE.map((value) => ({
            href: activityUrl({ basePath, activityType, due: value, search, status, direction }),
            label: value === "all" ? "Any date" : title(value),
            current: due === value,
          }))}
        />
        <TasksWorkspace
          rows={JSON.parse(JSON.stringify(taskData.records.rows))}
          total={taskData.records.total}
          page={page}
          pageSize={PAGE_SIZE}
          search={search}
          status={status}
          due={due}
          view={view}
          teamId={teamId}
          options={JSON.parse(JSON.stringify(taskData.options))}
          myTeams={JSON.parse(JSON.stringify(taskData.myTeams))}
          currentUserId={session.userId}
          canManage={canManage}
          startCreating={query.create === "1" && canManage}
        />
      </div>
    );
  }

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
        : activityType === "follow_up"
          ? await listCrmFollowUps(client, context, {
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
      !["call", "meeting", "follow_up"].includes(activityType) && editId && canManage
        ? await getCrmRecord(client, context, "activities", editId).catch(() => null)
        : null,
  }));

  const totalPages = Math.max(1, Math.ceil(result.records.total / PAGE_SIZE));
  if (page > totalPages) {
    redirect(activityUrl({ basePath, activityType, due, search, status, direction, page: totalPages }));
  }

  return (
    <div className="crm-activity-page">
      <PageHeader
        eyebrow="CRM · Daily work"
        title={pageTitle}
        description={pageDescription}
        context={<StatusBadge tone="neutral">{result.records.total} matching</StatusBadge>}
      />

      {!fixedType ? (
        <Tabs
          label="Activity type"
          items={TYPES.map((type) => ({
            href: activityUrl({ basePath, activityType: type, due, search, status, direction: type === "call" ? direction : "all" }),
            label: typeLabel(type),
            current: activityType === type,
          }))}
        />
      ) : null}

      <Tabs
        label="Activity urgency"
        items={DUE.map((value) => ({
          href: activityUrl({ basePath, activityType, due: value, search, status, direction }),
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
      ) : activityType === "follow_up" ? (
        <FollowUpsWorkspace
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
