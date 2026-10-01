"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@vercentlabs/design-system";
import { formatDate, humanize } from "@/shared/format/human";
import type { LeadScoreContribution } from "../api/leads-api";
import type { Lead } from "../types";
import { Field, dateTimeFormatter } from "./lead-detail-shared";
import type { LeadDetailData } from "./useLeadDetailData";

// Intelligence tab: rule score and its breakdown, the separate propensity
// estimate, and marketing attribution.
export function LeadIntelligenceTab({
  lead,
  explanation,
  contributions,
  scoreRules,
  propensityFactors,
  describeFactor,
  attributionQuery,
  canManageLeads,
  recalculateMutation,
}: {
  lead: Lead;
  explanation:
    | NonNullable<LeadDetailData["scoreQuery"]["data"]>["explanation"]
    | undefined;
  contributions: LeadScoreContribution[] | undefined;
  scoreRules: LeadScoreContribution[];
  propensityFactors: LeadScoreContribution[];
  describeFactor: (name: string) => string;
  attributionQuery: LeadDetailData["attributionQuery"];
  canManageLeads: boolean;
  recalculateMutation: { mutate: () => void; isPending: boolean };
}) {
  return (
    <div className="flex flex-col gap-6 py-4">
      <p className="text-xs text-text-muted">
        Score is intelligence, not authority — it never changes stage,
        qualification, or record status on its own.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Field label="Score" value={explanation?.score ?? lead.score ?? "—"} />
        <Field
          label="Grade"
          value={humanize(explanation?.lead_grade ?? lead.grade) || "—"}
        />
        <Field
          label="Last calculated"
          value={
            explanation?.score_calculated_at
              ? dateTimeFormatter.format(
                  new Date(explanation.score_calculated_at),
                )
              : "Never"
          }
        />
      </div>
      {canManageLeads && (
        <Button
          variant="secondary"
          size="compact"
          className="w-fit"
          onPress={() => recalculateMutation.mutate()}
          isLoading={recalculateMutation.isPending}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Recalculate now
        </Button>
      )}
      {scoreRules.length > 0 && (
        <div
          className="flex flex-col gap-2 border-t border-border pt-4"
          aria-label="How the score adds up"
        >
          <p className="text-sm font-semibold text-text">
            How the score adds up
          </p>
          <ul className="flex flex-col gap-1">
            {scoreRules.map((contribution, i) => (
              <li
                key={i}
                className="flex justify-between text-sm text-text-secondary"
              >
                <span>
                  {contribution.occurrences > 1
                    ? `${contribution.name} (×${contribution.occurrences})`
                    : contribution.name}
                </span>
                <span className="tabular-nums">
                  {contribution.points > 0
                    ? `+${contribution.points}`
                    : contribution.points}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-muted">
            Only rules that matched are listed. The same inputs always give the
            same score.
          </p>
        </div>
      )}
      {explanation?.score_explanation?.model && (
        <p className="text-xs text-text-muted">
          Rules: {explanation.score_explanation.model.name} (v
          {explanation.score_explanation.model.version})
        </p>
      )}
      {!explanation?.score_calculated_at && !contributions && (
        <p className="text-sm text-text-secondary">
          No scoring model has evaluated this Lead yet.
        </p>
      )}
      {/* F027 — the ML propensity is separate from the rule score: its own number, its own explanation, never mixed into the score above. */}
      {explanation?.propensity_score != null && (
        <div
          className="flex flex-col gap-2 border-t border-border pt-4"
          aria-label="Likelihood to qualify"
        >
          <p className="text-sm font-semibold text-text">
            Likelihood to qualify (model estimate)
          </p>
          <p className="text-xs text-text-muted">
            {
              "Learned from past qualified and unqualified leads. It is shown next to the score, not added to it."
            }
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Field
              label="Likelihood"
              value={`${explanation.propensity_score}%`}
            />
            <Field
              label="Band"
              value={
                explanation.propensity_grade
                  ? humanize(explanation.propensity_grade)
                  : "—"
              }
            />
            <Field
              label="Last calculated"
              value={
                explanation.propensity_calculated_at
                  ? dateTimeFormatter.format(
                      new Date(explanation.propensity_calculated_at),
                    )
                  : "Never"
              }
            />
          </div>
          {propensityFactors.length > 0 && (
            <ul className="flex flex-col gap-1">
              {propensityFactors.slice(0, 5).map((factor, i) => (
                <li
                  key={i}
                  className="flex justify-between text-sm text-text-secondary"
                >
                  <span>{describeFactor(factor.name)}</span>
                  <span>
                    {factor.points > 0
                      ? "Raises the likelihood"
                      : factor.points < 0
                        ? "Lowers the likelihood"
                        : "No effect"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {explanation.propensity_explanation?.model && (
            <p className="text-xs text-text-muted">
              Model: {explanation.propensity_explanation.model.name} (v
              {explanation.propensity_explanation.model.version})
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-sm font-semibold text-text">Attribution</p>
        {attributionQuery.isLoading && (
          <p className="text-sm text-text-secondary">Loading touchpoints…</p>
        )}
        {attributionQuery.isSuccess &&
          (attributionQuery.data.timeline.touchpoints.length === 0 ? (
            <p className="text-sm text-text-secondary">
              No marketing touchpoints recorded for this Lead yet.
            </p>
          ) : (
            <>
              <p className="text-xs text-text-muted">{`Credit model: ${humanize(attributionQuery.data.timeline.model)}`}</p>
              <ul className="flex flex-col gap-1">
                {attributionQuery.data.timeline.touchpoints.map(
                  (touchpoint) => (
                    <li
                      key={touchpoint.id}
                      className="flex items-center justify-between gap-2 text-sm text-text-secondary"
                    >
                      <span>{`${humanize(touchpoint.event_type)} · ${humanize(touchpoint.channel)}${touchpoint.campaign_name ? ` · ${touchpoint.campaign_name}` : ""}`}</span>
                      <span className="shrink-0 text-xs tabular-nums">{`${formatDate(touchpoint.event_at)} · ${Math.round(touchpoint.creditWeight * 100)}% credit`}</span>
                    </li>
                  ),
                )}
              </ul>
            </>
          ))}
      </div>
    </div>
  );
}
