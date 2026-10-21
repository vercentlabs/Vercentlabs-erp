// What a CRM automation can do beyond a notification (CRM plan 4.6). Settings › Automations offers these for CRM events (a lead
// created, assigned or moved; a deal moved, won or lost…): plan a follow-up, give the record an owner, set its priority, tag it, email
// the person from a template, or tell the record's followers. The core workflow engine (core/platform/workflows) loads this file only for
// a workflow that uses one of them, so the platform knows nothing of CRM.
//
// Each action runs inside the workflow run's transaction under a narrow system authority (the organization's creator, with only the CRM
// permissions the action needs), through the same CRM operations a person uses — so consent, visibility and validation still apply.
import { resolveActivityType } from "../activity-types/records.js";
import { integrationActor } from "../data-management/system-actor.js";
import { CrmError } from "../data-management/errors.js";
import { sendRecordEmail } from "../email/outbound.js";
import { notifyFollowers } from "../followers/records.js";
import { scheduleFollowUp } from "../follow-ups/records.js";
import { assignLead } from "../leads/assignment.js";
import { assignOpportunity } from "../opportunities/assignment.js";
import { setRecordTags, tagsByRecord } from "../tags/records.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY = Object.freeze({ "crm.lead": "lead", "crm.opportunity": "opportunity" });
const TABLE = Object.freeze({ lead: "crm_leads", opportunity: "crm_opportunities" });
const text = (value) => String(value ?? "").trim();
const invalid = (message) => new CrmError(400, message, "WORKFLOW_DEFINITION_INVALID");

// The authority an action runs with: the given member while still active, else an active owner (data-management/system-actor.js),
// holding only CRM permissions, seeing every CRM record.
async function systemAuthority(client, organizationId, actAs = null) {
  return {
    organizationId, userId: await integrationActor(client, organizationId, actAs), roleSlugs: [], workflowOrigin: true,
    permissions: ["crm.view", "crm.records.view_all", "crm.leads.view", "crm.leads.view_all", "crm.leads.edit", "crm.leads.assign", "crm.leads.reassign", "crm.leads.view_sensitive",
      "crm.opportunities.view", "crm.opportunities.view_all", "crm.opportunities.edit", "crm.opportunities.assign", "crm.opportunities.reassign",
      "crm.follow_ups.create", "crm.follow_ups.view_all", "crm.contacts.view", "crm.contacts.view_all", "crm.accounts.view", "crm.accounts.view_all"],
  };
}

async function member(client, organizationId, userId) {
  return Boolean(UUID.test(String(userId ?? "")) && (await client.query("SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'", [organizationId, userId])).rows[0]);
}

// Checks one action as saved (returns its clean form), or refuses it with a sentence for the person setting it up.
export async function validateCrmWorkflowAction(client, organizationId, action, { eventEntityType, userFields }) {
  if (!ENTITY[eventEntityType]) throw invalid("This action works on lead and deal events only.");
  if (action.type === "crm.create_follow_up") {
    // any active activity type of the organization (CRM plan 5.2), by its code
    const followUpType = text(action.followUpType);
    const known = await resolveActivityType(client, organizationId, { code: followUpType || "none" }).catch(() => null);
    if (!followUpType || !known) throw invalid("Choose how to follow up.");
    const inHours = Number(action.inHours);
    if (!Number.isFinite(inHours) || inHours < 0 || inHours > 24 * 90) throw invalid("Follow up within 0 to 2,160 hours (90 days).");
    const subject = text(action.subject).slice(0, 200);
    const assignee = action.assignee?.type === "user" ? { type: "user", userId: text(action.assignee.userId) }
      : action.assignee?.type === "event_field" ? { type: "event_field", field: text(action.assignee.field) } : { type: "record_owner" };
    if (assignee.type === "user" && !(await member(client, organizationId, assignee.userId))) throw invalid("Choose an active member to assign the follow-up to.");
    if (assignee.type === "event_field" && !userFields.has(assignee.field)) throw invalid("Choose who in the event gets the follow-up.");
    return { type: action.type, followUpType, inHours, subject, assignee };
  }
  if (action.type === "crm.assign_owner") {
    if (!(await member(client, organizationId, action.userId))) throw invalid("Choose an active member to give the record to.");
    return { type: action.type, userId: action.userId };
  }
  if (action.type === "crm.set_priority") {
    if (!["low", "medium", "high"].includes(action.priority)) throw invalid("Choose a priority.");
    return { type: action.type, priority: action.priority };
  }
  if (action.type === "crm.add_tag") {
    const tag = text(action.tag).slice(0, 60);
    if (!tag) throw invalid("Name the tag to add.");
    return { type: action.type, tag };
  }
  if (action.type === "crm.send_email") {
    const template = UUID.test(String(action.templateId ?? ""))
      ? (await client.query("SELECT id FROM tenant.crm_email_templates WHERE organization_id = $1 AND id = $2 AND status = 'active'", [organizationId, action.templateId])).rows[0] : null;
    if (!template) throw invalid("Choose an active email template.");
    return { type: action.type, templateId: template.id };
  }
  if (action.type === "crm.notify_followers") {
    const title = text(action.title).slice(0, 120);
    if (!title) throw invalid("Give the notice a title.");
    return { type: action.type, title, message: text(action.message).slice(0, 500) };
  }
  throw invalid("An action is not supported.");
}

