# Session and CSRF security (SP006)

See [session-model.md](../architecture/session-model.md) and
[ADR-0009](../decisions/ADR-0009-opaque-server-sessions.md) for the session
design. This document focuses on the CSRF threat model specifically.

## The cookie is not the CSRF defense

`SameSite=Lax` is set on the session cookie
(`apps/api/src/identity/auth/session-cookie.ts`), but it is **defense in
depth only**. `SameSite=Lax` still allows top-level cross-site navigations
(a plain `<a>` link, and in older/misconfigured browsers, some cross-site
`<form>` submissions) to carry the cookie, and relying on it alone as the
CSRF control has historically been a false sense of security once any
browser or proxy behavior deviates from the ideal.

CORS is also never relied on for CSRF protection. CORS is a
browser-enforced restriction on **reading a cross-origin response** - it
does nothing to stop a same-site `<form>` POST or any request the browser
is willing to SEND, only to stop the attacker's page from reading the
reply. A form-based CSRF attack bypasses CORS entirely, by design.

## The real control: `CsrfGuard`

`apps/api/src/identity/auth/csrf.guard.ts`, applied to every identity
controller. For any request whose method is not `GET`/`HEAD`/`OPTIONS`:

1. Missing `Origin` header -> `403 FORBIDDEN`. Browsers send `Origin` on
   every cross-origin fetch/XHR/form submission, and on same-origin
   requests too in every modern browser - a legitimate same-site client
   request will always have one. Treating "no Origin" as trusted would make
   the whole check trivially bypassable by simply omitting the header.
2. `Origin` present but not in the `API_CORS_ORIGINS` allowlist -> `403
   FORBIDDEN`.
3. Otherwise: allowed.

This is checked on **every** state-changing identity route, including
`POST /identity/auth/login` itself - login CSRF (forcing a victim's browser
to authenticate as an attacker-controlled account, potentially causing the
victim to unknowingly save sensitive data into that account) is a real,
named attack class, not merely "session riding" against an already-
authenticated session.

## Cookie flags, and why each one is set

| Flag | Value | Why |
|---|---|---|
| `HttpOnly` | true | Never readable by page JavaScript - defeats token exfiltration via XSS. |
| `Secure` | true (except explicit local-HTTP dev) | Never sent over plain HTTP. |
| `SameSite` | `Lax` | Defense in depth (see above) - not the primary control. |
| `Path` | `/` | Required for the `__Host-` prefix; also the simplest, least-surprising scope. |
| `Domain` | (absent) | Required for the `__Host-` prefix; also prevents the cookie being sent to sibling subdomains. |
| Name prefix | `__Host-` | Browser-enforced: a `__Host-`-prefixed cookie MUST be `Secure`, MUST have `Path=/`, and MUST NOT have a `Domain` attribute - so the browser itself refuses to accept a malformed one from a compromised or misconfigured response. |

The `__Host-` prefix is dropped only for the explicit,
documented `SESSION_COOKIE_INSECURE_LOCAL_HTTP=true` local-development
escape hatch (browsers reject a `Secure` cookie entirely over plain HTTP,
so local `pnpm dev` over `http://localhost` needs the non-`__Host-`,
non-`Secure` name to work at all). This flag must never be set in any
deployed environment - `packages/configuration/src/api-env.ts` defaults it
to `false`.

## Session token handling

- The raw token is ≥256 bits of cryptographic randomness, shown to the
  client exactly once (the `Set-Cookie` response at login/MFA completion).
- The server stores only its SHA-256 hash. A stolen database backup, or a
  read-only SQL injection elsewhere in the system, never yields a directly
  usable session token.
- Every session mutation (list/revoke/logout) runs through
  `erp_identity_runtime` under `withUserScope`, so PostgreSQL RLS enforces
  the ownership boundary independent of application code correctness.

## Verified in tests

`apps/api/test/identity-api.integration.test.ts` (real HTTP, real
PostgreSQL) proves: missing-`Origin` rejection, disallowed-`Origin`
rejection, cookie flags (`HttpOnly`, `SameSite=Lax`, `Path=/`, correct
name) on a real `Set-Cookie` response, 401 on no cookie, 401 on a forged/
garbage cookie value, and session invalidation after logout and after a
password change.
