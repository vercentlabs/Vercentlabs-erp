import { randomUUID } from "node:crypto";
import {
  getCrmDashboard,
  getCrmReport,
  getCustomerSuccessDashboard,
  getCommunicationsDashboard,
  getConversationIntelligenceDashboard,
  getLeadAcquisitionDashboard,
  getLeadIntelligenceDashboard,
  getMarketingDashboard,
  getOpportunityRevenueDashboard,
  getPartnerEngagementDashboard,
  getCrmAiDashboard,
  getProcurementDashboard,
} from "@vercentlabs/api";

import {
  hasPermission,
  PERMISSIONS,
  requirePermissionFromSession,
} from "@/lib/authorization";
import { getBillingSummary, listBillingPlans } from "@/lib/billing";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { query, tenantTransaction, transaction } from "@/lib/db";
import { crmContext } from "@/lib/crm";
import { canViewCrmReport } from "@/lib/crm-api";
import { HttpError, readJson } from "@/lib/http";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requireMobileSession } from "@/lib/mobile-session";
import { moduleCatalog } from "@/lib/platform";
import { procurementContext } from "@/lib/procurement";
import { audit, enforceRateLimit } from "@/lib/security";
import {
  changePasswordSchema,
  profileSchema,
  sessionActionSchema,
} from "@/lib/validation";

const copy = {
  dashboard: [
    "ERP workspace",
    "Workspace dashboard",
    "Review what needs attention and maintain the organisation foundation.",
  ],
  procurement: [
    "Source-to-pay",
    "Procurement workspace",
    "Review suppliers, requisitions, sourcing, purchase orders, receipts and matching exceptions.",
  ],
  crm: [
    "Customer relationship management",
    "Turn every enquiry into accountable revenue",
    "Capture leads, plan follow-ups, manage opportunities, attribute campaigns and preserve the complete customer journey.",
  ],
  "crm-customer-success": [
    "Customer success",
    "Adoption, health and renewals",
    "Review onboarding milestones, customer health, renewal risk and churn interventions.",
  ],
  "crm-communications": [
    "CRM communications",
    "Inbox, email and calendar",
    "Review shared conversations, provider health, engagement events and meeting bookings.",
  ],
  "crm-conversation-intelligence": [
    "CRM conversation intelligence",
    "Calls, recordings and transcripts",
    "Review telephony provider health, governed recordings, transcript jobs and conversation actions.",
  ],
  "crm-lead-acquisition": [
    "CRM lead acquisition",
    "Imports, forms, channels and enrichment",
    "Review governed imports, published forms, provider events, open chats and enrichment proposals.",
  ],
  "crm-marketing": [
    "CRM marketing",
    "Segments, journeys and attribution",
    "Review governed audiences, campaign runs, journeys, events, surveys and influenced revenue.",
  ],
  "crm-lead-intelligence": [
    "CRM lead intelligence",
    "Scores, response SLAs and nurture",
    "Review explainable scoring, first-response commitments and the prioritized seller work queue.",
  ],
  "crm-opportunity-revenue": [
    "CRM opportunity intelligence",
    "Revenue, action plans and forecast",
    "Review recurring revenue, team splits, customer commitments, quota seasonality and predictive forecast.",
  ],
  "crm-partner-engagement": [
    "CRM partner and engagement",
    "Partners, field sales and coaching",
    "Review deal registration, MDF, visits, sequence branches, coaching and gamification.",
  ],
  "crm-ai-intelligence": [
    "Governed CRM AI",
    "Recommendations, relationships and deal risk",
    "Review explainable actions, relationship health, assistant drafts and risk signals.",
  ],
  "crm-mobile-readiness": [
    "CRM final readiness",
    "Offline sync and acceptance",
    "Review encrypted offline workflows, conflict handling and 83-capability completion evidence.",
  ],
  approvals: [
    "Approval centre",
    "Decisions requiring attention",
    "Review governed requests with separation of duties and immutable decision history.",
  ],
  "audit-logs": [
    "Governance",
    "Immutable audit log",
    "Review authentication, access, configuration and organisation events.",
  ],
  billing: [
    "Subscription and commercial control",
    "Billing",
    "Manage business capacity, invoices, payments and billing identity.",
  ],
  modules: [
    "Module registry",
    "Your ERP capability map",
    "Enable complete workflows and track the product roadmap.",
  ],
  profile: [
    "Personal account",
    "Your profile",
    "Maintain your identity and review recent authentication activity.",
  ],
  security: [
    "Account security",
    "Password and sessions",
    "Change your password, review active devices and revoke access.",
  ],
  users: [
    "Access administration",
    "Users and invitations",
    "Assign least-privilege roles and operating access.",
  ],
  roles: [
    "Role-based access control",
    "Roles and permissions",
    "Use system roles or create custom least-privilege roles.",
  ],
  "crm-reports": [
    "CRM analytics",
    "Pipeline, conversion and activity reports",
    "Review revenue health, engagement, risk, relationship coverage and seller execution.",
  ],
} as const;

