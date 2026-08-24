import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCrmOptions, getCrmRecord, listCrmRecords } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { crmContext, crmDefinitions } from "@/modules/crm";
import CrmResourceManager from "@/modules/crm/components/resource-manager";

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
}: {
  activityType: ActivityType;
  due: DueFilter;
  search?: string;
  status?: string;
  page?: number;
}) {
  const query = new URLSearchParams();
  if (activityType !== "all") query.set("activityType", activityType);
  if (due !== "all") query.set("due", due);
  if (search) query.set("search", search);
  if (status !== "all") query.set("status", status);
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
  }>;
}) {
  const [session, query] = await Promise.all([requireWorkspace(), searchParams]);
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();

  const activityType = enumValue(query.activityType, TYPES, "all");
  const due = enumValue(query.due, DUE, "all");
  const search = String(query.search || "").trim().slice(0, 200);
  const status = String(query.status || "all").trim().slice(0, 80) || "all";
  const parsedPage = Math.trunc(Number(query.page) || 1);
  const page = Math.max(1, Math.min(1_000_000, parsedPage));
  const editId = String(query.edit || "").trim().slice(0, 80);
  const canManage = hasPermission(session, PERMISSIONS.crmActivitiesManage);
  const context = crmContext(session);

  const result = await tenantTransaction(context.organizationId, async (client) => ({
    records: await listCrmRecords(client, context, "activities", {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      search,
      status,
      activityType,
      due,
    }),
    options: await getCrmOptions(client, context),
    editingRecord:
      editId && canManage
        ? await getCrmRecord(client, context, "activities", editId).catch(() => null)
        : null,
  }));

  const totalPages = Math.max(1, Math.ceil(result.records.total / PAGE_SIZE));
  if (page > totalPages) {
    redirect(activityUrl({ activityType, due, search, status, page: totalPages }));
  }

  return (
    <div className="crm-activity-page">
      <section className="page-heading crm-hci-heading">
        <div>
          <p className="eyebrow">CRM · Daily work</p>
          <h1>Activities</h1>
          <p>
            One work queue for calls, meetings, tasks and follow-ups. Focus the queue by what you need to do now instead of navigating between separate activity screens.
          </p>
        </div>
        <span className="status-badge neutral">{result.records.total} matching</span>
      </section>

      <nav className="crm-focus-bar" aria-label="Activity type">
        {TYPES.map((type) => (
          <Link
            key={type}
            href={activityUrl({ activityType: type, due, search, status })}
            className={activityType === type ? "active" : ""}
            aria-current={activityType === type ? "page" : undefined}
          >
            {type === "all" ? "All activity" : `${title(type)}s`}
          </Link>
        ))}
      </nav>

      <nav className="crm-focus-bar crm-focus-bar--secondary" aria-label="Activity urgency">
        {DUE.map((value) => (
          <Link
            key={value}
            href={activityUrl({ activityType, due: value, search, status })}
            className={due === value ? "active" : ""}
            aria-current={due === value ? "page" : undefined}
          >
            {value === "all" ? "Any date" : title(value)}
          </Link>
        ))}
      </nav>

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
    </div>
  );
}
