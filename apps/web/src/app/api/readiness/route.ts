import { query } from "@/lib/db";
import { errorResponse, HttpError, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

const EXPECTED_CONTROL_MIGRATION = "017_billing_state_machine_and_recovery.sql";
const EXPECTED_TENANT_MIGRATION = "027_enterprise_release_governance.sql";
const REQUIRED_RELEASE_FOUNDATION = Object.freeze({
  control: "014_procurement_module_release.sql",
  tenant: "013_procurement_enterprise_completion.sql",
  accounting: "011_accounting_integrity_and_compliance.sql",
});

export async function GET() {
  try {
    const rows = await query<{
      control_ready: boolean;
      tenant_ready: boolean;
      release_control_ready: boolean;
      release_tenant_ready: boolean;
      accounting_ready: boolean;
    }>(
      `
        SELECT
          EXISTS (
            SELECT 1 FROM schema_migrations WHERE name = $1
          ) AS control_ready,
          EXISTS (
            SELECT 1 FROM tenant_schema_migrations WHERE name = $2
          ) AS tenant_ready,
          EXISTS (
            SELECT 1 FROM schema_migrations WHERE name = $3
          ) AS release_control_ready,
          EXISTS (
            SELECT 1 FROM tenant_schema_migrations WHERE name = $4
          ) AS release_tenant_ready,
          EXISTS (
            SELECT 1 FROM tenant_schema_migrations WHERE name = $5
          ) AS accounting_ready
      `,
      [
        REQUIRED_RELEASE_FOUNDATION.control,
        REQUIRED_RELEASE_FOUNDATION.tenant,
        EXPECTED_CONTROL_MIGRATION,
        EXPECTED_TENANT_MIGRATION,
        REQUIRED_RELEASE_FOUNDATION.accounting,
      ],
    );

    const state = rows[0];
    if (
      !state?.control_ready ||
      !state?.tenant_ready ||
      !state?.release_control_ready ||
      !state?.release_tenant_ready ||
      !state?.accounting_ready
    ) {
      throw new HttpError(503, "The service schema is not ready.");
    }

    return ok({
      service: "vercentlabs-erp-web",
      status: "ready",
      release:
        process.env.VERCENTLABS_RELEASE_SHA ||
        process.env.VERCEL_GIT_COMMIT_SHA ||
        null,
      schema: {
        control: EXPECTED_CONTROL_MIGRATION,
        tenant: EXPECTED_TENANT_MIGRATION,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    return errorResponse(
      new HttpError(503, "The service dependencies are not ready."),
    );
  }
}
