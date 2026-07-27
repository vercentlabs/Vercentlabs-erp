import { getProcurementRecord } from "@vercentlabs/api";
import { procurementSession, tenantTransaction } from "@/lib/procurement-route";
import { errorResponse, ok } from "@/lib/http";
export async function GET(_request:Request,{params}:{params:Promise<{resource:string;id:string}>}){try{const {context}=await procurementSession();const {resource,id}=await params;return ok({record:await tenantTransaction(context.organizationId,c=>getProcurementRecord(c,context,resource,id))});}catch(error){return errorResponse(error);}}
