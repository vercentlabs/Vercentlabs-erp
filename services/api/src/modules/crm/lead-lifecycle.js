// F007 Lead lifecycle — compatibility re-export shim. The real
// implementation moved to
// lead-lifecycle-qualification-and-prioritization/lifecycle/ as part of
// CRM vNext Prompt 4's directed-transition-graph rebuild. This file exists
// only so existing call sites that star-export this whole module (see
// services/api/src/index.js) keep working without churn.
export * from "./lead-lifecycle-qualification-and-prioritization/lifecycle/index.js";
