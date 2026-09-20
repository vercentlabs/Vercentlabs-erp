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
  const availability=await getStockAvailability(client,stockContext,{itemId:line.itemId,warehouseId:line.warehouseId,requestedQuantity:requested});
  return {line,availability};
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
  const quantity=Number(checked.availability.requestedQuantity);
  const idempotencyKey=String(input.idempotencyKey||`sales:${checked.line.orderId}:${checked.line.lineId}:${quantity}`).slice(0,200);
  const reservation=await reserveStock(client,stockContext,{itemId:checked.line.itemId,warehouseId:checked.line.warehouseId,quantity,referenceType:"sales_order",referenceId:checked.line.orderId,idempotencyKey});
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
