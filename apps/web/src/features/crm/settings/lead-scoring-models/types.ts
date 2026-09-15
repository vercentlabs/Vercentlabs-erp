// tenant.crm_lead_scoring_models / crm_lead_scoring_model_rules via
// model-config.js — the REAL scoring configuration surface
// (scoring-engine.js's activeModel() reads this exclusively). Raw
// snake_case rows: model-config.js does not camelize.
export const SIGNAL_TYPES = ["demographic", "firmographic", "behavioral", "negative"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export type LeadScoringModelRule = {
  id: string;
  model_id: string;
  name: string;
  sequence: number;
  signal_type: SignalType;
  predicate: Record<string, unknown>;
  points: number;
  maximum_occurrences: number | null;
  decay_enabled: boolean;
  status: "active" | "inactive";
};

export type LeadScoringModel = {
  id: string;
  name: string;
  version: number;
  status: "draft" | "active" | "retired";
  base_score: number;
  score_floor: number;
  score_ceiling: number;
  decay_half_life_days: number;
  qualification_thresholds: { warm: number; hot: number; qualified: number };
  activated_at: string | null;
  created_at: string;
  updated_at: string;
  rules: LeadScoringModelRule[];
};
