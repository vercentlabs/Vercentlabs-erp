import { errorResponse, HttpError } from "@/lib/http";

export function crmLeadAcquisitionErrorResponse(error: unknown) {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number(error.status);
    const message =
      "message" in error
        ? String(error.message)
        : "CRM lead-acquisition request failed.";
    return errorResponse(
      new HttpError(Number.isInteger(status) ? status : 500, message),
    );
  }
  return errorResponse(error);
}
