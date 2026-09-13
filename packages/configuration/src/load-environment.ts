import type { z } from 'zod';

export interface LoadEnvironmentOptions {
  /**
   * Non-secret values applied only outside production, so local development
   * and CI can run without a `.env` file while production always fails fast
   * on missing configuration.
   */
  devDefaults?: Record<string, string>;
  source?: NodeJS.ProcessEnv | undefined;
}

export class EnvironmentValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'EnvironmentValidationError';
  }
}

export function loadEnvironment<Schema extends z.ZodTypeAny>(
  schema: Schema,
  options: LoadEnvironmentOptions = {},
): z.infer<Schema> {
  const source = options.source ?? process.env;
  const nodeEnv = source['NODE_ENV'] ?? 'development';
  const merged = nodeEnv === 'production' ? source : { ...options.devDefaults, ...source };

  const result = schema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new EnvironmentValidationError(issues);
  }
  return result.data;
}
