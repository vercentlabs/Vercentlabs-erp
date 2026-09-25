import { SalesError } from "../modules/sales/index.js";
import { getSalesOrderLineReservationContext } from "../modules/sales/pass1-operations.js";
import { reserveSalesOrderLines } from "../modules/sales/order-governance.js";
import {
  getStockAvailability,
  reserveStock,
  listActiveStockReservationsByReference,
  releaseStockReservation,
} from "../modules/stock/index.js";

export async function checkSalesOrderLineAvailability(client,salesContext,stockContext,input={}){
  const line=await getSalesOrderLineReservationContext(client,salesContext,input);
  if(salesContext.organizationId!==stockContext.organizationId)throw new SalesError(403,"Sales and Stock organization context must match.","SALES_STOCK_CONTEXT_INVALID");
  if(line.companyId!==stockContext.companyId)throw new SalesError(409,"Sales and Stock active-company context must match.","SALES_STOCK_COMPANY_MISMATCH");
  const requested=input.quantity==null||input.quantity===""?line.remainingReservableQuantity:Number(input.quantity);
  if(!Number.isFinite(requested)||requested<=0)throw new SalesError(400,"Reservation quantity must be greater than zero.","SALES_RESERVATION_QUANTITY_INVALID");
  if(requested>line.remainingReservableQuantity+1e-9)throw new SalesError(409,"Reservation quantity exceeds the unreserved confirmed Sales quantity.","SALES_RESERVATION_EXCEEDS_CONFIRMED");
  // Stock is counted in base units: 20 cartons of 12 is 240 pouches (F045/F046).
  const requestedBase=requested*line.conversionFactor;
  const availability=await getStockAvailability(client,stockContext,{itemId:line.itemId,warehouseId:line.warehouseId,requestedQuantity:requestedBase});
  const promise=await explainAvailabilityPromise(client,stockContext,line,Number(availability.availableToPromise),requestedBase);
  return {line,availability,requestedQuantity:requested,requestedBaseQuantity:requestedBase,promise};
}

// F045: an explainable promise — in stock now, covered by an open purchase
// order's expected delivery, or the supplier lead time — never a guess.
async function explainAvailabilityPromise(client,stockContext,line,availableBase,requestedBase){
  const today=new Date().toISOString().slice(0,10);
  const addDays=(days)=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
  const incoming=(await client.query(
    `SELECT po.data->>'purchaseOrderNumber' AS purchase_order_number,
            COALESCE(po.data->>'expectedDeliveryDate',po.data->>'needByDate') AS expected_date,
            sum(greatest((pol.data->>'quantity')::numeric-COALESCE(pol.received_quantity,(pol.data->>'receivedQuantity')::numeric,0),0)) AS open_quantity
       FROM tenant.procurement_purchase_order_lines pol
       JOIN tenant.procurement_purchase_orders po ON po.organization_id=pol.organization_id AND po.id=pol.parent_id
      WHERE pol.organization_id=$1 AND pol.company_id=$2 AND pol.item_id=$3 AND (pol.warehouse_id=$4 OR pol.warehouse_id IS NULL)
        AND po.status IN ('approved','dispatched','acknowledged','partially_received','pending_amendment_approval')
      GROUP BY 1,2 HAVING sum(greatest((pol.data->>'quantity')::numeric-COALESCE(pol.received_quantity,(pol.data->>'receivedQuantity')::numeric,0),0))>0
      ORDER BY 2 NULLS LAST`,
    [stockContext.organizationId,stockContext.companyId,line.itemId,line.warehouseId],
  )).rows.map((row)=>({purchaseOrderNumber:row.purchase_order_number,expectedDate:row.expected_date?String(row.expected_date).slice(0,10):null,openQuantity:Number(row.open_quantity)}));
  const leadTime=(await client.query(
    `SELECT min(lead_time_days)::int AS days FROM tenant.procurement_supplier_lead_times
      WHERE organization_id=$1 AND item_id=$2 AND status='active' AND (effective_from IS NULL OR effective_from<=current_date) AND (effective_to IS NULL OR effective_to>=current_date)`,
    [stockContext.organizationId,line.itemId],
  )).rows[0]?.days??null;
  const base={unit:line.unit,conversionFactor:line.conversionFactor,availableBase:availableBase,requestedBase,incoming,supplierLeadTimeDays:leadTime};
  if(availableBase>=requestedBase)return {...base,basis:"in_stock",promisedDate:today,explanation:`${requestedBase} units are free in this warehouse today.`};
  let covered=availableBase;
  for(const supply of incoming){
    covered+=supply.openQuantity;
    if(covered>=requestedBase&&supply.expectedDate)
      return {...base,basis:"incoming_supply",promisedDate:supply.expectedDate,explanation:`${availableBase} units free now; the rest arrives on purchase order ${supply.purchaseOrderNumber} expected ${supply.expectedDate}.`};
  }
  if(leadTime!=null)
    return {...base,basis:"supplier_lead_time",promisedDate:addDays(leadTime),explanation:`${availableBase} units free now and open purchase orders do not cover the rest; a new order takes the supplier lead time of ${leadTime} days.`};
  return {...base,basis:"no_supply",promisedDate:null,explanation:`Only ${availableBase} of ${requestedBase} units are free, and there is no open purchase order or supplier lead time to promise the rest.`};
}

