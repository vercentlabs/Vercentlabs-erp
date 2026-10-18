"use client";

// A lead's score (CRM plan 5.3), 0 to 100, with why: the rules it matched and what history says about leads like it.
import { Badge, Popover, PopoverTrigger, Button } from "@vercentlabs/design-system";

import type { ScoreDetails } from "@/features/crm/shared/fields-api";

export function LeadScoreBadge({ score, details }: { score: number | null | undefined; details?: ScoreDetails | null }) {
  if (score === null || score === undefined) return <span className="text-text-muted">Not scored</span>;
  const tone = details?.hot ? "danger" : score >= 40 ? "warning" : "neutral";
  return (
    <PopoverTrigger>
      <Button variant="ghost" size="compact" aria-label={`Score ${score}. Why?`}><Badge tone={tone}>{score}</Badge><span className="text-xs text-text-muted">Why?</span></Button>
      <Popover placement="bottom start">
        <div className="flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 text-sm">
          <h3 className="font-semibold">Score {score} of 100{details?.hot ? " · hot" : ""}</h3>
          {details?.rulesScore !== null && details?.rulesScore !== undefined && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-secondary">Your rules: {details.rulesScore}</span>
              {details.rules.length === 0 ? <span className="text-text-muted">No rule matched.</span> : (
                <ul className="flex flex-col gap-0.5">
                  {details.rules.map((rule) => (
                    <li key={rule.label} className="flex justify-between gap-2"><span>{rule.label}</span><span className="tabular-nums">{rule.points > 0 ? `+${rule.points}` : rule.points}</span></li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {details?.learned && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-secondary">From history ({details.learned.basedOn} closed leads): {details.learned.score}</span>
              <ul className="flex flex-col gap-0.5 text-text-secondary">
                {details.learned.factors.length ? details.learned.factors.map((factor) => <li key={factor.label}>{factor.label}</li>)
                  : <li>{Math.round(details.learned.overallRate * 100)}% of leads converted overall.</li>}
              </ul>
            </div>
          )}
          {details?.rulesScore !== null && details?.rulesScore !== undefined && details?.learned && <p className="text-xs text-text-muted">The score is the average of the two.</p>}
        </div>
      </Popover>
    </PopoverTrigger>
  );
}
