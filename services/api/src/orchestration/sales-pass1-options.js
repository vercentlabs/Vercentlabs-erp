import { createSalesDropShipRequest, listSalesPass1Options } from "../modules/sales/pass1-operations.js";
import { getProcurementRecord, listProcurementRecords } from "../modules/procurement/index.js";
import { SalesError } from "../modules/sales/index.js";

export async function listSalesPass1CrossModuleOptions(client,salesContext,procurementContext){
  const base=await listSalesPass1Options(client,salesContext);
  let suppliers=[];
  try {
    const result=await listProcurementRecords(client,procurementContext,"suppliers",{limit:100});
    suppliers=result.rows.map((row)=>({id:row.id,label:row.data?.displayName||row.data?.legalName||row.document_number||row.id,status:row.status}));
  } catch { suppliers=[]; }
  return {...base,suppliers};
}

export async function createSalesDropShipWithSupplierValidation(
  client,
  salesContext,
  procurementContext,
  input = {},
) {
  if (salesContext.organizationId !== procurementContext.organizationId)
    throw new SalesError(403, "Sales and Procurement organization context must match.", "SALES_PROCUREMENT_CONTEXT_INVALID");
  const supplier = await getProcurementRecord(client, procurementContext, "suppliers", input.supplierId);
  if (supplier.status === "archived" || supplier.status === "rejected")
    throw new SalesError(409, "Selected supplier is not active for drop shipping.", "SALES_DROP_SHIP_SUPPLIER_INVALID");
  return createSalesDropShipRequest(client, salesContext, { ...input, supplierId: supplier.id });
}
