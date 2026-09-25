"use client";

import { Badge, Checkbox, Select } from "@vercentlabs/design-system";

import type { GrantableRole } from "./api/access-api";

export const RISK_LABEL: Record<GrantableRole["risk_level"], string> = {
  standard: "Standard",
  sensitive: "Sensitive",
  privileged: "Privileged",
};

// Multiple roles + exactly one primary role, shared by Users and Invitations.
// Only roles the server says this administrator may grant are selectable;
// the rest are summarised instead of offered as choices that would 403.
export function RoleSelector({
  roles,
  roleIds,
  primaryRoleId,
  onChange,
}: {
  roles: GrantableRole[];
  roleIds: string[];
  primaryRoleId: string;
  onChange: (next: { roleIds: string[]; primaryRoleId: string }) => void;
}) {
  const grantable = roles.filter((role) => role.grantable);
  const unavailable = roles.filter((role) => !role.grantable && role.reason !== "ownership_transfer_only");

  const toggle = (role: GrantableRole, selected: boolean) => {
    const next = selected ? [...roleIds, role.id] : roleIds.filter((id) => id !== role.id);
    let primary = primaryRoleId;
    if (selected && !primary) primary = role.id;
    if (!selected && primary === role.id) primary = next[0] ?? "";
    onChange({ roleIds: next, primaryRoleId: primary });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1" aria-label="Roles">
        {grantable.map((role) => (
          <Checkbox key={role.id} isSelected={roleIds.includes(role.id)} onChange={(selected) => toggle(role, selected)}>
            <span className="flex flex-wrap items-center gap-2">
              <span>{role.name}</span>
              {role.risk_level !== "standard" && <Badge tone={role.risk_level === "privileged" ? "danger" : "warning"}>{RISK_LABEL[role.risk_level]}</Badge>}
            </span>
          </Checkbox>
        ))}
        {grantable.length === 0 && <p className="text-sm text-text-secondary">There are no roles you can assign.</p>}
      </div>
      {roleIds.length > 1 && (
        <Select
          label="Primary role"
          options={roleIds.map((id) => ({ value: id, label: roles.find((role) => role.id === id)?.name ?? "Role" }))}
          selectedKey={primaryRoleId}
          onSelectionChange={(key) => onChange({ roleIds, primaryRoleId: String(key) })}
        />
      )}
      {unavailable.length > 0 && (
        <p className="text-xs text-text-muted">
          {`${unavailable.length} other role${unavailable.length === 1 ? " is" : "s are"} not shown: they include access you don't hold yourself, or belong to a module that is turned off.`}
        </p>
      )}
    </div>
  );
}
