// The company setup wizard (Shared Platform plan 3): the steps a new company goes through once, in order —
//   1. legal details   legal name, PAN, GSTIN with its state, address, phone, logo
//   2. financial year  the month it starts and the company's time zone
//   3. app             the Free plan's one app (Standard and Custom include every app; the step is then done)
//   4. people          invite the team (optional: a one-person company skips it)
//   5. your data       the checklist of what to bring in (masters, opening stock, balances, open invoices)
// Each step reports done/not done from the data itself, so a company that filled its profile in Settings sees those steps done.
// Finishing (or skipping the rest) sets organizations.onboarding_completed_at; the home page then stops offering the wizard.
import { requireSessionPermission } from "../access/index.js";
import { getAppChoice } from "../billing/index.js";
import { audit } from "../security/request-security.js";
import { getCompanyProfile } from "./company-profile.js";

export const SETUP_STEPS = Object.freeze(["legal", "financial_year", "app", "people", "data"]);

export async function getSetupProgress(client, organizationId) {
  const profile = await getCompanyProfile(client, organizationId);
  const choice = await getAppChoice(client, organizationId).catch(() => null);
  const members = Number((await client.query(`SELECT count(*) FROM public.organization_memberships WHERE organization_id = $1 AND status = 'active'`, [organizationId])).rows[0].count);
  const invitations = Number((await client.query(
    `SELECT count(*) FROM public.organization_invitations WHERE organization_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`, [organizationId])).rows[0].count);
  const marked = (await client.query(`SELECT metadata FROM public.audit_events WHERE organization_id = $1 AND event_type = 'organization.setup.step_done' ORDER BY created_at`, [organizationId])).rows
    .map((row) => row.metadata?.step).filter(Boolean);
  const legalDone = Boolean(profile.legalName && profile.address.line1 && profile.address.stateCode && profile.address.postalCode && (profile.pan || profile.gstin));
  const steps = [
    { key: "legal", label: "Legal details", done: legalDone,
      missing: legalDone ? [] : [!profile.legalName && "legal name", !(profile.pan || profile.gstin) && "PAN or GSTIN", !profile.address.line1 && "address", !profile.address.stateCode && "state", !profile.address.postalCode && "PIN code"].filter(Boolean) },
    { key: "financial_year", label: "Financial year", done: marked.includes("financial_year") || legalDone && Boolean(profile.fiscalYearStartMonth), missing: [] },
    { key: "app", label: choice?.allowance ? "Your app" : "Apps", done: !choice || choice.allowance === null || !choice.needsChoice, missing: [] },
    { key: "people", label: "Invite your team", done: members > 1 || invitations > 0 || marked.includes("people"), optional: true, missing: [] },
    { key: "data", label: "Bring your data", done: marked.includes("data"), optional: true, missing: [] },
  ];
  const required = steps.filter((step) => !step.optional);
  return {
    steps,
    completedAt: profile.onboardingCompletedAt,
    readyToFinish: required.every((step) => step.done),
    nextStep: steps.find((step) => !step.done)?.key ?? null,
    profile,
  };
}

// A step the person says is done (the financial year as shown, "I'll invite people later", the data checklist read).
export async function markSetupStep(client, session, step) {
  requireSessionPermission(session, "organization.manage");
  if (!SETUP_STEPS.includes(step)) throw Object.assign(new Error("Unknown setup step."), { status: 400, code: "SETUP_STEP_UNKNOWN" });
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "organization.setup.step_done", entityType: "organization", entityId: session.organizationId, metadata: { step } });
  return getSetupProgress(client, session.organizationId);
}

// Finishes the wizard. The required steps (legal details, app) must be done; the optional ones may be left for later.
export async function completeSetup(client, session) {
  requireSessionPermission(session, "organization.manage");
  const progress = await getSetupProgress(client, session.organizationId);
  if (!progress.readyToFinish) {
    const open = progress.steps.filter((step) => !step.optional && !step.done).map((step) => step.label);
    throw Object.assign(new Error(`Finish ${open.join(" and ")} first.`), { status: 409, code: "SETUP_INCOMPLETE", details: { open } });
  }
  await client.query(`UPDATE public.organizations SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()), updated_at = now() WHERE id = $1`, [session.organizationId]);
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "organization.setup.completed", entityType: "organization", entityId: session.organizationId });
  return getSetupProgress(client, session.organizationId);
}
