import { createHash } from "node:crypto";

import { clientIp, enforceRateLimit } from "@vercentlabs/api";

import { withIngressClient } from "./db";

export type PublicRateLimit = {
  /** Bucket name, e.g. "crm-meeting-book". Shows up in aggregated logs. */
  bucket: string;
  maximum: number;
  windowSeconds: number;
  /**
   * What the limit counts against. Omitted = the caller's IP address. A
   * secret (a booking token, a capture key) is hashed first, so it never lands
   * in a key column.
   */
  subject?: string;
};

// Durable limiter for unauthenticated endpoints. Counters live in
// auth_rate_limits, which every web replica shares; nothing is held in
// process memory, so limits hold across replicas and restarts. Runs before
// any organisation-scoped work, so a flood is refused cheaply.
export async function enforcePublicRateLimits(
  request: Request,
  limits: PublicRateLimit[],
): Promise<void> {
  const ip = clientIp(request, process.env);
  await withIngressClient(async (client) => {
    for (const limit of limits) {
      const subject =
        limit.subject === undefined
          ? `ip:${ip}`
          : `sub:${createHash("sha256").update(limit.subject).digest("hex").slice(0, 32)}`;
      await enforceRateLimit(
        client,
        `${limit.bucket}:${subject}`,
        limit.maximum,
        limit.windowSeconds,
      );
    }
  });
}
