"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Dialog, EmptyState, ErrorState, PageHeader, PermissionState, TextField } from "@vercentlabs/design-system";

import { CompaniesApiError, CompanyRow, createCompany, listCompanies, updateCompany } from "../api/companies-api";

const QUERY_KEY = ["settings", "companies"];

export function CompaniesScreen({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: listCompanies });

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CompanyRow | null>(null);
  const [form, setForm] = useState({ name: "", legalName: "", code: "", countryCode: "IN", baseCurrency: "INR", taxId: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createCompany(form),
    onSuccess: () => {
      setFormError(null);
      setCreateOpen(false);
      setForm({ name: "", legalName: "", code: "", countryCode: "IN", baseCurrency: "INR", taxId: "" });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: unknown) => setFormError(error instanceof CompaniesApiError ? error.message : "The company could not be created."),
  });

  const editMutation = useMutation({
    mutationFn: (updates: { name: string; legalName: string; taxId: string }) => updateCompany(editTarget!.id, updates),
    onSuccess: () => {
      setFormError(null);
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: unknown) => setFormError(error instanceof CompaniesApiError ? error.message : "The company could not be updated."),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: (company: CompanyRow) => updateCompany(company.id, { status: company.status === "active" ? "inactive" : "active" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  if (!canManage) {
    return (
      <div className="flex flex-1 flex-col gap-6 px-8 py-10">
        <PermissionState title="You don't have access to Companies" description="Ask an administrator to grant company.manage." />
      </div>
    );
  }

  const companies = query.data?.companies ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6 px-8 py-10">
      <PageHeader
        title="Companies"
        description="Legal entities within your organization."
        primaryAction={
          <Button variant="primary" onPress={() => setCreateOpen(true)}>
            New company
          </Button>
        }
      />

      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : query.isError ? (
        <ErrorState title="Could not load companies" description="Something went wrong." action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : companies.length === 0 ? (
        <EmptyState title="No companies yet" description="Create your first company to get started." />
      ) : (
        <ul className="flex max-w-[720px] flex-col gap-2">
          {companies.map((company) => (
            <li key={company.id} className="flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text">{company.name}</span>
                  {company.is_primary && <Badge tone="info">Primary</Badge>}
                  <Badge tone={company.status === "active" ? "success" : "neutral"}>{company.status}</Badge>
                </div>
                <span className="text-xs text-text-muted">
                  {company.code} · {company.legal_name} · {company.country_code} · {company.base_currency}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="compact"
                  onPress={() => {
                    setEditTarget(company);
                    setForm({ name: company.name, legalName: company.legal_name, code: company.code, countryCode: company.country_code, baseCurrency: company.base_currency, taxId: company.tax_id ?? "" });
                  }}
                >
                  Edit
                </Button>
                <Button variant="secondary" size="compact" isLoading={toggleStatusMutation.isPending} onPress={() => toggleStatusMutation.mutate(company)}>
                  {company.status === "active" ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog isOpen={createOpen} onOpenChange={(open) => !open && setCreateOpen(false)} title="New company">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
          noValidate
        >
          <TextField label="Company name" isRequired value={form.name} onChange={(value) => setForm((f) => ({ ...f, name: value }))} />
          <TextField label="Legal name" isRequired value={form.legalName} onChange={(value) => setForm((f) => ({ ...f, legalName: value }))} />
          <TextField label="Company code" isRequired value={form.code} onChange={(value) => setForm((f) => ({ ...f, code: value }))} />
          <div className="flex gap-3">
            <TextField label="Country code" isRequired value={form.countryCode} onChange={(value) => setForm((f) => ({ ...f, countryCode: value }))} />
            <TextField label="Base currency" isRequired value={form.baseCurrency} onChange={(value) => setForm((f) => ({ ...f, baseCurrency: value }))} />
          </div>
          <TextField label="Tax ID (optional)" value={form.taxId} onChange={(value) => setForm((f) => ({ ...f, taxId: value }))} />
          {formError ? (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          ) : null}
          <Button type="submit" variant="primary" isLoading={createMutation.isPending}>
            Create company
          </Button>
        </form>
      </Dialog>

      <Dialog isOpen={Boolean(editTarget)} onOpenChange={(open) => !open && setEditTarget(null)} title="Edit company">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            editMutation.mutate({ name: form.name, legalName: form.legalName, taxId: form.taxId });
          }}
          noValidate
        >
          <TextField label="Company name" isRequired value={form.name} onChange={(value) => setForm((f) => ({ ...f, name: value }))} />
          <TextField label="Legal name" isRequired value={form.legalName} onChange={(value) => setForm((f) => ({ ...f, legalName: value }))} />
          <TextField label="Tax ID" value={form.taxId} onChange={(value) => setForm((f) => ({ ...f, taxId: value }))} />
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
