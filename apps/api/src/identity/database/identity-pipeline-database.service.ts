import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  createDatabaseConnection,
  toRuntimeConnectionString,
  type DatabaseConnection,
} from '@vercentlabs/database';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { API_ENV, type ApiEnv } from '../../config/api-env.provider.js';

export const IDENTITY_PIPELINE_DB = Symbol('IDENTITY_PIPELINE_DB');

/**
 * Connects as `erp_auth_pipeline` (see
 * database/migrations/platform/0012_create_identity_auth_runtime_grants_and_rls.sql):
 * the login/recovery/verification/invitation pipeline, which resolves a
 * user by email or a possessed token BEFORE any per-user scope can be set -
 * the same structural reason platform.organizations needed
 * `erp_platform_admin` instead of `erp_runtime`. Used only by
 * `AuthController` (login, MFA completion, logout is
 * `IDENTITY_RUNTIME_DB`'s job) and the verification/invitation/password-
 * reset controllers.
 */
@Injectable()
export class IdentityPipelineDatabaseService implements OnModuleDestroy {
  private readonly connection: DatabaseConnection;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    const url =
      env.IDENTITY_PIPELINE_DATABASE_URL ??
      toRuntimeConnectionString(env.DATABASE_URL, {
        user: 'erp_auth_pipeline',
        password: 'erp_auth_pipeline_dev_password',
      });
    this.connection = createDatabaseConnection(url);
  }

  get db(): NodePgDatabase {
    return this.connection.db;
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection.close();
  }
}
