import { submitPublishedLeadForm } from "@vercentlabs/api";
import { crmLeadAcquisitionErrorResponse } from "@/lib/crm-lead-acquisition-route";
import { query, tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

export async function POST(
  request: Request,
  route: { params: Promise<{ key: string }> },
) {
  try {
    const { key } = await route.params;
    const forms = await query<Record<string, unknown>>(
      "SELECT * FROM tenant.crm_public_capture_form_v2($1)",
      [key],
    );
    const form = forms[0];
    if (!form) throw new HttpError(404, "Published lead form not found.");
    const origin = request.headers.get("origin") || "";
    const allowed = Array.isArray(form.allowed_origins)
      ? form.allowed_origins.map(String)
      : [];
    if (origin && allowed.length && !allowed.includes(origin))
      throw new HttpError(
        403,
        "This origin is not allowed to submit the form.",
      );
    const input = (await request.json()) as Record<string, unknown>;
    input.__fingerprint =
      request.headers.get("x-vercentlabs-capture-fingerprint") ||
      request.headers.get("x-forwarded-for") ||
      "anonymous";
    if (String(input.companyWebsite || input._website || ""))
      return ok({ accepted: true });
    const context = {
      organizationId: String(form.organization_id),
      userId: String(form.created_by || "00000000-0000-4000-8000-000000000000"),
      activeCompanyId: form.company_id ? String(form.company_id) : null,
      activeBranchId: form.branch_id ? String(form.branch_id) : null,
      allowAllCompanies: true,
    };
    const result = await tenantTransaction(context.organizationId, (client) =>
      submitPublishedLeadForm(client, context, form, input),
    );
    return ok({ result }, 201);
  } catch (error) {
    return crmLeadAcquisitionErrorResponse(error);
  }
}
