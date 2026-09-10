// F009 — the Opportunity commercial record's child entities that had real
// schema (since the very first CRM migrations) but no write path anywhere:
// line items/products, the deal team (as a standalone concept, not only a
// side effect of revenue-split configuration) and competitor linkage. Every
// function here scopes through the parent Opportunity's own company/branch/
// owner record scope (requireOpportunityInScope) since none of these child
// tables carry their own company_id/branch_id column.
import {
  CrmError,
  queueOutboxEvent,
  text,
  number,
  camelize,
  requireOpportunityInScope,
} from "./shared.js";

// ---------------------------------------------------------------------------
// Opportunity items / products
// ---------------------------------------------------------------------------

export async function listOpportunityItems(client, context, opportunityId) {
  await requireOpportunityInScope(client, context, opportunityId, { lock: false });
  const result = await client.query(
    `SELECT oi.*,i.name AS item_name,i.code AS item_code,i.item_type
       FROM tenant.crm_opportunity_items oi
       JOIN tenant.items i ON i.organization_id=oi.organization_id AND i.id=oi.item_id
      WHERE oi.organization_id=$1 AND oi.opportunity_id=$2
      ORDER BY oi.created_at`,
    [context.organizationId, opportunityId],
  );
  return result.rows.map(camelize);
}

function validateItemInput(input, { create = false } = {}) {
  const errors = {};
  const itemId = text(input.itemId);
  if (create && !itemId) errors.itemId = ["Select a product or service."];
  const quantity = number(input.quantity, create ? 1 : undefined);
  if (create || Object.prototype.hasOwnProperty.call(input, "quantity")) {
    if (!(quantity > 0)) errors.quantity = ["Quantity must be greater than zero."];
  }
  const discountPercent = number(input.discountPercent, 0);
  if (discountPercent < 0 || discountPercent > 100)
    errors.discountPercent = ["Discount must be between 0 and 100."];
  const taxPercent = number(input.taxPercent, 0);
  if (taxPercent < 0 || taxPercent > 100)
    errors.taxPercent = ["Tax must be between 0 and 100."];
  if (Object.keys(errors).length)
    throw new CrmError(400, "Review the product line and try again.", "CRM_OPPORTUNITY_ITEM_INVALID", { errors });
  return { itemId, quantity, discountPercent, taxPercent };
}