const readPath = (data, path) => String(path ?? "").split(".").reduce((value, key) => (value === null || value === undefined ? undefined : value[key]), data);

// Runs one action for an event. Returns { type, done, reason? } for the run's evidence; a refusal by the CRM (consent, a full calendar…)
// is recorded, not thrown, so the other actions still run.
export async function executeCrmWorkflowAction(client, organizationId, action, { entity, data }) {
  const type = ENTITY[entity?.type];
  const id = entity?.id;
  if (!type || !UUID.test(String(id ?? ""))) return { type: action.type, done: false, reason: "NO_RECORD" };
  const record = (await client.query(`SELECT * FROM tenant.${TABLE[type]} WHERE organization_id = $1 AND id = $2`, [organizationId, id])).rows[0];
  if (!record) return { type: action.type, done: false, reason: "NO_RECORD" };
  const authority = await systemAuthority(client, organizationId);
  await client.query("SAVEPOINT crm_workflow_action");
  try {
    let result;
    if (action.type === "crm.create_follow_up") {
      const assignedTo = action.assignee.type === "user" ? action.assignee.userId
        : action.assignee.type === "event_field" ? readPath(data, action.assignee.field) : record.owner_user_id;
      const followUp = await scheduleFollowUp(client, authority, {
        relatedType: type, relatedId: id, type: action.followUpType, subject: action.subject || undefined,
        scheduledAt: new Date(Date.now() + action.inHours * 3600000).toISOString(), ...(UUID.test(String(assignedTo ?? "")) ? { assignedTo } : {}),
        notes: "Planned by an automation.",
      });
      result = { type: action.type, done: true, followUpId: followUp.id };
    } else if (action.type === "crm.assign_owner") {
      if (record.owner_user_id === action.userId) result = { type: action.type, done: false, reason: "ALREADY_OWNER" };
      else {
        if (type === "lead") await assignLead(client, authority, id, { ownerUserId: action.userId, reason: "Assigned by an automation" }, { method: "rule" });
        else await assignOpportunity(client, authority, id, { ownerUserId: action.userId, reason: "Assigned by an automation" });
        result = { type: action.type, done: true };
      }
    } else if (action.type === "crm.set_priority") {
      await client.query(`UPDATE tenant.${TABLE[type]} SET priority = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [organizationId, id, action.priority]);
      result = { type: action.type, done: true };
    } else if (action.type === "crm.add_tag") {
      const current = (await tagsByRecord(client, organizationId, type, [id])).get(id) ?? [];
      await setRecordTags(client, authority, type, id, [...current.map((tag) => ({ id: tag.id })), { name: action.tag }]);
      result = { type: action.type, done: true };
    } else if (action.type === "crm.send_email") {
      const { prepareRecordEmail } = await import("../email/outbound.js");
      // Sent in the owner's name, as they would send it.
      const sender = await systemAuthority(client, organizationId, record.owner_user_id ?? null);
      const draft = await prepareRecordEmail(client, sender, type, id, { templateId: action.templateId });
      if (!draft.to) result = { type: action.type, done: false, reason: "NO_EMAIL_ADDRESS" };
      else if (draft.refused) result = { type: action.type, done: false, reason: "REFUSED_EMAIL" };
      else {
        await sendRecordEmail(client, sender, type, id, { to: draft.to, subject: draft.subject, body: draft.body, templateId: action.templateId });
        result = { type: action.type, done: true };
      }
    } else if (action.type === "crm.notify_followers") {
      const told = await notifyFollowers(client, organizationId, type, id, { title: action.title, message: action.message, category: "crm_workflow" });
      result = { type: action.type, done: told > 0, told };
    } else {
      result = { type: action.type, done: false, reason: "UNSUPPORTED" };
    }
    await client.query("RELEASE SAVEPOINT crm_workflow_action");
    return result;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT crm_workflow_action");
    if (!(error instanceof CrmError)) throw error;
    return { type: action.type, done: false, reason: error.code ?? "REFUSED", message: error.message };
  }
}

