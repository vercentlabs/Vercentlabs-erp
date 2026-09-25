"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Badge, Button, EmptyState, ErrorState, PageHeader, PermissionState } from "@vercentlabs/design-system";

import { listModules, ModuleRow, ModulesApiError, setModuleEnabled } from "../api/modules-api";

const QUERY_KEY = ["settings", "modules"];

// Tenant enablement and plan entitlement are shown as two separate facts:
// turning a module on never changes the plan, and a plan that includes a
// module never turns it on. Access for each person still comes from roles.
function planLine(module: ModuleRow) {
  if (module.planIncluded) return "Included";
  return module.entitlementEnforced ? "Not included in current plan" : "Not included in current plan (not enforced yet)";
}

function accessLine(module: ModuleRow) {
  if (!module.enabled) return "Turned off — hidden from everyone. Roles and data are kept.";
  if (!module.availableToWorkspace) return "This module will remain unavailable until the plan includes it.";
  return "Controlled by roles and permissions.";
}

export function ModulesScreen({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: listModules, enabled: canManage });
  const [target, setTarget] = useState<ModuleRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (module: ModuleRow) => setModuleEnabled(module.key, !module.enabled),
    onSuccess: () => {
      setError(null);
      setTarget(null);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (failure: unknown) => {
      setTarget(null);
      setError(failure instanceof ModulesApiError ? failure.message : "The module could not be changed.");
    },
  });

  if (!canManage) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <PermissionState title="You can't manage modules" description="Module settings apply to the whole organization. Ask your organization owner or system administrator." />
      </div>
    );
  }

  const modules = query.data?.modules ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Modules" description="Turn business modules on or off for your whole organization. Turning a module off hides it for everyone; roles and data are kept." />

      {error ? (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : query.isError ? (
        <ErrorState title="Could not load modules" description="Something went wrong." action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : modules.length === 0 ? (
        <EmptyState title="No modules available" />
      ) : (
        <ul className="grid max-w-[1040px] grid-cols-1 gap-3 md:grid-cols-2" aria-label="Modules">
          {modules.map((module) => (
            <li key={module.key} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4" aria-label={module.name}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm font-semibold text-text">{module.name}</span>
                  <span className="text-xs text-text-muted">{module.description}</span>
                </div>
                <Badge tone={module.enabled ? "success" : "neutral"}>{module.enabled ? "Enabled" : "Disabled"}</Badge>
              </div>
              <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-xs">
                <dt className="text-text-muted">Status</dt>
                <dd className="text-text">{module.enabled ? "Enabled" : "Disabled"}</dd>
                <dt className="text-text-muted">Plan</dt>
                <dd className={module.planIncluded ? "text-text" : "text-warning"}>{planLine(module)}</dd>
                <dt className="text-text-muted">Access</dt>
                <dd className="text-text-secondary">{accessLine(module)}</dd>
              </dl>
              {module.released && (
                <div>
                  <Button variant={module.enabled ? "secondary" : "primary"} size="compact" onPress={() => setTarget(module)}>
                    {module.enabled ? `Disable ${module.name}` : `Enable ${module.name}`}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        isOpen={Boolean(target)}
        onOpenChange={(open) => !open && setTarget(null)}
        title={target?.enabled ? `Disable ${target?.name}?` : `Enable ${target?.name}?`}
        description={
          target?.enabled
            ? `${target?.name} will disappear for everyone in your organization and its pages and APIs will stop working. Role assignments and data are kept, and turning it back on restores access.`
            : `${target?.name} becomes available to people whose roles allow it${target && !target.planIncluded ? ", once your plan includes it" : ""}. This does not change your plan or billing.`
        }
        confirmLabel={target?.enabled ? "Disable module" : "Enable module"}
        isConfirming={mutation.isPending}
        onConfirm={() => target && mutation.mutate(target)}
      />
    </div>
  );
}
