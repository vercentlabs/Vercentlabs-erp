
import { query } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";

export const dynamic = "force-dynamic";

type ReadinessRow = {
  role_name: string;
  organizations_table: boolean;
  roles_table: boolean;
  tenant_schema: boolean;
  background_jobs_table: boolean;
};

export async function GET() {
  try {
    const rows = await query<ReadinessRow>(
      `
      SELECT
        current_user AS role_name,
        to_regclass('public.organizations') IS NOT NULL
          AS organizations_table,
        to_regclass('public.roles') IS NOT NULL
          AS roles_table,
        EXISTS (
          SELECT 1
          FROM pg_namespace
          WHERE nspname = 'tenant'
        ) AS tenant_schema,
        to_regclass('tenant.background_jobs') IS NOT NULL
          AS background_jobs_table
      `,
    );

    const state = rows[0];

    if (
      !state?.organizations_table ||
      !state?.roles_table ||
      !state?.tenant_schema
    ) {
      throw new HttpError(
        503,
        "The service database foundation is not ready.",
      );
    }

    return ok({
      service: "vercentlabs-erp-web",
      status: "ready",
      release:
        process.env.VERCENTLABS_RELEASE_SHA ||
        process.env.VERCEL_GIT_COMMIT_SHA ||
        null,
      database: {
        connected: true,
        runtimeRole: state.role_name,
      },
      platform: {
        organizations: state.organizations_table,
        roles: state.roles_table,
        tenantSchema: state.tenant_schema,
        workerQueueSchema: state.background_jobs_table,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return errorResponse(error);
    }

    return errorResponse(
      new HttpError(
        503,
        "The service dependencies are not ready.",
      ),
    );
  }
}
