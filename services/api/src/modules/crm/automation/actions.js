// What a CRM automation can do beyond a notification (CRM plan 4.6). Settings › Automations offers these for CRM events (a lead
// created, assigned or moved; a deal moved, won or lost; a company or contact added or changed…): plan a follow-up, give the record an
// owner, set its priority, tag it, email the person from a template, tell the record's followers — and (CRM audit) create a task, move
// the record to a stage, send a WhatsApp template, or send the event to one of the company's webhooks. The core workflow engine (core/platform/workflows) loads this file only for
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
import { changeLeadStage } from "../leads/records.js";
import { changeOpportunityStage } from "../opportunities/stages.js";
import { createTask } from "../tasks/records.js";
import { sendWhatsApp } from "../whatsapp/records.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY = Object.freeze({ "crm.lead": "lead", "crm.opportunity": "opportunity", "crm.party": "party", "crm.contact": "contact" });
const TABLE = Object.freeze({ lead: "crm_leads", opportunity: "crm_opportunities", party: "business_parties", contact: "contacts" });
// The actions that work on companies and contacts too; the rest change what only leads and deals have (an owner rule, a priority, tags,
// a stage).
const EVERY_RECORD = new Set(["crm.create_follow_up", "crm.send_email", "crm.notify_followers", "crm.create_task", "crm.send_whatsapp", "crm.call_webhook"]);
const text = (value) => String(value ?? "").trim();
const invalid = (message) => new CrmError(400, message, "WORKFLOW_DEFINITION_INVALID");

// The authority an action runs with: the given member while still active, else an active owner (data-management/system-actor.js),
// holding only CRM permissions, seeing every CRM record.
async function systemAuthority(client, organizationId, actAs = null) {
  return {
    organizationId, userId: await integrationActor(client, organizationId, actAs), roleSlugs: [], workflowOrigin: true,
    permissions: ["crm.view", "crm.records.view_all", "crm.leads.view", "crm.leads.view_all", "crm.leads.edit", "crm.leads.assign", "crm.leads.reassign", "crm.leads.view_sensitive",
      "crm.opportunities.view", "crm.opportunities.view_all", "crm.opportunities.edit", "crm.opportunities.assign", "crm.opportunities.reassign",
      "crm.follow_ups.create", "crm.follow_ups.view_all", "crm.contacts.view", "crm.contacts.view_all", "crm.accounts.view", "crm.accounts.view_all",
      "crm.contacts.edit", "crm.accounts.edit", "crm.leads.change_stage", "crm.opportunities.change_stage", "crm.tasks.create", "crm.tasks.assign", "crm.tasks.view_all"],
  };
}

async function member(client, organizationId, userId) {
  return Boolean(UUID.test(String(userId ?? "")) && (await client.query("SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'", [organizationId, userId])).rows[0]);
}

// Checks one action as saved (returns its clean form), or refuses it with a sentence for the person setting it up.
export async function validateCrmWorkflowAction(client, organizationId, action, { eventEntityType, userFields }) {
  if (!ENTITY[eventEntityType]) throw invalid("This action works on lead, deal, company and contact events only.");
  if (!["crm.lead", "crm.opportunity"].includes(eventEntityType) && !EVERY_RECORD.has(action.type)) throw invalid("This action works on lead and deal events only.");
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
  if (action.type === "crm.create_task") {
    const subject = text(action.subject).slice(0, 200);
    if (!subject) throw invalid("Say what the task is.");
    const inDays = Number(action.inDays);
    if (!Number.isInteger(inDays) || inDays < 0 || inDays > 365) throw invalid("Make the task due 0 to 365 days after the event.");
    if (!["low", "medium", "high"].includes(action.priority ?? "medium")) throw invalid("Choose a priority.");
    const assignee = action.assignee?.type === "user" ? { type: "user", userId: text(action.assignee.userId) } : { type: "record_owner" };
    if (assignee.type === "user" && !(await member(client, organizationId, assignee.userId))) throw invalid("Choose an active member to give the task to.");
    return { type: action.type, subject, inDays, priority: action.priority ?? "medium", assignee };
  }
  if (action.type === "crm.move_stage") {
    const stageCode = text(action.stageCode);
    const known = eventEntityType === "crm.lead"
      ? (await client.query("SELECT 1 FROM tenant.crm_lead_stages WHERE organization_id = $1 AND code = $2 AND is_active", [organizationId, stageCode])).rows[0]
      : (await client.query("SELECT 1 FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND code = $2 AND status = 'active' AND NOT is_won AND NOT is_lost", [organizationId, stageCode])).rows[0];
    if (!stageCode || !known) throw invalid(eventEntityType === "crm.lead" ? "Choose an active lead stage." : "Choose an open deal stage (won and lost are marked by people).");
    return { type: action.type, stageCode };
  }
  if (action.type === "crm.send_whatsapp") {
    const templateName = text(action.templateName);
    if (!/^[a-z0-9_]{1,512}$/.test(templateName)) throw invalid("Use the template's name as approved in WhatsApp Manager (lower case and underscores).");
    const templateLanguage = text(action.templateLanguage) || "en";
    if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(templateLanguage)) throw invalid("Use the template's language code, such as en or hi.");
    const parameters = (Array.isArray(action.parameters) ? action.parameters : []).slice(0, 10).map((value) => text(value).slice(0, 200));
    return { type: action.type, templateName, templateLanguage, parameters };
  }
  if (action.type === "crm.call_webhook") {
    const subscription = UUID.test(String(action.subscriptionId ?? ""))
      ? (await client.query("SELECT id FROM tenant.webhook_subscriptions WHERE organization_id = $1 AND id = $2 AND status = 'active'", [organizationId, action.subscriptionId])).rows[0] : null;
    if (!subscription) throw invalid("Choose an active webhook (Settings › Integrations › Webhooks).");
    return { type: action.type, subscriptionId: subscription.id };
  }
  throw invalid("An action is not supported.");
}

