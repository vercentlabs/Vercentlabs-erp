// CRM automation rules (tenant.crm_automation_rules): when a CRM event fires,
// every active rule whose conditions match runs its actions through the same
// governed CRM record commands the UI uses, inside a savepoint per rule, and
// each run is recorded in tenant.crm_automation_runs.
//
// The record commands and this engine call each other on purpose: actions
// create/update records, and those commands raise the events that run
// automation. That recursion is the reason for the import of
// ../resource-mutation-service.js below.
import { createNotification } from "../../../../core/platform/notifications/index.js";
import { criteriaMatches } from "../condition-matching.js";
import { CrmError } from "../errors.js";
import { queueOutboxEvent } from "../outbox.js";
import { createCrmRecord, updateCrmRecord } from "../resource-mutation-service.js";
import { assertActiveOrganizationUsers, isPlainObject } from "../resource-validation.js";

// Automation entity type → CRM web route segment.
const CRM_NOTIFICATION_ROUTE = Object.freeze({ lead: "leads", opportunity: "opportunities", party: "accounts", contact: "contacts", campaign: "campaigns", activity: "activities" });

export async function runCrmAutomation(
  client,
  context,
  eventType,
  entityType,
  entityId,
  payload,
) {
  const rules = await client.query(
    `SELECT * FROM tenant.crm_automation_rules WHERE organization_id = $1 AND event_type = $2 AND status = 'active' ORDER BY sequence, name`,
    [context.organizationId, eventType],
  );
  const results = [];
  for (const rule of rules.rows) {
    if (!criteriaMatches(payload, rule.conditions)) {
      results.push({ ruleId: rule.id, status: "skipped" });
      continue;
    }
    const output = [];
    await client.query("SAVEPOINT crm_automation_rule");
    try {
      for (const action of Array.isArray(rule.actions) ? rule.actions : []) {
        if (action.type === "create_activity") {
          const created = await createCrmRecord(client, context, "activities", {
            entityType,
            entityId,
            activityType: action.activityType || "task",
            subject:
              action.subject ||
              `Follow up: ${payload.name || payload.fullName || entityType}`,
            description: action.description || null,
            assignedTo:
              action.assignedTo || payload.ownerUserId || context.userId,
            dueAt: new Date(
              Date.now() + Number(action.delayMinutes || 0) * 60000,
            ).toISOString(),
          });
          output.push({ action: action.type, id: created.id });
        }
        if (action.type === "notification" && action.userId) {
          await assertActiveOrganizationUsers(client, context, [action.userId]);
          await createNotification(client, {
            organizationId: context.organizationId,
            userId: action.userId,
            category: "crm_automation",
            title: action.title || "CRM automation",
            message: action.message || "A CRM automation rule ran.",
            // Always the triggering record's real route, so the link works and
            // notification redaction (notification-visibility.js) can
            // re-check access to it; a free-form href is not accepted.
            href: `/crm/${CRM_NOTIFICATION_ROUTE[entityType] ?? `${entityType}s`}/${entityId}`,
            entityType: `crm_${entityType}`,
            entityId,
          });
          output.push({ action: action.type });
        }
        if (action.type === "update_record" && isPlainObject(action.fields)) {
          const targetResource =
            entityType === "lead"
              ? "leads"
              : entityType === "opportunity"
                ? "opportunities"
                : entityType === "activity"
                  ? "activities"
                  : null;
          if (!targetResource)
            throw new CrmError(
              400,
              `Automation cannot update ${entityType} records.`,
            );
          await updateCrmRecord(
            client,
            context,
            targetResource,
            entityId,
            action.fields,
          );
          output.push({ action: action.type, resource: targetResource });
        }
        if (action.type === "assign_owner" && action.userId) {
          const targetResource =
            entityType === "lead"
              ? "leads"
              : entityType === "opportunity"
                ? "opportunities"
                : entityType === "activity"
                  ? "activities"
                  : null;
          const ownerField =
            targetResource === "activities" ? "assignedTo" : "ownerUserId";
          if (!targetResource)
            throw new CrmError(
              400,
              `Automation cannot assign ${entityType} records.`,
            );
          const membership = await client.query(
            `SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
            [context.organizationId, action.userId],
          );
          if (!membership.rows[0])
            throw new CrmError(
              409,
              "Automation owner must be an active organization member.",
            );
          await updateCrmRecord(client, context, targetResource, entityId, {
            [ownerField]: action.userId,
          });
          output.push({ action: action.type, userId: action.userId });
        }
        if (action.type === "enroll_sequence" && action.sequenceId) {
          const targetField =
            entityType === "lead"
              ? "leadId"
              : entityType === "opportunity"
                ? "opportunityId"
                : entityType === "contact"
                  ? "contactId"
                  : null;
          if (!targetField)
            throw new CrmError(
              400,
              `Automation cannot enroll ${entityType} in a sequence.`,
            );
          const enrollment = await createCrmRecord(
            client,
            context,
            "sequence-enrollments",
            {
              sequenceId: action.sequenceId,
              [targetField]: entityId,
              currentStep: 0,
              nextRunAt: new Date(
                Date.now() + Number(action.delayMinutes || 0) * 60000,
              ).toISOString(),
              status: "active",
              enrolledBy: context.userId,
            },
          );
          output.push({ action: action.type, id: enrollment.id });
        }
        if (action.type === "create_recommendation" && action.title) {
          const recommendation = await createCrmRecord(
            client,
            context,
            "recommendations",
            {
              entityType,
              entityId,
              recommendationType:
                action.recommendationType || "next_best_action",
              title: action.title,
              rationale:
                action.rationale || "Created by a governed CRM automation.",
              actionPayload: action.actionPayload || {},
              priority: action.priority || "medium",
              confidence: action.confidence ?? null,
              source: "rules",
              dueAt: action.dueAt || null,
              status: "open",
            },
          );
          output.push({ action: action.type, id: recommendation.id });
        }
        if (action.type === "queue_communication") {
          const targetField =
            entityType === "lead"
              ? "leadId"
              : entityType === "opportunity"
                ? "opportunityId"
                : entityType === "contact"
                  ? "contactId"
                  : entityType === "party"
                    ? "partyId"
                    : null;
          if (!targetField)
            throw new CrmError(
              400,
              `Automation cannot communicate with ${entityType}.`,
            );
          const communication = await createCrmRecord(
            client,
            context,
            "communications",
            {
              channel: action.channel || "email",
              direction: "outbound",
              [targetField]: entityId,
              provider: action.provider || "outbox",
              subject: action.subject || null,
              body: action.body || "",
              fromAddress: action.fromAddress || null,
              toAddresses: Array.isArray(action.toAddresses)
                ? action.toAddresses
                : [],
              status: "queued",
              occurredAt: new Date().toISOString(),
              metadata: { automationRuleId: rule.id },
            },
          );
          output.push({ action: action.type, id: communication.id });
        }
        if (action.type === "emit_event" && action.eventType) {
          await queueOutboxEvent(
            client,
            context,
            action.eventType,
            entityType,
            entityId,
            isPlainObject(action.payload) ? action.payload : payload,
          );
          output.push({ action: action.type, eventType: action.eventType });
        }
      }
      await client.query(
        `INSERT INTO tenant.crm_automation_runs (organization_id, rule_id, event_type, entity_type, entity_id, status, result, finished_at) VALUES ($1, $2, $3, $4, $5, 'succeeded', $6, now())`,
        [
          context.organizationId,
          rule.id,
          eventType,
          entityType,
          entityId,
          output,
        ],
      );
      await client.query("RELEASE SAVEPOINT crm_automation_rule");
      results.push({ ruleId: rule.id, status: "succeeded", output });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT crm_automation_rule");
      await client.query("RELEASE SAVEPOINT crm_automation_rule");
      await client.query(
        `INSERT INTO tenant.crm_automation_runs (organization_id, rule_id, event_type, entity_type, entity_id, status, error_message, finished_at) VALUES ($1, $2, $3, $4, $5, 'failed', $6, now())`,
        [
          context.organizationId,
          rule.id,
          eventType,
          entityType,
          entityId,
          String(error?.message || error),
        ],
      );
      results.push({ ruleId: rule.id, status: "failed" });
    }
  }
  return results;
}
