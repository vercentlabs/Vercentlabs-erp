import { randomUUID } from "node:crypto";

import {
  initializeAccountingCompany,
  seedBusinessDataFoundation,
} from "@vercentlabs/api";
import { setTenantContext } from "@vercentlabs/database";
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";
import type { PoolClient } from "pg";

import type { SessionContext } from "@/core/auth";
import { ROLE_TEMPLATES } from "@/core/access-control";
import { ensureOrganizationBilling } from "@/core/billing";
import { query } from "@/core/db";

export const moduleCatalog = ERP_MODULE_CATALOG;

async function seedCrmFoundation(
  client: PoolClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    companyId: string;
    branchId: string;
  },
) {
  const pipeline = await client.query<{ id: string }>(
    `
      INSERT INTO tenant.crm_pipelines (
        organization_id, company_id, name, code, description, is_default,
        created_by, updated_by
      ) VALUES (
        $1, NULL, 'Standard sales pipeline', 'STANDARD',
        'Default lead-to-customer opportunity pipeline.', true, $2, $2
      )
      ON CONFLICT (organization_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        status = 'active',
        updated_by = EXCLUDED.updated_by
      RETURNING id
    `,
    [input.organizationId, input.ownerUserId],
  );
  const pipelineId = pipeline.rows[0]?.id;
  if (!pipelineId) throw new Error("CRM pipeline could not be created.");

  for (const stage of [
    ["Qualification", "QUALIFICATION", 10, 10, "pipeline", false, false, 7],
    ["Needs analysis", "NEEDS_ANALYSIS", 20, 25, "pipeline", false, false, 10],
    [
      "Value proposition",
      "VALUE_PROPOSITION",
      30,
      40,
      "best_case",
      false,
      false,
      14,
    ],
    ["Proposal", "PROPOSAL", 40, 60, "best_case", false, false, 14],
    ["Negotiation", "NEGOTIATION", 50, 80, "committed", false, false, 10],
    ["Closed won", "CLOSED_WON", 60, 100, "closed", true, false, null],
    ["Closed lost", "CLOSED_LOST", 70, 0, "closed", false, true, null],
  ] as const) {
    await client.query(
      `
        INSERT INTO tenant.crm_pipeline_stages (
          organization_id, pipeline_id, name, code, sequence, probability,
          forecast_category, is_won, is_lost, stale_after_days,
          created_by, updated_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
        ON CONFLICT (organization_id, pipeline_id, code) DO UPDATE SET
          name = EXCLUDED.name,
          sequence = EXCLUDED.sequence,
          probability = EXCLUDED.probability,
          forecast_category = EXCLUDED.forecast_category,
          is_won = EXCLUDED.is_won,
          is_lost = EXCLUDED.is_lost,
          stale_after_days = EXCLUDED.stale_after_days,
          status = 'active',
          updated_by = EXCLUDED.updated_by
      `,
      [input.organizationId, pipelineId, ...stage, input.ownerUserId],
    );
  }

  await client.query(
    `
      INSERT INTO tenant.crm_settings (
        organization_id, default_pipeline_id, default_currency_code,
        created_by, updated_by
      )
      SELECT $1, $2, company.base_currency, $3, $3
      FROM public.companies company
      WHERE company.id = $4 AND company.organization_id = $1
      ON CONFLICT (organization_id) DO UPDATE SET
        default_pipeline_id = COALESCE(tenant.crm_settings.default_pipeline_id, EXCLUDED.default_pipeline_id),
        default_currency_code = COALESCE(tenant.crm_settings.default_currency_code, EXCLUDED.default_currency_code),
        updated_by = EXCLUDED.updated_by
    `,
    [input.organizationId, pipelineId, input.ownerUserId, input.companyId],
  );

  for (const source of [
    ["Website", "WEBSITE", "website", true, 10],
    ["Referral", "REFERRAL", "referral", false, 20],
    ["Partner", "PARTNER", "partner", false, 30],
    ["Event", "EVENT", "event", false, 40],
    ["Phone enquiry", "PHONE", "phone", false, 50],
    ["Walk-in", "WALK_IN", "walk_in", false, 60],
    ["Import", "IMPORT", "import", false, 70],
    ["Other", "OTHER", "other", false, 80],
  ] as const) {
    await client.query(
      `INSERT INTO tenant.crm_lead_sources (
        organization_id, name, code, channel, is_default, sort_order, is_system, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,true,$7,$7)
      ON CONFLICT (organization_id, code) DO UPDATE SET
        name=EXCLUDED.name, channel=EXCLUDED.channel, sort_order=EXCLUDED.sort_order,
        is_system=true, status='active', archived_at=NULL, updated_by=EXCLUDED.updated_by`,
      [input.organizationId, ...source, input.ownerUserId],
    );
  }

  for (const stage of [
    ["new", "New", "Captured and awaiting first engagement.", 10, true],
    ["contacted", "Contacted", "Initial outreach has been made.", 20, false],
    ["working", "Working", "Active follow-up or discovery is underway.", 30, false],
  ] as const) {
    await client.query(
      `INSERT INTO tenant.crm_lead_stages(
         organization_id,code,name,description,sort_order,status,is_system,is_initial,created_by,updated_by
       ) VALUES($1,$2,$3,$4,$5,'active',true,$6,$7,$7)
       ON CONFLICT (organization_id,code) DO UPDATE SET
         is_system=true,updated_by=EXCLUDED.updated_by`,
      [input.organizationId, ...stage, input.ownerUserId],
    );
  }

  await client.query(
    `INSERT INTO tenant.crm_lead_stage_transitions(organization_id,from_stage_id,to_stage_id,created_by)
     SELECT $1,source.id,target.id,$2
       FROM tenant.crm_lead_stages source
       JOIN tenant.crm_lead_stages target ON target.organization_id=source.organization_id
      WHERE source.organization_id=$1
        AND ((source.code='new' AND target.code='contacted')
          OR (source.code='contacted' AND target.code IN ('new','working'))
          OR (source.code='working' AND target.code='contacted'))
     ON CONFLICT DO NOTHING`,
    [input.organizationId, input.ownerUserId],
  );

  for (const reason of [
    ["Price too high", "PRICE", "price"],
    ["Lost to competitor", "COMPETITION", "competition"],
    ["No budget", "NO_BUDGET", "budget"],
    ["Timing not right", "TIMING", "timing"],
    ["Not a fit", "NOT_FIT", "fit"],
    ["No response", "NO_RESPONSE", "no_response"],
    ["Duplicate", "DUPLICATE", "duplicate"],
    ["Other", "OTHER", "other"],
  ] as const) {
    await client.query(
      `INSERT INTO tenant.crm_lost_reasons (
        organization_id, name, code, category, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$5)
      ON CONFLICT (organization_id, code) DO UPDATE SET
        name=EXCLUDED.name, category=EXCLUDED.category, status='active', updated_by=EXCLUDED.updated_by`,
      [input.organizationId, ...reason, input.ownerUserId],
    );
  }

  for (const tag of [
    ["High intent", "#b91c1c"],
    ["Follow up", "#0369a1"],
    ["Enterprise", "#6d28d9"],
    ["SME", "#047857"],
  ] as const) {
    await client.query(
      `INSERT INTO tenant.crm_tags (
        organization_id, name, color, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$4)
      ON CONFLICT (organization_id, name) DO UPDATE SET
        color=EXCLUDED.color, status='active', updated_by=EXCLUDED.updated_by`,
      [input.organizationId, ...tag, input.ownerUserId],
    );
  }

  await client.query(
    `
      INSERT INTO tenant.crm_sales_teams (
        organization_id, company_id, code, name, manager_user_id,
        default_pipeline_id, currency_code, created_by, updated_by
      )
      SELECT $1, company.id, 'PRIMARY', 'Primary sales team', $2,
        $3, company.base_currency, $2, $2
      FROM public.companies company
      WHERE company.id = $4 AND company.organization_id = $1
      ON CONFLICT (organization_id, code) DO UPDATE SET
        company_id = COALESCE(tenant.crm_sales_teams.company_id, EXCLUDED.company_id),
        default_pipeline_id = COALESCE(tenant.crm_sales_teams.default_pipeline_id, EXCLUDED.default_pipeline_id),
        currency_code = COALESCE(tenant.crm_sales_teams.currency_code, EXCLUDED.currency_code),
        status = 'active',
        updated_by = EXCLUDED.updated_by
    `,
    [input.organizationId, input.ownerUserId, pipelineId, input.companyId],
  );
}

