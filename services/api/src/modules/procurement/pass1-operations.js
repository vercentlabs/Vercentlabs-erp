import { ProcurementError } from "./index.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid=(value,label)=>{if(!UUID.test(String(value||"")))throw new ProcurementError(400,`${label} is invalid.`);return String(value)};
const text=(value,max=2000)=>String(value??"").trim().slice(0,max);
const positive=(value,label)=>{const n=Number(value);if(!Number.isFinite(n)||n<=0)throw new ProcurementError(400,`${label} must be greater than zero.`);return n};
const has=(c,p)=>c.roleSlugs?.includes("organization_owner")||c.permissions?.includes(p);
const need=(c,p)=>{if(!has(c,p))throw new ProcurementError(403,"You do not have permission to perform this Procurement operation.");};
function company(c,input=null){const id=input||c.activeCompanyId||null;if(!id)throw new ProcurementError(409,"Select an active company before using this Procurement workflow.");return id;}
function companyWhere(c,values,alias="record"){if(c.activeCompanyId){values.push(c.activeCompanyId);return ` AND (${alias}.company_id IS NULL OR ${alias}.company_id=$${values.length})`;}return c.allowAllCompanies?"":" AND false";}
async function supplier(client,c,id){const values=[c.organizationId,uuid(id,"Supplier")];const r=await client.query(`SELECT * FROM tenant.procurement_suppliers record WHERE organization_id=$1 AND id=$2${companyWhere(c,values)} AND status NOT IN ('archived','rejected') LIMIT 1`,values);if(!r.rows[0])throw new ProcurementError(404,"Supplier not found.");return r.rows[0];}
async function po(client,c,id){const values=[c.organizationId,uuid(id,"Purchase order")];const r=await client.query(`SELECT * FROM tenant.procurement_purchase_orders record WHERE organization_id=$1 AND id=$2${companyWhere(c,values)} LIMIT 1`,values);if(!r.rows[0])throw new ProcurementError(404,"Purchase order not found.");return r.rows[0];}
async function receipt(client,c,id){const values=[c.organizationId,uuid(id,"Receipt")];const r=await client.query(`SELECT * FROM tenant.procurement_receipts record WHERE organization_id=$1 AND id=$2${companyWhere(c,values)} LIMIT 1`,values);if(!r.rows[0])throw new ProcurementError(404,"Receipt not found.");return r.rows[0];}
async function activeItem(client,c,id,{companyId=null,label="Item"}={}){
  const itemId=uuid(id,label);
  const values=[c.organizationId,itemId];
  let scope="";
  const effectiveCompanyId=companyId||c.activeCompanyId||null;
  if(effectiveCompanyId){values.push(effectiveCompanyId);scope=` AND (company_id IS NULL OR company_id=$${values.length})`;}
  else if(!c.allowAllCompanies)scope=" AND false";
  const r=await client.query(`SELECT id,company_id,uom_id FROM tenant.items WHERE organization_id=$1 AND id=$2 AND status='active'${scope} LIMIT 1`,values);
  if(!r.rows[0])throw new ProcurementError(404,`${label} was not found in the current Procurement company context.`,"PROCUREMENT_ITEM_NOT_FOUND");
  return r.rows[0];
}

export async function listProcurementPass1Operations(client,c,{kind="landed-costs",limit=100}={}){
  need(c,"procurement.view");
  const tables={"supplier-prices":"procurement_supplier_prices","landed-costs":"procurement_landed_costs","supplier-lead-times":"procurement_supplier_lead_times","reorder-requests":"procurement_reorder_requests","subcontract-orders":"procurement_subcontract_orders","sourcing-invitations":"procurement_sourcing_invitations","sourcing-bids":"procurement_sourcing_bids","sourcing-evaluations":"procurement_sourcing_evaluations","supplier-scorecards":"procurement_supplier_scorecards","returns":"procurement_returns","invoice-matches":"procurement_invoice_matches"};
  const table=tables[kind];if(!table)throw new ProcurementError(404,"Unknown Procurement operation resource.");
  const values=[c.organizationId];const scope=companyWhere(c,values,"record");
  const {rows}=await client.query(`SELECT * FROM tenant.${table} record WHERE record.organization_id=$1${scope} ORDER BY record.created_at DESC LIMIT $${values.length+1}`,[...values,Math.min(Math.max(Number(limit)||100,1),250)]);return rows;
}

