"use client";

// New and edit project: the essentials first (name, internal or customer, customer, Project Manager, dates), then the optional details
// (type, priority, contact, scope, tags, team). A draft saves with whatever is filled; activation asks for the rest. The code and company
// come from the server. One save per click (useSubmitKey); the record opens in place of the form.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ComboBox, ErrorState, PermissionState, RadioGroup, Radio, RecordFormPage, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { useSubmitKey } from "@/shared/http/submit-once";
import { FormSection } from "@/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { useDebouncedValue } from "@/shared/ui/list";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  PROJECTS_BASE, PRIORITY_LABEL, createProject, customerContacts, errorDetails, errorMessage, errorStatus, getOptions, getProject, newKey, searchCustomers, updateProject,
  type Options, type Priority, type Project,
} from "../api/projects-api";

type Values = {
  name: string; classification: "INTERNAL" | "CUSTOMER"; customerId: string | null; customerName: string; customerContactId: string | null; managerUserId: string | null;
  plannedStartDate: string; targetEndDate: string; projectTypeId: string | null; priority: Priority; description: string; tags: string;
  members: Array<{ userId: string; role: string }>;
};
const valuesOf = (project: Project | undefined, options: Options): Values => ({
  name: project?.name ?? "", classification: project?.classification ?? "INTERNAL", customerId: project?.customerId ?? null, customerName: project?.customer ?? "",
  customerContactId: project?.contact?.id ?? null, managerUserId: project ? project.managerId : options.users.some((user) => user.id === options.currentUserId) ? options.currentUserId : null,
  plannedStartDate: project?.plannedStartDate ?? "", targetEndDate: project?.targetEndDate ?? "", projectTypeId: project?.typeId ?? null, priority: project?.priority ?? "NORMAL",
  description: project?.description ?? "", tags: (project?.tags ?? []).join(", "), members: [],
});

export function ProjectFormScreen({ projectId }: { projectId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "options"), queryFn: getOptions, staleTime: 60_000 });
  const project = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "project", projectId), queryFn: () => getProject(projectId as string), enabled: Boolean(projectId) });
  if (options.isLoading || (projectId && project.isLoading)) return <LoadingState label={projectId ? "Loading the project" : "Loading"} />;
  if (options.isError || !options.data) {
    if (errorStatus(options.error) === 403) return <PermissionState title="You don't have access to projects" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load this page" description={errorMessage(options.error)} />;
  }
  if (projectId && (project.isError || !project.data)) return <ErrorState title="Could not load the project" description={errorMessage(project.error)} action={{ label: "All projects", onPress: () => router.push(`${PROJECTS_BASE}/all`) }} />;
  if (!projectId && !options.data.can.create) return <PermissionState title="You can't create projects" description="Ask an administrator for the Create projects permission." />;
  if (project.data && !project.data.can.edit) {
    return <ErrorState title="This project can't be edited" description={project.data.archived ? "Restore it first." : `It is ${project.data.statusLabel.toLowerCase()}${project.data.status === "COMPLETED" ? " — reopen it to change it" : ""}.`}
      action={{ label: "Open the project", onPress: () => router.push(`${PROJECTS_BASE}/${project.data.id}`) }} />;
  }
  return <ProjectForm key={project.data?.id ?? "new"} project={project.data} options={options.data} />;
}

