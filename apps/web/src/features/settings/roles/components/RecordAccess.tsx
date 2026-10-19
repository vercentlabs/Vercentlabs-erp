"use client";

// Record access per app (Own / Team / Company): which records a role's permissions reach. Each level is the app's own scope permissions
// (packages/permissions record-scopes.js), so what is chosen here is exactly what the app's backend enforces.
import { RECORD_SCOPES, RECORD_SCOPE_LEVELS, appsInPermissions, recordScopeLevel, withRecordScope, type RecordScopeLevel } from "@vercentlabs/permissions";

const LEVEL_LABEL: Record<RecordScopeLevel, string> = { own: "Own", team: "Team", company: "Company" };

// The editor: one row per app the role works in; changing a level rewrites that app's scope permissions.
export function RecordAccessEditor({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const apps = appsInPermissions(selected);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-text">Record access</legend>
      {apps.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Choose permissions in CRM, Sales, Procurement or Projects below to set whose records this role reaches there. Other apps&apos; records are company-wide.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border">
          {apps.map((app) => {
            const scope = RECORD_SCOPES[app];
            const level = recordScopeLevel(app, selected) ?? "own";
            return (
              <li key={app} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-text">{scope.label}</span>
                  <span className="text-xs text-text-secondary">{scope.records}</span>
                </span>
                <span role="radiogroup" aria-label={`${scope.label} record access`} className="flex shrink-0 gap-0.5 rounded-[var(--radius-control)] border border-border bg-surface-muted p-0.5">
                  {RECORD_SCOPE_LEVELS.map((entry) => {
                    const unavailable = entry.key === "team" && scope.team.length === 0;
                    return (
                      <button key={entry.key} type="button" role="radio" aria-checked={level === entry.key} disabled={unavailable} title={unavailable ? `${scope.label} has no team access level.` : entry.description}
                        onClick={() => onChange(withRecordScope(selected, app, entry.key))}
                        className={`flex-1 rounded-[calc(var(--radius-control)-2px)] px-3 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none ${level === entry.key ? "bg-surface text-brand shadow-sm" : "text-text-secondary hover:text-text"}`}>
                        {LEVEL_LABEL[entry.key]}
                      </button>
                    );
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-text-muted">Own: records they own or are assigned. Team: plus their teams&apos; records. Company: every record.</p>
    </fieldset>
  );
}

// Read-only, for a role's details.
export function RecordAccessSummary({ permissionKeys }: { permissionKeys: string[] }) {
  const apps = appsInPermissions(permissionKeys);
  if (!apps.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {apps.map((app) => {
        const level = recordScopeLevel(app, permissionKeys) ?? "own";
        return (
          <span key={app} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted px-2.5 py-1 text-xs">
            <span className="font-medium text-text">{RECORD_SCOPES[app].label}</span>
            <span className={level === "company" ? "text-warning" : level === "team" ? "text-info" : "text-success"}>{RECORD_SCOPE_LEVELS.find((entry) => entry.key === level)?.label}</span>
          </span>
        );
      })}
    </div>
  );
}
