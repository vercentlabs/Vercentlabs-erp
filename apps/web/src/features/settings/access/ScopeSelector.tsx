"use client";

import { Checkbox } from "@vercentlabs/design-system";

import type { GrantableCompany, GrantableDepartment, GrantableTeam } from "./api/access-api";

export type AccessScope = { companyIds: string[]; branchIds: string[]; departmentIds: string[]; teamIds: string[] };

// Company → branch → department → team access picker shared by Users and
// Invitations. Shows only what the server says the current administrator may
// grant, and only what is relevant to the current selection: a branch under a
// selected company, a company-bound department under a selected company (an
// organisation-wide department always), a team under a selected department.
// Clearing a parent clears its children. The server enforces the same rules
// independently (validateDepartmentTeamScope, the scope ceiling).
export function ScopeSelector({
  companies,
  departments = [],
  teams = [],
  companyIds,
  branchIds,
  departmentIds = [],
  teamIds = [],
  onChange,
}: {
  companies: GrantableCompany[];
  departments?: GrantableDepartment[];
  teams?: GrantableTeam[];
  companyIds: string[];
  branchIds: string[];
  departmentIds?: string[];
  teamIds?: string[];
  onChange: (next: AccessScope) => void;
}) {
  if (companies.length === 0) {
    return <p className="text-sm text-text-secondary">You don&apos;t administer any companies yet.</p>;
  }
  const current: AccessScope = { companyIds, branchIds, departmentIds, teamIds };
  const emit = (patch: Partial<AccessScope>) => {
    const next = { ...current, ...patch };
    // Keep children consistent with their parents.
    const branchParent = new Map(companies.flatMap((company) => company.branches.map((branch) => [branch.id, company.id] as const)));
    next.branchIds = next.branchIds.filter((id) => next.companyIds.includes(branchParent.get(id) ?? ""));
    next.departmentIds = next.departmentIds.filter((id) => {
      const department = departments.find((entry) => entry.id === id);
      return department && (!department.companyId || next.companyIds.includes(department.companyId));
    });
    next.teamIds = next.teamIds.filter((id) => {
      const team = teams.find((entry) => entry.id === id);
      return team && (!team.departmentId || next.departmentIds.includes(team.departmentId));
    });
    onChange(next);
  };
  const toggle = (list: string[], id: string, selected: boolean) => (selected ? [...list, id] : list.filter((entry) => entry !== id));

  const visibleDepartments = departments.filter((department) => !department.companyId || companyIds.includes(department.companyId));
  const visibleTeams = teams.filter((team) => !team.departmentId || departmentIds.includes(team.departmentId));
  const selectedCompanies = companies.filter((company) => companyIds.includes(company.id));

  return (
    <div className="flex flex-col gap-3" aria-label="Access scope">
      {companies.map((company) => {
        const companySelected = companyIds.includes(company.id);
        return (
          <fieldset key={company.id} className="flex flex-col gap-1.5 rounded-[var(--radius-control)] border border-border p-3">
            <legend className="sr-only">{company.name}</legend>
            <Checkbox isSelected={companySelected} onChange={(selected) => emit({ companyIds: toggle(companyIds, company.id, selected) })}>
              <span className="font-medium">{company.name}</span>
            </Checkbox>
            {company.branches.length > 0 ? (
              <div className="ml-6 flex flex-col gap-1">
                {company.branches.map((branch) => (
                  <Checkbox
                    key={branch.id}
                    isDisabled={!companySelected}
                    isSelected={companySelected && branchIds.includes(branch.id)}
                    onChange={(selected) => emit({ branchIds: toggle(branchIds, branch.id, selected) })}
                  >
                    {branch.name}
                  </Checkbox>
                ))}
              </div>
            ) : (
              <p className="ml-6 text-xs text-text-muted">No branches you can grant.</p>
            )}
          </fieldset>
        );
      })}
      {departments.length > 0 && (
        <fieldset className="flex flex-col gap-1.5 rounded-[var(--radius-control)] border border-border p-3">
          <legend className="px-1 text-xs font-semibold text-text-secondary">Departments</legend>
          {visibleDepartments.length === 0 ? (
            <p className="text-xs text-text-muted">Select a company to see its departments.</p>
          ) : (
            visibleDepartments.map((department) => (
              <Checkbox key={department.id} isSelected={departmentIds.includes(department.id)} onChange={(selected) => emit({ departmentIds: toggle(departmentIds, department.id, selected) })}>
                {department.name}
              </Checkbox>
            ))
          )}
        </fieldset>
      )}
      {teams.length > 0 && (
        <fieldset className="flex flex-col gap-1.5 rounded-[var(--radius-control)] border border-border p-3">
          <legend className="px-1 text-xs font-semibold text-text-secondary">Teams</legend>
          {visibleTeams.length === 0 ? (
            <p className="text-xs text-text-muted">Select a department to see its teams.</p>
          ) : (
            visibleTeams.map((team) => (
              <Checkbox key={team.id} isSelected={teamIds.includes(team.id)} onChange={(selected) => emit({ teamIds: toggle(teamIds, team.id, selected) })}>
                {team.name}
              </Checkbox>
            ))
          )}
        </fieldset>
      )}
      <p className="text-xs text-text-secondary" aria-live="polite">
        {selectedCompanies.length === 0
          ? "No company access selected."
          : [
              selectedCompanies.map((company) => company.name).join(", "),
              branchIds.length === 0 ? "no branches" : `${branchIds.length} branch${branchIds.length === 1 ? "" : "es"}`,
              departmentIds.length ? `${departmentIds.length} department${departmentIds.length === 1 ? "" : "s"}` : null,
              teamIds.length ? `${teamIds.length} team${teamIds.length === 1 ? "" : "s"}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
      </p>
    </div>
  );
}
