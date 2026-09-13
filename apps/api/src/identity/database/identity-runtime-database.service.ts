import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  createDatabaseConnection,
  toRuntimeConnectionString,
  type DatabaseConnection,
} from '@vercentlabs/database';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { API_ENV, type ApiEnv } from '../../config/api-env.provider.js';

export const IDENTITY_RUNTIME_DB = Symbol('IDENTITY_RUNTIME_DB');

/**
 * Connects as `erp_identity_runtime`: authenticated self-service only,
 * RLS-scoped to `app.current_user_id`. Used by every self-service
 * controller once a session is already known (profile, sessions, password
 * change, MFA management, step-up) - never for login itself.
 */
@Injectable()
export class IdentityRuntimeDatabaseService implements OnModuleDestroy {
  private readonly connection: DatabaseConnection;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    const url =
      env.IDENTITY_RUNTIME_DATABASE_URL ??
      toRuntimeConnectionString(env.DATABASE_URL, {
        user: 'erp_identity_runtime',
        password: 'erp_identity_runtime_dev_password',
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