export async function addOpportunityItem(client, context, opportunityId, input = {}) {
  const opportunity = await requireOpportunityInScope(client, context, opportunityId);
  if (opportunity.status !== "open")
    throw new CrmError(409, "Products can only be changed on an open Opportunity.", "CRM_OPPORTUNITY_ITEM_LOCKED");
  const { itemId, quantity, discountPercent, taxPercent } = validateItemInput(input, { create: true });
  const itemResult = await client.query(
    `SELECT id,sales_price FROM tenant.items WHERE organization_id=$1 AND id=$2 AND status='active'`,
    [context.organizationId, itemId],
  );
  if (!itemResult.rows[0])
    throw new CrmError(404, "That product or service is not available.", "CRM_OPPORTUNITY_ITEM_NOT_FOUND");
  const priceListId = text(input.priceListId) || null;
  const unitPrice = Object.prototype.hasOwnProperty.call(input, "unitPrice")
    ? Math.max(0, number(input.unitPrice, 0))
    : Number(itemResult.rows[0].sales_price || 0);
  const description = text(input.description) || null;
  const result = await client.query(
    `INSERT INTO tenant.crm_opportunity_items
       (organization_id,opportunity_id,item_id,price_list_id,description,quantity,unit_price,discount_percent,tax_percent,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
    [context.organizationId, opportunityId, itemId, priceListId, description, quantity, unitPrice, discountPercent, taxPercent, context.userId],
  );
  await queueOutboxEvent(client, context, "crm.opportunity_item.added", "opportunity", opportunityId, {
    opportunityItemId: result.rows[0].id, itemId, quantity, unitPrice,
  });
  return camelize(result.rows[0]);
}

export async function updateOpportunityItem(client, context, opportunityId, itemRowId, input = {}) {
  const opportunity = await requireOpportunityInScope(client, context, opportunityId);
  if (opportunity.status !== "open")
    throw new CrmError(409, "Products can only be changed on an open Opportunity.", "CRM_OPPORTUNITY_ITEM_LOCKED");
  const { quantity, discountPercent, taxPercent } = validateItemInput(input, { create: false });
  const sets = ["updated_by=$3", "updated_at=now()"];
  const values = [context.organizationId, itemRowId, context.userId];
  if (Object.prototype.hasOwnProperty.call(input, "quantity")) { values.push(quantity); sets.push(`quantity=$${values.length}`); }
  if (Object.prototype.hasOwnProperty.call(input, "unitPrice")) { values.push(Math.max(0, number(input.unitPrice, 0))); sets.push(`unit_price=$${values.length}`); }
  if (Object.prototype.hasOwnProperty.call(input, "discountPercent")) { values.push(discountPercent); sets.push(`discount_percent=$${values.length}`); }
  if (Object.prototype.hasOwnProperty.call(input, "taxPercent")) { values.push(taxPercent); sets.push(`tax_percent=$${values.length}`); }
  if (Object.prototype.hasOwnProperty.call(input, "description")) { values.push(text(input.description) || null); sets.push(`description=$${values.length}`); }
  const result = await client.query(
    `UPDATE tenant.crm_opportunity_items SET ${sets.join(",")} WHERE organization_id=$1 AND id=$2 AND opportunity_id=$${values.push(opportunityId)} RETURNING *`,
    values,
  );
  if (!result.rows[0]) throw new CrmError(404, "Opportunity line item not found.", "CRM_OPPORTUNITY_ITEM_NOT_FOUND");
  await queueOutboxEvent(client, context, "crm.opportunity_item.updated", "opportunity", opportunityId, { opportunityItemId: itemRowId });
  return camelize(result.rows[0]);
}

export async function removeOpportunityItem(client, context, opportunityId, itemRowId) {
  const opportunity = await requireOpportunityInScope(client, context, opportunityId);
  if (opportunity.status !== "open")
    throw new CrmError(409, "Products can only be changed on an open Opportunity.", "CRM_OPPORTUNITY_ITEM_LOCKED");
  const result = await client.query(
    `DELETE FROM tenant.crm_opportunity_items WHERE organization_id=$1 AND id=$2 AND opportunity_id=$3 RETURNING id`,
    [context.organizationId, itemRowId, opportunityId],
  );
  if (!result.rows[0]) throw new CrmError(404, "Opportunity line item not found.", "CRM_OPPORTUNITY_ITEM_NOT_FOUND");
  await queueOutboxEvent(client, context, "crm.opportunity_item.removed", "opportunity", opportunityId, { opportunityItemId: itemRowId });
  return { removed: true };
}

// ---------------------------------------------------------------------------
// Opportunity team (standalone — independent of revenue-split configuration)
// ---------------------------------------------------------------------------

const TEAM_ACCESS_LEVELS = new Set(["view", "edit", "manager"]);

export async function listOpportunityTeamMembers(client, context, opportunityId) {
  await requireOpportunityInScope(client, context, opportunityId, { lock: false });
  const result = await client.query(
    `SELECT tm.*,u.full_name,u.email
       FROM tenant.crm_opportunity_team_members tm
       JOIN public.users u ON u.id=tm.user_id
      WHERE tm.organization_id=$1 AND tm.opportunity_id=$2
      ORDER BY u.full_name`,
    [context.organizationId, opportunityId],
  );
  return result.rows.map(camelize);
}

export async function addOpportunityTeamMember(client, context, opportunityId, input = {}) {
  await requireOpportunityInScope(client, context, opportunityId);
  const userId = text(input.userId);
  if (!userId) throw new CrmError(400, "Choose a team member.", "CRM_OPPORTUNITY_TEAM_USER_REQUIRED");
  const accessLevel = TEAM_ACCESS_LEVELS.has(text(input.accessLevel)) ? text(input.accessLevel) : "view";
  const teamRole = text(input.teamRole) || "contributor";
  const userResult = await client.query(
    `SELECT 1 FROM public.organization_memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'`,
    [context.organizationId, userId],
  );
  if (!userResult.rows[0])
    throw new CrmError(404, "That user is not an active member of this organization.", "CRM_OPPORTUNITY_TEAM_USER_NOT_FOUND");
  const result = await client.query(
    `INSERT INTO tenant.crm_opportunity_team_members
       (organization_id,opportunity_id,user_id,team_role,access_level,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$6)
     ON CONFLICT (organization_id,opportunity_id,user_id)
     DO UPDATE SET team_role=EXCLUDED.team_role,access_level=EXCLUDED.access_level,updated_by=EXCLUDED.updated_by,updated_at=now()
     RETURNING *`,
    [context.organizationId, opportunityId, userId, teamRole, accessLevel, context.userId],
  );
  await queueOutboxEvent(client, context, "crm.opportunity_team.member_added", "opportunity", opportunityId, {
    userId, teamRole, accessLevel,
  });
  return camelize(result.rows[0]);
}