export async function reserveSalesOrderLineFromStock(client,salesContext,stockContext,input={}){
  // A retry with the same key must replay, not re-validate: once the first attempt
  // reserved the full remaining quantity, "unreserved quantity" is zero and the
  // ordinary checks below would reject the very request that already succeeded.
  const suppliedKey=String(input.idempotencyKey||"").trim().slice(0,200);
  if(suppliedKey){
    const prior=await client.query("SELECT response_payload FROM tenant.operation_idempotency WHERE organization_id=$1 AND company_id=$2 AND operation='stock.reservation.create' AND idempotency_key=$3 AND status='completed'",[stockContext.organizationId,stockContext.companyId,suppliedKey]);
    if(prior.rows[0])return {replayed:true,reservation:{...prior.rows[0].response_payload,replayed:true}};
  }
  const checked=await checkSalesOrderLineAvailability(client,salesContext,stockContext,input);
  if(!checked.availability.canPromise)throw new SalesError(409,"Available stock is lower than the requested Sales reservation quantity.","SALES_STOCK_INSUFFICIENT");
  // Stock reserves base units; Sales records the reservation in the line's selling unit.
  const quantity=checked.requestedQuantity;
  const idempotencyKey=String(input.idempotencyKey||`sales:${checked.line.orderId}:${checked.line.lineId}:${quantity}`).slice(0,200);
  const reservation=await reserveStock(client,stockContext,{itemId:checked.line.itemId,warehouseId:checked.line.warehouseId,quantity:checked.requestedBaseQuantity,referenceType:"sales_order",referenceId:checked.line.orderId,idempotencyKey});
  if(!reservation.replayed){
    await reserveSalesOrderLines(client,salesContext,checked.line.orderId,{lines:[{salesOrderLineId:checked.line.lineId,reservedQuantity:checked.line.reservedQuantity+quantity}]});
  }
  return {line:checked.line,availability:checked.availability,reservation};
}

// F046 gap: reserveSalesOrderLineFromStock creates a real tenant.stock_reservations
// row (reference_type='sales_order', reference_id=orderId) but nothing ever released
// it when the order was cancelled - the reservation id isn't stored on the Sales
// side at all, so this looks it up by reference instead of requiring a schema change.
export async function releaseSalesOrderStockReservationsOnCancel(client,stockContext,orderId){
  const reservations=await listActiveStockReservationsByReference(client,stockContext,{referenceType:"sales_order",referenceId:orderId});
  for(const reservation of reservations){
    await releaseStockReservation(client,stockContext,reservation.id,{status:"cancelled"});
  }
  return reservations.length;
}

// F046: release everything reserved for an order (before an amendment, or to
// let another order have the stock). Sales' reserved counters go back to zero
// in the same transaction, so the two sides never disagree.
export async function releaseSalesOrderStockReservations(client,salesContext,stockContext,orderId,reason){
  const note=String(reason||"").trim();
  if(note.length<5)throw new SalesError(400,"Say why the reservation is released (at least 5 characters).","SALES_RESERVATION_RELEASE_REASON");
  const reservations=await listActiveStockReservationsByReference(client,stockContext,{referenceType:"sales_order",referenceId:orderId});
  for(const reservation of reservations)await releaseStockReservation(client,stockContext,reservation.id,{status:"released"});
  await client.query(
    `UPDATE tenant.sales_order_line_progress progress SET reserved_quantity=0,updated_by=$3,updated_at=now()
       FROM tenant.sales_order_lines line JOIN tenant.sales_orders orders ON orders.id=$2 AND orders.current_version_id=line.sales_order_version_id
      WHERE progress.organization_id=$1 AND progress.sales_order_line_id=line.id`,
    [salesContext.organizationId,orderId,salesContext.userId||null],
  );
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id,entity_type,entity_id,event_type,from_status,to_status,metadata,actor_user_id)
     SELECT $1,'sales_order',$2,'sales_order.reservations_released',lifecycle_status,lifecycle_status,$3::jsonb,$4 FROM tenant.sales_orders WHERE organization_id=$1 AND id=$2`,
    [salesContext.organizationId,orderId,JSON.stringify({released:reservations.length,reason:note}),salesContext.userId||null],
  );
  return {released:reservations.length};
}

// F047: shipping consumes the order's reservation for that item and warehouse
// (a partly used reservation is consumed and the rest re-reserved), so reserved
// stock is not left locked after it has physically left.
export async function consumeSalesOrderReservation(client,stockContext,{orderId,itemId,warehouseId,baseQuantity,requestId}){
  let remaining=Number(baseQuantity);
  const reservations=(await listActiveStockReservationsByReference(client,stockContext,{referenceType:"sales_order",referenceId:orderId}))
    .filter((reservation)=>reservation.item_id===itemId&&reservation.warehouse_id===warehouseId);
  for(const reservation of reservations){
    if(remaining<=0)break;
    const held=Number(reservation.quantity);
    await releaseStockReservation(client,stockContext,reservation.id,{status:"consumed"});
    if(held>remaining){
      await reserveStock(client,stockContext,{itemId,warehouseId,quantity:held-remaining,referenceType:"sales_order",referenceId:orderId,idempotencyKey:`sales-remainder:${requestId}:${reservation.id}`});
      remaining=0;
    }else remaining-=held;
  }
  return Number(baseQuantity)-Math.max(remaining,0);
}
