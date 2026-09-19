import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { NextResponse } from "next/server";

import { resolveSessionContext, type ModuleAccess } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { HttpError } from "@/core/http-errors";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "vercentlabs_session";

export type SessionContext = {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  locale: string;
  timezone: string;
  emailVerified: boolean;
  mfaEnrolled: boolean;
  mfaPolicyRequired: boolean;
  mfaVerified: boolean;
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

// SP007 step-up gate, same shape as requireVerifiedUser's email check: the
// session already exists (login is untouched), this just blocks it from
// reaching the workspace until the MFA follow-up is satisfied. Checks
// mfaEnrolled OR mfaPolicyRequired, not mfaPolicyRequired alone — a user
// who voluntarily enrolled with no org/admin policy forcing them must still
// be asked for a code every login, or self-service MFA would enroll a
// factor that's never actually checked.
export async function requireMfaVerifiedUser(): Promise<SessionContext> {
  const session = await requireVerifiedUser();
  if ((session.mfaEnrolled || session.mfaPolicyRequired) && !session.mfaVerified) redirect("/mfa-verify");
  return session;
}

export async function requireWorkspace(): Promise<WorkspaceSessionContext> {
  const session = await requireMfaVerifiedUser();
  if (!session.organizationId) redirect("/onboarding");
  return session as WorkspaceSessionContext;
}

// For the MFA API routes themselves (/api/auth/mfa/*): deliberately NOT
// MFA-gated or workspace-gated. verify/enroll must be reachable precisely
// in the state requireApiWorkspace would otherwise reject (mfaEnrolled or
// mfaPolicyRequired, not yet mfaVerified) — that IS the request those
// routes exist to resolve. Still requires a real, authenticated,
// email-verified session; only the MFA and organization checks are
// skipped.
export async function requireApiUser(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) throw new HttpError(401, "Authentication is required.", "AUTH_REQUIRED");
  if (!session.emailVerified) throw new HttpError(403, "Email verification is required.", "AUTH_EMAIL_UNVERIFIED");
  return session;
}

// The page-level requireWorkspace()/requireMfaVerifiedUser() redirect is
// UX only — a request that reaches an API route directly (a stolen session
// cookie, a replayed request, a client that just never followed the
// redirect) must be rejected here too, independently. Hiding a page is not
// authorization; this is the actual enforcement boundary route handlers run
// server-side on every call.
export async function requireApiWorkspace(): Promise<WorkspaceSessionContext> {
  const session = await getSessionContext();
  if (!session) throw new HttpError(401, "Authentication is required.", "AUTH_REQUIRED");
  if (!session.emailVerified) throw new HttpError(403, "Email verification is required.", "AUTH_EMAIL_UNVERIFIED");
  if ((session.mfaEnrolled || session.mfaPolicyRequired) && !session.mfaVerified) {
    throw new HttpError(403, "Multi-factor verification is required for this session.", "AUTH_MFA_REQUIRED");
  }
  if (!session.organizationId) {
    throw new HttpError(403, "An authenticated organisation workspace is required.", "AUTH_NO_WORKSPACE");
  }
  return session as WorkspaceSessionContext;
}

export function nextPath(session: SessionContext) {
  if (!session.emailVerified)
    return "/verify-email?email=" + encodeURIComponent(session.email);
  if ((session.mfaEnrolled || session.mfaPolicyRequired) && !session.mfaVerified) return "/mfa-verify";
  if (!session.organizationId) return "/onboarding";
  return "/";
}

export type { ModuleAccess };
