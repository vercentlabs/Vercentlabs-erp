import { ProcurementError } from "./index.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid=(value,label)=>{if(!UUID.test(String(value||"")))throw new ProcurementError(400,`${label} is invalid.`);return String(value)};
const has=(c,p)=>c.roleSlugs?.includes("organization_owner")||c.permissions?.includes(p);
const need=(c,p)=>{if(!has(c,p))throw new ProcurementError(403,"You do not have permission to perform this Procurement operation.");};
function companyWhere(c,values,alias="record"){if(c.activeCompanyId){values.push(c.activeCompanyId);return ` AND (${alias}.company_id IS NULL OR ${alias}.company_id=$${values.length})`;}return c.allowAllCompanies?"":" AND false";}
async function supplier(client,c,id){const values=[c.organizationId,uuid(id,"Supplier")];const r=await client.query(`SELECT * FROM tenant.procurement_suppliers record WHERE organization_id=$1 AND id=$2${companyWhere(c,values)} AND status NOT IN ('archived','rejected') LIMIT 1`,values);if(!r.rows[0])throw new ProcurementError(404,"Supplier not found.");return r.rows[0];}
export async function listProcurementPass1Operations(client,c,{kind="invoice-matches",limit=100}={}){
  need(c,"procurement.view");
  const tables={"invoice-matches":"procurement_invoice_matches"};
  const table=tables[kind];if(!table)throw new ProcurementError(404,"Unknown Procurement operation resource.");
  const values=[c.organizationId];const scope=companyWhere(c,values,"record");
  const {rows}=await client.query(`SELECT * FROM tenant.${table} record WHERE record.organization_id=$1${scope} ORDER BY record.created_at DESC LIMIT $${values.length+1}`,[...values,Math.min(Math.max(Number(limit)||100,1),250)]);return rows;
}

export async function listProcurementPass1Options(client,c){
  need(c,"procurement.view");
  const values=[c.organizationId];const scope=companyWhere(c,values,"record");
  // Sequential, not Promise.all — concurrent client.query() on one shared
  // PoolClient can interleave extended-query protocol messages (observed
  // live in CRM as Postgres 08P01 "bind message supplies N parameters...");
  // see services/api/src/modules/crm/opportunity-and-pipeline-governance/
  // opportunity-revenue-intelligence.js's fix for the full explanation.
  const suppliers=await client.query(`SELECT record.id,COALESCE(record.data->>'displayName',record.data->>'legalName',record.data->>'supplierCode',record.id::text) AS label,record.status FROM tenant.procurement_suppliers record WHERE record.organization_id=$1${scope} AND record.status NOT IN ('archived','rejected') ORDER BY record.updated_at DESC LIMIT 1000`,values);
  const orders=await client.query(`SELECT record.id,COALESCE(record.data->>'purchaseOrderNumber',record.data->>'poNumber',record.data->>'number',record.id::text) AS label,record.status,record.company_id FROM tenant.procurement_purchase_orders record WHERE record.organization_id=$1${scope} ORDER BY record.updated_at DESC LIMIT 1000`,values);
  const receipts=await client.query(`SELECT record.id,COALESCE(record.data->>'receiptNumber',record.data->>'grnNumber',record.data->>'number',record.id::text) AS label,record.status,record.company_id FROM tenant.procurement_receipts record WHERE record.organization_id=$1${scope} ORDER BY record.updated_at DESC LIMIT 1000`,values);
  const items=await client.query(`SELECT id,code,name FROM tenant.items WHERE organization_id=$1 AND status='active' AND (company_id IS NULL OR company_id=$2) ORDER BY name LIMIT 1000`,[c.organizationId,c.activeCompanyId]);
  const warehouses=await client.query(`SELECT id,code,name FROM tenant.warehouses WHERE organization_id=$1 AND status='active' AND ($2::uuid IS NULL OR company_id=$2) ORDER BY name LIMIT 1000`,[c.organizationId,c.activeCompanyId]);
  const uoms=await client.query(`SELECT id,code,name FROM tenant.units_of_measure WHERE organization_id=$1 AND status='active' ORDER BY name LIMIT 200`,[c.organizationId]);
  const categories=await client.query(`SELECT record.id,COALESCE(record.data->>'name',record.data->>'code',record.id::text) AS label,record.status FROM tenant.procurement_categories record WHERE record.organization_id=$1${scope} AND record.status='active' ORDER BY label LIMIT 200`,values);
  const accountingParties=await client.query(`SELECT id,COALESCE(display_name,code) AS label FROM tenant.business_parties WHERE organization_id=$1 AND status='active' AND party_type IN ('supplier','both') AND (company_id IS NULL OR $2::uuid IS NULL OR company_id=$2) ORDER BY label LIMIT 1000`,[c.organizationId,c.activeCompanyId||null]);
  return {accountingParties:accountingParties.rows,suppliers:suppliers.rows,purchaseOrders:orders.rows,receipts:receipts.rows,items:items.rows,warehouses:warehouses.rows,uoms:uoms.rows,categories:categories.rows};
}

// Links a supplier to the Accounting business partner its invoices are booked to. A
// clean invoice match is only handed to Accounting as a vendor bill when this link
// exists. Suppliers are editable only while draft, so this is a separate, audited
// operation that works at any lifecycle stage.
export async function linkSupplierAccountingParty(client, c, input = {}) {
  need(c, "procurement.suppliers.manage");
  const target = await supplier(client, c, input.supplierId);
  const partyId = uuid(input.accountingPartyId, "Accounting party");
  const party = await client.query(`SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND id=$2 AND status='active' AND party_type IN ('supplier','both')`, [c.organizationId, partyId]);
  if (!party.rows[0]) throw new ProcurementError(404, "Active supplier party not found.", "PROCUREMENT_ACCOUNTING_PARTY_NOT_FOUND");
  const updated = await client.query(
    `UPDATE tenant.procurement_suppliers SET data=jsonb_set(data,'{accountingPartyId}',to_jsonb($3::text),true),version=version+1,updated_by=$4,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, target.id, partyId, c.userId],
  );
  await client.query(
    `INSERT INTO tenant.procurement_events(organization_id,company_id,entity_type,entity_id,event_type,payload,actor_user_id) VALUES($1,$2,'suppliers',$3,'accounting-party-linked',$4::jsonb,$5)`,
    [c.organizationId, target.company_id || null, target.id, JSON.stringify({ accountingPartyId: partyId }), c.userId],
  );
  return updated.rows[0];
}
