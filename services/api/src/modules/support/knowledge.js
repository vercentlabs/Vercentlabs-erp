// F369-F370: the knowledge base (draft -> review -> published -> retired, with a second-person
// publish check since published articles are customer-facing) and canned responses.
import { SupportError, has, need, needAny, oneOf, qx, text, textOrNull, uuid, uuidOrNull } from "./common.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";

const MANAGE = "support.manage";
const VIEW = ["support.view", MANAGE];

// ---------------------------------------------------------------- knowledge articles (F369)
export async function listKnowledgeArticles(client, c, filters = {}) {
  const params = [c.organizationId, c.companyId];
  const where = [];
  if (filters.portal) {
    // customer/public reads: only published, customer-visible articles, no permission required
    where.push(`ka.status='published'`, `ka.visibility IN ('customer','public')`);
  } else {
    needAny(c, VIEW);
    if (filters.status) { params.push(String(filters.status)); where.push(`ka.status=$${params.length}`); }
    if (filters.visibility) { params.push(String(filters.visibility)); where.push(`ka.visibility=$${params.length}`); }
  }
  if (filters.categoryId) { params.push(uuid(filters.categoryId, "Category")); where.push(`ka.category_id=$${params.length}`); }
  if (filters.search) { params.push(`%${String(filters.search).toLowerCase()}%`); where.push(`(lower(ka.title) LIKE $${params.length} OR lower(ka.summary) LIKE $${params.length})`); }
  const { rows } = await qx(client, `SELECT ka.*, cat.name AS category_name FROM tenant.support_knowledge_articles ka LEFT JOIN tenant.support_categories cat ON cat.id=ka.category_id
    WHERE ka.organization_id=$1 AND ka.company_id=$2 ${where.length ? "AND " + where.join(" AND ") : ""} ORDER BY ka.updated_at DESC LIMIT 500`, params);
  return rows;
}
export async function getKnowledgeArticle(client, c, id, { portal = false } = {}) {
  const { rows } = await qx(client, `SELECT ka.*, cat.name AS category_name FROM tenant.support_knowledge_articles ka LEFT JOIN tenant.support_categories cat ON cat.id=ka.category_id WHERE ka.organization_id=$1 AND ka.id=$2`, [c.organizationId, uuid(id, "Article")]);
  const a = rows[0];
  if (!a) throw new SupportError(404, "Article was not found.", "SUPPORT_ARTICLE_NOT_FOUND");
  if (portal) {
    if (a.status !== "published" || !["customer", "public"].includes(a.visibility)) throw new SupportError(404, "Article was not found.", "SUPPORT_ARTICLE_NOT_FOUND");
  } else needAny(c, VIEW);
  return a;
}
export async function saveKnowledgeArticle(client, c, input) {
  need(c, "support.knowledge.manage");
  const title = text(input.title, 200);
  const content = text(input.content, 20000);
  if (!title) throw new SupportError(400, "An article needs a title.", "SUPPORT_ARTICLE_INVALID");
  if (!content) throw new SupportError(400, "An article needs content.", "SUPPORT_ARTICLE_INVALID");
  const visibility = oneOf(String(input.visibility ?? "internal"), ["internal", "customer", "public"], "Visibility");
  const tags = JSON.stringify(Array.isArray(input.tags) ? input.tags.map((t) => text(t, 40)).filter(Boolean) : []);
  if (input.id) {
    const cur = await qx(client, `SELECT * FROM tenant.support_knowledge_articles WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(input.id, "Article")]);
    if (!cur.rows[0]) throw new SupportError(404, "Article was not found.", "SUPPORT_ARTICLE_NOT_FOUND");
    if (cur.rows[0].status === "published") throw new SupportError(409, "A published article is edited through a new version (revise it, then republish), not in place.", "SUPPORT_ARTICLE_STATE");
    const { rows } = await qx(client, `UPDATE tenant.support_knowledge_articles SET title=$4,summary=$5,content=$6,category_id=$7,visibility=$8,tags=$9::jsonb,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, cur.rows[0].id, title, textOrNull(input.summary, 500), content, uuidOrNull(input.categoryId, "Category"), visibility, tags]);
    return rows[0];
  }
  const articleNumber = await nextDocumentNumber(client, c, { documentType: "support_knowledge_article", prefix: "KB" });
  const { rows } = await qx(client, `INSERT INTO tenant.support_knowledge_articles(organization_id,company_id,article_number,title,summary,content,category_id,status,visibility,version,tags,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,1,$9::jsonb,$10) RETURNING *`,
    [c.organizationId, c.companyId, articleNumber, title, textOrNull(input.summary, 500), content, uuidOrNull(input.categoryId, "Category"), visibility, tags, c.userId]);
  return rows[0];
}
export async function submitKnowledgeArticle(client, c, id) {
  need(c, "support.knowledge.manage");
  const { rows } = await qx(client, `UPDATE tenant.support_knowledge_articles SET status='review',updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='draft' RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Article")]);
  if (!rows[0]) throw new SupportError(409, "Only a draft article can be submitted for review.", "SUPPORT_ARTICLE_STATE");
  return rows[0];
}
// Published content reaches customers, so it is approved by someone other than its author (unless
// they hold support.manage, matching how other modules let a manager fast-track their own work).
export async function publishKnowledgeArticle(client, c, id, input = {}) {
  need(c, "support.knowledge.manage");
  const cur = await qx(client, `SELECT * FROM tenant.support_knowledge_articles WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Article")]);
  if (!cur.rows[0]) throw new SupportError(404, "Article was not found.", "SUPPORT_ARTICLE_NOT_FOUND");
  const a = cur.rows[0];
  if (a.status !== "review") throw new SupportError(409, "Only an article submitted for review can be published.", "SUPPORT_ARTICLE_STATE");
  if (a.created_by === c.userId && !has(c, MANAGE)) throw new SupportError(403, "You cannot publish your own article; ask someone else to review it.", "SELF_APPROVAL_BLOCKED");
  if (input.approve === false) {
    const { rows } = await qx(client, `UPDATE tenant.support_knowledge_articles SET status='draft',updated_at=now() WHERE id=$1 RETURNING *`, [a.id]);
    return rows[0];
  }
  const { rows } = await qx(client, `UPDATE tenant.support_knowledge_articles SET status='published',approved_by=$2,published_at=now(),updated_at=now() WHERE id=$1 RETURNING *`, [a.id, c.userId]);
  return rows[0];
}
export async function retireKnowledgeArticle(client, c, id, reason) {
  need(c, "support.knowledge.manage");
  if (!text(reason)) throw new SupportError(400, "Give a reason for retiring this article.", "SUPPORT_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.support_knowledge_articles SET status='retired',updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='published' RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Article")]);
  if (!rows[0]) throw new SupportError(409, "Only a published article can be retired.", "SUPPORT_ARTICLE_STATE");
  return rows[0];
}
// A new draft version of a retired/published article, so its history is kept rather than edited away.
export async function reviseKnowledgeArticle(client, c, id) {
  need(c, "support.knowledge.manage");
  const cur = await qx(client, `SELECT * FROM tenant.support_knowledge_articles WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(id, "Article")]);
  if (!cur.rows[0]) throw new SupportError(404, "Article was not found.", "SUPPORT_ARTICLE_NOT_FOUND");
  const a = cur.rows[0];
  const { rows } = await qx(client, `INSERT INTO tenant.support_knowledge_articles(organization_id,company_id,article_number,title,summary,content,category_id,status,visibility,version,tags,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10::jsonb,$11) RETURNING *`,
    [c.organizationId, c.companyId, a.article_number, a.title, a.summary, a.content, a.category_id, a.visibility, a.version + 1, JSON.stringify(a.tags ?? []), c.userId]);
  return rows[0];
}
export async function rateKnowledgeArticle(client, c, id, helpful) {
  const { rows } = await qx(client, `UPDATE tenant.support_knowledge_articles SET helpful_count=helpful_count+CASE WHEN $2 THEN 1 ELSE 0 END, not_helpful_count=not_helpful_count+CASE WHEN $2 THEN 0 ELSE 1 END WHERE organization_id=$1 AND id=$3 AND status='published' RETURNING *`, [c.organizationId, Boolean(helpful), uuid(id, "Article")]);
  if (!rows[0]) throw new SupportError(404, "Article was not found.", "SUPPORT_ARTICLE_NOT_FOUND");
  return rows[0];
}
export async function linkArticleToTicket(client, c, input) {
  need(c, "support.communication.manage");
  const { rows } = await qx(client, `INSERT INTO tenant.support_ticket_knowledge_links(organization_id,ticket_id,article_id,link_type,linked_by) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (ticket_id,article_id) DO UPDATE SET link_type=EXCLUDED.link_type,linked_by=EXCLUDED.linked_by,linked_at=now() RETURNING *`,
    [c.organizationId, uuid(input.ticketId, "Ticket"), uuid(input.articleId, "Article"), oneOf(String(input.linkType ?? "suggested"), ["suggested", "used", "resolution"], "Link type"), c.userId]);
  return rows[0];
}
export async function listTicketKnowledgeLinks(client, c, ticketId) {
  needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT l.*, a.title, a.article_number FROM tenant.support_ticket_knowledge_links l JOIN tenant.support_knowledge_articles a ON a.id=l.article_id WHERE l.organization_id=$1 AND l.ticket_id=$2 ORDER BY l.linked_at`, [c.organizationId, uuid(ticketId, "Ticket")]);
  return rows;
}

