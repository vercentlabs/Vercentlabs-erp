"use client";

import { useState } from "react";
import Link from "next/link";
import { Radio, RadioGroup, SearchField } from "@vercentlabs/design-system";

import { MODULE_NAVIGATION } from "@/shell/navigation/module-navigation-registry";

import type { GrantableRole } from "./api/access-api";

// The one role a person has, shared by Users and Invitations: choosing a role replaces the one before (the server refuses two). Access
// that spans several jobs is a custom role, made under Settings › Roles and permissions. The roles come grouped by module (General
// first, then the modules in the app's order) with a search across names and descriptions. Only roles the server says this
// administrator may grant are offered; the rest are counted instead of offered as choices that would 403. The list does not scroll on
// its own — the dialog around it does — so there is never a scrollbar inside a scrollbar. roleIds / primaryRoleId keep the API's
// shape: always the same single role.
const GROUP_ORDER = ["platform", ...MODULE_NAVIGATION.map((module) => module.moduleKey)];
const groupName = (key: string) => (key === "platform" ? "General" : MODULE_NAVIGATION.find((module) => module.moduleKey === key)?.label ?? key);
const RISK = { sensitive: { label: "Sensitive", className: "text-warning" }, privileged: { label: "Privileged", className: "text-danger" } } as const;

export function RoleSelector({
  roles,
  roleIds,
  onChange,
}: {
  roles: GrantableRole[];
  roleIds: string[];
  primaryRoleId?: string;
  onChange: (next: { roleIds: string[]; primaryRoleId: string }) => void;
}) {
  const [search, setSearch] = useState("");
  const grantable = roles.filter((role) => role.grantable);
  const unavailable = roles.filter((role) => !role.grantable && role.reason !== "ownership_transfer_only");
  const current = roles.find((role) => role.id === roleIds[0]);

  const needle = search.trim().toLowerCase();
  const matches = grantable.filter((role) => !needle || role.name.toLowerCase().includes(needle) || role.description?.toLowerCase().includes(needle));
  const groups = [...new Set(matches.map((role) => role.module_key))]
    .sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99))
    .map((key) => ({ key, name: groupName(key), roles: matches.filter((role) => role.module_key === key).sort((a, b) => a.name.localeCompare(b.name)) }));

  if (grantable.length === 0) return <p className="text-sm text-text-secondary">There are no roles you can assign.</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <SearchField aria-label="Search roles" placeholder="Search roles" className="w-full" value={search} onChange={setSearch} />
        <p className="text-xs text-text-secondary">
          {current ? <>Role: <span className="font-medium text-text">{current.name}</span>. </> : "Choose one role. "}
          Need access from more than one?{" "}
          <Link href="/settings/roles" className="font-medium text-brand hover:underline">Create a custom role</Link>.
        </p>
      </div>

      <RadioGroup aria-label="Role" value={roleIds[0] ?? ""} onChange={(id) => onChange({ roleIds: [id], primaryRoleId: id })}>
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.name} className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold tracking-wide text-text-muted uppercase">{group.name}</h3>
              <div className="flex flex-col">
                {group.roles.map((role) => {
                  const risk = role.risk_level === "standard" ? null : RISK[role.risk_level];
                  return (
                    <Radio key={role.id} value={role.id} className="w-full items-start rounded-[var(--radius-control)] px-2 py-1.5 hover:bg-surface-muted">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="text-sm text-text">{role.name}</span>
                          {risk && <span className={`shrink-0 text-[11px] font-medium ${risk.className}`}>{risk.label}</span>}
                        </span>
                        {role.description && <span className="line-clamp-1 text-xs text-text-muted" title={role.description}>{role.description}</span>}
                      </span>
                    </Radio>
                  );
                })}
              </div>
            </section>
          ))}
          {!groups.length && <p className="text-sm text-text-secondary">{`No role matches "${search.trim()}".`}</p>}
        </div>
      </RadioGroup>

      {unavailable.length > 0 && (
        <p className="text-xs text-text-muted">
          {`${unavailable.length} other role${unavailable.length === 1 ? " is" : "s are"} not shown: they include access you don't hold yourself, or belong to a module that is turned off.`}
        </p>
      )}
    </div>
  );
}
