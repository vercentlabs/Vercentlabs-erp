import { submitPublishedLeadForm } from "@vercentlabs/api";
import { crmLeadAcquisitionErrorResponse } from "@/modules/crm/server/lead-acquisition";
import { query, tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
import {
  directCaptureFingerprint,
  readRequestBytes,
  verifiedCaptureProxyFingerprint,
} from "@/core/security";

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
    // Unlike the previous check (`if (origin && allowed.length ...)`), an
    // omitted Origin header no longer bypasses a configured allowlist — a
    // server-to-server caller that simply doesn't send Origin must not be
    // treated as automatically allowed. Matches the sibling
    // apps/web/src/app/api/crm/public/capture/[key]/route.ts check.
    if (allowed.length && !allowed.includes(origin)) {
      throw new HttpError(
        403,
        "This origin is not allowed to submit the form.",
      );
    }

    const bytes = await readRequestBytes(request, 50_000);
    const rawBody = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new HttpError(400, "Invalid JSON request.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "Invalid JSON request.");
    }
    const input = parsed as Record<string, unknown>;

    // Trusted-proxy HMAC fingerprint when present, otherwise clientIp()+UA —
    // never a raw, client-suppliable X-Forwarded-For header (see Part 3 of
    // docs/implementation/ERP_SECURITY_HARDENING_003.md: a spoofed header
    // previously let a caller mint a fresh rate-limit fingerprint on every
    // request).
    const trustedFingerprint = verifiedCaptureProxyFingerprint(request, rawBody);
    input.__fingerprint = trustedFingerprint || directCaptureFingerprint(request);

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