export async function seedOrganizationFoundation(
  client: PoolClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    companyId: string;
    branchId: string;
    timezone: string;
  },
) {
  // Sourced from the single canonical role catalogue (apps/web/src/lib/
  // access-control.ts's ROLE_TEMPLATES) rather than a separate,
  // independently-maintained seed list — see docs/implementation/
  // ERP_AUTHORIZATION_MODEL_004.md, Part 1/9 for why the two used to
  // disagree (this file previously had its own roleSeed/permissionsForRole
  // that had drifted: it never created project_manager/asset_manager/
  // pos_manager/quality_manager/support_manager for new organizations at
  // all, and always left module_key/assignable/risk_level at column
  // defaults instead of the template's real values).
  const roleIds = new Map<string, string>();
  for (const template of ROLE_TEMPLATES) {
    const id = randomUUID();
    const result = await client.query<{ id: string }>(
      `
      INSERT INTO roles (id, organization_id, name, slug, description, is_system, module_key, template_key, assignable, risk_level)
      VALUES ($1, $2, $3, $4, $5, true, $6, $4, $7, $8)
      ON CONFLICT (organization_id, slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        module_key = EXCLUDED.module_key,
        template_key = EXCLUDED.template_key,
        assignable = EXCLUDED.assignable,
        risk_level = EXCLUDED.risk_level
      RETURNING id
    `,
      [
        id,
        input.organizationId,
        template.name,
        template.slug,
        template.description,
        template.moduleKey,
        template.assignable,
        template.riskLevel,
      ],
    );
    roleIds.set(template.slug, result.rows[0].id);
    for (const permission of template.permissions) {
      await client.query(
        "INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [result.rows[0].id, permission],
      );
    }
  }

  const ownerRoleId = roleIds.get("organization_owner");
  if (!ownerRoleId) throw new Error("Owner role could not be created.");

  await client.query(
    `
    INSERT INTO user_role_assignments (organization_id, user_id, role_id, assigned_by)
    VALUES ($1, $2, $3, $2) ON CONFLICT DO NOTHING
  `,
    [input.organizationId, input.ownerUserId, ownerRoleId],
  );
  await client.query(
    "INSERT INTO membership_company_access (organization_id, user_id, company_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    [input.organizationId, input.ownerUserId, input.companyId],
  );
  await client.query(
    "INSERT INTO membership_branch_access (organization_id, user_id, branch_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    [input.organizationId, input.ownerUserId, input.branchId],
  );
  await client.query(
    `
    INSERT INTO user_preferences (organization_id, user_id, active_company_id, active_branch_id, timezone)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (organization_id, user_id) DO UPDATE SET active_company_id = EXCLUDED.active_company_id, active_branch_id = EXCLUDED.active_branch_id, timezone = EXCLUDED.timezone
  `,
    [
      input.organizationId,
      input.ownerUserId,
      input.companyId,
      input.branchId,
      input.timezone,
    ],
  );

  for (const moduleEntry of moduleCatalog) {
    const status =
      moduleEntry.availability === "released" ? "enabled" : "disabled";
    await client.query(
      `INSERT INTO organization_modules (
        organization_id, module_key, name, status, enabled_at
      ) VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'enabled' THEN now() ELSE NULL END)
      ON CONFLICT (organization_id, module_key) DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        enabled_at = CASE
          WHEN EXCLUDED.status = 'enabled' THEN COALESCE(organization_modules.enabled_at, now())
          ELSE NULL
        END,
        updated_at = now()`,
      [input.organizationId, moduleEntry.key, moduleEntry.name, status],
    );
  }

  for (const [entityType, prefix] of [
    ["customer", "CUS-"],
    ["supplier", "SUP-"],
    ["quotation", "QUO-"],
    ["sales_order", "SO-"],
    ["purchase_order", "PO-"],
    ["invoice", "INV-"],
    ["employee", "EMP-"],
    ["asset", "AST-"],
    ["business_party", "PTY-"],
    ["contact", "CON-"],
    ["item", "ITM-"],
    ["warehouse", "WH-"],
    ["price_list", "PL-"],
    ["journal_entry", "JE-"],
    ["customer_invoice", "INV-"],
    ["customer_credit_note", "CN-"],
    ["customer_receipt", "RCT-"],
    ["vendor_bill", "BILL-"],
    ["vendor_credit_note", "VCN-"],
    ["vendor_payment", "PAY-"],
    ["bank_statement", "BST-"],
    ["accounting_close_run", "CLS-"],
    ["accounting_revaluation_run", "FXR-"],
    ["fixed_asset", "FA-"],
    ["accounting_tax_return", "TAX-"],
    ["accounting_consolidation_run", "CON-"],
    ["crm_lead", "LEAD-"],
    ["crm_opportunity", "OPP-"],
    ["crm_campaign", "CMP-"],
    ["crm_activity", "ACT-"],
  ] as const) {
    await client.query(
      "INSERT INTO numbering_series (organization_id, entity_type, prefix) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [input.organizationId, entityType, prefix],
    );
  }

  await setTenantContext(client, input.organizationId);
  await seedBusinessDataFoundation(client, {
    organizationId: input.organizationId,
    userId: input.ownerUserId,
  });
  await initializeAccountingCompany(client, {
    organizationId: input.organizationId,
    companyId: input.companyId,
    userId: input.ownerUserId,
  });
  await seedCrmFoundation(client, input);

  await ensureOrganizationBilling(client, {
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
  });

  await client.query(
    `
    INSERT INTO notifications (organization_id, user_id, type, title, message, href)
    VALUES ($1, $2, 'welcome', 'Your ERP workspace is ready', 'Review companies, branches, roles and users before adding business workflows.', '/settings')
  `,
    [input.organizationId, input.ownerUserId],
  );
}

