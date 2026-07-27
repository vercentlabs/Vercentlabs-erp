import { transitionProcurementRecord } from "@vercentlabs/api";
import { procurementSession, tenantTransaction } from "@/lib/procurement-route";
import { assertSameOriginOrMobile } from "@/lib/security";
import { errorResponse, ok, readJson } from "@/lib/http";
import { procurementActionSchema } from "@/lib/procurement-validation";
export async function POST(request:Request,{params}:{params:Promise<{resource:string;id:string}>}){try{assertSameOriginOrMobile(request);const {context}=await procurementSession(true);const {resource,id}=await params;const input=procurementActionSchema.parse(await readJson(request));const record=await tenantTransaction(context.organizationId,c=>transitionProcurementRecord(c,context,resource,id,input.action,input));return ok({record});}catch(error){return errorResponse(error);}}
