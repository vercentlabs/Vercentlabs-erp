"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";

type ModuleManagerProps = {
  moduleKey: string;
  status: "registered" | "enabled" | "disabled";
  canManage: boolean;
};

export default function ModuleManager({
  moduleKey,
  status,
  canManage,
}: ModuleManagerProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function update(nextStatus: ModuleManagerProps["status"]) {
    setError("");
    startTransition(async () => {
      const data = await requestJson(
        `/api/modules/${encodeURIComponent(moduleKey)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      if (!data.ok) {
        setError(data.message || "The module status could not be changed.");
        return;
      }
      router.refresh();
    });
  }

  if (!canManage)
    return (
      <span
        className={`status-pill ${status === "enabled" ? "active" : "inactive"}`}
      >
        {status}
      </span>
    );
  return (
    <div className="module-controls">
      <select
        aria-label={`Status for ${moduleKey}`}
        disabled={pending}
        onChange={(event) =>
          update(event.target.value as ModuleManagerProps["status"])
        }
        value={status}
      >
        <option value="registered">Registered</option>
        <option value="enabled">Enabled</option>
        <option value="disabled">Disabled</option>
      </select>
      {error ? (
        <small className="inline-error" role="alert">
          {error}
        </small>
      ) : null}
    </div>
  );
}
