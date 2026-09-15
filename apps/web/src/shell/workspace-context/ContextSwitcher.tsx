"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MenuTrigger,
  Menu,
  MenuItem,
  MenuSeparator,
  IconButton,
} from "@vercentlabs/design-system";
import { Building2, ChevronsUpDown } from "lucide-react";

import { useWorkspaceContext } from "./WorkspaceContext";

type CompanyOption = {
  id: string;
  name: string;
  branches: Array<{ id: string; name: string }>;
};

async function fetchCompanies(): Promise<CompanyOption[]> {
  const response = await fetch("/api/workspace/companies");
  const payload = (await response.json()) as {
    ok: boolean;
    companies?: CompanyOption[];
    message?: string;
  };
  if (!response.ok || !payload.ok)
    throw new Error(payload.message || "Could not load companies.");
  return payload.companies ?? [];
}

// Company/branch context switching (Phase 4). Organization is not a
// selector here — the prompt is explicit that Organization/Company/Branch
// are the global shell's context, while Warehouse/Accounting Period/Store-
// Terminal/Project stay module-specific and must never become global
// selectors. Switching always calls the server (never trusts a locally-
// held id), then clears every query cached under the previous
// organizationId+companyId scope before the new context can be read —
// see queryKeys.ts's scopedQueryKey() convention.
export function ContextSwitcher() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();

  const companiesQuery = useQuery({
    queryKey: ["workspace-companies", workspace.organizationId],
    queryFn: fetchCompanies,
  });

  const switchMutation = useMutation({
    mutationFn: async (input: {
      companyId: string;
      branchId: string | null;
    }) => {
      const response = await fetch("/api/workspace/context", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
      };
      if (!response.ok || !payload.ok)
        throw new Error(payload.message || "Could not switch context.");
      return payload;
    },
    onSuccess: () => {
      // Scope-safety: drop every query cached under the previous
      // organizationId+companyId before the server-resolved context
      // (re-fetched by router.refresh()) can render new data.
      queryClient.removeQueries({ queryKey: [workspace.organizationId] });
      queryClient.removeQueries({ queryKey: ["workspace-companies"] });
      router.refresh();
    },
  });

  function handleSelect(companyId: string, branchId: string | null) {
    // Phase 4's unsaved-changes warning: this shell has no form-dirty
    // tracker yet (no screen with unsaved state exists this pass), so
    // there is nothing real to warn about. The switch itself already
    // redirects safely by construction — server-resolved context plus a
    // full router.refresh() re-renders every current route's data, and a
    // route that no longer exists in the new context falls back to that
    // route's own not-found/empty state rather than showing stale data.
    switchMutation.mutate({ companyId, branchId });
  }

  const label = workspace.companyName
    ? workspace.branchName
      ? `${workspace.companyName} · ${workspace.branchName}`
      : workspace.companyName
    : workspace.organizationName || "Workspace";

  return (
    <MenuTrigger>
      <IconButton
        aria-label={`Switch company or branch (current: ${label})`}
        variant="ghost"
        className="w-auto gap-2 px-2"
      >
        <Building2 aria-hidden="true" className="size-4" />
        <span className="max-w-[220px] truncate text-sm font-medium text-text">
          {label}
        </span>
        <ChevronsUpDown
          aria-hidden="true"
          className="size-3.5 text-text-muted"
        />
      </IconButton>
      <Menu
        onAction={(key) => {
          const [companyId, branchId] = String(key).split("::");
          handleSelect(companyId, branchId || null);
        }}
      >
        {companiesQuery.isLoading ? (
          <MenuItem id="loading" isDisabled textValue="Loading">
            Loading companies…
          </MenuItem>
        ) : companiesQuery.isError ? (
          <MenuItem id="error" isDisabled textValue="Error">
            Could not load companies.
          </MenuItem>
        ) : (
          (companiesQuery.data ?? []).flatMap((company) => [
            <MenuItem
              key={company.id}
              id={`${company.id}::`}
              textValue={company.name}
            >
              {company.name}
            </MenuItem>,
            ...company.branches.map((branch) => (
              <MenuItem
                key={branch.id}
                id={`${company.id}::${branch.id}`}
                textValue={branch.name}
              >
                <span className="pl-4 text-text-secondary">{branch.name}</span>
              </MenuItem>
            )),
            <MenuSeparator key={`${company.id}-sep`} />,
          ])
        )}
      </Menu>
    </MenuTrigger>
  );
}