export async function GET(
  request: Request,
  route: { params: Promise<{ area: string }> },
) {
  try {
    const session = await requireMobileSession(request);
    if (!session.organizationId)
      throw new HttpError(401, "Workspace required.");
    const { area } = await route.params;
    if (!(area in copy)) throw new HttpError(404, "Unknown workspace area.");
    const organizationId = session.organizationId;
    let data: Record<string, unknown>;

    if (area === "procurement") {
      requirePermissionFromSession(session, PERMISSIONS.procurementView);
      const context = procurementContext(session);
      data = await tenantTransaction(
        context.organizationId,
        async (client) => ({
          dashboard: await getProcurementDashboard(client, context),
        }),
      );
    } else if (area === "crm") {
      requirePermissionFromSession(session, PERMISSIONS.crmView);
      const context = crmContext(session);
      data = await tenantTransaction(
        context.organizationId,
        async (client) => ({
          dashboard: await getCrmDashboard(client, context),
        }),
      );
    } else if (area === "crm-customer-success") {
      requirePermissionFromSession(session, PERMISSIONS.crmView);
      const context = crmContext(session);
      data = await tenantTransaction(
        context.organizationId,
        async (client) => ({
          dashboard: await getCustomerSuccessDashboard(client, context),
        }),
      );
    } else if (area === "crm-communications") {
      requirePermissionFromSession(session, PERMISSIONS.crmView);
      const context = crmContext(session);
      data = await tenantTransaction(
        context.organizationId,
        async (client) => ({
          dashboard: await getCommunicationsDashboard(client, context),
        }),
      );
    } else if (area === "crm-conversation-intelligence") {
      requirePermissionFromSession(session, PERMISSIONS.crmView);
      const context = crmContext(session);
      data = await tenantTransaction(
        context.organizationId,
        async (client) => ({
          dashboard: await getConversationIntelligenceDashboard(
            client,
            context,
          ),
        }),
      );
    } else if (area === "crm-lead-acquisition") {
      requirePermissionFromSession(session, PERMISSIONS.crmView);
      const context = crmContext(session);
      data = await tenantTransaction(
        context.organizationId,
        async (client) => ({
          dashboard: await getLeadAcquisitionDashboard(client, context),
        }),
      );
    } else if (area === "crm-marketing") {
      requirePermissionFromSession(session, PERMISSIONS.crmView);
      const context = crmContext(session);
      data = await tenantTransaction(
        context.organizationId,
        async (client) => ({
          dashboard: await getMarketingDashboard(client, context),
        }),
      );
    } else if (area === "crm-lead-intelligence") {
      requirePermissionFromSession(session, PERMISSIONS.crmView);
      const context = crmContext(session);
      data = await tenantTransaction(
        context.organizationId,
        async (client) => ({
          dashboard: await getLeadIntelligenceDashboard(client, context),
        }),
      );
    } else if (area === "crm-opportunity-revenue") {
      requirePermissionFromSession(session, PERMISSIONS.crmView);
      const context = crmContext(session);
      data = await tenantTransaction(
        context.organizationId,
        async (client) => ({
          dashboard: await getOpportunityRevenueDashboard(client, context),
        }),
      );
    } else if (area === "crm-partner-engagement") {
      requirePermissionFromSession(session, PERMISSIONS.crmView);
      const context = crmContext(session);
      data = await tenantTransaction(
        context.organizationId,
        async (client) => ({
          dashboard: await getPartnerEngagementDashboard(client, context),
        }),
      );
    } else if (area === "crm-ai-intelligence") {
      requirePermissionFromSession(session, PERMISSIONS.crmView);
      const context = crmContext(session);
      data = await tenantTransaction(
        context.organizationId,
        async (client) => ({
          dashboard: await getCrmAiDashboard(client, context),
        }),
      );
    } else if (area === "crm-mobile-readiness") {
      requirePermissionFromSession(session, PERMISSIONS.crmView);
      data = {
        offline: {
          encrypted: true,
          maxAttempts: 5,
          batchSize: 50,
          conflictStrategies: ["server-wins", "client-wins", "field-merge"],
        },
        capabilityCount: 83,
      };
    } else if (area === "crm-reports") {
      requirePermissionFromSession(session, PERMISSIONS.crmReportsView);
      const names = [
        "pipeline",
        "conversion",
        "sources",
        "activities",
        "forecast",
        "campaigns",
        "revenue-operations",
        "account-health",
        "privacy",
        "pipeline-intelligence",
        "engagement-intelligence",
        "relationship-coverage",
        "partner-pipeline",
        "ai-governance",
      ] as const;
      const visible = names.filter((name) => canViewCrmReport(session, name));
      const context = crmContext(session);
      const reports = await tenantTransaction(
        context.organizationId,
        async (client) => {
          const entries: Array<[string, unknown]> = [];
          for (const name of visible)
            entries.push([name, await getCrmReport(client, context, name)]);
          return Object.fromEntries(entries);
        },
      );
      data = { reports, names: visible };
    } else if (area === "dashboard") {
      const [counts] = await query<Record<string, number>>(
        `SELECT
          (SELECT count(*)::int FROM companies WHERE organization_id=$1 AND status='active') AS companies,
          (SELECT count(*)::int FROM branches WHERE organization_id=$1 AND status='active') AS branches,
          (SELECT count(*)::int FROM organization_memberships WHERE organization_id=$1 AND status='active') AS users,
          (SELECT count(*)::int FROM departments WHERE organization_id=$1 AND status='active') AS departments,
          (SELECT count(*)::int FROM notifications WHERE organization_id=$1 AND user_id=$2 AND read_at IS NULL) AS unread_notifications`,
        [organizationId, session.userId],
      );
      const recentEvents = hasPermission(session, PERMISSIONS.auditView)
        ? await query(
            `SELECT a.id,a.event_type,a.entity_type,a.entity_id,a.created_at,u.full_name AS actor_name
             FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id
             WHERE a.organization_id=$1 ORDER BY a.created_at DESC LIMIT 6`,
            [organizationId],
          )
        : [];
      const activities = await query(
        `SELECT id,title,due_at FROM activities
         WHERE organization_id=$1 AND assigned_to=$2 AND completed_at IS NULL
         ORDER BY due_at ASC NULLS LAST LIMIT 6`,
        [organizationId, session.userId],
      );
      data = { counts: counts || {}, recentEvents, activities };
    } else if (area === "approvals") {
      requirePermissionFromSession(session, "approvals.manage");
      data = {
        rows: await query(
          `SELECT a.id,a.title,a.entity_type,a.entity_id,a.command_key,a.status,a.version,
                  a.requested_at,u.full_name AS requester
           FROM approval_requests a LEFT JOIN users u ON u.id=a.requested_by
           WHERE a.organization_id=$1 AND (a.assigned_to=$2 OR a.assigned_to IS NULL)
           ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END,a.requested_at DESC LIMIT 100`,
          [organizationId, session.userId],
        ),
      };
    } else if (area === "audit-logs") {
      requirePermissionFromSession(session, PERMISSIONS.auditView);
      const url = new URL(request.url);
      const event = url.searchParams.get("event") || "";
      const search = url.searchParams.get("q") || "";
      data = {
        rows: await query(
          `SELECT a.id,a.event_type,a.entity_type,a.entity_id,u.full_name AS actor_name,
                  u.email AS actor_email,a.ip_address,a.metadata,a.created_at
           FROM audit_events a LEFT JOIN users u ON u.id=a.actor_user_id
           WHERE a.organization_id=$1
             AND ($2='' OR a.event_type ILIKE '%' || $2 || '%')
             AND ($3='' OR a.entity_type ILIKE '%' || $3 || '%' OR COALESCE(a.entity_id,'') ILIKE '%' || $3 || '%' OR COALESCE(u.email,'') ILIKE '%' || $3 || '%')
           ORDER BY a.created_at DESC LIMIT 250`,
          [organizationId, event, search],
        ),
      };
    } else if (area === "billing") {
      requirePermissionFromSession(session, PERMISSIONS.billingView);
      const [plans, summary, payments, invoices, profile] = await Promise.all([
        listBillingPlans(),
        getBillingSummary(organizationId),
        query(
          `SELECT provider_payment_id,amount_paise,currency,status,method,captured_at,created_at FROM billing_payments WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 20`,
          [organizationId],
        ),
        query(
          `SELECT provider_invoice_id,amount_paise,amount_due_paise,amount_paid_paise,currency,status,invoice_url,issued_at,paid_at FROM billing_invoices WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 20`,
          [organizationId],
        ),
        query(
          `SELECT legal_name,billing_email,phone,gstin,billing_address FROM billing_customers WHERE organization_id=$1 LIMIT 1`,
          [organizationId],
        ),
      ]);
      data = {
        plans,
        summary,
        payments,
        invoices,
        profile: profile[0] || null,
        canManage: hasPermission(session, PERMISSIONS.billingManage),
        canCheckout: hasPermission(session, PERMISSIONS.billingCheckout),
      };
    } else if (area === "modules") {
      const rows = await query(
        `SELECT module_key,status FROM organization_modules WHERE organization_id=$1`,
        [organizationId],
      );
      data = { modules: moduleCatalog, statuses: rows };
    } else if (area === "profile") {
      requirePermissionFromSession(session, "profile.manage");
      const [logins, preferences] = await Promise.all([
        query(
          `SELECT succeeded,reason,ip_address,user_agent,created_at FROM login_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`,
          [session.userId],
        ),
        query(
          `SELECT COALESCE(p.locale,'en-IN') AS locale,COALESCE(p.timezone,o.timezone) AS timezone,COALESCE(p.theme,'system') AS theme FROM organizations o LEFT JOIN user_preferences p ON p.organization_id=o.id AND p.user_id=$2 WHERE o.id=$1`,
          [organizationId, session.userId],
        ),
      ]);
      data = {
        user: {
          fullName: session.fullName,
          email: session.email,
          roleSlugs: session.roleSlugs,
          organizationName: session.organizationName,
        },
        preferences: preferences[0] || {
          locale: "en-IN",
          timezone: "Asia/Kolkata",
          theme: "system",
        },
        logins,
      };
    } else if (area === "security") {
      data = {
        currentSessionId: session.sessionId,
        sessions: await query(
          `SELECT id,session_type,device_name,device_platform,ip_address,created_at,last_seen_at,expires_at
           FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() AND idle_expires_at>now()
           ORDER BY last_seen_at DESC`,
          [session.userId],
        ),
      };
    } else if (area === "roles") {
      requirePermissionFromSession(session, PERMISSIONS.rolesManage);
      const [roles, permissions] = await Promise.all([
        query(
          `SELECT r.id,r.name,r.slug,r.description,r.is_system,
          COALESCE(array_agg(rp.permission_key ORDER BY rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL),ARRAY[]::text[]) AS permission_keys,
          (SELECT count(*)::int FROM user_role_assignments ura WHERE ura.organization_id=r.organization_id AND ura.role_id=r.id) AS user_count
          FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id
          WHERE r.organization_id=$1 AND r.status='active' GROUP BY r.id
          ORDER BY CASE WHEN r.slug='organization_owner' THEN 0 WHEN r.is_system THEN 1 ELSE 2 END,r.name`,
          [organizationId],
        ),
        query(
          `SELECT key,name,category,description FROM permissions ORDER BY category,name`,
        ),
      ]);
      data = { roles, permissions };
    } else {
      requirePermissionFromSession(session, PERMISSIONS.usersView);
      const [users, invitations, roles, companies, branches, departments] =
        await Promise.all([
          query(
            `SELECT u.id AS user_id,u.full_name,u.email,m.status,r.id AS role_id,r.name AS role_name,r.slug AS role_slug,u.email_verified_at,u.last_login_at,
          COALESCE((SELECT array_agg(a.company_id) FROM membership_company_access a WHERE a.organization_id=m.organization_id AND a.user_id=u.id),ARRAY[]::uuid[]) AS company_ids,
          COALESCE((SELECT array_agg(a.branch_id) FROM membership_branch_access a WHERE a.organization_id=m.organization_id AND a.user_id=u.id),ARRAY[]::uuid[]) AS branch_ids,
          COALESCE((SELECT array_agg(a.department_id) FROM membership_department_access a WHERE a.organization_id=m.organization_id AND a.user_id=u.id),ARRAY[]::uuid[]) AS department_ids
          FROM organization_memberships m JOIN users u ON u.id=m.user_id
          LEFT JOIN user_role_assignments ura ON ura.organization_id=m.organization_id AND ura.user_id=u.id
          LEFT JOIN roles r ON r.id=ura.role_id WHERE m.organization_id=$1 ORDER BY u.full_name`,
            [organizationId],
          ),
          query(
            `SELECT i.id,i.email,COALESCE(r.name,i.role) AS role_name,i.expires_at,i.revoked_at,i.accepted_at FROM organization_invitations i LEFT JOIN roles r ON r.id=i.role_id WHERE i.organization_id=$1 ORDER BY i.created_at DESC LIMIT 100`,
            [organizationId],
          ),
          query(
            `SELECT id,name,slug FROM roles WHERE organization_id=$1 AND status='active' ORDER BY name`,
            [organizationId],
          ),
          query(
            `SELECT id,name FROM companies WHERE organization_id=$1 AND status='active' ORDER BY is_primary DESC,name`,
            [organizationId],
          ),
          query(
            `SELECT id,name,company_id FROM branches WHERE organization_id=$1 AND status='active' ORDER BY is_primary DESC,name`,
            [organizationId],
          ),
          query(
            `SELECT id,name FROM departments WHERE organization_id=$1 AND status='active' ORDER BY name`,
            [organizationId],
          ),
        ]);
      data = {
        users,
        invitations,
        options: { roles, companies, branches, departments },
        canManage: hasPermission(session, PERMISSIONS.usersManage),
        currentUserId: session.userId,
      };
    }

    const [eyebrow, title, description] = copy[area as keyof typeof copy];
    return mobileOk(request, {
      page: { area, eyebrow, title, description, data },
    });
  } catch (error) {
    return mobileError(request, error);
  }
}

