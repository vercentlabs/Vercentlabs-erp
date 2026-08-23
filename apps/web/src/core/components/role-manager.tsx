"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/core/client-request";

type Conflict = {
  key: string;
  severity: "warning" | "blocking";
  description: string;
};

type RoleRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  isSystem: boolean;
  assignable: boolean;
  moduleKey: string;
  riskLevel: "standard" | "sensitive" | "privileged";
  version: number;
  permissionKeys: string[];
  userCount: number;
  conflicts: Conflict[];
  canManage: boolean;
};

type DraftRole = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  moduleKey: string;
  riskLevel: string;
  permissionKeys: string[];
};

const blankDraft: DraftRole = {
  name: "",
  slug: "",
  description: "",
  moduleKey: "platform",
  riskLevel: "standard",
  permissionKeys: [],
};

export default function RoleManager({
  roles,
  permissions,
  canManage,
}: {
  roles: RoleRow[];
  permissions: Array<{
    key: string;
    name: string;
    category: string;
    description: string;
  }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<DraftRole>(blankDraft);
  const groups = useMemo(
    () =>
      permissions.reduce<Record<string, typeof permissions>>(
        (result, permission) => {
          (result[permission.category] ||= []).push(permission);
          return result;
        },
        {},
      ),
    [permissions],
  );

  function editRole(role: RoleRow) {
    setMessage("");
    setDraft({
      id: role.isSystem ? undefined : role.id,
      name: role.isSystem ? `${role.name} custom` : role.name,
      slug: role.isSystem ? `${role.slug}_custom` : role.slug,
      description: role.description,
      moduleKey: role.moduleKey,
      riskLevel: role.riskLevel,
      permissionKeys: role.permissionKeys,
    });
    document
      .getElementById("role-editor")
      ?.scrollIntoView({ behavior: "smooth" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || pending) return;
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get("name") || ""),
      slug: String(form.get("slug") || ""),
      description: String(form.get("description") || ""),
      moduleKey: String(form.get("moduleKey") || "platform"),
      riskLevel: String(form.get("riskLevel") || "standard"),
      permissionKeys: form.getAll("permissionKeys").map(String),
      acknowledgeWarningConflicts:
        form.get("acknowledgeWarningConflicts") === "on",
    };
    const result = await requestJson(
      draft.id ? `/api/roles/${draft.id}` : "/api/roles",
      {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setMessage(result.message || "Request completed.");
    setPending(false);
    if (result.ok) {
      setDraft(blankDraft);
      router.refresh();
    }
  }

  return (
    <div className="resource-layout">
      <section className="panel">
        <div className="card-title-row">
          <div>
            <p className="eyebrow">Role catalogue</p>
            <h2>Released-module role templates</h2>
          </div>
          <span className="status-badge">{roles.length} roles</span>
        </div>
        <p className="notice">
          Users may receive several cumulative roles. The primary role controls
          the display label and legacy administrator context; all selected roles
          contribute permissions.
        </p>
        <div className="role-grid">
          {roles.map((role) => (
            <article className="resource-card" key={role.id}>
              <div className="card-title-row">
                <div className="role-card-heading">
                  <strong>{role.name}</strong>
                  <span>{role.slug}</span>
                </div>
                <span
                  className={`status-pill ${role.riskLevel === "privileged" ? "warning" : "active"}`}
                >
                  {role.isSystem ? "Template" : "Custom"}
                </span>
              </div>
              <p>{role.description}</p>
              <div className="chip-row">
                <span>{role.moduleKey}</span>
                <span>{role.riskLevel}</span>
                <span>v{role.version}</span>
                <span>{role.permissionKeys.length} permissions</span>
                <span>{role.userCount} users</span>
              </div>
              {role.conflicts.length ? (
                <div className="notice warning">
                  <strong>Access review required</strong>
                  <ul className="compact-list">
                    {role.conflicts.map((conflict) => (
                      <li key={conflict.key}>
                        {conflict.severity}: {conflict.description}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <details>
                <summary>View permissions</summary>
                <ul className="compact-list">
                  {role.permissionKeys.map((key) => (
                    <li key={key}>
                      {permissions.find((permission) => permission.key === key)
                        ?.name || key}
                    </li>
                  ))}
                </ul>
              </details>
              {role.canManage ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => editRole(role)}
                >
                  {role.isSystem ? "Clone as custom role" : "Edit custom role"}
                </button>
              ) : null}
              {canManage &&
              !role.canManage &&
              role.slug !== "organization_owner" ? (
                <p className="field-help">
                  A stronger administrator must clone or edit this role.
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {canManage ? (
        <section className="panel sticky-panel" id="role-editor">
          <p className="eyebrow">
            {draft.id ? "Edit custom role" : "Custom role"}
          </p>
          <h2>
            {draft.id
              ? "Create a new role version"
              : "Create least-privilege access"}
          </h2>
          <form
            className="form-stack"
            key={`${draft.id || "new"}:${draft.slug}`}
            onSubmit={submit}
          >
            <label>
              Role name
              <input
                name="name"
                required
                minLength={2}
                maxLength={100}
                defaultValue={draft.name}
              />
            </label>
            <label>
              Role slug
              <input
                name="slug"
                required
                pattern="[a-z0-9_]+"
                placeholder="sales_operations_india"
                defaultValue={draft.slug}
              />
            </label>
            <label>
              Module
              <select name="moduleKey" defaultValue={draft.moduleKey}>
                <option value="platform">Platform</option>
                <option value="crm">CRM</option>
                <option value="sales">Sales</option>
                <option value="accounting">Accounting</option>
                <option value="procurement">Procurement</option>
              </select>
            </label>
            <label>
              Risk level
              <select name="riskLevel" defaultValue={draft.riskLevel}>
                <option value="standard">Standard</option>
                <option value="sensitive">Sensitive</option>
                <option value="privileged">Privileged</option>
              </select>
            </label>
            <label>
              Description
              <textarea
                name="description"
                rows={4}
                maxLength={500}
                defaultValue={draft.description}
              />
            </label>
            {Object.entries(groups).map(([category, items]) => (
              <fieldset key={category}>
                <legend>{category}</legend>
                <div className="permission-list">
                  {items.map((permission) => (
                    <label className="checkbox-row" key={permission.key}>
                      <input
                        type="checkbox"
                        name="permissionKeys"
                        value={permission.key}
                        defaultChecked={draft.permissionKeys.includes(
                          permission.key,
                        )}
                      />
                      <span>
                        <strong>{permission.name}</strong>
                        <small>{permission.description}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <label className="checkbox-row">
              <input type="checkbox" name="acknowledgeWarningConflicts" />
              <span>
                <strong>Acknowledge warning-level conflicts</strong>
                <small>
                  Blocking segregation-of-duties conflicts can never be saved.
                  Use this only after documenting why a warning is acceptable.
                </small>
              </span>
            </label>
            <div className="action-row">
              <button
                className="primary-button"
                type="submit"
                disabled={pending}
              >
                {pending
                  ? "Saving…"
                  : draft.id
                    ? "Save new version"
                    : "Create role"}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setDraft(blankDraft)}
              >
                Clear
              </button>
            </div>
            {message ? (
              <p className="notice" role="status">
                {message}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}
    </div>
  );
}
