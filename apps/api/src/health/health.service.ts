import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import type { Pool } from 'pg';
import { Redis } from 'ioredis';
import { checkDatabaseReady } from '@vercentlabs/database';
import { API_ENV, type ApiEnv } from '../config/api-env.provider.js';

// pg is CommonJS without a statically-analyzable named export, so Node's ESM
// loader cannot do `import { Pool } from 'pg'` at runtime.
const { Pool: PoolCtor } = pg;

export interface ReadinessResult {
  status: 'ok' | 'degraded';
  checks: {
    postgres: boolean;
    redis: boolean;
  };
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly redis: Redis;

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    this.pool = new PoolCtor({
      connectionString: this.env.DATABASE_URL,
      connectionTimeoutMillis: 2000,
    });
    this.redis = new Redis(this.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    this.redis.on('error', () => {
      /* readiness checks handle failures explicitly; avoid unhandled 'error' crashes */
    });
  }

  async checkReadiness(): Promise<ReadinessResult> {
    const [postgres, redis] = await Promise.all([this.checkPostgres(), this.checkRedis()]);
    return { status: postgres && redis ? 'ok' : 'degraded', checks: { postgres, redis } };
  }

  private async checkPostgres(): Promise<boolean> {
    return checkDatabaseReady(this.pool);
  }

  private async checkRedis(): Promise<boolean> {
    try {
      if (this.redis.status === 'wait' || this.redis.status === 'end') {
        await this.redis.connect();
      }
      const pong = await this.redis.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
    this.redis.disconnect();
  }
}
