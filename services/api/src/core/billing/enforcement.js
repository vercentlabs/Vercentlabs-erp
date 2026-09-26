// observe: report billing limits without blocking (default outside production);
// enforce: block. Set explicitly with BILLING_ENFORCEMENT_MODE.
export function billingEnforcementMode(env = process.env) {
  const configured = env.BILLING_ENFORCEMENT_MODE?.toLowerCase();
  if (configured === "observe" || configured === "enforce") return configured;
  return env.NODE_ENV === "production" ? "enforce" : "observe";
}
