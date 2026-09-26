import { NextResponse, type NextRequest } from "next/server";

// Every request gets a request id and a correlation id before any route
// runs, even when no upstream proxy provided them. A caller-supplied value is
// accepted only if it is a short, safe token (never unbounded or free text);
// otherwise a fresh UUID is used. Route handlers read them from the request
// headers (workspaceRoute puts them in the log context and access-denial
// audit); the request id is echoed on the response for support tickets.
const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

function safeId(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && SAFE_ID.test(trimmed) ? trimmed : null;
}

export function proxy(request: NextRequest) {
  const requestId = safeId(request.headers.get("x-request-id")) ?? crypto.randomUUID();
  const correlationId = safeId(request.headers.get("x-correlation-id")) ?? requestId;
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-correlation-id", correlationId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
