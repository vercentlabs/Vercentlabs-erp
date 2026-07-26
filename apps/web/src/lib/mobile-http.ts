import { randomUUID } from "node:crypto";

import type { NextResponse } from "next/server";

import { errorResponse, ok } from "@/lib/http";

function requestId(request: Request) {
  const supplied = request.headers.get("x-request-id") || "";
  return /^[A-Za-z0-9_-]{8,80}$/.test(supplied) ? supplied : randomUUID();
}

function decorate(response: NextResponse, id: string) {
  response.headers.set("X-Request-ID", id);
  response.headers.set("X-Vercentlabs-API-Version", "mobile-v1");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export function mobileOk(
  request: Request,
  data: Record<string, unknown>,
  status = 200,
) {
  const id = requestId(request);
  return decorate(ok({ ...data, requestId: id }, status), id);
}

export function mobileError(request: Request, error: unknown) {
  return decorate(errorResponse(error), requestId(request));
}
