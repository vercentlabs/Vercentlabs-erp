// The one catalogue of developer API scopes. A scope exists here only when a
// real /api/v1 endpoint consumes it; keys can be issued only with these, and
// a stored scope string that is not registered grants nothing. An API scope
// is a machine grant, not a human permission: it does not carry any user's
// roles or RBAC permissions.
export const API_SCOPES = Object.freeze([
  Object.freeze({
    key: "platform.context.read",
    displayName: "Read workspace context",
    description: "The organization's name, this app's identity, the key's scopes and the modules enabled for the organization.",
    risk: "low",
    consumedBy: Object.freeze(["GET /api/v1/platform/context"]),
  }),
]);

const BY_KEY = new Map(API_SCOPES.map((scope) => [scope.key, scope]));

export function getApiScope(key) {
  return BY_KEY.get(String(key || "")) || null;
}

export const API_VERSION = "v1";
