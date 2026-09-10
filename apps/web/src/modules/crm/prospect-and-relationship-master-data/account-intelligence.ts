import { errorResponse, HttpError } from "@/core/http";

export function crmAccountIntelligenceErrorResponse(error: unknown) {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number(error.status);
    const message =
      "message" in error ? String(error.message) : "CRM request failed.";
    // The `code` (e.g. CRM_ACCOUNT_HIERARCHY_SELF_PARENT/_CYCLE,
    // CRM_MERGE_COMPARISON_STALE) must survive so callers can distinguish
    // specific typed conflicts (e.g. show "Refresh comparison") instead of a
    // generic error — this was previously dropped here.
    const code = "code" in error ? String(error.code) : undefined;
    return errorResponse(
      new HttpError(Number.isInteger(status) ? status : 500, message, code),
    );
  }
  return errorResponse(error);
}
