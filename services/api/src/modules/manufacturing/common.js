// Shared helpers for the Manufacturing modules (Bills of Materials, Manufacturing Orders).
export class MfgError extends Error {
  constructor(status, message, code = "MFG_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// The domain context of a workspace session.
export function manufacturingContext(session) {
  return { organizationId: session.organizationId, userId: session.userId, permissions: session.permissions || [], roleSlugs: session.roleSlugs || [] };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new MfgError(400, `${label} is invalid.`, "MFG_REFERENCE_INVALID");
  return String(value);
};
export const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
export const has = (c, p) => c.roleSlugs?.includes("organization_owner") || c.roleSlugs?.includes("system_administrator") || c.permissions?.includes(p);
