import fs from "node:fs";

const register = JSON.parse(
  fs.readFileSync(
    "docs/implementation/four-module-feature-register.json",
    "utf8",
  ),
);
const evidence = JSON.parse(
  fs.readFileSync(
    "docs/implementation/four-module-feature-evidence.json",
    "utf8",
  ),
);

const statusCounts = {};
for (const row of register) {
  statusCounts[row.Status] = (statusCounts[row.Status] || 0) + 1;
}
const evidenceCounts = {
  implementation: evidence.filter(
    (row) =>
      Array.isArray(row.implementationPaths) && row.implementationPaths.length,
  ).length,
  tests: evidence.filter(
    (row) => Array.isArray(row.testPaths) && row.testPaths.length,
  ).length,
  acceptance: evidence.filter((row) => row.acceptanceStatus === "verified")
    .length,
};

const report = {
  generatedAt: new Date().toISOString(),
  releaseScope: {
    controlledEarlyAccessModules: ["CRM", "Sales", "Accounting", "Procurement"],
    roadmapModuleCount: 8,
  },
  benchmark: {
    totalCapabilities: register.length,
    statusCounts,
    evidenceCounts,
    completionGate: "pnpm verify:419-complete",
    complete:
      statusCounts.Implemented === register.length &&
      evidenceCounts.implementation === register.length &&
      evidenceCounts.tests === register.length &&
      evidenceCounts.acceptance === register.length,
  },
  productionPromotion: {
    localGate: "pnpm release:gate",
    benchmarkGate: "pnpm release:benchmark-gate",
    fullGate: "pnpm release:production:gate",
    externalEvidenceRequired: [
      "production environment validation",
      "disposable-database restore rehearsal",
      "deployed smoke checks",
      "monitoring and incident ownership",
    ],
  },
};

console.log(JSON.stringify(report, null, 2));
