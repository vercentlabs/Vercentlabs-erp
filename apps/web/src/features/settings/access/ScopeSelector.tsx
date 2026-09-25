"use client";

import { Checkbox } from "@vercentlabs/design-system";

import type { GrantableCompany } from "./api/access-api";

// Company → branch access picker shared by Users and Invitations. Shows only
// what the server says the current administrator may grant. A branch can be
// chosen only under a selected company, and clearing a company clears its
// branches; the server enforces the same rules independently.
export function ScopeSelector({
  companies,
  companyIds,
  branchIds,
  onChange,
}: {
  companies: GrantableCompany[];
  companyIds: string[];
  branchIds: string[];
  onChange: (next: { companyIds: string[]; branchIds: string[] }) => void;
}) {
  if (companies.length === 0) {
    return <p className="text-sm text-text-secondary">You don&apos;t administer any companies yet.</p>;
  }

  const toggleCompany = (company: GrantableCompany, selected: boolean) => {
    if (selected) {
      onChange({ companyIds: [...companyIds, company.id], branchIds });
    } else {
      const removed = new Set(company.branches.map((branch) => branch.id));
      onChange({ companyIds: companyIds.filter((id) => id !== company.id), branchIds: branchIds.filter((id) => !removed.has(id)) });
    }
  };
  const toggleBranch = (branchId: string, selected: boolean) =>
    onChange({ companyIds, branchIds: selected ? [...branchIds, branchId] : branchIds.filter((id) => id !== branchId) });

  const selectedCompanies = companies.filter((company) => companyIds.includes(company.id));
  const selectedBranchCount = branchIds.length;

  return (
    <div className="flex flex-col gap-3" aria-label="Company and branch access">
      {companies.map((company) => {
        const companySelected = companyIds.includes(company.id);
        return (
          <fieldset key={company.id} className="flex flex-col gap-1.5 rounded-[var(--radius-control)] border border-border p-3">
            <legend className="sr-only">{company.name}</legend>
            <Checkbox isSelected={companySelected} onChange={(selected) => toggleCompany(company, selected)}>
              <span className="font-medium">{company.name}</span>
            </Checkbox>
            {company.branches.length > 0 ? (
              <div className="ml-6 flex flex-col gap-1">
                {company.branches.map((branch) => (
                  <Checkbox
                    key={branch.id}
                    isDisabled={!companySelected}
                    isSelected={companySelected && branchIds.includes(branch.id)}
                    onChange={(selected) => toggleBranch(branch.id, selected)}
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
      <p className="text-xs text-text-secondary" aria-live="polite">
        {selectedCompanies.length === 0
          ? "No company access selected."
          : `${selectedCompanies.map((company) => company.name).join(", ")} · ${selectedBranchCount === 0 ? "no branches" : `${selectedBranchCount} branch${selectedBranchCount === 1 ? "" : "es"}`}`}
      </p>
    </div>
  );
}
