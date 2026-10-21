// The first screens of a workspace (MVP 44): which app someone lands in, the Get started card on an app's main screen (the owner and
// administrators, while the workspace is new; each task ticks itself from the data, however it was done), a teammate's Welcome card
// (what already exists in their apps, counted only from records they may see), and the one GST question a new company is asked.
import { hasSessionPermission } from "../access/index.js";
import { updateCompanyProfile } from "./company-profile.js";

export class WorkspaceStartError extends Error {
  constructor(status, message, code = "WORKSPACE_START_ERROR", details) {
    super(message);
    this.name = "WorkspaceStartError";
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

const NEW_WORKSPACE_DAYS = 30;
const WELCOME_DAYS = 7;
const NAMES = { crm: "CRM", sales: "Sales", "point-of-sale": "Point of Sale", accounting: "Accounting", procurement: "Purchase", stock: "Stock", manufacturing: "Manufacturing",
  projects: "Projects", assets: "Assets", quality: "Quality", support: "Support", "hr-payroll": "HR & Payroll" };
const exists = (table, where = "") => `SELECT EXISTS (SELECT 1 FROM tenant.${table} WHERE organization_id = $1${where ? ` AND ${where}` : ""}) AS done`;
const teammate = `SELECT (SELECT count(*) FROM public.organization_memberships WHERE organization_id = $1 AND status = 'active') > 1
  OR EXISTS (SELECT 1 FROM public.organization_invitations WHERE organization_id = $1 AND revoked_at IS NULL) AS done`;
const INVITE = { label: "Invite a teammate", href: "/settings/invitations", sql: teammate };
// Three tasks per app: what to do, where it opens, and how we know it's done.
const TASKS = {
  crm: [{ label: "Add your first deal", href: "/crm/opportunities/new", sql: exists("crm_opportunities") },
    { label: "Add or import contacts", href: "/crm/contacts", sql: exists("contacts") }, INVITE],
  sales: [{ label: "Add a product or service", href: "/sales/products", sql: exists("items") },
    { label: "Send your first quotation", href: "/sales/quotations/new", sql: exists("sales_quotations", "sent_at IS NOT NULL") },
    { label: "Add your logo for documents", href: "/settings/organization", sql: `SELECT EXISTS (SELECT 1 FROM public.organizations WHERE id = $1 AND logo_file_id IS NOT NULL) AS done` }],
  // Products live in Sales or Stock (POS has no product list of its own): the task opens whichever the person has.
  "point-of-sale": [{ label: "Add your products or menu", href: [["sales", "/sales/products"], ["stock", "/inventory/items"]], sql: exists("items") },
    { label: "Open the register", href: "/pos/register", sql: exists("pos_shifts") }, { label: "Make a test sale", href: "/pos/register", sql: exists("pos_sales") }],
  accounting: [{ label: "Create your first invoice", href: "/accounting/customer-invoices", sql: exists("accounting_customer_invoices") },
    { label: "Add your GST details", action: "gst", sql: null }, { label: "Record a payment", href: "/accounting/receipts", sql: exists("accounting_customer_receipts") }],
  procurement: [{ label: "Add a supplier", href: "/procurement/suppliers", sql: exists("procurement_suppliers") },
    { label: "Create a purchase order", href: "/procurement/purchase-orders/new", sql: exists("purchase_orders") },
    { label: "Record a supplier bill", href: "/procurement/supplier-bills", sql: exists("accounting_vendor_bills") }],
  stock: [{ label: "Add your products", href: "/inventory/items", sql: exists("items") }, { label: "Enter opening stock", href: "/inventory/opening-stock", sql: exists("opening_stocks") },
    { label: "Record goods received", href: "/inventory/goods-receipts", sql: exists("goods_receipts") }],
  manufacturing: [{ label: "Add a product and its parts", href: "/manufacturing/boms", sql: exists("manufacturing_boms") },
    { label: "Create a manufacturing order", href: "/manufacturing/orders", sql: exists("manufacturing_orders") },
    { label: "Record finished goods", href: "/manufacturing/finished-goods-receipts", sql: exists("manufacturing_finished_goods_receipts") }],
  projects: [{ label: "Create a project", href: "/projects/new", sql: exists("projects") }, { label: "Add tasks", href: "/projects/tasks", sql: exists("project_tasks") },
    { label: "Log time", href: "/projects/timesheets", sql: exists("project_time_entries") }],
  assets: [{ label: "Add an asset", href: "/assets/register/new", sql: exists("assets") }, { label: "Give it to a person or place", href: "/assets/assignments", sql: exists("asset_assignments") },
    { label: "Log a maintenance visit", href: "/assets/maintenance", sql: exists("asset_maintenance_events") }],
  quality: [{ label: "Record an inspection", href: "/quality/incoming", sql: exists("quality_inspections") },
    { label: "Raise a problem report", href: "/quality/nonconformances", sql: exists("quality_nonconformances") },
    { label: "Invite your quality checker", href: "/settings/invitations", sql: `SELECT EXISTS (SELECT 1 FROM public.user_role_assignments a JOIN public.roles r ON r.id = a.role_id
      WHERE a.organization_id = $1 AND a.status = 'active' AND r.module_key = 'quality') OR EXISTS (SELECT 1 FROM public.organization_invitation_roles ir JOIN public.roles r ON r.id = ir.role_id
      JOIN public.organization_invitations i ON i.id = ir.invitation_id WHERE i.organization_id = $1 AND i.revoked_at IS NULL AND r.module_key = 'quality') AS done` }],
  support: [{ label: "Create a ticket", href: "/support", sql: exists("support_tickets") },
    { label: "Connect your support email", href: "/support/settings", sql: exists("support_mailboxes") }, INVITE],
  "hr-payroll": [{ label: "Add your employees", href: "/hr/employees", sql: exists("hr_employees") }, { label: "Set up leave types", href: "/hr/leave-types", sql: exists("hr_leave_types") },
    { label: "Run your first payroll", href: "/hr/payroll-runs", sql: exists("hr_payroll_runs") }],
};

// The GST question: needed while GST is on and no company registration says which state the business is in.
export async function getGstDetailsStatus(client, session) {
  const settings = (await client.query(`SELECT COALESCE(tax_enabled, true) AS tax_enabled FROM tenant.tax_settings WHERE organization_id = $1`, [session.organizationId])).rows[0];
  const registration = (await client.query(`SELECT registration_number, state_code FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' AND state_code IS NOT NULL
      ORDER BY is_default DESC, created_at LIMIT 1`, [session.organizationId])).rows[0];
  const organization = (await client.query(`SELECT state_code FROM public.organizations WHERE id = $1`, [session.organizationId])).rows[0];
  const taxEnabled = settings?.tax_enabled !== false;
  return { needed: taxEnabled ? !registration : !organization?.state_code, taxEnabled, gstin: registration?.registration_number ?? null,
    stateCode: registration?.state_code ?? organization?.state_code ?? null, canEdit: hasSessionPermission(session, "organization.manage") };
}
// input: registered (true: gstin — the state comes from it; false: stateCode only, and documents are made without GST).
export async function saveGstDetails(client, session, input = {}) {
  if (!hasSessionPermission(session, "organization.manage")) throw new WorkspaceStartError(403, "Ask the owner or an administrator to add the GST details.", "GST_DETAILS_DENIED");
  const registered = input.registered === true || input.registered === "true";
  if (registered) {
    const gstin = String(input.gstin ?? "").trim().toUpperCase();
    if (!gstin) throw new WorkspaceStartError(422, "Enter your GSTIN.", "GST_DETAILS_INVALID", { field: "gstin" });
    await updateCompanyProfile(client, session, { gstin, address: { stateCode: gstin.slice(0, 2) } });
    await client.query(`INSERT INTO tenant.tax_settings (organization_id, tax_enabled) VALUES ($1, true) ON CONFLICT (organization_id) DO UPDATE SET tax_enabled = true`, [session.organizationId]);
  } else {
    const stateCode = String(input.stateCode ?? "").trim();
    if (!/^\d{2}$/.test(stateCode)) throw new WorkspaceStartError(422, "Pick your state.", "GST_DETAILS_INVALID", { field: "stateCode" });
    await updateCompanyProfile(client, session, { address: { stateCode } });
    await client.query(`INSERT INTO tenant.tax_settings (organization_id, tax_enabled) VALUES ($1, false) ON CONFLICT (organization_id) DO UPDATE SET tax_enabled = false`, [session.organizationId]);
  }
  return getGstDetailsStatus(client, session);
}

// Where someone lands: the app they used last (when they still have it), else the first app chosen at signup, else the first they have.
// accessible: the module keys this person may open, in menu order.
export async function startingModule(client, session, accessible) {
  const user = (await client.query(`SELECT last_module_key FROM public.users WHERE id = $1`, [session.userId])).rows[0];
  if (user?.last_module_key && accessible.includes(user.last_module_key)) return user.last_module_key;
  const profile = (await client.query(`SELECT business_profile FROM public.organizations WHERE id = $1`, [session.organizationId])).rows[0]?.business_profile;
  return (profile?.chosen ?? []).find((key) => accessible.includes(key)) ?? accessible[0] ?? null;
}
export async function rememberLastModule(client, session, moduleKey) {
  if (!NAMES[moduleKey]) return;
  await client.query(`UPDATE public.users SET last_module_key = $2 WHERE id = $1 AND last_module_key IS DISTINCT FROM $2`, [session.userId, moduleKey]);
}

const dismissed = async (client, session, guide, moduleKey) => Boolean((await client.query(`SELECT dismissed_at FROM public.workspace_guides WHERE organization_id = $1 AND user_id = $2
    AND guide = $3 AND module_key = $4`, [session.organizationId, session.userId, guide, moduleKey])).rows[0]?.dismissed_at);

// Counts for the Welcome card, from the records this person may see: all of them with the app's "view all" permission, else their own.
const METRICS = {
  crm: [{ label: "open deals", table: "crm_opportunities", where: "status = 'open'", owner: "owner_user_id", all: ["crm.opportunities.view_all", "crm.records.view_all"], href: "/crm/pipeline" },
    { label: "contacts", table: "contacts", owner: "owner_user_id", all: ["crm.customers.view_all", "crm.records.view_all"], href: "/crm/contacts" }],
  sales: [{ label: "quotations", table: "sales_quotations", owner: "owner_user_id", all: ["sales.quotation.view_all"], href: "/sales/quotations" }],
  support: [{ label: "open tickets", table: "support_tickets", where: "status NOT IN ('resolved', 'closed', 'cancelled')", owner: "assigned_user_id", all: ["support.ticket.view_all"], href: "/support" }],
  projects: [{ label: "tasks", table: "project_tasks", where: "status NOT IN ('done', 'cancelled')", owner: "assignee_user_id", all: ["projects.view_all"], href: "/projects/tasks" }],
  quality: [{ label: "inspections", table: "quality_inspections", owner: "assigned_inspector_id", all: ["quality.inspection.view_all"], href: "/quality/incoming" }],
};
async function welcomeMetrics(client, session, apps) {
  const out = [];
  for (const app of apps) {
    for (const m of METRICS[app] ?? []) {
      const seesAll = m.all.some((permission) => hasSessionPermission(session, permission));
      const base = `FROM tenant.${m.table} WHERE organization_id = $1${m.where ? ` AND ${m.where}` : ""}`;
      try {
        await client.query("SAVEPOINT welcome_metric");
        const row = (await client.query(`SELECT count(*) FILTER (WHERE $3 OR ${m.owner} = $2)::int AS total, count(*) FILTER (WHERE ${m.owner} = $2)::int AS mine ${base}`,
          [session.organizationId, session.userId, seesAll])).rows[0];
        await client.query("RELEASE SAVEPOINT welcome_metric");
        if (row.total > 0) out.push({ label: m.label, count: row.total, href: m.href });
        if (row.mine > 0 && !out.some((x) => x.mine)) out.push({ label: "assigned to you", count: row.mine, href: m.href, mine: true });
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT welcome_metric");
      }
    }
  }
  return out.slice(0, 4);
}

// The card on an app's main screen: Get started (owner / administrators, new workspace, tasks not all done, not closed) or Welcome
// (a teammate in their first week, not closed). accessible: the app keys this person may open.
export async function getWorkspaceGuide(client, session, moduleKey, accessible = []) {
  const organization = (await client.query(`SELECT name, created_at FROM public.organizations WHERE id = $1`, [session.organizationId])).rows[0];
  const isNew = Date.now() - new Date(organization.created_at).getTime() < NEW_WORKSPACE_DAYS * 86_400_000;
  if (hasSessionPermission(session, "organization.manage")) {
    if (!isNew || !TASKS[moduleKey] || (await dismissed(client, session, "get_started", moduleKey))) return null;
    const gst = moduleKey === "accounting" ? await getGstDetailsStatus(client, session) : null;
    const tasks = [];
    for (const task of TASKS[moduleKey]) {
      let done = false;
      if (task.action === "gst") done = !gst.needed;
      else {
        try {
          await client.query("SAVEPOINT guide_task");
          done = Boolean((await client.query(task.sql, [session.organizationId])).rows[0]?.done);
          await client.query("RELEASE SAVEPOINT guide_task");
        } catch {
          await client.query("ROLLBACK TO SAVEPOINT guide_task");
        }
      }
      const href = Array.isArray(task.href) ? task.href.find(([key]) => accessible.includes(key))?.[1] ?? null : task.href ?? null;
      tasks.push({ label: task.label, href, action: task.action ?? null, done });
    }
    if (tasks.every((task) => task.done)) return null;
    return { kind: "get_started", moduleKey, title: `Get started with ${NAMES[moduleKey]}`, tasks, done: tasks.filter((task) => task.done).length };
  }
  const membership = (await client.query(`SELECT created_at FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`, [session.organizationId, session.userId])).rows[0];
  if (!membership || Date.now() - new Date(membership.created_at).getTime() > WELCOME_DAYS * 86_400_000 || (await dismissed(client, session, "welcome", ""))) return null;
  const inviter = (await client.query(`SELECT u.full_name FROM public.organization_invitations i JOIN public.users u ON u.id = i.invited_by
      WHERE i.organization_id = $1 AND lower(i.email) = lower($2) AND i.accepted_at IS NOT NULL ORDER BY i.accepted_at DESC LIMIT 1`, [session.organizationId, session.email])).rows[0];
  const apps = accessible.filter((key) => NAMES[key]);
  const names = apps.map((key) => NAMES[key]);
  return { kind: "welcome", title: `Welcome to ${organization.name}`,
    line: `${inviter?.full_name?.split(/\s+/)[0] ?? "Your team"} gave you access to ${names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "your apps"}.`,
    metrics: await welcomeMetrics(client, session, apps) };
}
export async function dismissWorkspaceGuide(client, session, { guide, moduleKey = "" } = {}) {
  if (!["get_started", "welcome"].includes(guide)) throw new WorkspaceStartError(400, "Unknown card.", "WORKSPACE_GUIDE_INVALID");
  await client.query(`INSERT INTO public.workspace_guides (organization_id, user_id, guide, module_key, dismissed_at) VALUES ($1, $2, $3, $4, now())
    ON CONFLICT (organization_id, user_id, guide, module_key) DO UPDATE SET dismissed_at = now()`, [session.organizationId, session.userId, guide, guide === "welcome" ? "" : String(moduleKey)]);
  return { dismissed: true };
}
// Help › Get started: the closed card comes back.
export async function reopenWorkspaceGuide(client, session, moduleKey) {
  await client.query(`UPDATE public.workspace_guides SET dismissed_at = NULL WHERE organization_id = $1 AND user_id = $2 AND (module_key = $3 OR guide = 'welcome')`,
    [session.organizationId, session.userId, String(moduleKey ?? "")]);
  return { reopened: true };
}
