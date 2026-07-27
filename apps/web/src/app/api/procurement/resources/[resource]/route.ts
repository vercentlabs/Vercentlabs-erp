import { createProcurementRecord, listProcurementRecords } from "@vercentlabs/api";
import { procurementSession, tenantTransaction } from "@/lib/procurement-route";
import { assertSameOriginOrMobile } from "@/lib/security";
import { errorResponse, ok, readJson } from "@/lib/http";
import { procurementCreateSchema } from "@/lib/procurement-validation";
export async function GET(request:Request,{params}:{params:Promise<{resource:string}>}){try{const {context}=await procurementSession();const {resource}=await params;const filters=Object.fromEntries(new URL(request.url).searchParams.entries());return ok(await tenantTransaction(context.organizationId,c=>listProcurementRecords(c,context,resource,filters)));}catch(error){return errorResponse(error);}}
export async function POST(request:Request,{params}:{params:Promise<{resource:string}>}){try{assertSameOriginOrMobile(request);const {context}=await procurementSession(true);const {resource}=await params;const input=procurementCreateSchema.parse(await readJson(request));const record=await tenantTransaction(context.organizationId,c=>createProcurementRecord(c,context,resource,input));return ok({record},201);}catch(error){return errorResponse(error);}}
