"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import AppIcon from "@/shared/components/app-icon";
import { requestJson } from "@/shared/http/client-request";

type ContextSwitcherProps = {
  organizations: Array<{ id: string; name: string }>;
  companies: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; company_id: string; name: string }>;
  activeOrganizationId: string;
  activeCompanyId: string | null;
  activeBranchId: string | null;
};

export default function ContextSwitcher({
  organizations,
  companies,
  branches,
  activeOrganizationId,
  activeCompanyId,
  activeBranchId,
}: ContextSwitcherProps) {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState(activeOrganizationId);
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

  async function switchOrganization(nextOrganizationId: string) {
    if (!nextOrganizationId || nextOrganizationId === activeOrganizationId) {
      return;
    }

    setOrganizationId(nextOrganizationId);
    setPending(true);
    setMessage("Updating organisation context…");

    try {
      const result = await requestJson<{ next?: string }>(
        "/api/context/organization",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId: nextOrganizationId }),
        },
      );
      if (!result.ok) {
        throw new Error(
          result.message || "Organisation context could not be updated.",
        );
      }

      setMessage(result.message || "Organisation context updated.");
      router.replace(result.next || "/dashboard");
      router.refresh();
    } catch (error) {
      setOrganizationId(activeOrganizationId);
      setMessage(
        error instanceof Error
          ? error.message
          : "Organisation context could not be updated.",
      );
    } finally {
      setPending(false);
    }
  }

  async function save(
    nextCompanyId: string,
    nextBranchId: string,
    previousCompanyId: string,
    previousBranchId: string,
  ) {
    if (!nextCompanyId) return;
    setPending(true);
    setMessage("Updating operating context…");

    try {
      const result = await requestJson("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: nextCompanyId,
          branchId: nextBranchId || null,
        }),
      });
      if (!result.ok) {
        throw new Error(result.message || "Context update failed.");
      }

      setMessage(result.message || "Operating context updated.");
      router.refresh();
    } catch (error) {
      setCompanyId(previousCompanyId);
      setBranchId(previousBranchId);
      setMessage(
        error instanceof Error
          ? error.message
          : "Operating context could not be updated.",
      );
    } finally {
      setPending(false);
    }
  }

  const canSwitchOrganization = organizations.length > 1;

  return (
    <div
      className={
        "context-switcher" +
        (canSwitchOrganization ? " has-organisation" : "")
      }
      aria-label="Current operating context"
    >
      <span className="context-switcher-icon" aria-hidden="true">
        <AppIcon name="companies" size={18} />
      </span>
      {canSwitchOrganization ? (
        <>
          <label>
            <span>Organisation</span>
            <select
              aria-label="Active organisation"
              value={organizationId}
              disabled={pending}
              onChange={(event) => {
                void switchOrganization(event.target.value);
              }}
            >
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <span className="context-divider" aria-hidden="true" />
        </>
      ) : null}
      <label>
        <span>Company</span>
        <select
          aria-label="Active company"
          value={companyId}
          disabled={pending}
          onChange={(event) => {
            const previousCompanyId = companyId;
            const previousBranchId = branchId;
            const nextCompanyId = event.target.value;
            const nextBranchId =
              branches.find(
                (branch) => branch.company_id === nextCompanyId,
              )?.id || "";
            setCompanyId(nextCompanyId);
            setBranchId(nextBranchId);
            void save(
              nextCompanyId,
              nextBranchId,
              previousCompanyId,
              previousBranchId,
            );
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
            const previousBranchId = branchId;
            const nextBranchId = event.target.value;
            setBranchId(nextBranchId);
            void save(
              companyId,
              nextBranchId,
              companyId,
              previousBranchId,
            );
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
