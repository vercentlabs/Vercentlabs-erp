import { errorResponse, HttpError } from "@/core/http";
export function crmOfflineErrorResponse(error: unknown) {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number(error.status);
    const message =
      "message" in error
        ? String(error.message)
        : "Offline CRM request failed.";
    return errorResponse(
      new HttpError(Number.isInteger(status) ? status : 500, message),
    );
  }
  return errorResponse(error);
}
