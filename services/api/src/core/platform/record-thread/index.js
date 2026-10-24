// The shared record thread (Shared Platform plan 4): on any main document — quotations, orders, invoices, deliveries, returns, credit and
// debit notes, challans, purchase
// orders, supplier bills, items, assets — one place for:
//   comments and internal notes, with @mentions (the person is told),
//   followers (told of new comments on records they follow; the author of a comment follows the record),
//   scheduled activities (a call, meeting, to-do or email for someone, by a date; reminded on the day),
//   and the history (the record's audit trail).
// Who may see a thread is decided by the record's own module: the thread loads the record through that module's read function,
// which applies its visibility rules (own / team / all), before showing or changing anything.
import { createNotification } from "../notifications/index.js";

export class RecordThreadError extends Error {
  constructor(status, message, code = "RECORD_THREAD_ERROR") {
    super(message);
    this.name = "RecordThreadError";
    this.status = status;
    this.code = code;
  }
}

const lazy = (path, name) => async (client, context, id) => (await import(path))[name](client, context, id);
// The first of these fields on the record or one level down (reads return { rfq: {...} }, { claim: {...} } and so on).
const field = (...keys) => (record) => {
  for (const source of [record, ...Object.values(record ?? {}).filter((value) => value && typeof value === "object" && !Array.isArray(value))])
    for (const key of keys) if (source?.[key]) return source[key];
  return null;
};
// type -> { module (app key), label, href, read (the module's own visibility-checked read), title(record) }
export const RECORD_THREAD_TYPES = Object.freeze({
  "sales.quotation": { module: "sales", label: "Quotation", href: (id) => `/sales/quotations/${id}`, read: lazy("../../../modules/sales/quotations/records.js", "getQuotation"),
    title: (record) => record?.quotation?.quotation_number ?? record?.quotation_number },
  // A customer's notes and to-dos in Sales, for a company without CRM (Line-by-line audit).
  "sales.customer": { module: "sales", label: "Customer", href: (id) => `/sales/customers/${id}`, read: lazy("../../../modules/sales/customers/records.js", "getCustomer"),
    title: (record) => record?.displayName ?? record?.customer?.displayName },
  "sales.order": { module: "sales", label: "Sales order", href: (id) => `/sales/orders/${id}`, read: lazy("../../../modules/sales/orders/records.js", "getSalesOrder"),
    title: (record) => record?.order?.sales_order_number ?? record?.sales_order_number },
  "sales.invoice": { module: "sales", label: "Invoice", href: (id) => `/sales/invoices/${id}`, read: lazy("../../../modules/sales/invoices/records.js", "getSalesInvoice"),
    title: (record) => record?.invoice?.invoice_number ?? record?.invoice_number },
  "sales.delivery": { module: "sales", label: "Delivery", href: (id) => `/sales/deliveries/${id}`, read: lazy("../../../modules/sales/deliveries/records.js", "getDelivery"),
    title: (record) => record?.delivery?.request_number ?? record?.request_number },
  // Every Sales document has its thread (Sales report H1).
  "sales.return": { module: "sales", label: "Sales return", href: (id) => `/sales/returns/${id}`, read: lazy("../../../modules/sales/returns/records.js", "getSalesReturn"),
    title: (record) => record?.salesReturn?.return_number },
  "sales.credit_note": { module: "sales", label: "Credit note", href: (id) => `/sales/credit-notes/${id}`, read: lazy("../../../modules/sales/credit-notes/records.js", "getCreditNote"),
    title: (record) => record?.creditNote?.invoice_number },
  "sales.debit_note": { module: "sales", label: "Debit note", href: (id) => `/sales/debit-notes/${id}`, read: lazy("../../../modules/sales/debit-notes/index.js", "getDebitNote"),
    title: (record) => record?.debitNote?.number },
  "sales.challan": { module: "sales", label: "Delivery challan", href: (id) => `/sales/challans/${id}`, read: lazy("../../../modules/sales/challans.js", "getSalesChallan"),
    title: (record) => record?.challanNumber },
  "procurement.purchase_order": { module: "procurement", label: "Purchase order", href: (id) => `/procurement/purchase-orders/${id}`,
    read: lazy("../../../modules/procurement/purchase-orders/records.js", "getPurchaseOrder"), title: (record) => record?.order?.purchase_order_number ?? record?.purchaseOrderNumber ?? record?.purchase_order_number },
  "procurement.supplier_bill": { module: "procurement", label: "Supplier bill", href: (id) => `/procurement/supplier-bills/${id}`,
    read: lazy("../../../modules/procurement/supplier-bills/records.js", "getSupplierBill"), title: (record) => record?.bill?.billNumber ?? record?.billNumber },
  "procurement.supplier": { module: "procurement", label: "Supplier", href: (id) => `/procurement/suppliers/${id}`,
    read: lazy("../../../modules/procurement/suppliers/records.js", "getSupplier"), title: field("supplierName") },
  "procurement.indent": { module: "procurement", label: "Purchase request", href: (id) => `/procurement/indents/${id}`,
    read: lazy("../../../modules/procurement/indents/index.js", "getPurchaseIndent"), title: field("number") },
  "procurement.rfq": { module: "procurement", label: "Price request", href: (id) => `/procurement/rfqs/${id}`,
    read: lazy("../../../modules/procurement/rfqs/index.js", "getPurchaseRfq"), title: field("number") },
  "procurement.goods_receipt": { module: "procurement", label: "Goods received", href: (id) => `/procurement/goods-receipts/${id}`,
    read: lazy("../../../modules/procurement/purchase-orders/receipt-records.js", "getGoodsReceipt"), title: field("receiptNumber") },
  "procurement.purchase_return": { module: "procurement", label: "Return to supplier", href: (id) => `/procurement/purchase-returns/${id}`,
    read: lazy("../../../modules/procurement/purchase-returns/records.js", "getPurchaseReturn"), title: field("returnNumber") },
  "procurement.debit_note": { module: "procurement", label: "Debit note", href: (id) => `/procurement/debit-notes-credits/claims/${id}`,
    read: lazy("../../../modules/procurement/vendor-credits/claims.js", "getSupplierDebitClaim"), title: field("claimNumber", "number") },
  "procurement.supplier_credit": { module: "procurement", label: "Supplier credit note", href: (id) => `/procurement/debit-notes-credits/vendor-credits/${id}`,
    read: lazy("../../../modules/procurement/vendor-credits/records.js", "getVendorCredit"), title: field("creditNumber", "billNumber", "number") },
  "products.item": { module: null, label: "Item", href: (id) => `/inventory/items/${id}`, read: lazy("../../../modules/products/records.js", "getProduct"),
    title: (record) => record?.product?.name ?? record?.name ?? record?.item?.name },
  "assets.asset": { module: "assets", label: "Asset", href: (id) => `/assets/register/${id}`, read: lazy("../../../modules/assets/asset-register/register-read.js", "getAsset"),
    title: (record) => record?.asset?.assetCode ?? record?.assetCode ?? record?.asset_code },
});
const ACTIVITY_TYPES = Object.freeze({ to_do: "To-do", call: "Call", meeting: "Meeting", email: "Email" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function recordThreadType(type) {
  const definition = RECORD_THREAD_TYPES[type];
  if (!definition) throw new RecordThreadError(404, "Comments are not available on this kind of record.", "RECORD_THREAD_TYPE");
  return definition;
}

// Loads the record through its own module (visibility applies); returns { definition, title }.
async function requireRecord(client, context, type, id) {
  const definition = recordThreadType(type);
  if (!UUID.test(String(id))) throw new RecordThreadError(404, "The record was not found.", "RECORD_THREAD_NOT_FOUND");
  let record;
  try {
    record = await definition.read(client, context, id);
  } catch (error) {
    if (error?.status === 403 || error?.status === 404) throw new RecordThreadError(404, "The record was not found, or you cannot see it.", "RECORD_THREAD_NOT_FOUND");
    throw error;
  }
  if (!record) throw new RecordThreadError(404, "The record was not found, or you cannot see it.", "RECORD_THREAD_NOT_FOUND");
  return { definition, title: definition.title(record) ?? definition.label };
}

async function notifyPeople(client, context, type, id, title, userIds, { heading, message }) {
  const definition = recordThreadType(type);
  for (const userId of [...new Set(userIds)].filter((user) => user && user !== context.userId)) {
    await createNotification(client, {
      organizationId: context.organizationId, userId, category: "record_thread", title: `${heading} — ${definition.label} ${title}`.slice(0, 200), message,
      href: definition.href(id), entityType: type, entityId: id,
    });
  }
}

async function activeMembers(client, organizationId, userIds) {
  if (!userIds.length) return [];
  return (await client.query(`SELECT user_id FROM public.organization_memberships WHERE organization_id = $1 AND status = 'active' AND user_id = ANY($2::uuid[])`,
    [organizationId, userIds])).rows.map((row) => row.user_id);
}

export async function getRecordThread(client, context, type, id) {
  const { title } = await requireRecord(client, context, type, id);
  const comments = (await client.query(
    `SELECT comment.id, comment.kind, comment.body, comment.mentions, comment.created_by, comment.created_at, comment.edited_at, comment.deleted_at, author.full_name AS author_name
       FROM public.comments comment LEFT JOIN public.users author ON author.id = comment.created_by
      WHERE comment.organization_id = $1 AND comment.entity_type = $2 AND comment.entity_id = $3 ORDER BY comment.created_at`,
    [context.organizationId, type, String(id)])).rows.map((row) => ({
    id: row.id, kind: row.kind, body: row.deleted_at ? null : row.body, deleted: Boolean(row.deleted_at), mentions: row.mentions ?? [], authorId: row.created_by, authorName: row.author_name,
    at: row.created_at, editedAt: row.edited_at, mine: row.created_by === context.userId,
  }));
  const activities = (await client.query(
    `SELECT activity.*, to_char(activity.due_date, 'YYYY-MM-DD') AS due, assignee.full_name AS assignee_name, creator.full_name AS creator_name
       FROM public.record_activities activity
       LEFT JOIN public.users assignee ON assignee.id = activity.assigned_to
       LEFT JOIN public.users creator ON creator.id = activity.created_by
      WHERE activity.organization_id = $1 AND activity.entity_type = $2 AND activity.entity_id = $3
      ORDER BY (activity.status = 'open') DESC, activity.due_date, activity.created_at`, [context.organizationId, type, String(id)])).rows.map((row) => ({
    id: row.id, type: row.activity_type, typeLabel: ACTIVITY_TYPES[row.activity_type], summary: row.summary, note: row.note, dueDate: row.due, assignedTo: row.assigned_to,
    assigneeName: row.assignee_name, createdByName: row.creator_name, status: row.status, doneAt: row.done_at, doneNote: row.done_note,
    overdue: row.status === "open" && row.due < new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
  }));
  const followers = (await client.query(
    `SELECT follower.user_id, app_user.full_name FROM public.record_followers follower JOIN public.users app_user ON app_user.id = follower.user_id
      WHERE follower.organization_id = $1 AND follower.entity_type = $2 AND follower.entity_id = $3 ORDER BY follower.created_at`, [context.organizationId, type, String(id)])).rows
    .map((row) => ({ userId: row.user_id, name: row.full_name }));
  const history = (await client.query(
    `SELECT event.event_type, event.created_at, event.metadata, actor.full_name AS actor_name FROM public.audit_events event
       LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.entity_id = $2 ORDER BY event.created_at DESC LIMIT 100`, [context.organizationId, String(id)])).rows
    .map((row) => ({ event: row.event_type, label: String(row.event_type).split(".").slice(-1)[0].replace(/_/g, " "), at: row.created_at, by: row.actor_name }));
  return { type, id: String(id), title, comments, activities, followers, following: followers.some((follower) => follower.userId === context.userId), history };
}

async function follow(client, organizationId, type, id, userId) {
  await client.query(`INSERT INTO public.record_followers (organization_id, entity_type, entity_id, user_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [organizationId, type, String(id), userId]);
}

// input: { body, kind: "comment" | "note", mentions: [userId] }. A note is internal (followers are not told; mentioned people are).
export async function addRecordComment(client, context, type, id, input = {}) {
  const { title } = await requireRecord(client, context, type, id);
  const body = String(input.body ?? "").trim();
  if (!body || body.length > 10_000) throw new RecordThreadError(422, "Write the comment (up to 10,000 characters).", "RECORD_THREAD_INVALID");
  const kind = input.kind === "note" ? "note" : "comment";
  const mentions = await activeMembers(client, context.organizationId, [...new Set((Array.isArray(input.mentions) ? input.mentions : []).filter((value) => UUID.test(String(value))))]);
  const comment = (await client.query(
    `INSERT INTO public.comments (organization_id, entity_type, entity_id, body, created_by, kind, mentions) VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[]) RETURNING id`,
    [context.organizationId, type, String(id), body, context.userId, kind, mentions])).rows[0];
  await follow(client, context.organizationId, type, id, context.userId);
  const excerpt = body.length > 160 ? `${body.slice(0, 157)}…` : body;
  await notifyPeople(client, context, type, id, title, mentions, { heading: "You were mentioned", message: excerpt });
  if (kind === "comment") {
    const followers = (await client.query(`SELECT user_id FROM public.record_followers WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3`,
      [context.organizationId, type, String(id)])).rows.map((row) => row.user_id).filter((user) => !mentions.includes(user));
    await notifyPeople(client, context, type, id, title, followers, { heading: "New comment", message: excerpt });
  }
  return getRecordThread(client, context, type, id);
}

export async function editRecordComment(client, context, type, id, commentId, { body } = {}) {
  await requireRecord(client, context, type, id);
  const text = String(body ?? "").trim();
  if (!text || text.length > 10_000) throw new RecordThreadError(422, "Write the comment (up to 10,000 characters).", "RECORD_THREAD_INVALID");
  const updated = await client.query(
    `UPDATE public.comments SET body = $5, edited_at = now(), updated_at = now()
      WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND created_by = $6 AND deleted_at IS NULL RETURNING id`,
    [context.organizationId, type, String(id), commentId, text, context.userId]);
  if (!updated.rowCount) throw new RecordThreadError(404, "Only the author can change a comment.", "RECORD_THREAD_NOT_AUTHOR");
  return getRecordThread(client, context, type, id);
}

export async function deleteRecordComment(client, context, type, id, commentId) {
  await requireRecord(client, context, type, id);
  const updated = await client.query(
    `UPDATE public.comments SET deleted_at = now(), updated_at = now() WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND created_by = $5 AND deleted_at IS NULL RETURNING id`,
    [context.organizationId, type, String(id), commentId, context.userId]);
  if (!updated.rowCount) throw new RecordThreadError(404, "Only the author can remove a comment.", "RECORD_THREAD_NOT_AUTHOR");
  return getRecordThread(client, context, type, id);
}

export async function setRecordFollowing(client, context, type, id, following) {
  await requireRecord(client, context, type, id);
  if (following) await follow(client, context.organizationId, type, id, context.userId);
  else await client.query(`DELETE FROM public.record_followers WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND user_id = $4`, [context.organizationId, type, String(id), context.userId]);
  return getRecordThread(client, context, type, id);
}

// input: { type, summary, note?, dueDate (YYYY-MM-DD), assignedTo }
export async function scheduleRecordActivity(client, context, type, id, input = {}) {
  const { title } = await requireRecord(client, context, type, id);
  const activityType = ACTIVITY_TYPES[input.type] ? input.type : "to_do";
  const summary = String(input.summary ?? "").trim();
  if (!summary || summary.length > 200) throw new RecordThreadError(422, "Say what is to be done (up to 200 characters).", "RECORD_THREAD_INVALID");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.dueDate ?? ""))) throw new RecordThreadError(422, "Choose the due date.", "RECORD_THREAD_INVALID");
  const assignee = input.assignedTo || context.userId;
  if (!(await activeMembers(client, context.organizationId, [assignee])).length) throw new RecordThreadError(422, "Choose an active member of the company.", "RECORD_THREAD_INVALID");
  await client.query(
    `INSERT INTO public.record_activities (organization_id, entity_type, entity_id, activity_type, summary, note, due_date, assigned_to, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9)`,
    [context.organizationId, type, String(id), activityType, summary, String(input.note ?? "").trim().slice(0, 2000) || null, input.dueDate, assignee, context.userId]);
  await notifyPeople(client, context, type, id, title, [assignee], { heading: `${ACTIVITY_TYPES[activityType]} for you`, message: `${summary} — due ${input.dueDate}` });
  return getRecordThread(client, context, type, id);
}

export async function closeRecordActivity(client, context, type, id, activityId, { outcome = "done", note = "" } = {}) {
  await requireRecord(client, context, type, id);
  const status = outcome === "cancelled" ? "cancelled" : "done";
  const updated = await client.query(
    `UPDATE public.record_activities SET status = $5, done_at = now(), done_note = $6, updated_at = now()
      WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND status = 'open' RETURNING id`,
    [context.organizationId, type, String(id), activityId, status, String(note).trim().slice(0, 2000) || null]);
  if (!updated.rowCount) throw new RecordThreadError(404, "That activity is not open.", "RECORD_THREAD_ACTIVITY");
  return getRecordThread(client, context, type, id);
}

// Worker (daily, in the company's transaction): open activities due today or earlier that were not reminded today.
export async function remindDueRecordActivities(client, organizationId, { today = null } = {}) {
  const due = (await client.query(
    `UPDATE public.record_activities SET reminded_at = now()
      WHERE organization_id = $1 AND status = 'open'
        AND due_date <= COALESCE($2::date, (now() AT TIME ZONE COALESCE((SELECT timezone FROM public.organizations WHERE id = $1), 'Asia/Kolkata'))::date)
        AND (reminded_at IS NULL OR reminded_at::date < now()::date)
      RETURNING id, entity_type, entity_id, activity_type, summary, assigned_to, to_char(due_date, 'YYYY-MM-DD') AS due`, [organizationId, today])).rows;
  for (const activity of due) {
    const definition = RECORD_THREAD_TYPES[activity.entity_type];
    if (!definition) continue;
    await createNotification(client, {
      organizationId, userId: activity.assigned_to, category: "record_thread",
      title: `${ACTIVITY_TYPES[activity.activity_type]} due: ${activity.summary}`.slice(0, 200), message: `${definition.label} — due ${activity.due}.`,
      href: definition.href(activity.entity_id), entityType: activity.entity_type, entityId: activity.entity_id,
    });
  }
  return due.length;
}
