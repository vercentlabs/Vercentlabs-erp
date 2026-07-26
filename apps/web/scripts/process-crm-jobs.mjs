import path from "node:path";

import dotenv from "dotenv";
import pg from "pg";

import { setTenantContext } from "@vercentlabs/database";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const enforcementMode =
  process.env.BILLING_ENFORCEMENT_MODE?.toLowerCase() === "enforce"
    ? "enforce"
    : "observe";

function number(value) {
  return Number(value || 0);
}

function canConsume({ usage, limits, metric, quantity = 1 }) {
  const maximum = number(limits?.[metric]);
  if (enforcementMode !== "enforce" || maximum <= 0) return true;
  return number(usage[metric]) + quantity <= maximum;
}

async function incrementUsage(client, organizationId, metric, quantity = 1) {
  await client.query(
    `
      INSERT INTO public.billing_usage_monthly (
        organization_id, month_start, metric, quantity
      ) VALUES (
        $1, date_trunc('month', current_date)::date, $2, $3
      )
      ON CONFLICT (organization_id, month_start, metric)
      DO UPDATE SET
        quantity = public.billing_usage_monthly.quantity + EXCLUDED.quantity,
        updated_at = now()
    `,
    [organizationId, metric, quantity],
  );
}

let processed = 0;
let blockedByCapacity = 0;

try {
  const organizations = await pool.query(
    `
      SELECT
        organization.id,
        organization.created_by,
        subscription.status,
        subscription.trial_ends_at,
        subscription.grace_ends_at,
        subscription.limits_snapshot
      FROM public.organizations organization
      LEFT JOIN public.organization_subscriptions subscription
        ON subscription.organization_id = organization.id
      WHERE organization.status = 'active'
        AND (
          $1::boolean = false
          OR subscription.status IN ('active', 'authenticated', 'internal')
          OR (
            subscription.status = 'trialing'
            AND subscription.trial_ends_at >= now()
          )
          OR (
            subscription.status IN ('past_due', 'halted')
            AND subscription.grace_ends_at >= now()
          )
        )
    `,
    [enforcementMode === "enforce"],
  );

  for (const organization of organizations.rows) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await setTenantContext(client, organization.id);

      const usageResult = await client.query(
        `
          SELECT metric, quantity
          FROM public.billing_usage_monthly
          WHERE organization_id = $1
            AND month_start = date_trunc('month', current_date)::date
        `,
        [organization.id],
      );
      const usage = Object.fromEntries(
        usageResult.rows.map((row) => [row.metric, number(row.quantity)]),
      );
      const limits = organization.limits_snapshot || {};

      await client.query(
        `
          UPDATE tenant.crm_activities
          SET status = 'overdue', updated_at = now()
          WHERE organization_id = $1
            AND status IN ('planned', 'in_progress')
            AND due_at < now()
        `,
        [organization.id],
      );

      const enrollments = await client.query(
        `
          SELECT
            enrollment.*,
            sequence.owner_user_id,
            step.id AS step_id,
            step.action_type,
            step.subject_template,
            step.body_template,
            step.delay_minutes
          FROM tenant.crm_sequence_enrollments enrollment
          JOIN tenant.crm_sequences sequence
            ON sequence.id = enrollment.sequence_id
           AND sequence.status = 'active'
          JOIN tenant.crm_sequence_steps step
            ON step.sequence_id = enrollment.sequence_id
           AND step.step_order = enrollment.current_step + 1
          WHERE enrollment.organization_id = $1
            AND enrollment.status = 'active'
            AND COALESCE(enrollment.next_run_at, now()) <= now()
          ORDER BY enrollment.next_run_at NULLS FIRST
          LIMIT 100
          FOR UPDATE OF enrollment SKIP LOCKED
        `,
        [organization.id],
      );

      for (const row of enrollments.rows) {
        const isOutbound = !["task", "call"].includes(row.action_type);
        if (
          !canConsume({
            usage,
            limits,
            metric: "automation_actions_monthly",
          }) ||
          (isOutbound &&
            !canConsume({
              usage,
              limits,
              metric: "outbound_messages_monthly",
            }))
        ) {
          blockedByCapacity += 1;
          break;
        }

        const entityType = row.lead_id
          ? "lead"
          : row.opportunity_id
            ? "opportunity"
            : "contact";
        const entityId = row.lead_id || row.opportunity_id || row.contact_id;
        const actorId = row.owner_user_id || organization.created_by;

        if (!isOutbound) {
          await client.query(
            `
              INSERT INTO tenant.crm_activities (
                organization_id, entity_type, entity_id, activity_type,
                subject, description, status, assigned_to, due_at,
                created_by, updated_by
              ) VALUES (
                $1, $2, $3, $4, $5, $6, 'planned', $7, now(), $7, $7
              )
            `,
            [
              organization.id,
              entityType,
              entityId,
              row.action_type,
              row.subject_template || `Sequence ${row.action_type}`,
              row.body_template,
              actorId,
            ],
          );
        } else {
          const communication = await client.query(
            `
              INSERT INTO tenant.crm_communications (
                organization_id, channel, direction, lead_id,
                opportunity_id, contact_id, provider, subject, body,
                status, occurred_at, created_by, updated_by
              ) VALUES (
                $1, $2, 'outbound', $3, $4, $5, 'sequence', $6, $7,
                'queued', now(), $8, $8
              )
              RETURNING id
            `,
            [
              organization.id,
              row.action_type,
              row.lead_id,
              row.opportunity_id,
              row.contact_id,
              row.subject_template,
              row.body_template,
              actorId,
            ],
          );
          await client.query(
            `
              INSERT INTO tenant.crm_outbox_events (
                organization_id, event_type, entity_type, entity_id, payload
              ) VALUES ($1, 'crm.communication.queued', 'communication', $2, $3)
            `,
            [
              organization.id,
              communication.rows[0].id,
              {
                channel: row.action_type,
                subject: row.subject_template,
                sourceEntityType: entityType,
                sourceEntityId: entityId,
              },
            ],
          );
          await incrementUsage(
            client,
            organization.id,
            "outbound_messages_monthly",
          );
          usage.outbound_messages_monthly =
            number(usage.outbound_messages_monthly) + 1;
        }

        await incrementUsage(
          client,
          organization.id,
          "automation_actions_monthly",
        );
        usage.automation_actions_monthly =
          number(usage.automation_actions_monthly) + 1;

        const next = await client.query(
          `
            SELECT delay_minutes
            FROM tenant.crm_sequence_steps
            WHERE organization_id = $1
              AND sequence_id = $2
              AND step_order = $3
          `,
          [organization.id, row.sequence_id, row.current_step + 2],
        );
        await client.query(
          `
            UPDATE tenant.crm_sequence_enrollments
            SET
              current_step = current_step + 1,
              next_run_at = CASE
                WHEN $1::int IS NULL THEN NULL
                ELSE now() + ($1 * interval '1 minute')
              END,
              status = CASE
                WHEN $1::int IS NULL THEN 'completed'
                ELSE status
              END,
              completed_at = CASE
                WHEN $1::int IS NULL THEN now()
                ELSE completed_at
              END,
              updated_by = $2,
              updated_at = now()
            WHERE organization_id = $3 AND id = $4
          `,
          [
            next.rows[0]?.delay_minutes ?? null,
            actorId,
            organization.id,
            row.id,
          ],
        );
        processed += 1;
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(
    `CRM jobs completed. Sequence actions processed: ${processed}. Capacity-blocked organisations: ${blockedByCapacity}. Provider-bound messages were queued for the CRM outbox delivery worker.`,
  );
} finally {
  await pool.end();
}
