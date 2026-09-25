import type { CrmFoundationContext, QueryClient } from "../../../index.js";

export const REDACTED_CRM_NOTIFICATION: Readonly<{ title: string; message: string }>;
export function redactInaccessibleCrmNotifications<T extends { href?: string | null; title?: string; message?: string | null }>(
  client: QueryClient,
  context: CrmFoundationContext,
  notifications: T[],
  options?: { canUseCrm?: boolean },
): Promise<Array<T & { redacted?: boolean }>>;
