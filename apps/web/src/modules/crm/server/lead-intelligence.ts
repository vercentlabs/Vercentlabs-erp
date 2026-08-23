import { errorResponse, HttpError } from "@/core/http";
export function crmLeadIntelligenceErrorResponse(error: unknown) {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number(error.status);
    const message =
      "message" in error
        ? String(error.message)
        : "CRM lead-intelligence request failed.";
    return errorResponse(
      new HttpError(Number.isInteger(status) ? status : 500, message),
    );
  }
  return errorResponse(error);
}
