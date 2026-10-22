"use client";

import { summarizeEffectiveAccess } from "./effective-access";

const listWords = (words: string[]) => (words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

// What a role lets a person do, in plain words (UX only — the server decides): each module they can use with how far they can go and,
// for CRM, whose records; the riskier extras as one short sentence under it; what they can run for the whole company; and the modules
// they cannot open as a single line (named on hover) instead of a long list.
export function EffectiveAccessSummary({
  roles,
}: {
  roles: Array<{ slug: string; permission_keys: readonly string[] }>;
}) {
  if (roles.length === 0) return null;
  const summary = summarizeEffectiveAccess(roles);
  const withAccess = summary.modules.filter((module) => module.level !== "none");
  const without = summary.modules.filter((module) => module.level === "none");
  return (
    <section aria-label="What they can do" className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-border bg-surface-muted p-3">
      <h3 className="text-sm font-semibold text-text">What they can do</h3>
      {withAccess.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {withAccess.map((module) => (
            <li key={module.key} className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-text">{module.name}</span>
              <span className="text-sm text-text-secondary">{module.detail}.</span>
              {module.extras.length > 0 && <span className="text-xs text-text-muted">{`They can also ${listWords(module.extras)}.`}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-secondary">They can&apos;t open any business module.</p>
      )}
      {summary.administration.length > 0 && (
        <p className="text-sm text-text-secondary">
          <span className="font-medium text-text">For the whole company: </span>{`${listWords(summary.administration.map((item) => item.toLowerCase()))}.`}
        </p>
      )}
      {summary.highRisk.length > 0 && <p className="text-xs text-warning">{`Sensitive: ${listWords(summary.highRisk.map((item) => item.toLowerCase()))}.`}</p>}
      {without.length > 0 && withAccess.length > 0 && (
        <p className="text-xs text-text-muted" title={without.map((module) => module.name).join(", ")}>
          {`No access to the other ${without.length} ${without.length === 1 ? "module" : "modules"}.`}
        </p>
      )}
    </section>
  );
}
