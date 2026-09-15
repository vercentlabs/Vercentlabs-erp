// tenant.crm_lead_stages / crm_lead_stage_transitions /
// crm_lead_stage_transition_reasons via stage-catalog.js / transition-
// graph.js / stage-migration.js — the SAME catalog the Lead 360's "Move
// to stage" UI already reads (getLeadTransitionGraph). These rows ARE
// camelCased (dto() in lifecycle/shared.js), unlike account-intelligence.js/
// assignment-engine.js/scoring model-config.js in the other Tranche I
// screens.
export type LeadStage = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  status: "active" | "inactive";
  isSystem: boolean;
  isInitial: boolean;
  dwellWarningHours: number | null;
  dwellBreachHours: number | null;
  leadCount: number;
  createdAt: string;
  updatedAt: string;
};

export type LeadStageTransition = {
  organizationId: string;
  fromStageId: string;
  toStageId: string;
  fromStageName: string;
  fromStageCode: string;
  toStageName: string;
  toStageCode: string;
  reasonRequired: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TransitionReasonScope = "transition" | "destination" | "any";
export type LeadStageTransitionReason = {
  id: string;
  scopeType: TransitionReasonScope;
  fromStageId: string | null;
  toStageId: string | null;
  code: string;
  label: string;
  sequence: number;
  status: "active" | "inactive";
};