// ---------------------------------------------------------------- canned responses (F370)
export async function listCannedResponses(client, c, filters = {}) {
  needAny(c, ["support.view", "support.communication.manage", MANAGE]);
  const params = [c.organizationId, c.companyId, c.userId];
  let where = "";
  if (filters.categoryId) { params.push(uuid(filters.categoryId, "Category")); where = ` AND r.category_id=$${params.length}`; }
  const { rows } = await qx(client, `SELECT r.*, cat.name AS category_name FROM tenant.support_canned_responses r LEFT JOIN tenant.support_categories cat ON cat.id=r.category_id
    WHERE r.organization_id=$1 AND r.company_id=$2 AND r.active AND (r.shared OR r.owner_user_id=$3)${where} ORDER BY r.name`, params);
  return rows;
}
export async function saveCannedResponse(client, c, input) {
  need(c, "support.communication.manage");
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  const body = text(input.body, 4000);
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !name || !body) throw new SupportError(400, "A canned response needs a code, name and body.", "SUPPORT_CANNED_INVALID");
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.support_canned_responses SET name=$4,category_id=$5,subject=$6,body=$7,shared=$8,tags=$9::jsonb,active=$10,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Canned response"), name, uuidOrNull(input.categoryId, "Category"), textOrNull(input.subject, 200), body, input.shared !== false, JSON.stringify(Array.isArray(input.tags) ? input.tags.map((t) => text(t, 40)).filter(Boolean) : []), input.active !== false]);
    if (!rows[0]) throw new SupportError(404, "Canned response was not found.", "SUPPORT_CANNED_NOT_FOUND");
    return rows[0];
  }
  try {
    const { rows } = await qx(client, `INSERT INTO tenant.support_canned_responses(organization_id,company_id,code,name,category_id,subject,body,shared,owner_user_id,tags,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`,
      [c.organizationId, c.companyId, code, name, uuidOrNull(input.categoryId, "Category"), textOrNull(input.subject, 200), body, input.shared !== false, input.shared === false ? c.userId : null, JSON.stringify(Array.isArray(input.tags) ? input.tags.map((t) => text(t, 40)).filter(Boolean) : []), c.userId]);
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new SupportError(409, `Canned response ${code} already exists.`, "SUPPORT_CANNED_DUPLICATE");
    throw e;
  }
}
export async function recordCannedResponseUsage(client, c, id) {
  const { rows } = await qx(client, `UPDATE tenant.support_canned_responses SET usage_count=usage_count+1 WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND (shared OR owner_user_id=$4) RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Canned response"), c.userId]);
  if (!rows[0]) throw new SupportError(404, "Canned response was not found.", "SUPPORT_CANNED_NOT_FOUND");
  return rows[0];
}
