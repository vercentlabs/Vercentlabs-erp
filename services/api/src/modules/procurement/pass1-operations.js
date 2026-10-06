import { ProcurementError } from "./index.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid=(value,label)=>{if(!UUID.test(String(value||"")))throw new ProcurementError(400,`${label} is invalid.`);return String(value)};
const has=(c,p)=>c.roleSlugs?.includes("organization_owner")||c.permissions?.includes(p);
const need=(c,p)=>{if(!has(c,p))throw new ProcurementError(403,"You do not have permission to perform this Procurement operation.");};
export async function listProcurementPass1Operations(client,c,{kind="invoice-matches",limit=100}={}){
  need(c,"procurement.view");
  const tables={"invoice-matches":"procurement_invoice_matches"};
  const table=tables[kind];if(!table)throw new ProcurementError(404,"Unknown Procurement operation resource.");
  const {rows}=await client.query(`SELECT * FROM tenant.${table} record WHERE record.organization_id=$1 ORDER BY record.created_at DESC LIMIT $2`,[c.organizationId,Math.min(Math.max(Number(limit)||100,1),250)]);return rows;
}

export async function listProcurementPass1Options(client,c){
  need(c,"procurement.view");
  const values=[c.organizationId];
  // Sequential, not Promise.all — concurrent client.query() on one shared
  // PoolClient can interleave extended-query protocol messages (observed
  // live in CRM as Postgres 08P01 "bind message supplies N parameters...");
  // see services/api/src/modules/crm/pipeline/
  // opportunity-revenue-intelligence.js's fix for the full explanation.
  // Suppliers from the Supplier Master: every one (old documents name inactive and blocked ones too), labelled with number and city; only active ones are selectable.
  const suppliers=await client.query(`SELECT supplier.id, party.display_name || ' · ' || supplier.supplier_number || COALESCE(' · ' || location.city, '') AS label, supplier.status,
      supplier.supplier_number, party.display_name AS name, party.gstin, location.city, (supplier.status = 'active') AS selectable
    FROM tenant.procurement_suppliers supplier JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
    LEFT JOIN LATERAL (SELECT address.city FROM tenant.procurement_supplier_addresses address WHERE address.organization_id = supplier.organization_id AND address.supplier_id = supplier.id
                         AND address.status = 'active' ORDER BY address.is_primary DESC, address.created_at LIMIT 1) location ON true
   WHERE supplier.organization_id=$1 ORDER BY (supplier.status = 'active') DESC, party.display_name LIMIT 2000`,values);
  const orders=await client.query(`SELECT record.id,COALESCE(record.data->>'purchaseOrderNumber',record.data->>'poNumber',record.data->>'number',record.id::text) AS label,record.status FROM tenant.procurement_purchase_orders record WHERE record.organization_id=$1 ORDER BY record.updated_at DESC LIMIT 1000`,values);
  const receipts=await client.query(`SELECT record.id,COALESCE(record.data->>'receiptNumber',record.data->>'grnNumber',record.data->>'number',record.id::text) AS label,record.status FROM tenant.procurement_receipts record WHERE record.organization_id=$1 ORDER BY record.updated_at DESC LIMIT 1000`,values);
  const items=await client.query(`SELECT id,code,name FROM tenant.items WHERE organization_id=$1 AND status='active' AND is_purchasable ORDER BY name LIMIT 1000`,values);
  const warehouses=await client.query(`SELECT id,code,name FROM tenant.warehouses WHERE organization_id=$1 AND status='active' ORDER BY name LIMIT 1000`,values);
  const uoms=await client.query(`SELECT id,code,name FROM tenant.units_of_measure WHERE organization_id=$1 AND status='active' ORDER BY name LIMIT 200`,[c.organizationId]);
  const categories=await client.query(`SELECT record.id,COALESCE(record.data->>'name',record.data->>'code',record.id::text) AS label,record.status FROM tenant.procurement_categories record WHERE record.organization_id=$1 AND record.status='active' ORDER BY label LIMIT 200`,values);
  // Purchase payment terms, for a purchase order that does not take its supplier's default.
  const paymentTerms=await client.query(`SELECT id,code,name FROM tenant.payment_terms WHERE organization_id=$1 AND status='active' AND is_purchase_enabled ORDER BY default_due_days,name`,values);
  return {paymentTerms:paymentTerms.rows,suppliers:suppliers.rows,purchaseOrders:orders.rows,receipts:receipts.rows,items:items.rows,warehouses:warehouses.rows,uoms:uoms.rows,categories:categories.rows};
}