export async function PATCH(
  request: Request,
  route: { params: Promise<{ area: string }> },
) {
  try {
    const session = await requireMobileSession(request);
    if (!session.organizationId)
      throw new HttpError(401, "Workspace required.");
    const { area } = await route.params;

    if (area === "profile") {
      requirePermissionFromSession(session, "profile.manage");
      const input = profileSchema.parse(await readJson(request));
      await transaction(async (client) => {
        await client.query(
          "UPDATE users SET full_name=$2,updated_at=now() WHERE id=$1",
          [session.userId, input.fullName],
        );
        await client.query(
          `INSERT INTO user_preferences (organization_id,user_id,locale,timezone,theme) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (organization_id,user_id) DO UPDATE SET locale=EXCLUDED.locale,timezone=EXCLUDED.timezone,theme=EXCLUDED.theme,updated_at=now()`,
          [
            session.organizationId,
            session.userId,
            input.locale,
            input.timezone,
            input.theme,
          ],
        );
      });
      await audit({
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "profile.updated",
        entityType: "user",
        entityId: session.userId,
        afterData: input,
        request,
      });
      return mobileOk(request, { message: "Profile updated." });
    }

    if (area === "security") {
      const input = sessionActionSchema.parse(await readJson(request));
      if (input.action === "revoke-others") {
        await query(
          `UPDATE sessions SET revoked_at=now(),revoked_reason='user_revoked_other_sessions' WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL`,
          [session.userId, session.sessionId],
        );
      } else {
        if (!input.sessionId || input.sessionId === session.sessionId)
          throw new HttpError(400, "Use sign out to end the current session.");
        await query(
          `UPDATE sessions SET revoked_at=now(),revoked_reason='user_revoked_session' WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`,
          [input.sessionId, session.userId],
        );
      }
      await audit({
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "auth.session_revoked",
        entityType: "session",
        entityId: input.sessionId || "others",
        request,
      });
      return mobileOk(request, { message: "Session access updated." });
    }

    throw new HttpError(405, "This workspace action is not supported.");
  } catch (error) {
    return mobileError(request, error);
  }
}