const readPath = (data, path) => String(path ?? "").split(".").reduce((value, key) => (value === null || value === undefined ? undefined : value[key]), data);

// Runs one action for an event. Returns { type, done, reason? } for the run's evidence; a refusal by the CRM (consent, a full calendar…)
// is recorded, not thrown, so the other actions still run.
export async function executeCrmWorkflowAction(client, organizationId, action, { entity, data, eventId = null }) {
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
    } else if (action.type === "crm.create_task") {
      const assignedTo = action.assignee.type === "user" ? action.assignee.userId : record.owner_user_id;
      const due = new Date(Date.now() + action.inDays * 86400000).toISOString().slice(0, 10);
      const task = await createTask(client, authority, { title: action.subject, priority: action.priority, relatedType: type, relatedId: id, dueDate: due,
        ...(UUID.test(String(assignedTo ?? "")) ? { assignedTo } : {}), description: "Created by an automation." });
      result = { type: action.type, done: true, taskId: task.id };
    } else if (action.type === "crm.move_stage") {
      if (type === "lead") {
        const moved = await changeLeadStage(client, authority, id, { stage: action.stageCode, note: "Moved by an automation" });
        result = { type: action.type, done: Boolean(moved.changed), ...(moved.changed ? {} : { reason: "ALREADY_THERE" }) };
      } else {
        const stage = (await client.query("SELECT id FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND pipeline_id = $2 AND code = $3 AND status = 'active'",
          [organizationId, record.pipeline_id, action.stageCode])).rows[0];
        if (!stage) result = { type: action.type, done: false, reason: "STAGE_NOT_IN_PIPELINE" };
        else {
          const moved = await changeOpportunityStage(client, authority, id, { stageId: stage.id, note: "Moved by an automation" });
          result = { type: action.type, done: moved.changed !== false, ...(moved.changed === false ? { reason: "ALREADY_THERE" } : {}) };
        }
      }
    } else if (action.type === "crm.send_whatsapp") {
      const values = action.parameters.map((value) => value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => String(readPath(data, key) ?? record[key] ?? "")));
      const sent = await sendWhatsApp(client, authority, type, id, { templateName: action.templateName, templateLanguage: action.templateLanguage, parameters: values });
      result = { type: action.type, done: sent.status === "sent" };
    } else if (action.type === "crm.call_webhook") {
      if (!UUID.test(String(eventId ?? ""))) result = { type: action.type, done: false, reason: "NO_EVENT" };
      else {
        // The platform's own delivery queue: signed, retried and kept safe from internal addresses like any webhook.
        const queued = await client.query(
          `INSERT INTO tenant.webhook_deliveries (organization_id, event_id, subscription_id, event_type)
           SELECT $1, event.id, subscription.id, event.event_type FROM tenant.platform_events event, tenant.webhook_subscriptions subscription
            WHERE event.organization_id = $1 AND event.id = $2 AND subscription.organization_id = $1 AND subscription.id = $3 AND subscription.status = 'active'
           ON CONFLICT (event_id, subscription_id) DO NOTHING`, [organizationId, eventId, action.subscriptionId]);
        result = { type: action.type, done: queued.rowCount > 0, ...(queued.rowCount ? {} : { reason: "ALREADY_QUEUED_OR_INACTIVE" }) };
      }
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

