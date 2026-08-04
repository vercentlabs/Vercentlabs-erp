"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/lib/client-request";

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeZone: "Asia/Kolkata",
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function localInputValue(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 16) : "";
}
function isoOrNull(value: FormDataEntryValue | null) {
  const text = String(value || "").trim();
  return text ? new Date(text).toISOString() : null;
}

export type UserRow = {
  userId: string;
  fullName: string;
  email: string;
  status: "active" | "disabled";
  roleIds: string[];
  roleNames: string[];
  roleSlugs: string[];
  primaryRoleId: string | null;
  accessStartsAt: string | null;
  accessExpiresAt: string | null;
  companyIds: string[];
  branchIds: string[];
  departmentIds: string[];
  teamIds: string[];
  emailVerified: boolean;
  lastLoginAt: string | null;
};

type RoleOption = {
  id: string;
  name: string;
  slug: string;
  moduleKey: string;
  riskLevel: string;
  permissionKeys: string[];
};

function RoleSelection({
  roles,
  selected,
  primary,
  allowOwner = false,
}: {
  roles: RoleOption[];
  selected: string[];
  primary: string | null;
  allowOwner?: boolean;
}) {
  const options = allowOwner
    ? roles
    : roles.filter((role) => role.slug !== "organization_owner");
  const [roleIds, setRoleIds] = useState(selected);
  const [primaryRoleId, setPrimaryRoleId] = useState(
    primary && selected.includes(primary) ? primary : selected[0] || "",
  );
  const effectivePermissions = new Set(
    options
      .filter((role) => roleIds.includes(role.id))
      .flatMap((role) => role.permissionKeys),
  );

  function changeRole(roleId: string, checked: boolean) {
    const next = checked
      ? [...new Set([...roleIds, roleId])]
      : roleIds.filter((id) => id !== roleId);
    setRoleIds(next);
    if (!next.includes(primaryRoleId)) setPrimaryRoleId(next[0] || "");
  }

  return (
    <fieldset>
      <legend>Roles</legend>
      <p className="field-help">
        Select every job role this user performs. Permissions are cumulative.
      </p>
      <div className="permission-list">
        {options.map((role) => (
          <label className="checkbox-row" key={role.id}>
            <input
              type="checkbox"
              name="roleIds"
              value={role.id}
              checked={roleIds.includes(role.id)}
              onChange={(event) =>
                changeRole(role.id, event.currentTarget.checked)
              }
            />
            <span>
              <strong>{role.name}</strong>
              <small>
                {role.moduleKey} · {role.riskLevel} ·{" "}
                {role.permissionKeys.length} permissions
              </small>
            </span>
          </label>
        ))}
      </div>
      <label>
        Primary role
        <select
          name="primaryRoleId"
          required
          value={primaryRoleId}
          onChange={(event) => setPrimaryRoleId(event.currentTarget.value)}
        >
          <option value="">Select primary role</option>
          {options
            .filter((role) => roleIds.includes(role.id))
            .map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
        </select>
      </label>
      {roleIds.length ? (
        <p className="field-help">
          Current selection provides {effectivePermissions.size} unique
          permissions.
        </p>
      ) : (
        <p className="notice warning">Select at least one role.</p>
      )}
    </fieldset>
  );
}

export default function UserAdministration({
  users,
  invitations,
  roles,
  companies,
  branches,
  departments,
  teams,
  canManage,
  currentUserId,
}: {
  users: UserRow[];
  invitations: Array<{
    id: string;
    email: string;
    roleNames: string[];
    expiresAt: string;
    revokedAt: string | null;
    acceptedAt: string | null;
  }>;
  roles: RoleOption[];
  companies: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; name: string; companyId: string }>;
  departments: Array<{
    id: string;
    name: string;
    companyId: string | null;
    branchId: string | null;
  }>;
  teams: Array<{ id: string; name: string; departmentId: string | null }>;
  canManage: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState("");
  const [developmentUrl, setDevelopmentUrl] = useState("");

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const roleIds = form.getAll("roleIds").map(String);
    setPending("invite");
    setMessage("");
    setDevelopmentUrl("");
    const result = await requestJson<{ developmentUrl?: string }>(
      "/api/invitations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(form.get("email") || ""),
          roleIds,
          primaryRoleId: String(form.get("primaryRoleId") || ""),
          companyIds: form.getAll("companyIds").map(String),
          branchIds: form.getAll("branchIds").map(String),
          departmentIds: form.getAll("departmentIds").map(String),
          teamIds: form.getAll("teamIds").map(String),
          accessStartsAt: isoOrNull(form.get("accessStartsAt")),
          accessExpiresAt: isoOrNull(form.get("accessExpiresAt")),
          acknowledgeWarningConflicts:
            form.get("acknowledgeWarningConflicts") === "on",
        }),
      },
    );
    setMessage(result.message || "Request completed.");
    setDevelopmentUrl(result.developmentUrl || "");
    setPending("");
    if (result.ok) {
      formElement.reset();
      router.refresh();
    }
  }

  async function updateUser(event: FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    if (pending) return;
    setPending(userId);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const result = await requestJson(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: String(form.get("status") || "active"),
        roleIds: form.getAll("roleIds").map(String),
        primaryRoleId: String(form.get("primaryRoleId") || ""),
        companyIds: form.getAll("companyIds").map(String),
        branchIds: form.getAll("branchIds").map(String),
        departmentIds: form.getAll("departmentIds").map(String),
        teamIds: form.getAll("teamIds").map(String),
        accessStartsAt: isoOrNull(form.get("accessStartsAt")),
        accessExpiresAt: isoOrNull(form.get("accessExpiresAt")),
        reason: String(form.get("reason") || ""),
        acknowledgeWarningConflicts:
          form.get("acknowledgeWarningConflicts") === "on",
      }),
    });
    setMessage(result.message || "Request completed.");
    setPending("");
    if (result.ok) router.refresh();
  }

  async function invitationAction(id: string, action: "resend" | "revoke") {
    if (pending) return;
    setPending(id + action);
    setMessage("");
    setDevelopmentUrl("");
    const result = await requestJson<{ developmentUrl?: string }>(
      `/api/invitations/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
    );
    setMessage(result.message || "Request completed.");
    setDevelopmentUrl(result.developmentUrl || "");
    setPending("");
    if (result.ok) router.refresh();
  }

  const assignableRoles = roles.filter(
    (role) => role.slug !== "organization_owner",
  );

  function ScopeSelection({ user }: { user?: UserRow }) {
    return (
      <>
        <fieldset>
          <legend>Company access</legend>
          <div className="permission-list compact">
            {companies.map((company) => (
              <label className="checkbox-row" key={company.id}>
                <input
                  type="checkbox"
                  name="companyIds"
                  value={company.id}
                  defaultChecked={user?.companyIds.includes(company.id)}
                />
                <span>
                  <strong>{company.name}</strong>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Branch access</legend>
          <div className="permission-list compact">
            {branches.map((branch) => (
              <label className="checkbox-row" key={branch.id}>
                <input
                  type="checkbox"
                  name="branchIds"
                  value={branch.id}
                  defaultChecked={user?.branchIds.includes(branch.id)}
                />
                <span>
                  <strong>{branch.name}</strong>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {departments.length ? (
          <fieldset>
            <legend>Department access</legend>
            <div className="permission-list compact">
              {departments.map((department) => (
                <label className="checkbox-row" key={department.id}>
                  <input
                    type="checkbox"
                    name="departmentIds"
                    value={department.id}
                    defaultChecked={user?.departmentIds.includes(department.id)}
                  />
                  <span>
                    <strong>{department.name}</strong>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {teams.length ? (
          <fieldset>
            <legend>Team access</legend>
            <div className="permission-list compact">
              {teams.map((team) => (
                <label className="checkbox-row" key={team.id}>
                  <input
                    type="checkbox"
                    name="teamIds"
                    value={team.id}
                    defaultChecked={user?.teamIds.includes(team.id)}
                  />
                  <span>
                    <strong>{team.name}</strong>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </>
    );
  }

  return (
    <div className="stack-section">
      {canManage ? (
        <section className="panel">
          <p className="eyebrow">Invite team member</p>
          <h2>Send controlled workspace access</h2>
          <form className="form-stack" onSubmit={invite}>
            <label>
              Work email
              <input name="email" type="email" required />
            </label>
            <RoleSelection roles={roles} selected={[]} primary={null} />
            <ScopeSelection />
            <div className="split-fields">
              <label>
                Access starts
                <input name="accessStartsAt" type="datetime-local" />
              </label>
              <label>
                Access expires
                <input name="accessExpiresAt" type="datetime-local" />
              </label>
            </div>
            <label className="checkbox-row">
              <input type="checkbox" name="acknowledgeWarningConflicts" />
              <span>
                <strong>Acknowledge warning-level access conflicts</strong>
                <small>Blocking conflicts remain prohibited.</small>
              </span>
            </label>
            <button
              className="primary-button"
              type="submit"
              disabled={pending === "invite"}
            >
              {pending === "invite" ? "Sending…" : "Send invitation"}
            </button>
          </form>
          {developmentUrl ? (
            <a className="development-link" href={developmentUrl}>
              Open the local invitation link
            </a>
          ) : null}
        </section>
      ) : null}

      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}

      <section className="panel">
        <div className="card-title-row">
          <div>
            <p className="eyebrow">Active access</p>
            <h2>{users.length} organisation users</h2>
          </div>
        </div>
        <div className="user-grid">
          {users.map((user) => (
            <form
              className="resource-card form-stack"
              key={user.userId}
              onSubmit={(event) => updateUser(event, user.userId)}
            >
              <div className="card-title-row">
                <div>
                  <strong>{user.fullName}</strong>
                  <span>{user.email}</span>
                </div>
                <span className={`status-pill ${user.status}`}>
                  {user.status}
                </span>
              </div>
              <div className="chip-row">
                {user.roleNames.map((name, index) => (
                  <span key={`${name}:${index}`}>
                    {index === 0 ? `Primary: ${name}` : name}
                  </span>
                ))}
              </div>
              <p className="field-help">
                Email {user.emailVerified ? "verified" : "not verified"} · Last
                login{" "}
                {user.lastLoginAt
                  ? dateTimeFormatter.format(new Date(user.lastLoginAt))
                  : "never"}
              </p>
              {canManage ? (
                <details>
                  <summary>Edit roles and scope</summary>
                  <div className="form-stack">
                    <RoleSelection
                      roles={roles}
                      selected={user.roleIds}
                      primary={user.primaryRoleId}
                      allowOwner={user.roleSlugs.includes("organization_owner")}
                    />
                    <label>
                      Account status
                      <select name="status" defaultValue={user.status}>
                        <option value="active">Active</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </label>
                    <ScopeSelection user={user} />
                    <div className="split-fields">
                      <label>
                        Access starts
                        <input
                          name="accessStartsAt"
                          type="datetime-local"
                          defaultValue={localInputValue(user.accessStartsAt)}
                        />
                      </label>
                      <label>
                        Access expires
                        <input
                          name="accessExpiresAt"
                          type="datetime-local"
                          defaultValue={localInputValue(user.accessExpiresAt)}
                        />
                      </label>
                    </div>
                    <label>
                      Reason for access change
                      <textarea
                        name="reason"
                        required
                        minLength={3}
                        maxLength={500}
                        placeholder="Role change approved for the user's current responsibilities."
                      />
                    </label>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        name="acknowledgeWarningConflicts"
                      />
                      <span>
                        <strong>Acknowledge warning-level conflicts</strong>
                        <small>
                          Use only after reviewing the combined permissions.
                        </small>
                      </span>
                    </label>
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={
                        pending === user.userId || user.userId === currentUserId
                      }
                    >
                      {pending === user.userId
                        ? "Saving…"
                        : user.userId === currentUserId
                          ? "Use another administrator"
                          : "Save access"}
                    </button>
                  </div>
                </details>
              ) : null}
            </form>
          ))}
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">Invitations</p>
        <h2>Pending and historical invitations</h2>
        <div className="resource-grid">
          {invitations.map((invitation) => (
            <article className="resource-card" key={invitation.id}>
              <strong>{invitation.email}</strong>
              <p>{invitation.roleNames.join(" + ") || "No role"}</p>
              <small>
                Expires {dateFormatter.format(new Date(invitation.expiresAt))}
              </small>
              {!invitation.acceptedAt && !invitation.revokedAt && canManage ? (
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => invitationAction(invitation.id, "resend")}
                  >
                    Resend
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => invitationAction(invitation.id, "revoke")}
                  >
                    Revoke
                  </button>
                </div>
              ) : (
                <span className="status-pill">
                  {invitation.acceptedAt
                    ? "accepted"
                    : invitation.revokedAt
                      ? "revoked"
                      : "expired"}
                </span>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
