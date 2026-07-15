"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import AppIcon from "@/components/app-icon";

export default function ContextSwitcher({
  companies,
  branches,
  activeCompanyId,
  activeBranchId,
}: {
  companies: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; company_id: string; name: string }>;
  activeCompanyId: string | null;
  activeBranchId: string | null;
}) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState(
    activeCompanyId || companies[0]?.id || "",
  );
  const [branchId, setBranchId] = useState(activeBranchId || "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const availableBranches = useMemo(
    () => branches.filter((branch) => branch.company_id === companyId),
    [branches, companyId],
  );

  async function save(nextCompanyId: string, nextBranchId: string) {
    if (!nextCompanyId) return;
    setPending(true);
    setMessage("Updating operating context…");

    try {
      const response = await fetch("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: nextCompanyId,
          branchId: nextBranchId || null,
        }),
      });

      if (!response.ok) {
        throw new Error("Context update failed.");
      }

      setMessage("Operating context updated.");
      router.refresh();
    } catch {
      setMessage("Operating context could not be updated.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="context-switcher" aria-label="Current operating context">
      <span className="context-switcher-icon" aria-hidden="true">
        <AppIcon name="companies" size={18} />
      </span>
      <label>
        <span>Company</span>
        <select
          aria-label="Active company"
          value={companyId}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.value;
            setCompanyId(next);
            const firstBranch =
              branches.find((branch) => branch.company_id === next)?.id || "";
            setBranchId(firstBranch);
            void save(next, firstBranch);
          }}
        >
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </label>
      <span className="context-divider" aria-hidden="true" />
      <label>
        <span>Branch</span>
        <select
          aria-label="Active branch"
          value={branchId}
          disabled={pending}
          onChange={(event) => {
            setBranchId(event.target.value);
            void save(companyId, event.target.value);
          }}
        >
          <option value="">All branches</option>
          {availableBranches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