function ProjectForm({ project, options }: { project?: Project; options: Options }) {
  const mode = project ? "edit" : "create";
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Values>(() => valuesOf(project, options));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [customerSearch, setCustomerSearch] = useState(project?.customer ?? "");
  const term = useDebouncedValue(customerSearch);
  const customers = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "customers", term), queryFn: () => searchCustomers(term), enabled: values.classification === "CUSTOMER", staleTime: 30_000 });
  const contacts = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "contacts", values.customerId), queryFn: () => customerContacts(values.customerId as string), enabled: Boolean(values.customerId) });
  const set = <K extends keyof Values>(key: K) => (value: Values[K]) => { setValues((current) => ({ ...current, [key]: value })); setFieldErrors((current) => ({ ...current, [key]: "" })); };
  const customerOptions = useMemo(() => {
    const list = (customers.data ?? []).map((row) => ({ value: row.id, label: `${row.name}${row.number ? ` · ${row.number}` : ""}` }));
    if (values.customerId && !list.some((row) => row.value === values.customerId)) list.unshift({ value: values.customerId, label: values.customerName || "Selected customer" });
    return list;
  }, [customers.data, values.customerId, values.customerName]);
  const dateProblem = values.plannedStartDate && values.targetEndDate && values.targetEndDate < values.plannedStartDate ? "The target date cannot be before the start date." : "";
  const submit = useSubmitKey();
  // The create request key: a repeated save (double click, retry after a lost answer) returns the same project.
  const [createKey] = useState(newKey);
  const input = () => {
    const tags = values.tags.split(/[,;]/).map((tag) => tag.trim()).filter(Boolean);
    const body: Record<string, unknown> = {
      name: values.name.trim() || null, classification: values.classification, customerId: values.classification === "CUSTOMER" ? values.customerId : null,
      customerContactId: values.classification === "CUSTOMER" ? values.customerContactId : null, managerUserId: values.managerUserId, plannedStartDate: values.plannedStartDate || null,
      targetEndDate: values.targetEndDate || null, projectTypeId: values.projectTypeId, priority: values.priority, description: values.description.trim() || null, tags,
    };
    if (mode === "create") body.members = values.members.filter((row) => row.userId && row.userId !== values.managerUserId);
    return body;
  };
  const mutation = useMutation({
    mutationFn: () => submit.run(async () => (mode === "edit" ? updateProject(project!.id, { ...input(), expectedVersion: project!.version }) : createProject({ ...input(), idempotencyKey: createKey }))),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") });
      router.replace(`${PROJECTS_BASE}/${saved.projectId}`);
    },
    onError: (failure) => {
      const details = errorDetails(failure) as { field?: string; problems?: Array<{ field: string; message: string }> };
      const fields: Record<string, string> = {};
      if (details.field) fields[details.field] = errorMessage(failure);
      for (const problem of details.problems ?? []) fields[problem.field] = problem.message;
      setFieldErrors(fields);
      setError(errorMessage(failure));
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });
  const busy = mutation.isPending || mutation.isSuccess;
  const cancelHref = mode === "edit" ? `${PROJECTS_BASE}/${project!.id}` : `${PROJECTS_BASE}/all`;
  const userOptions = options.users.map((user) => ({ value: user.id, label: user.name }));
  const active = project && project.status !== "DRAFT";
  return (
    <RecordFormPage
      header={{ title: mode === "edit" ? `Edit ${project!.code}` : "New project",
        description: mode === "edit" ? (active ? "A planned or running project keeps its name, type, manager, dates and (for a customer project) its customer." : "Changes are kept in the project's history.")
          : "Save a draft with what you know now; the project code is assigned automatically. Team, links and documents can follow on the project page." }}
      formActions={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" isDisabled={busy} onPress={() => router.replace(cancelHref)}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || Boolean(dateProblem)} onPress={() => { setError(null); mutation.mutate(); }}>{mode === "edit" ? "Save changes" : "Save draft"}</Button>
        </div>
      }
      banner={error ? <Notice tone="danger">{error}</Notice> : undefined}
    >
      <FormSection title="Essentials" description="What a project needs before it can be activated.">
        <TextField label="Project name" value={values.name} onChange={set("name")} maxLength={200} isRequired={Boolean(active)} errorMessage={fieldErrors.name}
          description={active ? undefined : "Required to activate; a draft can wait."} />
        <RadioGroup label="Project for" value={values.classification} orientation="horizontal"
          onChange={(value) => setValues((current) => ({ ...current, classification: value as Values["classification"], ...(value === "INTERNAL" ? { customerId: null, customerName: "", customerContactId: null } : {}) }))}>
          <Radio value="INTERNAL">An internal initiative</Radio>
          <Radio value="CUSTOMER">A customer</Radio>
        </RadioGroup>
        {values.classification === "CUSTOMER" && (
          <ComboBox label="Customer" placeholder="Search customers" selectedKey={values.customerId} inputValue={customerSearch} onInputChange={setCustomerSearch}
            onSelectionChange={(key) => { const id = key ? String(key) : null; const chosen = customerOptions.find((row) => row.value === id);
              setValues((current) => ({ ...current, customerId: id, customerName: chosen?.label ?? "", customerContactId: null })); setFieldErrors((current) => ({ ...current, customerId: "" })); }}
            options={customerOptions} isLoading={customers.isFetching} emptyMessage="No customer matches." errorMessage={fieldErrors.customerId}
            description="From the shared customer master; required to activate." />
        )}
        <Select label="Project Manager" placeholder="Choose the accountable manager" selectedKey={values.managerUserId} onSelectionChange={(key) => set("managerUserId")(key ? String(key) : null)}
          options={userOptions} errorMessage={fieldErrors.managerUserId} description="An active colleague whose role can use Projects." />
        <TextField label="Planned start" type="date" value={values.plannedStartDate} onChange={set("plannedStartDate")} errorMessage={fieldErrors.plannedStartDate} />
        <TextField label="Target end" type="date" value={values.targetEndDate} onChange={set("targetEndDate")} errorMessage={dateProblem || fieldErrors.targetEndDate} />
      </FormSection>
      <FormSection title="Details" description="Optional now; the type is needed to activate.">
        <Select label="Project type" placeholder="Choose" selectedKey={values.projectTypeId} onSelectionChange={(key) => set("projectTypeId")(key ? String(key) : null)}
          options={options.types.map((type) => ({ value: type.id, label: type.name }))} errorMessage={fieldErrors.projectTypeId} />
        <Select label="Priority" selectedKey={values.priority} onSelectionChange={(key) => set("priority")(String(key) as Priority)}
          options={options.priorities.map((priority) => ({ value: priority, label: PRIORITY_LABEL[priority] }))} />
        {values.classification === "CUSTOMER" && values.customerId && (
          <Select label="Customer contact" placeholder={contacts.data?.length ? "Choose" : "No contacts for this customer"} selectedKey={values.customerContactId}
            onSelectionChange={(key) => set("customerContactId")(key ? String(key) : null)} options={(contacts.data ?? []).map((row) => ({ value: row.id, label: `${row.name}${row.email ? ` · ${row.email}` : ""}` }))}
            errorMessage={fieldErrors.customerContactId} />
        )}
        <TextField label="Tags" value={values.tags} onChange={set("tags")} description="Separate with commas, e.g. ERP, rollout" errorMessage={fieldErrors.tags} />
        <div className="sm:col-span-2"><TextArea label="Description and scope" value={values.description} onChange={set("description")} maxLength={10000}
          description="What is delivered, and what is not. A short paragraph is enough." /></div>
      </FormSection>
      {mode === "create" && (
        <FormSection title="Team" description="People are told when they are added. You can also add them later." columns={1}>
          {values.members.map((row, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_200px_auto]">
              <Select aria-label="Member" placeholder="Choose a colleague" selectedKey={row.userId || null} onSelectionChange={(key) => setValues((current) => ({ ...current,
                members: current.members.map((entry, at) => (at === index ? { ...entry, userId: key ? String(key) : "" } : entry)) }))}
                options={userOptions.filter((option) => option.value !== values.managerUserId)} />
              <Select aria-label="Project role" selectedKey={row.role} onSelectionChange={(key) => setValues((current) => ({ ...current,
                members: current.members.map((entry, at) => (at === index ? { ...entry, role: String(key) } : entry)) }))} options={options.roles.map((role) => ({ value: role.code, label: role.name }))} />
              <Button variant="ghost" onPress={() => setValues((current) => ({ ...current, members: current.members.filter((_, at) => at !== index) }))}>Remove</Button>
            </div>
          ))}
          <div><Button variant="secondary" onPress={() => setValues((current) => ({ ...current, members: [...current.members, { userId: "", role: "MEMBER" }] }))}>Add a team member</Button></div>
        </FormSection>
      )}
    </RecordFormPage>
  );
}
