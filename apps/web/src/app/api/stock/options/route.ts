import { listStockOperationOptions } from "@vercentlabs/api";
import { stockSession, tenantTransaction } from "@/modules/stock/server";
import { errorResponse, ok } from "@/core/http";
export async function GET(){try{const{context}=await stockSession();return ok({options:await tenantTransaction(context.organizationId,(client)=>listStockOperationOptions(client,context))});}catch(error){return errorResponse(error)}}
