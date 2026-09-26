import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { MfgError, dateOrNull, has, need, nonNegative, positive, recordEvent, text, uuid } from "./common.js";

// Product definition: BOMs (multi-level, versioned, alternates) and engineering change control
// (F145-F149, F190).
//
//   BOM:  draft -> pending_approval -> active -> inactive | obsolete       (approval by a different person)
//   ECN:  draft -> submitted -> approved -> implemented                    (or rejected / cancelled)
//
// An active BOM is immutable: a change is a NEW version (revise) that goes through approval, or an
// engineering change that creates one. Work orders snapshot the BOM they were created from, so
// approving a new version never changes an order already in flight.
export function manufacturingContext(session) {
  const companyId = session.activeCompanyId || session.companyId;
  if (!companyId) throw new MfgError(400, "Select an active company before using Manufacturing.", "ACTIVE_COMPANY_REQUIRED");
  return { organizationId: session.organizationId, companyId, userId: session.userId, permissions: session.permissions || [], roleSlugs: session.roleSlugs || [] };
}

const ISSUE_METHODS = ["manual", "backflush"];
const MAX_DEPTH = 12;

async function loadBom(client, c, id, { lock = false } = {}) {
  const { rows } = await client.query(`SELECT * FROM tenant.manufacturing_boms WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(id, "BOM")]);
  if (!rows[0]) throw new MfgError(404, "BOM was not found.", "MFG_BOM_NOT_FOUND");
  return rows[0];
}
const requireStatus = (bom, ...allowed) => {
  if (!allowed.includes(bom.status)) throw new MfgError(409, `This BOM is ${bom.status}; that action needs it to be ${allowed.join(" or ")}.`, "MFG_BOM_STATE_INVALID");
};

async function activeItem(client, c, itemId, label) {
  const item = (await client.query(`SELECT id,code,name,uom_id,status FROM tenant.items WHERE organization_id=$1 AND id=$2 AND (company_id IS NULL OR company_id=$3)`, [c.organizationId, uuid(itemId, label), c.companyId])).rows[0];
  if (!item) throw new MfgError(404, `${label} was not found for the active company.`, "MFG_ITEM_NOT_FOUND");
  if (item.status !== "active") throw new MfgError(409, `${label} ${item.code} is not active.`, "MFG_ITEM_INACTIVE");
  return item;
}

function cleanComponents(list, parentItemId) {
  if (!Array.isArray(list) || !list.length) throw new MfgError(400, "A BOM needs at least one component.", "MFG_COMPONENTS_REQUIRED");
  if (list.length > 500) throw new MfgError(400, "A BOM can have at most 500 components.", "MFG_COMPONENTS_TOO_MANY");
  const seen = new Set();
  return list.map((line, index) => {
    const itemId = uuid(line.itemId, `Component ${index + 1} item`);
    if (itemId === parentItemId) throw new MfgError(409, "A product cannot be a component of itself.", "MFG_BOM_SELF_REFERENCE");
    const key = `${itemId}:${line.operationSequence || ""}`;
    if (seen.has(key)) throw new MfgError(409, "The same component appears twice for the same operation; combine the quantities.", "MFG_COMPONENT_DUPLICATE");
    seen.add(key);
    const issueMethod = line.issueMethod || "manual";
    if (!ISSUE_METHODS.includes(issueMethod)) throw new MfgError(400, "Issue method must be manual or backflush.", "MFG_ISSUE_METHOD_INVALID");
    const scrap = nonNegative(line.scrapPercent, "Scrap percent");
    if (scrap >= 100) throw new MfgError(400, "Scrap percent must be below 100.", "MFG_SCRAP_INVALID");
    return { itemId, quantity: positive(line.quantity, `Component ${index + 1} quantity`), uomId: line.uomId ? uuid(line.uomId, "Unit") : null, scrapPercent: scrap, issueMethod, warehouseId: line.warehouseId ? uuid(line.warehouseId, "Warehouse") : null, operationSequence: line.operationSequence ? Math.trunc(Number(line.operationSequence)) : null, notes: text(line.notes, 1000) || null };
  });
}

// A structure must be a tree: exploding a proposed component must never lead back to the parent.
async function assertNoCycle(client, c, parentItemId, componentItemIds) {
  const seen = new Set();
  const queue = [...componentItemIds];
  let guard = 0;
  while (queue.length) {
    const itemId = queue.shift();
    if (itemId === parentItemId) throw new MfgError(409, "This structure would contain the product inside itself (a circular BOM).", "MFG_BOM_CYCLE");
    if (seen.has(itemId) || ++guard > 5000) continue;
    seen.add(itemId);
    const children = (await client.query(
      `SELECT DISTINCT component.item_id FROM tenant.manufacturing_boms bom JOIN tenant.manufacturing_bom_components component ON component.bom_id=bom.id
        WHERE bom.organization_id=$1 AND bom.company_id=$2 AND bom.item_id=$3 AND bom.status IN ('active','pending_approval')`,
      [c.organizationId, c.companyId, itemId],
    )).rows;
    for (const child of children) queue.push(child.item_id);
  }
}

async function insertComponents(client, c, bomId, components) {
  for (const [index, line] of components.entries()) {
    await client.query(
      `INSERT INTO tenant.manufacturing_bom_components(organization_id,bom_id,line_number,item_id,quantity,uom_id,scrap_percent,issue_method,warehouse_id,operation_sequence,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.organizationId, bomId, index + 1, line.itemId, line.quantity, line.uomId, line.scrapPercent, line.issueMethod, line.warehouseId, line.operationSequence, line.notes],
    );
  }
}

