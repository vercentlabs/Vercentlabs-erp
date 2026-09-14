import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { NextResponse } from "next/server";

import { resolveSessionContext, type ModuleAccess } from "@vercentlabs/api";

import { withClient } from "@/core/db";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "vercentlabs_session";

export type SessionContext = {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  locale: string;
  timezone: string;
  emailVerified: boolean;
  organizationId: string | null;
  organizationName: string | null;
  membershipRole: "owner" | "admin" | "member" | null;
  roleSlugs: string[];
  permissions: string[];
  activeCompanyId: string | null;
  companyName: string | null;
  activeBranchId: string | null;
  branchName: string | null;
};

export type WorkspaceSessionContext = SessionContext & {
  organizationId: string;
};

export function setSessionCookie(
  response: NextResponse,
  session: { token: string; expiresAt: Date },
) {
  response.cookies.set(COOKIE_NAME, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}

async function resolveFromToken(
  token: string,
  sessionType: "browser" | "mobile",
) {
  return withClient((client) =>
    resolveSessionContext(client, token, sessionType, process.env),
  ) as Promise<SessionContext | null>;
}

// Request-scoped memoization only (React's cache() dedupes by call within
// one render/request, never across requests) — so the root (workspace)
// layout and any per-module route-group layout can each call
// getSessionContext()/requireWorkspace() without re-running the session
// query for the same request. Ported convention from the recovered
// apps/web/src/core/auth.ts (see PLATFORM_PORT_REGISTER.csv).
export const getSessionContext = cache(
  async (): Promise<SessionContext | null> => {
    const requestHeaders = await headers();
    const authorization = requestHeaders.get("authorization") || "";
    const bearer = authorization.match(/^Bearer ([A-Za-z0-9_-]{40,200})$/)?.[1];
    if (bearer) return resolveFromToken(bearer, "mobile");
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;
    return token ? resolveFromToken(token, "browser") : null;
  },
);

export async function requireUser(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  return session;
}

export async function requireVerifiedUser(): Promise<SessionContext> {
  const session = await requireUser();
  if (!session.emailVerified)
    redirect("/verify-email?email=" + encodeURIComponent(session.email));
  return session;
}

export async function requireWorkspace(): Promise<WorkspaceSessionContext> {
  const session = await requireVerifiedUser();
  if (!session.organizationId) redirect("/onboarding");
  return session as WorkspaceSessionContext;
}

export async function requireApiWorkspace(): Promise<WorkspaceSessionContext> {
  const session = await getSessionContext();
  if (!session?.organizationId) {
    throw new Error("An authenticated organisation workspace is required.");
  }
  return session as WorkspaceSessionContext;
}

export function nextPath(session: SessionContext) {
  if (!session.emailVerified)
    return "/verify-email?email=" + encodeURIComponent(session.email);
  if (!session.organizationId) return "/onboarding";
  return "/";
}

export type { ModuleAccess };
