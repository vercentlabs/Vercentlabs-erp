import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import type { SessionContext } from "@/lib/auth";
import { query } from "@/lib/db";

export const moduleCatalog = [
  {
    key: "accounting",
    name: "Accounting",
    description: "Financial records, receivables, payables and reporting.",
  },
  {
    key: "procurement",
    name: "Procurement",
    description: "Purchase requests, suppliers, orders and receipts.",
  },
  {
    key: "sales",
    name: "Sales",
    description: "Quotations, orders, fulfilment and revenue operations.",
  },
  {
    key: "crm",
    name: "CRM",
    description: "Leads, opportunities, customer relationships and activities.",
  },
  {
    key: "stock",
    name: "Stock",
    description: "Warehouses, inventory, transfers and traceability.",
  },
  {
    key: "manufacturing",
    name: "Manufacturing",
    description: "Production planning, materials, operations and costs.",
  },
  {
    key: "projects",
    name: "Projects",
    description: "Projects, tasks, time, budgets and profitability.",
  },
  {
    key: "assets",
    name: "Assets",
    description: "Asset lifecycle, depreciation and maintenance.",
  },
  {
    key: "point-of-sale",
    name: "Point of Sale",
    description: "Counter sales, payments, shifts and returns.",
  },
  {
    key: "quality",
    name: "Quality",
    description: "Inspections, non-conformances and corrective action.",
  },
  {
    key: "support",
    name: "Support",
    description: "Customer requests, service targets and resolutions.",
  },
  {
    key: "hr-payroll",
    name: "HR & Payroll",
    description: "Employees, attendance, leave and payroll.",
  },
] as const;

const roleSeed = [
  [
    "Organisation Owner",
    "organization_owner",
    "Full organisation ownership and governance.",
  ],
  [
    "System Administrator",
    "system_administrator",
    "Platform configuration and access administration.",
  ],
  [
    "Company Administrator",
    "company_administrator",
    "Company, branch and user administration.",
  ],
  ["Finance Manager", "finance_manager", "Finance governance and approvals."],
  ["Sales Manager", "sales_manager", "Sales team governance and approvals."],
  [
    "Purchase Manager",
    "purchase_manager",
    "Procurement governance and approvals.",
  ],
  ["Inventory Manager", "inventory_manager", "Stock and warehouse governance."],
  ["Manufacturing Manager", "manufacturing_manager", "Production governance."],
  ["HR Manager", "hr_manager", "People and payroll governance."],
  ["Employee", "employee", "Standard employee workspace access."],
  ["Auditor", "auditor", "Read-only governance and audit access."],
  ["Read-only User", "read_only", "Read-only workspace access."],
] as const;

const allPermissions = [
  "workspace.view",
  "organization.manage",
  "company.manage",
  "branch.manage",
  "department.manage",
  "cost_center.manage",
  "team.manage",
  "users.view",
  "users.manage",
  "roles.manage",
  "audit.view",
  "notifications.view",
  "modules.manage",
  "numbering.manage",
  "approvals.manage",
  "profile.manage",
  "sessions.manage",
];

function permissionsForRole(slug: string) {
  if (["organization_owner", "system_administrator"].includes(slug))
    return allPermissions;
  if (slug === "company_administrator")
    return allPermissions.filter((key) => key !== "organization.manage");
  if (
    [
      "finance_manager",
      "sales_manager",
      "purchase_manager",
      "inventory_manager",
      "manufacturing_manager",
      "hr_manager",
    ].includes(slug)
  ) {
    return [
      "workspace.view",
      "notifications.view",
      "profile.manage",
      "approvals.manage",
    ];
  }
  if (slug === "auditor")
    return [
      "workspace.view",
      "audit.view",
      "notifications.view",
      "profile.manage",
    ];
  return ["workspace.view", "notifications.view", "profile.manage"];
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
  const roleIds = new Map<string, string>();
  for (const [name, slug, description] of roleSeed) {
    const id = randomUUID();
    const result = await client.query<{ id: string }>(
      `
      INSERT INTO roles (id, organization_id, name, slug, description, is_system)
      VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT (organization_id, slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
      RETURNING id
    `,
      [id, input.organizationId, name, slug, description],
    );
    roleIds.set(slug, result.rows[0].id);
    for (const permission of permissionsForRole(slug)) {
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
    await client.query(
      "INSERT INTO organization_modules (organization_id, module_key, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [input.organizationId, moduleEntry.key, moduleEntry.name],
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
  ] as const) {
    await client.query(
      "INSERT INTO numbering_series (organization_id, entity_type, prefix) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [input.organizationId, entityType, prefix],
    );
  }

  await client.query(
    `
    INSERT INTO notifications (organization_id, user_id, type, title, message, href)
    VALUES ($1, $2, 'welcome', 'Your ERP workspace is ready', 'Review companies, branches, roles and users before adding business workflows.', '/dashboard')
  `,
    [input.organizationId, input.ownerUserId],
  );
}

export async function getShellData(session: SessionContext) {
  const organizationId = session.organizationId as string;
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
  return { companies, branches, unreadNotifications: unread[0]?.count || 0 };
}
