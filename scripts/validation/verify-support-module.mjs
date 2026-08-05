import fs from "node:fs";

const required = [
  "database/control-plane/migrations/025_support_module_release.sql",
  "database/tenant/migrations/050_support_module.sql",
  "services/api/src/support/index.js",
  "apps/web/src/app/(app)/support/page.tsx",
  "apps/web/src/app/api/support/dashboard/route.ts",
  "apps/web/src/app/api/support/tickets/[id]/actions/route.ts",
  "packages/permissions/src/support.js",
  "packages/shared-types/src/support.js",
  "packages/shared-sdk/src/support.js",
];

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const migration = fs.readFileSync(
  "database/tenant/migrations/050_support_module.sql",
  "utf8",
);
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
  if (!migration.includes(marker))
    throw new Error(`Migration missing ${marker}`);
}

const service = fs.readFileSync("services/api/src/support/index.js", "utf8");
for (const marker of [
  "createSupportQueue",
  "createSlaPolicy",
  "createSupportTicket",
  "assignSupportTicket",
  "addSupportCommunication",
  "transitionSupportTicket",
  "createKnowledgeArticle",
  "RESOLUTION_CODE_REQUIRED",
]) {
  if (!service.includes(marker)) throw new Error(`Service missing ${marker}`);
}

console.log("Support module static verification passed.");
