"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Dialog, EmptyState, ErrorState, PageHeader, PermissionState, Select, TextField } from "@vercentlabs/design-system";

import { listCompanies } from "@/features/settings/companies/api/companies-api";
import { BranchesApiError, BranchRow, createBranch, listBranches, updateBranch } from "../api/branches-api";

const QUERY_KEY = ["settings", "branches"];
const COMPANIES_QUERY_KEY = ["settings", "companies"];

export function BranchesScreen({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: listBranches });
  const companiesQuery = useQuery({ queryKey: COMPANIES_QUERY_KEY, queryFn: listCompanies });

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<BranchRow | null>(null);
  const [form, setForm] = useState({ name: "", code: "", timezone: "Asia/Kolkata", companyId: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createBranch(form),
    onSuccess: () => {
      setFormError(null);
      setCreateOpen(false);
      setForm({ name: "", code: "", timezone: "Asia/Kolkata", companyId: "" });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: unknown) => setFormError(error instanceof BranchesApiError ? error.message : "The branch could not be created."),
  });

  const editMutation = useMutation({
    mutationFn: (updates: { name: string; timezone: string }) => updateBranch(editTarget!.id, updates),
    onSuccess: () => {
      setFormError(null);
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: unknown) => setFormError(error instanceof BranchesApiError ? error.message : "The branch could not be updated."),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: (branch: BranchRow) => updateBranch(branch.id, { status: branch.status === "active" ? "inactive" : "active" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  if (!canManage) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <PermissionState title="You don't have access to Branches" description="Ask an administrator to grant branch.manage." />
      </div>
    );
  }

  const branches = query.data?.branches ?? [];
  const companies = companiesQuery.data?.companies ?? [];
  const companyName = (companyId: string) => companies.find((c) => c.id === companyId)?.name ?? companyId;
  const companyOptions = companies.map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Branches"
        description="Locations within each company."
        primaryAction={
          <Button variant="primary" onPress={() => setCreateOpen(true)} isDisabled={companies.length === 0}>
            New branch
          </Button>
        }
      />

      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : query.isError ? (
        <ErrorState title="Could not load branches" description="Something went wrong." action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : branches.length === 0 ? (
        <EmptyState title="No branches yet" description={companies.length === 0 ? "Create a company first." : "Create your first branch."} />
      ) : (
        <ul className="flex max-w-[720px] flex-col gap-2">
          {branches.map((branch) => (
            <li key={branch.id} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-text">{branch.name}</span>
                  {branch.is_primary && <Badge tone="info">Primary</Badge>}
                  <Badge tone={branch.status === "active" ? "success" : "neutral"}>{branch.status}</Badge>
                </div>
                <span className="text-xs text-text-muted">
                  {branch.code} · {companyName(branch.company_id)} · {branch.timezone}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="compact"
                  onPress={() => {
                    setEditTarget(branch);
                    setForm({ name: branch.name, code: branch.code, timezone: branch.timezone, companyId: branch.company_id });
                  }}
                >
                  Edit
                </Button>
                <Button variant="secondary" size="compact" isLoading={toggleStatusMutation.isPending} onPress={() => toggleStatusMutation.mutate(branch)}>
                  {branch.status === "active" ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog isOpen={createOpen} onOpenChange={(open) => !open && setCreateOpen(false)} title="New branch">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
          noValidate
        >
          <Select label="Company" isRequired options={companyOptions} selectedKey={form.companyId} onSelectionChange={(key) => setForm((f) => ({ ...f, companyId: String(key) }))} />
          <TextField label="Branch name" isRequired value={form.name} onChange={(value) => setForm((f) => ({ ...f, name: value }))} />
          <TextField label="Branch code" isRequired value={form.code} onChange={(value) => setForm((f) => ({ ...f, code: value }))} />
          <TextField label="Timezone" isRequired value={form.timezone} onChange={(value) => setForm((f) => ({ ...f, timezone: value }))} />
          {formError ? (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          ) : null}
          <Button type="submit" variant="primary" isLoading={createMutation.isPending}>
            Create branch
          </Button>
        </form>
      </Dialog>

      <Dialog isOpen={Boolean(editTarget)} onOpenChange={(open) => !open && setEditTarget(null)} title="Edit branch">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            editMutation.mutate({ name: form.name, timezone: form.timezone });
          }}
          noValidate
        >
          <TextField label="Branch name" isRequired value={form.name} onChange={(value) => setForm((f) => ({ ...f, name: value }))} />
          <TextField label="Timezone" isRequired value={form.timezone} onChange={(value) => setForm((f) => ({ ...f, timezone: value }))} />
          {formError ? (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          ) : null}
          <Button type="submit" variant="primary" isLoading={editMutation.isPending}>
            Save
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
