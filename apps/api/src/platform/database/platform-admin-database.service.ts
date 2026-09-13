import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  createDatabaseConnection,
  toRuntimeConnectionString,
  type DatabaseConnection,
} from '@vercentlabs/database';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { API_ENV, type ApiEnv } from '../../config/api-env.provider.js';

export const PLATFORM_ADMIN_DB = Symbol('PLATFORM_ADMIN_DB');

/**
 * A SEPARATE connection pool from `PlatformDatabaseService`, connecting as
 * the distinct `erp_platform_admin` role (see
 * database/migrations/platform/0007_harden_organizations_tenant_boundary.sql).
 * This is the only pool authorized to write `platform.organizations` -
 * organization create/activate/suspend/recover/close/update-metadata are
 * control-plane actions, not ordinary tenant-runtime queries, and now have a
 * database-level distinction to match: `erp_runtime` can no longer insert
 * or update this table at all, RLS-restricted or not.
 *
 * Which connection a request uses is fixed at startup by which
 * controller/service injects which token (`PLATFORM_ADMIN_DB` here vs
 * `PLATFORM_DB`) - never derived from a client-supplied header, cookie,
 * query parameter or body field. See
 * docs/security/platform-operator-boundary.md and
 * tests/architecture/platform-api-boundaries.test.ts, which enforces that
 * only `OrganizationsController` may inject this token.
 */
@Injectable()
export class PlatformAdminDatabaseService implements OnModuleDestroy {
  private readonly connection: DatabaseConnection;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    const adminUrl =
      env.PLATFORM_ADMIN_DATABASE_URL ??
      toRuntimeConnectionString(env.DATABASE_URL, {
        user: 'erp_platform_admin',
        password: 'erp_platform_admin_dev_password',
      });
    this.connection = createDatabaseConnection(adminUrl);
  }

  get db(): NodePgDatabase {
    return this.connection.db;
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection.close();
  }
}
