#!/usr/bin/env node
// `pnpm test:crm:db` — CRM behaviour against a real PostgreSQL on the
// restricted runtime role: public booking, coverage, analytics, forecast,
// import and reports. Fails when the database is unreachable or any test is
// skipped (scripts/lib/run-db-suite.mjs).
import fs from "node:fs";
import path from "node:path";

import { root, runDbSuite } from "../lib/run-db-suite.mjs";

const directory = "tests/integration/crm";
export const CRM_DB_TEST_FILES = Object.freeze(
  fs
    .readdirSync(path.join(root, directory))
    .filter((file) => file.endsWith("-db.test.mjs"))
    .sort()
    .map((file) => `${directory}/${file}`),
);

await runDbSuite({ name: "CRM", files: CRM_DB_TEST_FILES });
