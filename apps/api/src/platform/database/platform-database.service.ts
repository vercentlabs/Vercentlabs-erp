import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  createDatabaseConnection,
  toRuntimeConnectionString,
  type DatabaseConnection,
} from '@vercentlabs/database';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { API_ENV, type ApiEnv } from '../../config/api-env.provider.js';

export const PLATFORM_DB = Symbol('PLATFORM_DB');

/**
 * Owns the single connection pool platform domain commands/queries run
 * against. Always connects as the least-privilege `erp_runtime` role
 * (never the migration/admin role apps/api uses for health checks) - see
 * database/migrations/platform/0006_create_runtime_role_and_rls.sql and
 * docs/security/tenant-isolation.md.
 */
@Injectable()
export class PlatformDatabaseService implements OnModuleDestroy {
  private readonly connection: DatabaseConnection;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    const runtimeUrl = env.RUNTIME_DATABASE_URL ?? toRuntimeConnectionString(env.DATABASE_URL);
    this.connection = createDatabaseConnection(runtimeUrl);
  }

  get db(): NodePgDatabase {
    return this.connection.db;
  }

  async onModuleDestroy(): Promise<void> {
    await this.connection.close();
  }
}