export async function createBom(client, c, input = {}) {
  need(c, "manufacturing.bom.manage");
  const item = await activeItem(client, c, input.itemId, "Product");
  const code = text(input.code, 80).toUpperCase();
  if (!code) throw new MfgError(400, "A BOM code is required.", "MFG_CODE_REQUIRED");
  const components = cleanComponents(input.components, item.id);
  for (const line of components) await activeItem(client, c, line.itemId, "Component");
  await assertNoCycle(client, c, item.id, components.map((l) => l.itemId));
  const outputQuantity = positive(input.outputQuantity ?? 1, "Output quantity");
  const from = dateOrNull(input.effectiveFrom, "Effective from");
  const to = dateOrNull(input.effectiveTo, "Effective to");
  if (from && to && to < from) throw new MfgError(400, "Effective to cannot be before effective from.", "MFG_DATE_INVALID");
  const version = (await client.query(`SELECT COALESCE(max(version),0)+1 AS v FROM tenant.manufacturing_boms WHERE organization_id=$1 AND company_id=$2 AND code=$3`, [c.organizationId, c.companyId, code])).rows[0].v;
  const sameCode = (await client.query(`SELECT item_id FROM tenant.manufacturing_boms WHERE organization_id=$1 AND company_id=$2 AND code=$3 LIMIT 1`, [c.organizationId, c.companyId, code])).rows[0];
  if (sameCode && sameCode.item_id !== item.id) throw new MfgError(409, `BOM code ${code} already belongs to another product.`, "MFG_BOM_CODE_TAKEN");
  const bom = (
    await client.query(
      `INSERT INTO tenant.manufacturing_boms(organization_id,company_id,item_id,code,version,status,output_quantity,output_uom_id,effective_from,effective_to,is_default,notes,created_by,name,revision,is_alternate,alternate_priority)
       VALUES($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,false,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [c.organizationId, c.companyId, item.id, code, version, outputQuantity, input.outputUomId ? uuid(input.outputUomId, "Unit") : item.uom_id, from, to, text(input.notes, 2000) || null, c.userId, text(input.name, 200) || null, text(input.revision, 40) || "A", Boolean(input.isAlternate), Math.trunc(Number(input.alternatePriority || 0)) || 0],
    )
  ).rows[0];
  await insertComponents(client, c, bom.id, components);
  await recordEvent(client, c, "bom", bom.id, "manufacturing.bom.created", { componentCount: components.length, version });
  return bom;
}

// Only a draft can be edited in place; anything else is revised into a new version.
export async function updateDraftBom(client, c, bomId, input = {}) {
  need(c, "manufacturing.bom.manage");
  const bom = await loadBom(client, c, bomId, { lock: true });
  requireStatus(bom, "draft");
  if (input.components !== undefined) {
    const components = cleanComponents(input.components, bom.item_id);
    for (const line of components) await activeItem(client, c, line.itemId, "Component");
    await assertNoCycle(client, c, bom.item_id, components.map((l) => l.itemId));
    await client.query(`DELETE FROM tenant.manufacturing_bom_components WHERE organization_id=$1 AND bom_id=$2`, [c.organizationId, bom.id]);
    await insertComponents(client, c, bom.id, components);
  }
  const from = input.effectiveFrom === undefined ? bom.effective_from : dateOrNull(input.effectiveFrom, "Effective from");
  const to = input.effectiveTo === undefined ? bom.effective_to : dateOrNull(input.effectiveTo, "Effective to");
  if (from && to && String(to).slice(0, 10) < String(from).slice(0, 10)) throw new MfgError(400, "Effective to cannot be before effective from.", "MFG_DATE_INVALID");
  const { rows } = await client.query(
    `UPDATE tenant.manufacturing_boms SET name=$3,notes=$4,output_quantity=$5,effective_from=$6,effective_to=$7,revision=$8,is_alternate=$9,alternate_priority=$10,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, bom.id, input.name === undefined ? bom.name : text(input.name, 200) || null, input.notes === undefined ? bom.notes : text(input.notes, 2000) || null, input.outputQuantity === undefined ? bom.output_quantity : positive(input.outputQuantity, "Output quantity"), from, to, input.revision === undefined ? bom.revision : text(input.revision, 40) || bom.revision, input.isAlternate === undefined ? bom.is_alternate : Boolean(input.isAlternate), input.alternatePriority === undefined ? bom.alternate_priority : Math.trunc(Number(input.alternatePriority)) || 0],
  );
  return rows[0];
}