export async function upsertSupplierPurchasePrice(client,c,input={}){
  need(c,"procurement.catalog.manage");
  const s=await supplier(client,c,input.supplierId);
  const itemId=uuid(input.itemId,"Item");
  const item=await client.query(`SELECT id,company_id,uom_id FROM tenant.items WHERE organization_id=$1 AND id=$2 AND status='active'`,[c.organizationId,itemId]);
  if(!item.rows[0])throw new ProcurementError(404,"Active item not found.","PROCUREMENT_SUPPLIER_PRICE_ITEM_NOT_FOUND");
  const companyId=s.company_id||company(c,input.companyId);
  if(item.rows[0].company_id&&item.rows[0].company_id!==companyId)throw new ProcurementError(409,"Supplier and item belong to different companies.","PROCUREMENT_SUPPLIER_PRICE_COMPANY_MISMATCH");
  const uomId=input.uomId?uuid(input.uomId,"UOM"):null;
  if(uomId){const u=await client.query(`SELECT id FROM tenant.units_of_measure WHERE organization_id=$1 AND id=$2 AND status='active'`,[c.organizationId,uomId]);if(!u.rows[0])throw new ProcurementError(409,"Selected UOM is not active.","PROCUREMENT_SUPPLIER_PRICE_UOM_INVALID");}
  const minimumQuantity=positive(input.minimumQuantity??1,"Minimum quantity");
  const rate=Number(input.rate);if(!Number.isFinite(rate)||rate<0)throw new ProcurementError(400,"Supplier rate cannot be negative.","PROCUREMENT_SUPPLIER_PRICE_RATE_INVALID");
  const currency=String(input.currencyCode||"INR").trim().toUpperCase();if(!/^[A-Z]{3}$/.test(currency))throw new ProcurementError(400,"Currency must be a three-letter code.","PROCUREMENT_SUPPLIER_PRICE_CURRENCY_INVALID");
  const validFrom=input.validFrom||new Date().toISOString().slice(0,10),validTo=input.validTo||null;if(validTo&&String(validFrom)>String(validTo))throw new ProcurementError(400,"Valid-from date cannot be after valid-to date.","PROCUREMENT_SUPPLIER_PRICE_DATE_INVALID");
  const existing=await client.query(`SELECT id FROM tenant.procurement_supplier_prices WHERE organization_id=$1 AND supplier_id=$2 AND item_id=$3 AND uom_id IS NOT DISTINCT FROM $4 AND minimum_quantity=$5 AND valid_from=$6::date LIMIT 1 FOR UPDATE`,[c.organizationId,s.id,itemId,uomId,minimumQuantity,validFrom]);
  if(existing.rows[0]){const r=await client.query(`UPDATE tenant.procurement_supplier_prices SET company_id=$3,rate=$4,currency_code=$5,valid_to=$6,status='active',updated_by=$7,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,[c.organizationId,existing.rows[0].id,companyId,rate,currency,validTo,c.userId]);return r.rows[0];}
  const r=await client.query(`INSERT INTO tenant.procurement_supplier_prices(organization_id,company_id,supplier_id,item_id,uom_id,minimum_quantity,rate,currency_code,valid_from,valid_to,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$11) RETURNING *`,[c.organizationId,companyId,s.id,itemId,uomId,minimumQuantity,rate,currency,validFrom,validTo,c.userId]);return r.rows[0];
}

export async function createProcurementLandedCost(client,c,input={}){
  need(c,"procurement.matching.manage");
  const purchaseOrder=input.purchaseOrderId?await po(client,c,input.purchaseOrderId):null;
  const received=input.receiptId?await receipt(client,c,input.receiptId):null;
  if(!purchaseOrder&&!received)throw new ProcurementError(400,"Select a Purchase Order or Goods Receipt for landed cost.");
  if(purchaseOrder&&received&&purchaseOrder.company_id!==received.company_id)throw new ProcurementError(409,"Purchase Order and Receipt belong to different companies.");
  const amount=Number(input.amount);if(!Number.isFinite(amount)||amount<0)throw new ProcurementError(400,"Landed cost amount cannot be negative.");
  const currency=String(input.currencyCode||"").trim().toUpperCase();if(!/^[A-Z]{3}$/.test(currency))throw new ProcurementError(400,"Currency is required.");
  const method=String(input.allocationMethod||"value");if(!new Set(["value","quantity","weight","manual"]).has(method))throw new ProcurementError(400,"Landed cost allocation method is invalid.");
  const costType=text(input.costType,100);if(!costType)throw new ProcurementError(400,"Cost type is required.");
  const companyId=purchaseOrder?.company_id||received?.company_id||company(c,input.companyId);
  const r=await client.query(`INSERT INTO tenant.procurement_landed_costs(organization_id,company_id,purchase_order_id,receipt_id,cost_type,amount,currency_code,allocation_method,note,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,[c.organizationId,companyId,purchaseOrder?.id||null,received?.id||null,costType,amount,currency,method,text(input.note)||null,c.userId]);return r.rows[0];
}

export async function upsertSupplierLeadTime(client,c,input={}){
  need(c,"procurement.suppliers.manage");
  const s=await supplier(client,c,input.supplierId);
  const days=Math.trunc(Number(input.leadTimeDays));if(!Number.isFinite(days)||days<0||days>3650)throw new ProcurementError(400,"Lead time must be between 0 and 3650 days.");
  const companyId=s.company_id||company(c,input.companyId);
  const itemId=input.itemId?(await activeItem(client,c,input.itemId,{companyId})).id:null;
  const effectiveFrom=input.effectiveFrom||null,effectiveTo=input.effectiveTo||null;
  if(effectiveFrom&&effectiveTo&&String(effectiveFrom)>String(effectiveTo))throw new ProcurementError(400,"Effective-from date cannot be after effective-to date.","PROCUREMENT_LEAD_TIME_DATE_INVALID");
  const existing=await client.query(`SELECT id FROM tenant.procurement_supplier_lead_times WHERE organization_id=$1 AND supplier_id=$2 AND item_id IS NOT DISTINCT FROM $3 AND status='active' ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`,[c.organizationId,s.id,itemId]);
  if(existing.rows[0]){const r=await client.query(`UPDATE tenant.procurement_supplier_lead_times SET company_id=$4,lead_time_days=$5,effective_from=COALESCE($6::date,effective_from),effective_to=$7,updated_by=$8,updated_at=now() WHERE organization_id=$1 AND id=$2 AND supplier_id=$3 RETURNING *`,[c.organizationId,existing.rows[0].id,s.id,companyId,days,effectiveFrom,effectiveTo,c.userId]);return r.rows[0];}
  const r=await client.query(`INSERT INTO tenant.procurement_supplier_lead_times(organization_id,company_id,supplier_id,item_id,lead_time_days,effective_from,effective_to,created_by,updated_by) VALUES($1,$2,$3,$4,$5,COALESCE($6::date,current_date),$7,$8,$8) RETURNING *`,[c.organizationId,companyId,s.id,itemId,days,effectiveFrom,effectiveTo,c.userId]);return r.rows[0];
}

export async function createProcurementReorderRequest(client,c,input={}){
  need(c,"procurement.po.create");
  const companyId=company(c,input.companyId);
  const ruleId=uuid(input.reorderRuleId,"Reorder rule"),itemId=uuid(input.itemId,"Item"),warehouseId=uuid(input.warehouseId,"Warehouse");
  const quantity=positive(input.quantity,"Reorder quantity");
  const key=text(input.idempotencyKey,200);if(!key)throw new ProcurementError(400,"Reorder idempotency key is required.");
  const replay=await client.query(`SELECT * FROM tenant.procurement_reorder_requests WHERE organization_id=$1 AND idempotency_key=$2`,[c.organizationId,key]);if(replay.rows[0])return replay.rows[0];
  const r=await client.query(`INSERT INTO tenant.procurement_reorder_requests(organization_id,company_id,reorder_rule_id,item_id,warehouse_id,supplier_id,quantity,required_by,idempotency_key,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,[c.organizationId,companyId,ruleId,itemId,warehouseId,input.supplierId?uuid(input.supplierId,"Supplier"):null,quantity,input.requiredBy||null,key,c.userId]);return r.rows[0];
}

export async function createProcurementSubcontractOrder(client,c,input={}){
  need(c,"procurement.po.create");
  const s=await supplier(client,c,input.supplierId);
  const linkedPo=input.purchaseOrderId?await po(client,c,input.purchaseOrderId):null;
  const companyId=linkedPo?.company_id||s.company_id||company(c,input.companyId);
  if(linkedPo&&s.company_id&&linkedPo.company_id!==s.company_id)throw new ProcurementError(409,"Supplier and Purchase Order belong to different companies.");
  const itemId=input.itemId?(await activeItem(client,c,input.itemId,{companyId})).id:null;
  const expectedReturnDate=input.expectedReturnDate||null;
  if(expectedReturnDate&&Number.isNaN(Date.parse(String(expectedReturnDate))))throw new ProcurementError(400,"Expected return date is invalid.","PROCUREMENT_SUBCONTRACT_DATE_INVALID");
  const r=await client.query(`INSERT INTO tenant.procurement_subcontract_orders(organization_id,company_id,supplier_id,purchase_order_id,reference_type,reference_id,item_id,quantity,expected_return_date,note,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *`,[c.organizationId,companyId,s.id,linkedPo?.id||null,text(input.referenceType,100)||null,input.referenceId?uuid(input.referenceId,"Reference"):null,itemId,positive(input.quantity,"Quantity"),expectedReturnDate,text(input.note)||null,c.userId]);return r.rows[0];
}

export async function listProcurementPass1Options(client,c){
  need(c,"procurement.view");
  const values=[c.organizationId];const scope=companyWhere(c,values,"record");
  // Sequential, not Promise.all — concurrent client.query() on one shared
  // PoolClient can interleave extended-query protocol messages (observed
  // live in CRM as Postgres 08P01 "bind message supplies N parameters...");
  // see services/api/src/modules/crm/opportunity-and-pipeline-governance/
  // opportunity-revenue-intelligence.js's fix for the full explanation.
  const suppliers=await client.query(`SELECT record.id,COALESCE(record.data->>'displayName',record.data->>'legalName',record.data->>'supplierCode',record.id::text) AS label,record.status FROM tenant.procurement_suppliers record WHERE record.organization_id=$1${scope} AND record.status NOT IN ('archived','rejected') ORDER BY record.updated_at DESC LIMIT 100`,values);
  const orders=await client.query(`SELECT record.id,COALESCE(record.data->>'purchaseOrderNumber',record.data->>'poNumber',record.data->>'number',record.id::text) AS label,record.status,record.company_id FROM tenant.procurement_purchase_orders record WHERE record.organization_id=$1${scope} ORDER BY record.updated_at DESC LIMIT 100`,values);
  const receipts=await client.query(`SELECT record.id,COALESCE(record.data->>'receiptNumber',record.data->>'grnNumber',record.data->>'number',record.id::text) AS label,record.status,record.company_id FROM tenant.procurement_receipts record WHERE record.organization_id=$1${scope} ORDER BY record.updated_at DESC LIMIT 100`,values);
  const items=await client.query(`SELECT id,code,name FROM tenant.items WHERE organization_id=$1 AND status='active' AND (company_id IS NULL OR company_id=$2) ORDER BY name LIMIT 200`,[c.organizationId,c.activeCompanyId]);
  const warehouses=await client.query(`SELECT id,code,name FROM tenant.warehouses WHERE organization_id=$1 AND status='active' AND ($2::uuid IS NULL OR company_id=$2) ORDER BY name LIMIT 100`,[c.organizationId,c.activeCompanyId]);
  const sourcingEvents=await client.query(`SELECT record.id,COALESCE(record.data->>'eventNumber',record.data->>'title',record.id::text) AS label,record.status,record.company_id FROM tenant.procurement_sourcing_events record WHERE record.organization_id=$1${scope} ORDER BY record.updated_at DESC LIMIT 100`,values);
  const uoms=await client.query(`SELECT id,code,name FROM tenant.units_of_measure WHERE organization_id=$1 AND status='active' ORDER BY name LIMIT 200`,[c.organizationId]);
  const categories=await client.query(`SELECT record.id,COALESCE(record.data->>'name',record.data->>'code',record.id::text) AS label,record.status FROM tenant.procurement_categories record WHERE record.organization_id=$1${scope} AND record.status='active' ORDER BY label LIMIT 200`,values);
  const agreements=await client.query(`SELECT record.id,COALESCE(record.data->>'agreementNumber',record.data->>'title',record.id::text) AS label,record.status FROM tenant.procurement_agreements record WHERE record.organization_id=$1${scope} ORDER BY record.updated_at DESC LIMIT 100`,values);
  const requisitions=await client.query(`SELECT record.id,COALESCE(record.data->>'requisitionNumber',record.data->>'title',record.id::text) AS label,record.status FROM tenant.procurement_requisitions record WHERE record.organization_id=$1${scope} ORDER BY record.updated_at DESC LIMIT 100`,values);
  return {suppliers:suppliers.rows,purchaseOrders:orders.rows,receipts:receipts.rows,items:items.rows,warehouses:warehouses.rows,sourcingEvents:sourcingEvents.rows,uoms:uoms.rows,categories:categories.rows,agreements:agreements.rows,requisitions:requisitions.rows};
}
