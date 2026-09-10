import {
  CrmError,
  CrmLeadIntelligenceError,
  CrmOpportunityRevenueError,
  LeadDuplicateError,
  LeadGovernanceError,
  LeadOperationsError,
  LeadQualificationError,
  OpportunityOperationsError,
} from "@vercentlabs/api";
import { ZodError } from "zod";
import { errorResponse, fail, HttpError } from "@/core/http";

export function crmErrorResponse(error: unknown) {
  if (
    error instanceof CrmError ||
    error instanceof CrmLeadIntelligenceError ||
    error instanceof LeadDuplicateError ||
    error instanceof LeadGovernanceError ||
    error instanceof LeadOperationsError ||
    error instanceof LeadQualificationError ||
    error instanceof OpportunityOperationsError ||
    error instanceof CrmOpportunityRevenueError
  ) {
    const details =
      error.details && typeof error.details === "object"
        ? (error.details as Record<string, unknown>)
        : {};
    const errors =
      details.errors && typeof details.errors === "object"
        ? details.errors
        : {};
    return fail(error.message, error.status, {
      code: error.code || "CRM_ERROR",
      errors,
      ...(error instanceof LeadDuplicateError
        ? {
            classification: details.classification || "exact",
            matches: Array.isArray(details.matches) ? details.matches : [],
            canOverride: Boolean(details.canOverride),
          }
        : {}),
    });
  }
  if (error instanceof ZodError) {
    return fail("Review the submitted fields.", 400, {
      code: "CRM_VALIDATION_ERROR",
      errors: error.flatten().fieldErrors,
    });
  }
  if (error instanceof HttpError) {
    return fail(error.message, error.status, {
      code: error.code || "CRM_REQUEST_ERROR",
      errors: {},
    });
  }
  return errorResponse(error);
}

export function rethrowCrmError(error: unknown): never {
  if (
    error instanceof CrmError ||
    error instanceof CrmLeadIntelligenceError ||
    error instanceof LeadDuplicateError ||
    error instanceof LeadGovernanceError ||
    error instanceof LeadOperationsError ||
    error instanceof LeadQualificationError ||
    error instanceof OpportunityOperationsError ||
    error instanceof CrmOpportunityRevenueError
  )
    throw new HttpError(
      error.status,
      error.message,
      error.code,
      // Integrity closeout (Prompts 1-5): details (e.g. the structured
      // missingRequirements list on CRM_OPPORTUNITY_STAGE_EXIT_BLOCKED)
      // were previously dropped here — the client only ever saw the
      // generic message, never which specific requirement was missing.
      (error as { details?: Record<string, unknown> }).details,
    );
  throw error;
}
