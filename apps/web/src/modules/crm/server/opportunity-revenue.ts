import { errorResponse, HttpError } from "@/core/http";
export function crmOpportunityRevenueErrorResponse(error: unknown) {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number(error.status);
    const message =
      "message" in error
        ? String(error.message)
        : "CRM opportunity-revenue request failed.";
    // `code` was previously dropped here — every typed
    // CrmOpportunityRevenueError (CRM_REVENUE_SPLITS_NOT_BALANCED,
    // CRM_OPPORTUNITY_ITEM_NOT_FOUND, ...) reached the browser as a
    // generic message with no code, breaking any code-based UI handling.
    // Found and fixed this prompt — same bug class as the CrmError code
    // passthrough fixes in earlier prompts.
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return errorResponse(
      new HttpError(Number.isInteger(status) ? status : 500, message, code),
    );
  }
  return errorResponse(error);
}
