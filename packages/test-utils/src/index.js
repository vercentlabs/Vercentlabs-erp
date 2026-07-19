export const TEST_TENANTS = Object.freeze({
  alpha: Object.freeze({ organizationId: "018f1ec7-49c3-7a52-8c4e-52e164537a01", companyId: "018f1ec7-49c3-7a52-8c4e-52e164537a02", userId: "018f1ec7-49c3-7a52-8c4e-52e164537a03" }),
  beta: Object.freeze({ organizationId: "018f1ec7-49c3-7a52-8c4e-52e164537b01", companyId: "018f1ec7-49c3-7a52-8c4e-52e164537b02", userId: "018f1ec7-49c3-7a52-8c4e-52e164537b03" }),
});

export function createQueryRecorder(responses = []) {
  const calls = [];
  return { calls, async query(text, values = []) { calls.push({ text, values }); const response = responses.shift(); return response || { rows: [], rowCount: 0 }; } };
}

export function productionGuard(environment = process.env) {
  if (environment.NODE_ENV === "production" || environment.VERCENT_ENV_TARGET === "production") throw new Error("Test utility execution is forbidden in production.");
}