export async function POST(
  request: Request,
  route: { params: Promise<{ area: string }> },
) {
  try {
    const session = await requireMobileSession(request);
    const { area } = await route.params;
    if (area !== "security")
      throw new HttpError(405, "This workspace action is not supported.");
    await enforceRateLimit(`change-password:${session.userId}`, 5, 900);
    const input = changePasswordSchema.parse(await readJson(request));
    const users = await query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id=$1",
      [session.userId],
    );
    if (
      !users[0] ||
      !(await verifyPassword(input.currentPassword, users[0].password_hash))
    ) {
      throw new HttpError(401, "The current password is incorrect.");
    }
    const nextHash = await hashPassword(input.password);
    await transaction(async (client) => {
      const history = await client.query<{ password_hash: string }>(
        "SELECT password_hash FROM password_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5",
        [session.userId],
      );
      for (const previous of history.rows) {
        if (await verifyPassword(input.password, previous.password_hash))
          throw new HttpError(
            400,
            "Choose a password you have not recently used.",
          );
      }
      await client.query(
        "UPDATE users SET password_hash=$1,password_changed_at=now(),updated_at=now() WHERE id=$2",
        [nextHash, session.userId],
      );
      await client.query(
        "INSERT INTO password_history (id,user_id,password_hash) VALUES ($1,$2,$3)",
        [randomUUID(), session.userId, nextHash],
      );
      await client.query(
        "UPDATE sessions SET revoked_at=now(),revoked_reason='password_change' WHERE user_id=$1 AND revoked_at IS NULL",
        [session.userId],
      );
    });
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "auth.password_changed",
      entityType: "user",
      entityId: session.userId,
      request,
    });
    return mobileOk(request, {
      message: "Password changed. Sign in again on this device.",
    });
  } catch (error) {
    return mobileError(request, error);
  }
}
