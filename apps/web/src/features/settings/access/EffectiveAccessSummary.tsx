"use client";

import { Badge } from "@vercentlabs/design-system";

import { summarizeEffectiveAccess } from "./effective-access";

// Readable preview of the access a set of roles grants (UX only — the server
// decides). Lists the modules with access, the administration abilities and
// the high-risk capabilities; modules without access are collapsed into one
// line instead of twelve "No access" rows.
export function EffectiveAccessSummary({ roles }: { roles: Array<{ slug: string; permission_keys: readonly string[] }> }) {
  if (roles.length === 0) return null;
  const summary = summarizeEffectiveAccess(roles);
  const withAccess = summary.modules.filter((module) => module.level !== "none");
  const without = summary.modules.filter((module) => module.level === "none");
  return (
    <section aria-label="Effective access" className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-surface-muted p-3">
      <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">Effective access</span>
      {withAccess.length > 0 ? (
        <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-3 gap-y-1 text-sm">
          {withAccess.map((module) => (
            <div key={module.key} className="contents">
              <dt className="font-medium text-text">{module.name}</dt>
              <dd className="text-text-secondary">{module.detail}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-text-secondary">No business module access.</p>
      )}
      {without.length > 0 && withAccess.length > 0 && (
        <p className="text-xs text-text-muted">{`No access: ${without.map((module) => module.name).join(", ")}`}</p>
      )}
      {summary.administration.length > 0 && <p className="text-sm text-text-secondary">{`Administration: ${summary.administration.join("; ")}`}</p>}
      {summary.highRisk.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="High-risk access">
          {summary.highRisk.map((label) => (
            <Badge key={label} tone="warning">
              {label}
            </Badge>
          ))}
        </div>
      )}
    </section>
  );
}
