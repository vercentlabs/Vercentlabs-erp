import type { NativeModuleManifest } from "@/core/modules/types";

export const crmManifest: NativeModuleManifest = {
  key: "crm",
  name: "CRM",
  description:
    "Leads, opportunities, customer activities and pipeline execution.",
  icon: "people-outline",
  permission: "crm.view",
  released: true,
  routes: ["leads", "pipeline", "activities", "crm/[resource]/[id]"],
  offline: {
    resources: ["dashboard", "leads", "opportunities", "activities"],
    mutationHandlers: [
      "create",
      "complete",
      "stage",
      "batch-sync",
      "resolve-conflict",
    ],
  },
};
