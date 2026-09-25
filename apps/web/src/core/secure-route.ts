// The preferred composition for protected workspace API routes.
//
// Pure and dependency-injected on purpose: no "next/*", no "server-only",
// no "@/" alias — so the security ordering below is unit-tested under plain
// `node --test` (secure-route.test.ts). core/workspace-route.ts wires the
// real dependencies; route handlers import `workspaceRoute` from there.
//
// Order, explicit and fixed:
//   1. same-origin/CSRF check for EVERY non-safe HTTP method (derived from
//      request.method, so a mutation cannot forget it), before any DB work;
//   2. authenticated, MFA-satisfied workspace session (server-resolved);
//   3. one transaction/client (tenant RLS by default — the tenant is the
//      session's organization, never request input);
//   4. principal, plus a WorkspaceAccessSnapshot when module/scope checks
//      are requested;
//   5. Shared Access authorize(): module → permission(s);
//   6. billing write gate (opt-in, mutations only);
//   7. the handler — which still owns validation, record/domain policy,
//      business logic and audit.
import type {
  AccessDecision,
  AccessPrincipal,
  AuthorizeInput,
  WorkspaceAccessSnapshot,
} from "@vercentlabs/api/access";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type SecureRouteTransaction = "tenant" | "platform" | "none";

export type SecureRouteOptions = {
  /** Business module that must be released, enabled, entitled and permitted. */
  module?: string;
  /** Permission(s) the caller must hold (all of them). */
  permission?: string;
  permissions?: readonly string[];
  /** Stable action label for audit/observability, e.g. "crm.lead_source.create". */
  action?: string;
  /** Require an active, writable subscription (business-data mutations only). */
  billingWrite?: boolean;
  /**
   * "tenant" (default): tenant-RLS transaction for the session's organization.
   * "platform": plain transaction for public/platform tables (Settings).
   * "none": a single pooled client, no transaction (read-only platform reads).
   */
  transaction?: SecureRouteTransaction;
  /** Build the full WorkspaceAccessSnapshot even without a module check. */
  snapshot?: boolean;
  /**
   * Also record a durable audit event when an AUTHENTICATED caller is denied
   * (403, or a concealed 404). Only for high-value administration routes:
   * every denial is already logged; persisting all of them would let a
   * client flood the audit table.
   */
  auditDenial?: boolean;
};

export type DeniedAccessEvent = {
  principal: AccessPrincipal;
  request: Request;
  status: number;
  code: string | null;
  module: string | null;
  action: string | null;
  permission: string | null;
};

type ErrorShape = { status?: unknown; code?: unknown; deniedCode?: unknown; permission?: unknown };

function deniedStatus(error: unknown): { status: number; code: string | null; permission: string | null } | null {
  if (typeof error !== "object" || error === null) return null;
  const shape = error as ErrorShape;
  const status = typeof shape.status === "number" ? shape.status : null;
  const code = typeof shape.deniedCode === "string" ? shape.deniedCode : typeof shape.code === "string" ? shape.code : null;
  const concealed = status === 404 && typeof shape.deniedCode === "string";
  if (status !== 403 && !concealed) return null;
  return { status, code, permission: typeof shape.permission === "string" ? shape.permission : null };
}

export type SecureRouteContext<Session, Client> = {
  request: Request;
  session: Session;
  principal: AccessPrincipal;
  snapshot: WorkspaceAccessSnapshot | null;
  client: Client;
};

type Denial = Extract<AccessDecision, { allowed: false }>;

export type SecureRouteDeps<Session extends { organizationId: string }, Client> = {
  assertOrigin(request: Request): void;
  requireSession(): Promise<Session>;
  runTenant<T>(organizationId: string, work: (client: Client) => Promise<T>): Promise<T>;
  runPlatform<T>(work: (client: Client) => Promise<T>): Promise<T>;
  runClient<T>(work: (client: Client) => Promise<T>): Promise<T>;
  createPrincipal(session: Session): AccessPrincipal;
  buildSnapshot(client: Client, session: Session): Promise<WorkspaceAccessSnapshot>;
  authorize(input: AuthorizeInput): AccessDecision;
  denialToError(decision: Denial): Error;
  onDenied?(decision: Denial, principal: AccessPrincipal, request: Request): void;
  requireBillingWrite(client: Client, organizationId: string): Promise<unknown>;
  toErrorResponse(error: unknown): Response;
  /** Durable audit for auditDenial routes; must use its own connection (the request transaction has rolled back). */
  recordDeniedAccess?(event: DeniedAccessEvent): Promise<void>;
  /** Structured log for a denial raised by the handler/domain (authorize() denials use onDenied). */
  logDeniedAccess?(event: DeniedAccessEvent): void;
};

export function isMutationRequest(request: Request) {
  return !SAFE_METHODS.has(String(request.method || "GET").toUpperCase());
}

export function createSecureRoute<Session extends { organizationId: string }, Client>(
  deps: SecureRouteDeps<Session, Client>,
) {
  return async function secureRoute(
    request: Request,
    options: SecureRouteOptions,
    handler: (context: SecureRouteContext<Session, Client>) => Promise<Response>,
  ): Promise<Response> {
    let principal: AccessPrincipal | null = null;
    try {
      const mutation = isMutationRequest(request);
      if (mutation) deps.assertOrigin(request);
      if (options.billingWrite && !mutation) {
        throw new TypeError("secureRoute: billingWrite applies to mutations only.");
      }

      const session = await deps.requireSession();
      const transaction = options.transaction ?? "tenant";
      const run =
        transaction === "none"
          ? deps.runClient
          : transaction === "platform"
            ? deps.runPlatform
            : <T>(work: (client: Client) => Promise<T>) => deps.runTenant(session.organizationId, work);

      return await run(async (client) => {
        const snapshot = options.module || options.snapshot ? await deps.buildSnapshot(client, session) : null;
        principal = snapshot?.principal ?? deps.createPrincipal(session);
        const decision = deps.authorize({
          principal,
          snapshot,
          module: options.module,
          permission: options.permission,
          permissions: options.permissions,
          action: options.action,
        });
        if (!decision.allowed) {
          deps.onDenied?.(decision, principal!, request);
          throw deps.denialToError(decision);
        }
        if (options.billingWrite) await deps.requireBillingWrite(client, principal!.organizationId);
        return handler({ request, session, principal: principal!, snapshot, client });
      });
    } catch (error) {
      const denial = principal ? deniedStatus(error) : null;
      if (denial && principal) {
        const event: DeniedAccessEvent = {
          principal,
          request,
          status: denial.status,
          code: denial.code,
          module: options.module ?? null,
          action: options.action ?? null,
          permission: denial.permission ?? options.permission ?? null,
        };
        if (!(error instanceof Error && error.name === "AccessDeniedError")) deps.logDeniedAccess?.(event);
        if (options.auditDenial && deps.recordDeniedAccess) {
          // Best-effort: failing to write evidence must never turn the
          // intended 403/404 into an unrelated 500.
          try {
            await deps.recordDeniedAccess(event);
          } catch {
            // recordDeniedAccess implementations log their own failures.
          }
        }
      }
      return deps.toErrorResponse(error);
    }
  };
}
