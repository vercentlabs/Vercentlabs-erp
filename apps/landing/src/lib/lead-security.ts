import { createHash } from "node:crypto";
import { isIP } from "node:net";

import { siteConfig } from "@/lib/site-config";

const memoryRateLimits = new Map<string, { count: number; resetAt: number }>();

export type RateLimitResult = {
  allowed: boolean;
  status: number;
  limit: number;
  remaining: number;
  resetAt: number;
  message?: string;
};

function allowedOrigins() {
  const configured = (process.env.FORM_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const siteOrigin =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || siteConfig.siteUrl;
  if (siteOrigin) configured.push(siteOrigin);

  if (process.env.NODE_ENV !== "production") {
    configured.push("http://localhost:3000", "http://127.0.0.1:3000");
  }

  return new Set(
    configured
      .map((origin) => {
        try {
          return new URL(origin).origin;
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  );
}

export function hasAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  return allowedOrigins().has(origin);
}

export async function readJsonBody(request: Request, maximumBytes = 50000) {
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > maximumBytes) {
    return { ok: false as const, status: 413, message: "The request is too large." };
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maximumBytes) {
    return { ok: false as const, status: 413, message: "The request is too large." };
  }

  try {
    return { ok: true as const, data: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false as const, status: 400, message: "Invalid JSON request." };
  }
}

function trustedClientIp(request: Request) {
  const configuredHeader =
    process.env.TRUSTED_PROXY_IP_HEADER?.trim().toLowerCase();
  if (!configuredHeader) {
    return process.env.NODE_ENV === "production" ? null : "local";
  }

  const rawValue = request.headers.get(configuredHeader);
  if (!rawValue) return null;
  const index = Math.max(
    0,
    Number.parseInt(process.env.TRUSTED_PROXY_CLIENT_INDEX || "0", 10) || 0,
  );
  const candidate = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)[index];
  return candidate && isIP(candidate) ? candidate : null;
}

export function leadFingerprint(request: Request) {
  const clientIp = trustedClientIp(request);
  if (!clientIp) return null;
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) || "unknown";
  return createHash("sha256")
    .update(`${clientIp}|${userAgent}`)
    .digest("hex");
}

function memoryRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): RateLimitResult {
  const now = Date.now();
  const current = memoryRateLimits.get(key);
  const resetAt =
    current && current.resetAt > now
      ? current.resetAt
      : now + windowSeconds * 1000;
  const count = current && current.resetAt > now ? current.count + 1 : 1;

  memoryRateLimits.set(key, { count, resetAt });
  if (memoryRateLimits.size > 2000) {
    for (const [entryKey, entry] of memoryRateLimits) {
      if (entry.resetAt <= now) memoryRateLimits.delete(entryKey);
    }
  }

  return {
    allowed: count <= limit,
    status: count <= limit ? 200 : 429,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
    message: count <= limit ? undefined : "Too many requests. Try again later.",
  };
}

export async function enforceLeadRateLimit(
  request: Request,
  bucket: string,
  limit = 5,
  windowSeconds = 3600,
): Promise<RateLimitResult> {
  const identity = leadFingerprint(request);
  if (!identity) {
    return {
      allowed: false,
      status: 503,
      limit,
      remaining: 0,
      resetAt: Date.now() + windowSeconds * 1000,
      message:
        "Form protection is not configured. Please use the email option.",
    };
  }

  const key = `vercentlabs:landing:${bucket}:${identity}`;
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    if (process.env.NODE_ENV === "production") {
      return {
        allowed: false,
        status: 503,
        limit,
        remaining: 0,
        resetAt: Date.now() + windowSeconds * 1000,
        message:
          "Form protection is not configured. Please use the email option.",
      };
    }
    return memoryRateLimit(key, limit, windowSeconds);
  }

  try {
    const response = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(windowSeconds), "NX"],
      ]),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Rate limit service failed");

    const result = (await response.json()) as Array<{
      result?: number | string;
      error?: string;
    }>;
    const count = Number(result[0]?.result || 0);
    const resetAt = Date.now() + windowSeconds * 1000;
    return {
      allowed: count > 0 && count <= limit,
      status: count > 0 && count <= limit ? 200 : 429,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt,
      message: count > limit ? "Too many requests. Try again later." : undefined,
    };
  } catch {
    return {
      allowed: false,
      status: 503,
      limit,
      remaining: 0,
      resetAt: Date.now() + windowSeconds * 1000,
      message:
        "Form protection is temporarily unavailable. Please use the email option.",
    };
  }
}
