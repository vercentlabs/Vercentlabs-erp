import { query } from "@/lib/db";
import { errorResponse, HttpError, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

const EXPECTED_CONTROL_MIGRATION = "011_mobile_sessions.sql";
const EXPECTED_TENANT_MIGRATION = "007_crm_outbox_leases.sql";

export async function GET() {
  try {
    const rows = await query<{
      control_ready: boolean;
      tenant_ready: boolean;
    }>(
      `
        SELECT
          EXISTS (
            SELECT 1 FROM schema_migrations WHERE name = $1
          ) AS control_ready,
          EXISTS (
            SELECT 1 FROM tenant_schema_migrations WHERE name = $2
          ) AS tenant_ready
      `,
      [EXPECTED_CONTROL_MIGRATION, EXPECTED_TENANT_MIGRATION],
    );

    if (!rows[0]?.control_ready || !rows[0]?.tenant_ready) {
      throw new HttpError(503, "The service schema is not ready.");
    }

    return ok({
      service: "vercentlabs-erp-web",
      status: "ready",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    return errorResponse(
      new HttpError(503, "The service dependencies are not ready."),
    );
  }
}