export async function submitBom(client, c, bomId) {
  need(c, "manufacturing.bom.manage");
  const bom = await loadBom(client, c, bomId, { lock: true });
  requireStatus(bom, "draft");
  const count = (await client.query(`SELECT count(*)::int AS n FROM tenant.manufacturing_bom_components WHERE organization_id=$1 AND bom_id=$2`, [c.organizationId, bom.id])).rows[0].n;
  if (!count) throw new MfgError(409, "A BOM with no components cannot be submitted.", "MFG_COMPONENTS_REQUIRED");
  const { rows } = await client.query(`UPDATE tenant.manufacturing_boms SET status='pending_approval',submitted_by=$3,submitted_at=now(),rejection_reason=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, bom.id, c.userId]);
  await recordEvent(client, c, "bom", bom.id, "manufacturing.bom.submitted");
  return rows[0];
}

export async function approveBom(client, c, bomId) {
  need(c, "manufacturing.bom.manage");
  const bom = await loadBom(client, c, bomId, { lock: true });
  requireStatus(bom, "pending_approval");
  // Segregation of duties: the person who defined or submitted a structure cannot approve it.
  if ([bom.created_by, bom.submitted_by].includes(c.userId) && !has(c, "manufacturing.bom.self_approve")) {
    throw new MfgError(403, "A BOM must be approved by someone other than the person who created or submitted it.", "MFG_BOM_SELF_APPROVAL");
  }
  return activate(client, c, bom);
}

async function activate(client, c, bom) {
  // One default per product; alternates coexist with it. A new default retires the previous one.
  if (!bom.is_alternate) {
    await client.query(`UPDATE tenant.manufacturing_boms SET status='inactive',is_default=false,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND status='active' AND NOT is_alternate AND id<>$4`, [c.organizationId, c.companyId, bom.item_id, bom.id]);
  }
  const { rows } = await client.query(
    `UPDATE tenant.manufacturing_boms SET status='active',is_default=$3,approved_by=$4,approved_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, bom.id, !bom.is_alternate, c.userId],
  );
  await recordEvent(client, c, "bom", bom.id, "manufacturing.bom.activated", { version: bom.version });
  return rows[0];
}

export async function rejectBom(client, c, bomId, reason) {
  need(c, "manufacturing.bom.manage");
  const bom = await loadBom(client, c, bomId, { lock: true });
  requireStatus(bom, "pending_approval");
  if (!text(reason, 1000)) throw new MfgError(400, "A reason is required to send a BOM back.", "MFG_REASON_REQUIRED");
  const { rows } = await client.query(`UPDATE tenant.manufacturing_boms SET status='draft',rejection_reason=$3,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, bom.id, text(reason, 1000)]);
  await recordEvent(client, c, "bom", bom.id, "manufacturing.bom.rejected", { reason: text(reason, 1000) });
  return rows[0];
}

export async function obsoleteBom(client, c, bomId, reason) {
  need(c, "manufacturing.bom.manage");
  const bom = await loadBom(client, c, bomId, { lock: true });
  requireStatus(bom, "active", "inactive");
  if (!text(reason, 1000)) throw new MfgError(400, "A reason is required to obsolete a BOM.", "MFG_REASON_REQUIRED");
  const open = (await client.query(`SELECT count(*)::int AS n FROM tenant.manufacturing_work_orders WHERE organization_id=$1 AND bom_id=$2 AND status IN ('planned','released','in_progress')`, [c.organizationId, bom.id])).rows[0].n;
  if (open) throw new MfgError(409, `${open} open work order(s) use this BOM; finish or cancel them first.`, "MFG_BOM_IN_USE");
  const { rows } = await client.query(`UPDATE tenant.manufacturing_boms SET status='obsolete',is_default=false,obsolete_reason=$3,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, bom.id, text(reason, 1000)]);
  await recordEvent(client, c, "bom", bom.id, "manufacturing.bom.obsoleted", { reason: text(reason, 1000) });
  return rows[0];
}

