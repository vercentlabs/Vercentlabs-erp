import { listStockReorderCandidates } from "../modules/stock/index.js";
import { ProcurementError } from "../modules/procurement/index.js";
import { createProcurementReorderRequest } from "../modules/procurement/pass1-operations.js";

// F094 cross-module orchestration. Stock owns availability/reorder rules;
// Procurement owns the purchasing queue. No module writes another module's tables.
export async function generateReorderPurchasingRequests(client, stockContext, procurementContext, { limit = 100, asOf = new Date() } = {}) {
  if (stockContext.organizationId !== procurementContext.organizationId) throw new ProcurementError(403,"Stock and Procurement organization context must match.","PROCUREMENT_STOCK_CONTEXT_INVALID");
  if (stockContext.companyId !== procurementContext.activeCompanyId && !procurementContext.allowAllCompanies) throw new ProcurementError(409,"Stock and Procurement active-company context must match.","PROCUREMENT_STOCK_COMPANY_MISMATCH");
  const candidates = await listStockReorderCandidates(client, stockContext, { limit });
  const rows = [];
  for (const candidate of candidates) {
    const required = new Date(asOf);
    required.setUTCDate(required.getUTCDate() + Math.max(0, Number(candidate.leadTimeDays || 0)));
    rows.push(await createProcurementReorderRequest(client, procurementContext, {
      companyId: stockContext.companyId,
      reorderRuleId: candidate.reorderRuleId,
      itemId: candidate.itemId,
      warehouseId: candidate.warehouseId,
      supplierId: candidate.preferredSupplierId || null,
      quantity: candidate.reorderQuantity,
      requiredBy: required.toISOString().slice(0, 10),
      idempotencyKey: `reorder:${candidate.reorderRuleId}:${required.toISOString().slice(0, 10)}`,
    }));
  }
  return { candidates: candidates.length, createdOrReplayed: rows.length, rows };
}