export async function getShellData(session: SessionContext) {
  const organizationId = session.organizationId as string;
  const organizations = await query<{ id: string; name: string }>(
    `
    SELECT organization.id, organization.name
    FROM organization_memberships AS membership
    JOIN organizations AS organization
      ON organization.id = membership.organization_id
     AND organization.status = 'active'
    WHERE membership.user_id = $1
      AND membership.status = 'active'
    ORDER BY CASE WHEN organization.id = $2 THEN 0 ELSE 1 END,
             organization.name,
             organization.id
  `,
    [session.userId, organizationId],
  );
  const owner =
    session.roleSlugs.includes("organization_owner") ||
    session.roleSlugs.includes("system_administrator");
  const companies = await query<{ id: string; name: string }>(
    `
    SELECT c.id, c.name FROM companies c
    WHERE c.organization_id = $1 AND c.status = 'active'
      AND ($3::boolean OR EXISTS (
        SELECT 1 FROM membership_company_access a
        WHERE a.organization_id = $1 AND a.user_id = $2 AND a.company_id = c.id
      ))
    ORDER BY c.is_primary DESC, c.name
  `,
    [organizationId, session.userId, owner],
  );

  const branches = await query<{
    id: string;
    company_id: string;
    name: string;
  }>(
    `
    SELECT b.id, b.company_id, b.name FROM branches b
    WHERE b.organization_id = $1 AND b.status = 'active'
      AND ($3::boolean OR EXISTS (
        SELECT 1 FROM membership_branch_access a
        WHERE a.organization_id = $1 AND a.user_id = $2 AND a.branch_id = b.id
      ))
    ORDER BY b.is_primary DESC, b.name
  `,
    [organizationId, session.userId, owner],
  );

  const unread = await query<{ count: number }>(
    "SELECT count(*)::int AS count FROM notifications WHERE organization_id = $1 AND user_id = $2 AND read_at IS NULL",
    [organizationId, session.userId],
  );
  return {
    organizations,
    companies,
    branches,
    unreadNotifications: unread[0]?.count || 0,
  };
}