// A new version of an existing BOM, copied from it, as a draft to be edited and approved.
export async function reviseBom(client, c, bomId, input = {}) {
  need(c, "manufacturing.bom.manage");
  const source = await loadBom(client, c, bomId);
  requireStatus(source, "active", "inactive", "obsolete");
  const pendingDraft = (await client.query(`SELECT 1 FROM tenant.manufacturing_boms WHERE organization_id=$1 AND company_id=$2 AND code=$3 AND status IN ('draft','pending_approval')`, [c.organizationId, c.companyId, source.code])).rows[0];
  if (pendingDraft) throw new MfgError(409, "This BOM already has a revision in progress; finish or reject it first.", "MFG_REVISION_IN_PROGRESS");
  const version = (await client.query(`SELECT max(version)+1 AS v FROM tenant.manufacturing_boms WHERE organization_id=$1 AND company_id=$2 AND code=$3`, [c.organizationId, c.companyId, source.code])).rows[0].v;
  const revision = text(input.revision, 40) || String.fromCharCode(64 + Math.min(version, 26));
  const bom = (
    await client.query(
      `INSERT INTO tenant.manufacturing_boms(organization_id,company_id,item_id,code,version,status,output_quantity,output_uom_id,effective_from,effective_to,is_default,notes,created_by,name,revision,revision_note,supersedes_bom_id,is_alternate,alternate_priority)
       VALUES($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,false,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [c.organizationId, c.companyId, source.item_id, source.code, version, source.output_quantity, source.output_uom_id, dateOrNull(input.effectiveFrom, "Effective from"), null, source.notes, c.userId, source.name, revision, text(input.revisionNote, 1000) || null, source.id, source.is_alternate, source.alternate_priority],
    )
  ).rows[0];
  await client.query(
    `INSERT INTO tenant.manufacturing_bom_components(organization_id,bom_id,line_number,item_id,quantity,uom_id,scrap_percent,issue_method,warehouse_id,operation_sequence,notes)
     SELECT organization_id,$2,line_number,item_id,quantity,uom_id,scrap_percent,issue_method,warehouse_id,operation_sequence,notes FROM tenant.manufacturing_bom_components WHERE organization_id=$1 AND bom_id=$3`,
    [c.organizationId, bom.id, source.id],
  );
  await client.query(
    `INSERT INTO tenant.manufacturing_bom_outputs(organization_id,bom_id,item_id,output_type,quantity,cost_share_percent,warehouse_id,notes) SELECT organization_id,$2,item_id,output_type,quantity,cost_share_percent,warehouse_id,notes FROM tenant.manufacturing_bom_outputs WHERE organization_id=$1 AND bom_id=$3`,
    [c.organizationId, bom.id, source.id],
  );
  await recordEvent(client, c, "bom", bom.id, "manufacturing.bom.revised", { from: source.id, version });
  return bom;
}

export async function addComponentAlternate(client, c, componentId, input = {}) {
  need(c, "manufacturing.bom.manage");
  const component = (await client.query(`SELECT component.*,bom.status AS bom_status,bom.item_id AS parent_item_id FROM tenant.manufacturing_bom_components component JOIN tenant.manufacturing_boms bom ON bom.id=component.bom_id WHERE component.organization_id=$1 AND component.id=$2 AND bom.company_id=$3`, [c.organizationId, uuid(componentId, "Component"), c.companyId])).rows[0];
  if (!component) throw new MfgError(404, "Component was not found.", "MFG_COMPONENT_NOT_FOUND");
  if (component.bom_status !== "draft") throw new MfgError(409, "Alternates can only be changed on a draft BOM; revise it first.", "MFG_BOM_STATE_INVALID");
  const item = await activeItem(client, c, input.itemId, "Alternate item");
  if (item.id === component.item_id || item.id === component.parent_item_id) throw new MfgError(409, "An alternate must be a different item from the component and from the product.", "MFG_ALTERNATE_INVALID");
  try {
    const { rows } = await client.query(`INSERT INTO tenant.manufacturing_bom_component_alternates(organization_id,bom_component_id,item_id,ratio,priority,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [c.organizationId, component.id, item.id, positive(input.ratio ?? 1, "Ratio"), Math.trunc(Number(input.priority || 1)) || 1, text(input.notes, 500) || null, c.userId]);
    return rows[0];
  } catch (error) {
    if (error.code === "23505") throw new MfgError(409, "That alternate is already listed for this component.", "MFG_ALTERNATE_DUPLICATE");
    throw error;
  }
}

export async function removeComponentAlternate(client, c, alternateId) {
  need(c, "manufacturing.bom.manage");
  const alt = (await client.query(`SELECT alt.id,bom.status FROM tenant.manufacturing_bom_component_alternates alt JOIN tenant.manufacturing_bom_components component ON component.id=alt.bom_component_id JOIN tenant.manufacturing_boms bom ON bom.id=component.bom_id WHERE alt.organization_id=$1 AND alt.id=$2 AND bom.company_id=$3`, [c.organizationId, uuid(alternateId, "Alternate"), c.companyId])).rows[0];
  if (!alt) throw new MfgError(404, "Alternate was not found.", "MFG_ALTERNATE_NOT_FOUND");
  if (alt.status !== "draft") throw new MfgError(409, "Alternates can only be changed on a draft BOM; revise it first.", "MFG_BOM_STATE_INVALID");
  await client.query(`DELETE FROM tenant.manufacturing_bom_component_alternates WHERE organization_id=$1 AND id=$2`, [c.organizationId, alt.id]);
  return { removed: true };
}

// ---------------------------------------------------------------- reads
export async function listBoms(client, c, { status = null, itemId = null, limit = 250 } = {}) {
  need(c, "manufacturing.view");
  const values = [c.organizationId, c.companyId];
  let filter = "";
  if (status) { values.push(String(status)); filter += ` AND bom.status=$${values.length}`; }
  if (itemId) { values.push(uuid(itemId, "Product")); filter += ` AND bom.item_id=$${values.length}`; }
  values.push(Math.min(Math.max(Number(limit) || 250, 1), 500));
  const { rows } = await client.query(
    `SELECT bom.id,bom.code,bom.name,bom.version,bom.revision,bom.status,bom.is_default,bom.is_alternate,bom.alternate_priority,bom.output_quantity::text AS output_quantity,bom.effective_from,bom.effective_to,bom.created_at,bom.approved_at,
            item.code AS item_code,item.name AS item_name,(SELECT count(*)::int FROM tenant.manufacturing_bom_components x WHERE x.bom_id=bom.id) AS component_count
       FROM tenant.manufacturing_boms bom JOIN tenant.items item ON item.organization_id=bom.organization_id AND item.id=bom.item_id
      WHERE bom.organization_id=$1 AND bom.company_id=$2${filter} ORDER BY item.name,bom.code,bom.version DESC LIMIT $${values.length}`,
    values,
  );
  return rows;
}

export async function getBom(client, c, bomId) {
  need(c, "manufacturing.view");
  const bom = await loadBom(client, c, bomId);
  const item = (await client.query(`SELECT code,name FROM tenant.items WHERE organization_id=$1 AND id=$2`, [c.organizationId, bom.item_id])).rows[0];
  const components = (
    await client.query(
      `SELECT component.id,component.line_number,component.item_id,item.code AS item_code,item.name AS item_name,component.quantity::text AS quantity,component.scrap_percent::text AS scrap_percent,component.issue_method,component.operation_sequence,component.notes,
              EXISTS (SELECT 1 FROM tenant.manufacturing_boms sub WHERE sub.organization_id=component.organization_id AND sub.company_id=$3 AND sub.item_id=component.item_id AND sub.status='active' AND sub.is_default) AS has_sub_assembly,
              COALESCE((SELECT json_agg(json_build_object('id',alt.id,'itemCode',altitem.code,'itemName',altitem.name,'ratio',alt.ratio::text,'priority',alt.priority) ORDER BY alt.priority) FROM tenant.manufacturing_bom_component_alternates alt JOIN tenant.items altitem ON altitem.id=alt.item_id WHERE alt.bom_component_id=component.id),'[]'::json) AS alternates
         FROM tenant.manufacturing_bom_components component JOIN tenant.items item ON item.organization_id=component.organization_id AND item.id=component.item_id
        WHERE component.organization_id=$1 AND component.bom_id=$2 ORDER BY component.line_number`,
      [c.organizationId, bom.id, c.companyId],
    )
  ).rows;
  const versions = (await client.query(`SELECT id,version,revision,status,created_at,approved_at,revision_note FROM tenant.manufacturing_boms WHERE organization_id=$1 AND company_id=$2 AND code=$3 ORDER BY version DESC`, [c.organizationId, c.companyId, bom.code])).rows;
  const alternatesForItem = (await client.query(`SELECT id,code,version,status,alternate_priority FROM tenant.manufacturing_boms WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND id<>$4 AND status IN ('active','pending_approval','draft') ORDER BY is_alternate,alternate_priority`, [c.organizationId, c.companyId, bom.item_id, bom.id])).rows;
  const outputs = (await client.query(`SELECT o.id,o.output_type,o.quantity::text AS quantity,o.cost_share_percent::text AS cost_share_percent,item.code AS item_code,item.name AS item_name FROM tenant.manufacturing_bom_outputs o JOIN tenant.items item ON item.id=o.item_id WHERE o.organization_id=$1 AND o.bom_id=$2 ORDER BY item.name`, [c.organizationId, bom.id])).rows;
  return { ...bom, item_code: item?.code, item_name: item?.name, components, outputs, versions, otherStructures: alternatesForItem };
}

// Multi-level explosion (F146): every level's requirement, with scrap allowance, using each
// sub-assembly's default active BOM at the given date. Items with no active BOM are leaves (bought).
export async function explodeBom(client, c, { bomId = null, itemId = null, quantity = 1, asOf = null } = {}) {
  need(c, "manufacturing.view");
  const qty = positive(quantity, "Quantity");
  const day = dateOrNull(asOf, "As-of date") || new Date().toISOString().slice(0, 10);
  const root = bomId ? await loadBom(client, c, bomId) : await resolveBomForItem(client, c, uuid(itemId, "Product"), day);
  if (!root) throw new MfgError(404, "No active BOM applies to that product on that date.", "MFG_NO_ACTIVE_BOM");
  const lines = [];
  const stack = [];
  async function walk(bom, requiredOutput, level, path) {
    if (level > MAX_DEPTH) throw new MfgError(409, `The structure is deeper than ${MAX_DEPTH} levels.`, "MFG_BOM_TOO_DEEP");
    const components = (await client.query(`SELECT component.*,item.code,item.name FROM tenant.manufacturing_bom_components component JOIN tenant.items item ON item.id=component.item_id WHERE component.organization_id=$1 AND component.bom_id=$2 ORDER BY component.line_number`, [c.organizationId, bom.id])).rows;
    for (const component of components) {
      const scrapFactor = 1 / (1 - Number(component.scrap_percent) / 100);
      const required = (Number(component.quantity) * (requiredOutput / Number(bom.output_quantity))) * scrapFactor;
      if (path.includes(component.item_id)) throw new MfgError(409, `Circular structure through ${component.code}.`, "MFG_BOM_CYCLE");
      const sub = await resolveBomForItem(client, c, component.item_id, day);
      lines.push({ level, itemId: component.item_id, itemCode: component.code, itemName: component.name, requiredQuantity: String(Number(required.toFixed(6))), scrapPercent: component.scrap_percent, issueMethod: component.issue_method, isSubAssembly: Boolean(sub), bomCode: sub ? sub.code : null });
      if (sub) await walk(sub, required, level + 1, [...path, component.item_id]);
    }
  }
  stack.push(root.item_id);
  await walk(root, qty, 1, stack);
  const leaves = new Map();
  for (const line of lines.filter((l) => !l.isSubAssembly)) {
    const existing = leaves.get(line.itemId) ?? { itemId: line.itemId, itemCode: line.itemCode, itemName: line.itemName, requiredQuantity: 0 };
    existing.requiredQuantity += Number(line.requiredQuantity);
    leaves.set(line.itemId, existing);
  }
  return { bomId: root.id, bomCode: root.code, quantity: String(qty), asOf: day, lines, purchasedTotals: [...leaves.values()].map((l) => ({ ...l, requiredQuantity: String(Number(l.requiredQuantity.toFixed(6))) })) };
}

// The default active BOM for a product on a date (its effectivity window applies).
export async function resolveBomForItem(client, c, itemId, day = null) {
  const on = day || new Date().toISOString().slice(0, 10);
  const { rows } = await client.query(
    `SELECT * FROM tenant.manufacturing_boms WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND status='active' AND NOT is_alternate
        AND (effective_from IS NULL OR effective_from<=$4::date) AND (effective_to IS NULL OR effective_to>=$4::date) ORDER BY version DESC LIMIT 1`,
    [c.organizationId, c.companyId, itemId, on],
  );
  return rows[0] ?? null;
}

// Where used (F146): every product whose active structure contains the item, directly or through
// sub-assemblies.
export async function whereUsed(client, c, { itemId } = {}) {
  need(c, "manufacturing.view");
  const target = uuid(itemId, "Item");
  const result = [];
  const seen = new Set([target]);
  let frontier = [{ id: target, level: 0 }];
  while (frontier.length && result.length < 500) {
    const next = [];
    for (const node of frontier) {
      const parents = (
        await client.query(
          `SELECT DISTINCT bom.id AS bom_id,bom.code,bom.item_id,item.code AS item_code,item.name AS item_name,component.quantity::text AS quantity
             FROM tenant.manufacturing_bom_components component JOIN tenant.manufacturing_boms bom ON bom.id=component.bom_id JOIN tenant.items item ON item.id=bom.item_id
            WHERE component.organization_id=$1 AND bom.company_id=$2 AND component.item_id=$3 AND bom.status='active'`,
          [c.organizationId, c.companyId, node.id],
        )
      ).rows;
      for (const parent of parents) {
        result.push({ level: node.level + 1, bomId: parent.bom_id, bomCode: parent.code, itemCode: parent.item_code, itemName: parent.item_name, quantityPer: parent.quantity });
        if (!seen.has(parent.item_id)) { seen.add(parent.item_id); next.push({ id: parent.item_id, level: node.level + 1 }); }
      }
    }
    frontier = next;
  }
  return result;
}

// ---------------------------------------------------------------- engineering change (F190)
async function loadChange(client, c, id, { lock = false } = {}) {
  const { rows } = await client.query(`SELECT * FROM tenant.manufacturing_engineering_changes WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(id, "Change")]);
  if (!rows[0]) throw new MfgError(404, "Engineering change was not found.", "MFG_CHANGE_NOT_FOUND");
  return rows[0];
}
const requireChangeStatus = (change, ...allowed) => {
  if (!allowed.includes(change.status)) throw new MfgError(409, `This change is ${change.status}; that action needs it to be ${allowed.join(" or ")}.`, "MFG_CHANGE_STATE_INVALID");
};

export async function createEngineeringChange(client, c, input = {}) {
  need(c, "manufacturing.bom.manage");
  const target = await loadBom(client, c, input.targetBomId);
  requireStatus(target, "active");
  if (!text(input.title, 200)) throw new MfgError(400, "A change needs a title.", "MFG_TITLE_REQUIRED");
  if (!text(input.reason, 2000)) throw new MfgError(400, "State why the change is needed.", "MFG_REASON_REQUIRED");
  const components = cleanComponents(input.components, target.item_id);
  for (const line of components) await activeItem(client, c, line.itemId, "Component");
  await assertNoCycle(client, c, target.item_id, components.map((l) => l.itemId));
  const number = await nextDocumentNumber(client, c, { documentType: "manufacturing_engineering_change", prefix: "ECN" });
  const { rows } = await client.query(
    `INSERT INTO tenant.manufacturing_engineering_changes(organization_id,company_id,change_number,title,reason,target_bom_id,proposed_components,effective_from,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING *`,
    [c.organizationId, c.companyId, number, text(input.title, 200), text(input.reason, 2000), target.id, JSON.stringify(components), dateOrNull(input.effectiveFrom, "Effective from"), c.userId],
  );
  await recordEvent(client, c, "engineering_change", rows[0].id, "manufacturing.change.created");
  return rows[0];
}

export async function submitEngineeringChange(client, c, id) {
  need(c, "manufacturing.bom.manage");
  const change = await loadChange(client, c, id, { lock: true });
  requireChangeStatus(change, "draft");
  const { rows } = await client.query(`UPDATE tenant.manufacturing_engineering_changes SET status='submitted',submitted_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, change.id]);
  return rows[0];
}

export async function decideEngineeringChange(client, c, id, { approve, note } = {}) {
  need(c, "manufacturing.manage");
  const change = await loadChange(client, c, id, { lock: true });
  requireChangeStatus(change, "submitted");
  if (change.requested_by === c.userId && !has(c, "manufacturing.bom.self_approve")) throw new MfgError(403, "An engineering change must be decided by someone other than its requester.", "MFG_CHANGE_SELF_APPROVAL");
  if (!approve && !text(note, 1000)) throw new MfgError(400, "A reason is required to reject a change.", "MFG_REASON_REQUIRED");
  const { rows } = await client.query(`UPDATE tenant.manufacturing_engineering_changes SET status=$3,decided_by=$4,decided_at=now(),decision_note=$5,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, change.id, approve ? "approved" : "rejected", c.userId, text(note, 1000) || null]);
  await recordEvent(client, c, "engineering_change", change.id, approve ? "manufacturing.change.approved" : "manufacturing.change.rejected");
  return rows[0];
}

// Implementing an approved change creates the new BOM version from the proposal and activates it
// (the approval already happened at the change), retiring the version it supersedes. Open work
// orders keep the BOM they were created from.
export async function implementEngineeringChange(client, c, id) {
  need(c, "manufacturing.bom.manage");
  const change = await loadChange(client, c, id, { lock: true });
  requireChangeStatus(change, "approved");
  const target = await loadBom(client, c, change.target_bom_id, { lock: true });
  const version = (await client.query(`SELECT max(version)+1 AS v FROM tenant.manufacturing_boms WHERE organization_id=$1 AND company_id=$2 AND code=$3`, [c.organizationId, c.companyId, target.code])).rows[0].v;
  const bom = (
    await client.query(
      `INSERT INTO tenant.manufacturing_boms(organization_id,company_id,item_id,code,version,status,output_quantity,output_uom_id,effective_from,is_default,notes,created_by,name,revision,revision_note,supersedes_bom_id,is_alternate,alternate_priority)
       VALUES($1,$2,$3,$4,$5,'draft',$6,$7,$8,false,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [c.organizationId, c.companyId, target.item_id, target.code, version, target.output_quantity, target.output_uom_id, change.effective_from, target.notes, change.requested_by, target.name, String.fromCharCode(64 + Math.min(version, 26)), `${change.change_number}: ${change.title}`, target.id, target.is_alternate, target.alternate_priority],
    )
  ).rows[0];
  await insertComponents(client, c, bom.id, change.proposed_components);
  await client.query(
    `INSERT INTO tenant.manufacturing_bom_outputs(organization_id,bom_id,item_id,output_type,quantity,cost_share_percent,warehouse_id,notes) SELECT organization_id,$2,item_id,output_type,quantity,cost_share_percent,warehouse_id,notes FROM tenant.manufacturing_bom_outputs WHERE organization_id=$1 AND bom_id=$3`,
    [c.organizationId, bom.id, target.id],
  );
  const activated = await activate(client, c, bom);
  await client.query(`UPDATE tenant.manufacturing_engineering_changes SET status='implemented',implemented_at=now(),resulting_bom_id=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, change.id, activated.id]);
  await recordEvent(client, c, "engineering_change", change.id, "manufacturing.change.implemented", { bomId: activated.id, version });
  return { changeId: change.id, bom: activated };
}

export async function cancelEngineeringChange(client, c, id, reason) {
  need(c, "manufacturing.bom.manage");
  const change = await loadChange(client, c, id, { lock: true });
  requireChangeStatus(change, "draft", "submitted", "approved");
  if (!text(reason, 1000)) throw new MfgError(400, "A reason is required to cancel a change.", "MFG_REASON_REQUIRED");
  const { rows } = await client.query(`UPDATE tenant.manufacturing_engineering_changes SET status='cancelled',decision_note=$3,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, change.id, text(reason, 1000)]);
  return rows[0];
}

