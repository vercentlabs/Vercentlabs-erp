import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const required = [
  "apps/web/src/core",
  "apps/web/src/modules",
  "apps/web/src/shared",

  "services/api/src/core",
  "services/api/src/modules",
  "services/api/src/orchestration",

  "database/platform/migrations",
  "database/tenant/migrations",

  "packages/erp-registry",
];

for (const item of required) {
  if (!fs.existsSync(path.join(root, item))) {
    throw new Error(`Missing architecture path: ${item}`);
  }
}

const oldPaths = [
  "apps/web/src/lib",
  "apps/web/src/components",

  "services/api/src/accounting",
  "services/api/src/assets",
  "services/api/src/crm",
  "services/api/src/hr-payroll",
  "services/api/src/manufacturing",
  "services/api/src/point-of-sale",
  "services/api/src/procurement",
  "services/api/src/projects",
  "services/api/src/quality",
  "services/api/src/sales",
  "services/api/src/stock",
  "services/api/src/support",

  "database/control-plane",
];

for (const item of oldPaths) {
  if (fs.existsSync(path.join(root, item))) {
    throw new Error(`Old architecture path remains: ${item}`);
  }
}

const modules = [
  "crm",
  "sales",
  "procurement",
  "stock",
  "manufacturing",
  "quality",
  "projects",
  "assets",
  "point-of-sale",
  "support",
  "hr-payroll",
  "accounting",
];

for (const module of modules) {
  for (const item of [
    `apps/web/src/modules/${module}`,
    `services/api/src/modules/${module}`,
  ]) {
    if (!fs.existsSync(path.join(root, item))) {
      throw new Error(`Missing ERP module: ${item}`);
    }
  }
}

console.log("ERP architecture structure OK");
