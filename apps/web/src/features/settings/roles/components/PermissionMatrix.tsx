"use client";

// The permission matrix: for one area (CRM, Sales, Inventory…), every permission against every role that has any of them — which role
// can do what, side by side. The first column stays in place while the roles scroll sideways on a narrow screen.
import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { SearchField, Select } from "@vercentlabs/design-system";

import type { PermissionCatalogEntry, RoleRow } from "../api/roles-api";

export function PermissionMatrix({ roles, catalog }: { roles: RoleRow[]; catalog: PermissionCatalogEntry[] }) {
  const categories = useMemo(() => [...new Set(catalog.map((entry) => entry.category))].sort(), [catalog]);
  const [category, setCategory] = useState(() => (categories.includes("CRM") ? "CRM" : categories[0] ?? ""));
  const [filter, setFilter] = useState("");
  const [onlyHolding, setOnlyHolding] = useState(true);
  const term = filter.trim().toLowerCase();
  const permissions = catalog.filter((entry) => entry.category === category && (!term || `${entry.name} ${entry.key}`.toLowerCase().includes(term)));
  const keys = new Set(catalog.filter((entry) => entry.category === category).map((entry) => entry.key));
  const grants = useMemo(() => new Map(roles.map((role) => [role.id, new Set(role.permission_keys)])), [roles]);
  const columns = roles.filter((role) => !onlyHolding || role.permission_keys.some((key) => keys.has(key)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-60">
          <Select aria-label="Area" selectedKey={category} onSelectionChange={(key) => setCategory(String(key))} options={categories.map((entry) => ({ value: entry, label: entry }))} />
        </div>
        <SearchField aria-label="Search permissions" placeholder="Search permissions" className="w-full sm:w-64" value={filter} onChange={setFilter} />
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={onlyHolding} onChange={(event) => setOnlyHolding(event.target.checked)} />
          Only roles with access to {category}
        </label>
      </div>
      {columns.length === 0 || permissions.length === 0 ? (
        <p className="text-sm text-text-secondary">{permissions.length === 0 ? "No permission matches." : `No role has access to ${category}.`}</p>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-[var(--radius-card)] border border-border bg-surface">
          <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 top-0 z-20 w-36 min-w-36 border-b sm:w-auto sm:min-w-56 border-r border-border bg-surface-muted px-3 py-2 text-left text-xs font-semibold text-text-secondary">
                  {`${category} · ${permissions.length}`}
                </th>
                {columns.map((role) => (
                  <th key={role.id} scope="col" className="sticky top-0 z-10 w-24 min-w-24 border-b sm:w-28 sm:min-w-28 border-border bg-surface-muted px-2 py-2 text-center align-bottom text-xs font-medium text-text">
                    <span className="line-clamp-2" title={role.name}>{role.name}</span>
                    {!role.is_system && <span className="block text-[11px] font-normal text-brand">Custom</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissions.map((permission) => (
                <tr key={permission.key} className="group">
                  <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-surface px-2 py-1.5 sm:px-3 text-left font-normal group-hover:bg-surface-hover">
                    <span className="block text-xs text-text sm:text-sm">{permission.name}</span>
                    <span className="hidden text-[11px] text-text-muted sm:block">{permission.key}</span>
                  </th>
                  {columns.map((role) => {
                    const granted = grants.get(role.id)?.has(permission.key);
                    return (
                      <td key={role.id} className="border-b border-border px-2 py-1.5 text-center group-hover:bg-surface-hover">
                        {granted ? <Check className="mx-auto size-4 text-success" aria-label={`${role.name}: allowed`} /> : <span className="text-text-muted" aria-label={`${role.name}: not allowed`}>·</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
