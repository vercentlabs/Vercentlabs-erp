"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/lib/client-request";

export default function RoleManager({
  roles,
  permissions,
}: {
  roles: Array<{
    id: string;
    name: string;
    slug: string;
    description: string;
    isSystem: boolean;
    permissionKeys: string[];
    userCount: number;
  }>;
  permissions: Array<{
    key: string;
    name: string;
    category: string;
    description: string;
  }>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get("name") || ""),
      slug: String(form.get("slug") || ""),
      description: String(form.get("description") || ""),
      permissionKeys: form.getAll("permissionKeys").map(String),
    };
    const formElement = event.currentTarget;
    const result = await requestJson("/api/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setMessage(result.message || "Request completed.");
    setPending(false);
    if (result.ok) {
      formElement.reset();
      router.refresh();
    }
  }
  const groups = permissions.reduce<Record<string, typeof permissions>>(
    (result, permission) => {
      (result[permission.category] ||= []).push(permission);
      return result;
    },
    {},
  );
  return (
    <div className="resource-layout">
      <section className="panel">
        <p className="eyebrow">Role catalogue</p>
        <h2>System and custom roles</h2>
        <div className="role-grid">
          {roles.map((role) => (
            <article className="resource-card" key={role.id}>
              <div className="card-title-row">
                <div className="role-card-heading">
                  <strong>{role.name}</strong>
                  <span>{role.slug}</span>
                </div>
                <span className="status-pill active">
                  {role.isSystem ? "System" : "Custom"}
                </span>
              </div>
              <p>{role.description}</p>
              <div className="chip-row">
                <span>{role.permissionKeys.length} permissions</span>
                <span>{role.userCount} users</span>
              </div>
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
            </article>
          ))}
        </div>
      </section>
      <section className="panel sticky-panel">
        <p className="eyebrow">Custom role</p>
        <h2>Create least-privilege access</h2>
        <form className="form-stack" onSubmit={submit}>
          <label>
            Role name
            <input name="name" required minLength={2} maxLength={100} />
          </label>
          <label>
            Role slug
            <input
              name="slug"
              required
              pattern="[a-z0-9_]+"
              placeholder="warehouse_supervisor"
            />
          </label>
          <label>
            Description
            <textarea name="description" rows={3} maxLength={500} />
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
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create role"}
          </button>
          {message ? (
            <p className="notice" role="status">
              {message}
            </p>
          ) : null}
        </form>
      </section>
    </div>
  );
}
