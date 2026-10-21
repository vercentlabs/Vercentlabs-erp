"use client";

// New and edit project: the essentials first (name, internal or customer, customer, Project Manager, dates), then the optional details
// (type, priority, contact, scope, tags, team). A draft saves with whatever is filled; activation asks for the rest. The code and company
// come from the server. One save per click (useSubmitKey); the record opens in place of the form. The customer is chosen from the shared
// customer master by its record (never typed as a name); past the draft it changes on the project's Customer & Contacts tab.
import { useMemo, useState } from "react";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
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
  PROJECTS_BASE, createProject, customerContacts, errorDetails, errorMessage, errorStatus, getOptions, getProject, newKey, searchCustomers, updateProject,
  type EligibleCustomer, type Options, type Priority, type Project,
} from "../api/projects-api";
import { PriorityField, priorityReasonMissing } from "../priority/Priority";

type Values = {
  name: string; classification: "INTERNAL" | "CUSTOMER"; customerId: string | null; crmAccountId: string | null; customerName: string; customerContactId: string | null; managerUserId: string | null;
  plannedStartDate: string; targetEndDate: string; projectTypeId: string | null; priority: Priority; description: string; tags: string;
  members: Array<{ userId: string; role: string }>;
};
const valuesOf = (project: Project | undefined, options: Options): Values => ({
  name: project?.name ?? "", classification: project?.classification ?? "INTERNAL", customerId: project?.customerId ?? null, crmAccountId: project?.crmAccountId ?? null, customerName: project?.customer ?? "",
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
  // Raising the project to Urgent, or lowering it from Urgent, says why (its milestones and tasks keep their own priorities).
  const [priorityReason, setPriorityReason] = useState("");
  // Progress Tracking: a running project's target date moving later says why (the original target and every revision are kept).
  const [targetChangeReason, setTargetChangeReason] = useState("");
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Values>(() => valuesOf(project, options));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [customerSearch, setCustomerSearch] = useState(project?.customer ?? "");
  const term = useDebouncedValue(customerSearch);
  const active = project && project.status !== "DRAFT";
  // Only someone who may assign a customer searches the customer master (the search lists customers to no one else).
  const mayAssign = options.can.customerAssign && !active;
  const customers = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "customers", term, options.can.crmAccounts), queryFn: () => searchCustomers(term, options.can.crmAccounts),
    enabled: values.classification === "CUSTOMER" && mayAssign, staleTime: 30_000 });
  const partyId = values.customerId ?? values.crmAccountId;
  const contacts = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "contacts", partyId), queryFn: () => customerContacts(partyId as string), enabled: Boolean(partyId) && mayAssign });
  const [chosen, setChosen] = useState<EligibleCustomer | null>(null);
  const set = <K extends keyof Values>(key: K) => (value: Values[K]) => { setValues((current) => ({ ...current, [key]: value })); setFieldErrors((current) => ({ ...current, [key]: "" })); };
  // Each option says what tells look-alikes apart: number, city, and whether it is inactive or a CRM account not yet a Customer.
  const customerOptions = useMemo(() => {
    const list = (customers.data ?? []).map((row) => ({ value: row.id, label: [row.name, row.number, row.city, row.note].filter(Boolean).join(" · ") }));
    if (partyId && !list.some((row) => row.value === partyId)) list.unshift({ value: partyId, label: values.customerName || "Selected customer" });
    return list;
  }, [customers.data, partyId, values.customerName]);
  const pickCustomer = (key: string | null) => {
    const row = (customers.data ?? []).find((item) => item.id === key) ?? null;
    if (row && !row.selectable) { setFieldErrors((current) => ({ ...current, customerId: row.inactive ? "This customer is inactive. Choose an eligible customer." : "This record cannot be chosen." })); return; }
    setChosen(row);
    setValues((current) => ({ ...current, customerId: row?.kind === "CRM_ACCOUNT" ? null : key, crmAccountId: row?.kind === "CRM_ACCOUNT" ? key : null,
      customerName: row ? [row.name, row.number].filter(Boolean).join(" · ") : "", customerContactId: null }));
    setFieldErrors((current) => ({ ...current, customerId: "" }));
  };
  const dateProblem = values.plannedStartDate && values.targetEndDate && values.targetEndDate < values.plannedStartDate ? "The target date cannot be before the start date." : "";
  const submit = useSubmitKey();
  // The create request key: a repeated save (double click, retry after a lost answer) returns the same project.
  const [createKey] = useState(newKey);
  const input = () => {
    const tags = values.tags.split(/[,;]/).map((tag) => tag.trim()).filter(Boolean);
    const body: Record<string, unknown> = {
      name: values.name.trim() || null, classification: values.classification, managerUserId: values.managerUserId, plannedStartDate: values.plannedStartDate || null,
      targetEndDate: values.targetEndDate || null, projectTypeId: values.projectTypeId, priority: values.priority, description: values.description.trim() || null, tags,
      ...(mode === "edit" && priorityReason.trim() ? { priorityReason: priorityReason.trim() } : {}),
      ...(mode === "edit" && targetChangeReason.trim() ? { targetChangeReason: targetChangeReason.trim() } : {}),
    };
    // The customer is sent only by someone who may choose it, on a draft (past the draft it changes on the Customer & Contacts tab).
    if (mayAssign) {
      body.customerId = values.classification === "CUSTOMER" ? values.customerId : null;
      body.crmAccountId = values.classification === "CUSTOMER" ? values.crmAccountId : null;
      body.customerContactId = values.classification === "CUSTOMER" ? values.customerContactId : null;
    }
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
  return (
    <RecordFormPage
      header={{ title: mode === "edit" ? `Edit ${project!.code}` : "New project",
        description: mode === "edit" ? (active ? "A planned or running project keeps its name, type, manager, dates and (for a customer project) its customer." : "Changes are kept in the project's history.")
          : "Save a draft with what you know now; the project code is assigned automatically. Team, links and documents can follow on the project page." }}
      formActions={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" isDisabled={busy} onPress={() => router.replace(cancelHref)}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || Boolean(dateProblem) || priorityReasonMissing(project?.priority, values.priority, priorityReason)} onPress={() => { setError(null); mutation.mutate(); }}>{mode === "edit" ? "Save changes" : "Save draft"}</Button>
        </div>
      }
      banner={error ? <Notice tone="danger">{error}</Notice> : undefined}
    >
      <FormSection title="Essentials" description="What a project needs before it can be activated.">
        <TextField label="Project name" value={values.name} onChange={set("name")} maxLength={200} isRequired={Boolean(active)} errorMessage={fieldErrors.name}
          description={active ? undefined : "Required to activate; a draft can wait."} />
        <RadioGroup label="Project for" value={values.classification} orientation="horizontal" isDisabled={Boolean(active)}
          onChange={(value) => setValues((current) => ({ ...current, classification: value as Values["classification"], ...(value === "INTERNAL" ? { customerId: null, crmAccountId: null, customerName: "", customerContactId: null } : {}) }))}>
          <Radio value="INTERNAL">An internal initiative</Radio>
          <Radio value="CUSTOMER">A customer</Radio>
        </RadioGroup>
        {values.classification === "CUSTOMER" && (mayAssign ? (
          <div className="flex flex-col gap-2">
            <ComboBox label="Customer" placeholder="Search by name, number, phone or GSTIN" selectedKey={partyId} inputValue={customerSearch} onInputChange={setCustomerSearch}
              onSelectionChange={(key) => pickCustomer(key ? String(key) : null)}
              options={customerOptions} isLoading={customers.isFetching} emptyMessage="No customer matches. A new customer is created in Sales or CRM first." errorMessage={fieldErrors.customerId}
              description="From the shared customer master; required to activate." />
            {chosen?.similarNames && <Notice tone="warning">Customers with similar names exist. Check the number and city before saving.</Notice>}
            {values.crmAccountId && <Notice tone="info">A CRM account, not yet a Customer: the draft keeps it as a provisional customer. It is linked to a Customer record before activation.</Notice>}
          </div>
        ) : (
          <TextField label="Customer" value={values.customerName || "Not set"} isReadOnly
            description={active ? "Change the customer on the project's Customer & Contacts tab, where the linked work is reviewed." : "You may not choose a project's customer."} />
        ))}
        <Select label="Project Manager" placeholder="Choose the accountable manager" selectedKey={values.managerUserId} onSelectionChange={(key) => set("managerUserId")(key ? String(key) : null)}
          options={userOptions} errorMessage={fieldErrors.managerUserId} description="An active colleague whose role can use Projects." />
        <TextField label="Planned start" type="date" value={values.plannedStartDate} onChange={set("plannedStartDate")} errorMessage={fieldErrors.plannedStartDate} />
        <TextField label="Target end" type="date" value={values.targetEndDate} onChange={set("targetEndDate")} errorMessage={dateProblem || fieldErrors.targetEndDate} />
        {project && ["IN_PROGRESS", "ON_HOLD"].includes(project.status) && project.targetEndDate && values.targetEndDate > project.targetEndDate && (
          <TextArea label="Why the target date moves later" value={targetChangeReason} onChange={setTargetChangeReason} isRequired maxLength={1000}
            errorMessage={fieldErrors.targetChangeReason} description="Kept with the schedule history; the original target stays on record." />
        )}
      </FormSection>
      <FormSection title="Details" description="Optional now; the type is needed to activate.">
        <Select label="Project type" placeholder="Choose" selectedKey={values.projectTypeId} onSelectionChange={(key) => set("projectTypeId")(key ? String(key) : null)}
          options={options.types.map((type) => ({ value: type.id, label: type.name }))} errorMessage={fieldErrors.projectTypeId} />
        <PriorityField value={values.priority} onChange={(next) => set("priority")(next)} original={project?.priority ?? null} reason={priorityReason} onReasonChange={setPriorityReason} />
        {values.classification === "CUSTOMER" && partyId && mayAssign && (
          <Select label="Primary contact" placeholder={contacts.data?.length ? "Choose" : "No contacts for this customer"} selectedKey={values.customerContactId}
            onSelectionChange={(key) => set("customerContactId")(key ? String(key) : null)} options={(contacts.data ?? []).map((row) => ({ value: row.id, label: `${row.name}${row.email ? ` · ${row.email}` : ""}` }))}
            errorMessage={fieldErrors.customerContactId} description="More contacts, with their roles, on the Customer & Contacts tab." />
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
