// Shared setup for the Projects real-PostgreSQL tests. It reuses the Accounting world (organization, company,
// users with explicit permission sets and a customer).
import { buildAccountingWorld, connectAdmin } from "./accounting-test-kit.mjs";

export { connectAdmin };

export const PM = ["projects.view", "projects.manage", "projects.create", "projects.tasks.manage", "projects.milestones.manage", "projects.resources.manage"];
export const PMO = ["projects.view", "projects.approve", "projects.time.approve", "projects.reports.view", "projects.settings.manage", "projects.audit.view"];
export const MEMBER = ["projects.view", "projects.time.enter"];

export async function buildProjectsWorld(admin, roles, tag) {
  return buildAccountingWorld(admin, roles, tag);
}