export async function removeOpportunityTeamMember(client, context, opportunityId, teamMemberId) {
  await requireOpportunityInScope(client, context, opportunityId);
  const result = await client.query(
    `DELETE FROM tenant.crm_opportunity_team_members WHERE organization_id=$1 AND id=$2 AND opportunity_id=$3 RETURNING user_id`,
    [context.organizationId, teamMemberId, opportunityId],
  );
  if (!result.rows[0]) throw new CrmError(404, "Team member not found.", "CRM_OPPORTUNITY_TEAM_MEMBER_NOT_FOUND");
  // Revenue splits are meaningless once their team-member row is gone.
  await client.query(
    `DELETE FROM tenant.crm_opportunity_revenue_splits WHERE organization_id=$1 AND team_member_id=$2`,
    [context.organizationId, teamMemberId],
  );
  await queueOutboxEvent(client, context, "crm.opportunity_team.member_removed", "opportunity", opportunityId, {
    userId: result.rows[0].user_id,
  });
  return { removed: true };
}

// ---------------------------------------------------------------------------
// Opportunity competitors (linking crm_competitors to a specific deal)
// ---------------------------------------------------------------------------

export async function listOpportunityCompetitors(client, context, opportunityId) {
  await requireOpportunityInScope(client, context, opportunityId, { lock: false });
  const result = await client.query(
    `SELECT oc.opportunity_id,oc.competitor_id,oc.is_primary,oc.notes,oc.created_at,
            c.name,c.website,c.strengths,c.weaknesses
       FROM tenant.crm_opportunity_competitors oc
       JOIN tenant.crm_competitors c ON c.organization_id=oc.organization_id AND c.id=oc.competitor_id
      WHERE oc.organization_id=$1 AND oc.opportunity_id=$2
      ORDER BY oc.is_primary DESC, c.name`,
    [context.organizationId, opportunityId],
  );
  return result.rows.map(camelize);
}

export async function addOpportunityCompetitor(client, context, opportunityId, input = {}) {
  await requireOpportunityInScope(client, context, opportunityId);
  const competitorId = text(input.competitorId);
  if (!competitorId) throw new CrmError(400, "Choose a competitor.", "CRM_OPPORTUNITY_COMPETITOR_REQUIRED");
  const competitorResult = await client.query(
    `SELECT id FROM tenant.crm_competitors WHERE organization_id=$1 AND id=$2 AND status='active'`,
    [context.organizationId, competitorId],
  );
  if (!competitorResult.rows[0])
    throw new CrmError(404, "That competitor is not available.", "CRM_OPPORTUNITY_COMPETITOR_NOT_FOUND");
  const isPrimary = Boolean(input.isPrimary);
  const notes = text(input.notes) || null;
  if (isPrimary) {
    await client.query(
      `UPDATE tenant.crm_opportunity_competitors SET is_primary=false WHERE organization_id=$1 AND opportunity_id=$2`,
      [context.organizationId, opportunityId],
    );
  }
  const result = await client.query(
    `INSERT INTO tenant.crm_opportunity_competitors
       (organization_id,opportunity_id,competitor_id,is_primary,notes,created_by)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT (organization_id,opportunity_id,competitor_id)
     DO UPDATE SET is_primary=EXCLUDED.is_primary,notes=EXCLUDED.notes
     RETURNING *`,
    [context.organizationId, opportunityId, competitorId, isPrimary, notes, context.userId],
  );
  await queueOutboxEvent(client, context, "crm.opportunity_competitor.added", "opportunity", opportunityId, {
    competitorId, isPrimary,
  });
  return camelize(result.rows[0]);
}

export async function removeOpportunityCompetitor(client, context, opportunityId, competitorId) {
  await requireOpportunityInScope(client, context, opportunityId);
  const result = await client.query(
    `DELETE FROM tenant.crm_opportunity_competitors WHERE organization_id=$1 AND opportunity_id=$2 AND competitor_id=$3 RETURNING competitor_id`,
    [context.organizationId, opportunityId, competitorId],
  );
  if (!result.rows[0]) throw new CrmError(404, "That competitor is not linked to this Opportunity.", "CRM_OPPORTUNITY_COMPETITOR_NOT_LINKED");
  await queueOutboxEvent(client, context, "crm.opportunity_competitor.removed", "opportunity", opportunityId, { competitorId });
  return { removed: true };
}