export async function listEngineeringChanges(client, c, { status = null } = {}) {
  need(c, "manufacturing.view");
  const values = [c.organizationId, c.companyId];
  let filter = "";
  if (status) { values.push(String(status)); filter = ` AND change.status=$${values.length}`; }
  const { rows } = await client.query(
    `SELECT change.id,change.change_number,change.title,change.reason,change.status,change.effective_from,change.created_at,change.decision_note,bom.code AS bom_code,bom.version AS bom_version,item.name AS item_name,item.code AS item_code,
            jsonb_array_length(change.proposed_components) AS component_count,change.resulting_bom_id
       FROM tenant.manufacturing_engineering_changes change JOIN tenant.manufacturing_boms bom ON bom.id=change.target_bom_id JOIN tenant.items item ON item.id=bom.item_id
      WHERE change.organization_id=$1 AND change.company_id=$2${filter} ORDER BY change.created_at DESC LIMIT 250`,
    values,
  );
  return rows;
}

// By-products and co-products (F174): extra outputs received with the main product, per one BOM output.
export async function addBomOutput(client, c, bomId, input = {}) {
  need(c, "manufacturing.bom.manage");
  const bom = await loadBom(client, c, bomId, { lock: true });
  requireStatus(bom, "draft");
  const item = await activeItem(client, c, input.itemId, "Output item");
  if (item.id === bom.item_id) throw new MfgError(409, "The main product is not a by-product of itself.", "MFG_OUTPUT_INVALID");
  const type = input.outputType === "co_product" ? "co_product" : "by_product";
  const share = nonNegative(input.costSharePercent, "Cost share");
  if (share >= 100) throw new MfgError(400, "Cost share must be below 100 percent.", "MFG_COST_SHARE_INVALID");
  const total = Number((await client.query(`SELECT COALESCE(sum(cost_share_percent),0) AS s FROM tenant.manufacturing_bom_outputs WHERE organization_id=$1 AND bom_id=$2 AND item_id<>$3`, [c.organizationId, bom.id, item.id])).rows[0].s) + share;
  if (total >= 100) throw new MfgError(400, "The cost shares of all by-products must add up to less than 100 percent.", "MFG_COST_SHARE_INVALID");
  const { rows } = await client.query(
    `INSERT INTO tenant.manufacturing_bom_outputs(organization_id,bom_id,item_id,output_type,quantity,cost_share_percent,warehouse_id,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (bom_id,item_id) DO UPDATE SET output_type=EXCLUDED.output_type,quantity=EXCLUDED.quantity,cost_share_percent=EXCLUDED.cost_share_percent,warehouse_id=EXCLUDED.warehouse_id,notes=EXCLUDED.notes RETURNING *`,
    [c.organizationId, bom.id, item.id, type, positive(input.quantity, "Quantity"), share, input.warehouseId ? uuid(input.warehouseId, "Warehouse") : null, text(input.notes, 500) || null],
  );
  return rows[0];
}

export async function removeBomOutput(client, c, outputId) {
  need(c, "manufacturing.bom.manage");
  const out = (await client.query(`SELECT o.id,bom.status FROM tenant.manufacturing_bom_outputs o JOIN tenant.manufacturing_boms bom ON bom.id=o.bom_id WHERE o.organization_id=$1 AND o.id=$2 AND bom.company_id=$3`, [c.organizationId, uuid(outputId, "Output"), c.companyId])).rows[0];
  if (!out) throw new MfgError(404, "Output was not found.", "MFG_OUTPUT_NOT_FOUND");
  if (out.status !== "draft") throw new MfgError(409, "Outputs can only be changed on a draft BOM; revise it first.", "MFG_BOM_STATE_INVALID");
  await client.query(`DELETE FROM tenant.manufacturing_bom_outputs WHERE organization_id=$1 AND id=$2`, [c.organizationId, out.id]);
  return { removed: true };
}
