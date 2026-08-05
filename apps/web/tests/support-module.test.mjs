import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  getSupportDashboard,
  listSupportResource,
} from "../../../services/api/src/support/index.js";

const read = (file) =>
  fs.readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");

test("Support covers tickets, queues, SLAs, escalation, communications and knowledge", () => {
  const migration = read("database/tenant/migrations/050_support_module.sql");
  const service = read("services/api/src/support/index.js");
  const modules = read("packages/shared-types/src/modules.js");

  for (const marker of [
    "support_queues",
    "support_sla_policies",
    "support_tickets",
    "support_ticket_status_history",
    "support_ticket_assignments",
    "support_communications",
    "support_escalation_policies",
    "support_escalations",
    "support_knowledge_articles",
    "FORCE ROW LEVEL SECURITY",
  ]) {
    assert.match(migration, new RegExp(marker));
  }

  assert.match(service, /createSupportTicket/);
  assert.match(service, /assignSupportTicket/);
  assert.match(service, /addSupportCommunication/);
  assert.match(service, /transitionSupportTicket/);
  assert.match(service, /RESOLUTION_CODE_REQUIRED/);
  assert.match(modules, /key: "support"[\s\S]*availability: "released"/);
});

test("Support web entry points are permission safe", () => {
  const page = read("apps/web/src/app/(app)/support/page.tsx");
  const route = read(
    "apps/web/src/app/api/support/tickets/[id]/actions/route.ts",
  );
  assert.match(page, /PERMISSIONS\.supportView/);
  assert.match(page, /<AccessDenied/);
  assert.match(route, /supportTicketActionSchema/);
  assert.match(route, /tenantTransaction/);
});

test("Support honors owner access and active-company scoping", async () => {
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      return { rows: [{}] };
    },
  };
  const owner = {
    organizationId: "organization-1",
    companyId: "company-1",
    userId: "user-1",
    permissions: [],
    roleSlugs: ["organization_owner"],
  };

  await getSupportDashboard(client, owner);
  assert.equal(queries.length, 2);

  queries.length = 0;
  await listSupportResource(client, owner, "tickets");
  assert.match(
    queries[0].text,
    /record\.organization_id=\$1 AND record\.company_id=\$2/,
  );
  assert.deepEqual(queries[0].values.slice(0, 2), [
    "organization-1",
    "company-1",
  ]);

  queries.length = 0;
  await listSupportResource(client, owner, "escalations");
  assert.match(queries[0].text, /record\.escalated_at DESC/);

  await assert.rejects(
    getSupportDashboard(client, { ...owner, roleSlugs: ["employee"] }),
    /Missing permission: support\.view/,
  );
});
