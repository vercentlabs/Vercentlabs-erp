import { DomainValidationError } from '@vercentlabs/contracts';
import type { z } from 'zod';

/**
 * Small, deliberate duplicate of apps/api/src/platform/http/http-inputs.ts's
 * `parseBody`/`parseQuery` - identity/ and platform/ are separate HTTP
 * surfaces with separate auth boundaries (see
 * docs/architecture/trusted-request-context.md), and this is a six-line
 * zod-to-DomainValidationError adapter, not shared business logic; keeping
 * it local avoids a cross-module HTTP-layer dependency for something this
 * small.
 */
function formatZodError(error: z.ZodError): { field?: string; message: string }[] {
  return error.issues.map((issue) => {
    const field = issue.path.join('.');
    return field ? { field, message: issue.message } : { message: issue.message };
  });
}

export function parseBody<Schema extends z.ZodTypeAny>(
  schema: Schema,
  body: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new DomainValidationError(
      'The request body failed validation.',
      formatZodError(result.error),
    );
  }
  return result.data;
}

export function parseQuery<Schema extends z.ZodTypeAny>(
  schema: Schema,
  query: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw new DomainValidationError(
      'The query parameters failed validation.',
      formatZodError(result.error),
    );
  }
  return result.data;
}
