"use client";

// Departments for purchase requests (report Phase 3): each with its head, who approves the department's requests first. Larger requests
// then follow the approval rules for purchase requests (Settings › Approval rules).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { Notice, Panel } from "@/shared/ui/Panel";
import { post, request } from "@/features/procurement/shared/http";

export type ProcurementDepartment = { id: string; name: string; headUserId: string | null; headName: string | null; active: boolean };
export const listDepartments = (all = false) => request<{ departments: ProcurementDepartment[] }>(`/settings/departments${all ? "?all=1" : ""}`).then((result) => result.departments);

export function DepartmentsPanel({ canManage, people }: { canManage: boolean; people: Array<{ id: string; name: string }> }) {
  const queryClient = useQueryClient();
  const key = ["procurement", "departments", "all"];
  const query = useQuery({ queryKey: key, queryFn: () => listDepartments(true) });
  const [draft, setDraft] = useState({ name: "", headUserId: "" });
  const done = () => { setDraft({ name: "", headUserId: "" }); void queryClient.invalidateQueries({ queryKey: ["procurement", "departments"] }); };
  const save = useMutation({ mutationFn: (input: Record<string, unknown>) => post("/settings/departments", input), onSuccess: done });
  const departments = query.data ?? [];
  return (
    <Panel title="Departments" description="Each department's head approves its purchase requests.">
      <div className="flex flex-col gap-3">
        {save.error && <Notice>{save.error instanceof Error ? save.error.message : "Could not save."}</Notice>}
        {departments.length ? (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {departments.map((department) => (
              <li key={department.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{department.name}</span>
                  {!department.active && <StatusBadge tone="neutral">Switched off</StatusBadge>}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <Select aria-label={`Head of ${department.name}`} size="compact" isDisabled={!canManage} selectedKey={department.headUserId ?? "none"} className="sm:w-56"
                    onSelectionChange={(value) => save.mutate({ id: department.id, name: department.name, headUserId: value === "none" ? null : String(value) })}
                    options={[{ value: "none", label: "No head (any approver)" }, ...people.map((person) => ({ value: person.id, label: person.name }))]} />
                  {canManage && <Button size="compact" variant="ghost" onPress={() => save.mutate({ id: department.id, name: department.name, headUserId: department.headUserId, active: !department.active })}>
                    {department.active ? "Switch off" : "Switch on"}</Button>}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-text-muted">No departments yet. Without one, anyone allowed to approve requests approves them.</p>}
        {canManage && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_2fr_auto] sm:items-end">
            <TextField label="New department" value={draft.name} onChange={(value) => setDraft((state) => ({ ...state, name: value }))} placeholder="Maintenance" />
            <Select label="Head" selectedKey={draft.headUserId || "none"} onSelectionChange={(value) => setDraft((state) => ({ ...state, headUserId: value === "none" ? "" : String(value) }))}
              options={[{ value: "none", label: "No head" }, ...people.map((person) => ({ value: person.id, label: person.name }))]} />
            <Button variant="secondary" isDisabled={!draft.name.trim()} isLoading={save.isPending} onPress={() => save.mutate({ name: draft.name.trim(), headUserId: draft.headUserId || null })}>Add</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
