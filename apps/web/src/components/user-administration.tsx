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

export type UserRow = {
  userId: string;
  fullName: string;
  email: string;
  status: "active" | "disabled";
  roleId: string | null;
  roleName: string | null;
  roleSlug: string | null;
  companyIds: string[];
  branchIds: string[];
  departmentIds: string[];
  emailVerified: boolean;
  lastLoginAt: string | null;
};

export default function UserAdministration({
  users,
  invitations,
  roles,
  companies,
  branches,
  departments,
  canManage,
  currentUserId,
}: {
  users: UserRow[];
  invitations: Array<{
    id: string;
    email: string;
    roleName: string;
    expiresAt: string;
    revokedAt: string | null;
    acceptedAt: string | null;
  }>;
  roles: Array<{ id: string; name: string; slug: string }>;
  companies: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; name: string; companyId: string }>;
  departments: Array<{ id: string; name: string }>;
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
    setPending("invite");
    setMessage("");
    setDevelopmentUrl("");
    const body = Object.fromEntries(new FormData(formElement).entries());
    const result = await requestJson<{ developmentUrl?: string }>(
      "/api/invitations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    const body = {
      status: String(form.get("status") || "active"),
      roleId: String(form.get("roleId") || ""),
      companyIds: form.getAll("companyIds").map(String),
      branchIds: form.getAll("branchIds").map(String),
      departmentIds: form.getAll("departmentIds").map(String),
    };
    const result = await requestJson(`/api/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

  return (
    <div className="stack-section">
      {canManage ? (
        <section className="panel">
          <p className="eyebrow">Invite team member</p>
          <h2>Send controlled workspace access</h2>
          <form className="inline-form" onSubmit={invite}>
            <label>
              Work email
              <input name="email" type="email" required />
            </label>
            <label>
              Role
              <select name="roleId" required>
                <option value="">Select role</option>
                {roles
                  .filter((role) => role.slug !== "organization_owner")
                  .map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
              </select>
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
              className="user-card"
              key={user.userId}
              onSubmit={(event) => updateUser(event, user.userId)}
            >
              <div className="user-card-header">
                <div className="avatar small">
                  {user.fullName.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <strong>{user.fullName}</strong>
                  <span>{user.email}</span>
                </div>
                <span
                  className={
                    user.status === "active"
                      ? "status-pill active"
                      : "status-pill inactive"
                  }
                >
                  {user.status}
                </span>
              </div>
              <div className="user-meta">
                <span>
                  {user.emailVerified ? "Email verified" : "Email pending"}
                </span>
                <span>
                  {user.lastLoginAt
                    ? `Last login ${dateTimeFormatter.format(
                        new Date(user.lastLoginAt),
                      )}`
                    : "No login recorded"}
                </span>
              </div>
              <label>
                Role
                <select
                  name="roleId"
                  defaultValue={user.roleId || ""}
                  disabled={
                    !canManage || user.roleSlug === "organization_owner"
                  }
                >
                  <option value="">Select role</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  name="status"
                  defaultValue={user.status}
                  disabled={
                    !canManage ||
                    user.userId === currentUserId ||
                    user.roleSlug === "organization_owner"
                  }
                >
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <fieldset>
                <legend>Company access</legend>
                <div className="checkbox-grid">
                  {companies.map((company) => (
                    <label className="checkbox-row" key={company.id}>
                      <input
                        type="checkbox"
                        name="companyIds"
                        value={company.id}
                        defaultChecked={user.companyIds.includes(company.id)}
                        disabled={!canManage}
                      />
                      {company.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Branch access</legend>
                <div className="checkbox-grid">
                  {branches.map((branch) => (
                    <label className="checkbox-row" key={branch.id}>
                      <input
                        type="checkbox"
                        name="branchIds"
                        value={branch.id}
                        defaultChecked={user.branchIds.includes(branch.id)}
                        disabled={!canManage}
                      />
                      {branch.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Department access</legend>
                <div className="checkbox-grid">
                  {departments.map((department) => (
                    <label className="checkbox-row" key={department.id}>
                      <input
                        type="checkbox"
                        name="departmentIds"
                        value={department.id}
                        defaultChecked={user.departmentIds.includes(
                          department.id,
                        )}
                        disabled={!canManage}
                      />
                      {department.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              {canManage && user.roleSlug !== "organization_owner" ? (
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={pending === user.userId}
                >
                  {pending === user.userId ? "Saving…" : "Save access"}
                </button>
              ) : null}
            </form>
          ))}
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">Invitations</p>
        <h2>Pending and recent invitations</h2>
        <div className="table-panel embedded">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((invite) => (
                <tr key={invite.id}>
                  <td>{invite.email}</td>
                  <td>{invite.roleName}</td>
                  <td>{dateFormatter.format(new Date(invite.expiresAt))}</td>
                  <td>
                    {invite.acceptedAt
                      ? "Accepted"
                      : invite.revokedAt
                        ? "Revoked"
                        : "Pending"}
                  </td>
                  <td>
                    {canManage && !invite.acceptedAt && !invite.revokedAt ? (
                      <div className="action-row">
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => invitationAction(invite.id, "resend")}
                          disabled={Boolean(pending)}
                        >
                          Resend
                        </button>
                        <button
                          type="button"
                          className="danger-link"
                          onClick={() => invitationAction(invite.id, "revoke")}
                          disabled={Boolean(pending)}
                        >
                          Revoke
                        </button>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {!invitations.length ? (
                <tr>
                  <td colSpan={5}>No invitations have been sent.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
