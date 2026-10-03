"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Plus } from "lucide-react";
import {
  Button,
  Dialog,
  EnterpriseDataGrid,
  EnterpriseListPage,
  IconButton,
  PermissionState,
  StatusBadge,
  TextArea,
  TextField,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { humanize } from "@/shared/format/human";
import { gridStates } from "@/features/crm/shared/ui/gridStates";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  archivePlaybook,
  createPlaybook,
  listPlaybooks,
  SettingsApiError,
} from "../api/qualification-and-playbooks-api";
import type { CrmPlaybook } from "../types";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

// Sales playbooks: guided question sets for a pipeline.
export function QualificationAndPlaybooksSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(
    CRM_PERMISSIONS.settingsManage,
  );
  const [playbookDialogOpen, setPlaybookDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playbooksQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "playbooks"),
    queryFn: listPlaybooks,
  });
  const playbooks = playbooksQuery.data?.rows ?? [];

  function invalidatePlaybooks() {
    queryClient.invalidateQueries({
      queryKey: scopedQueryKey(workspace, "crm", "playbooks"),
    });
  }
  function handleError(err: unknown) {
    setError(
      err instanceof SettingsApiError
        ? err.message
        : "This action could not be completed.",
    );
  }

  const archivePlaybookMutation = useMutation({
    mutationFn: (row: CrmPlaybook) => archivePlaybook(row.id, row.updatedAt),
    onSuccess: invalidatePlaybooks,
    onError: handleError,
  });

  const playbookColumns: ColumnDef<CrmPlaybook, unknown>[] = useMemo(
    () => [
      {
        id: "name",
        header: "Name",
        accessorKey: "name",
        cell: ({ row }) => (
          <span className="font-medium text-text">{row.original.name}</span>
        ),
      },
      {
        id: "framework",
        header: "Method",
        accessorFn: (row) =>
          row.framework ? humanize(row.framework) : "General",
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => (
          <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>
            {String(getValue())}
          </StatusBadge>
        ),
      },
      {
        id: "updatedAt",
        header: "Updated",
        accessorFn: (row) => dateFormatter.format(new Date(row.updatedAt)),
      },
    ],
    [],
  );

  if (!canManage)
    return (
      <PermissionState
        title="You don't have access to CRM Setup"
        description="Ask an administrator to grant crm.settings.manage."
      />
    );

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <EnterpriseListPage
        header={{
          title: "Playbooks",
          description:
            "Step-by-step selling guidance sellers can follow on a pipeline's deals. Separate from the qualification checks above.",
          primaryAction: (
            <Button
              variant="primary"
              onPress={() => setPlaybookDialogOpen(true)}
            >
              <Plus className="size-4" aria-hidden="true" />
              New playbook
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<CrmPlaybook>
          aria-label="Playbooks"
          columns={playbookColumns}
          data={playbooks}
          getRowId={(row) => row.id}
          {...gridStates(playbooksQuery, playbooks.length, "playbooks", {
            title: "No playbooks yet",
            description:
              "A playbook is a checklist of steps a seller follows for a type of lead, so every lead is worked the same way.",
          })}
          rowActions={(row) =>
            row.status === "active" ? (
              <span onClick={(event) => event.stopPropagation()}>
                <IconButton
                  aria-label={`Archive ${row.name}`}
                  size="compact"
                  variant="danger"
                  onPress={() => archivePlaybookMutation.mutate(row)}
                >
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              </span>
            ) : null
          }
        />
      </EnterpriseListPage>

      <PlaybookDialog
        isOpen={playbookDialogOpen}
        onOpenChange={setPlaybookDialogOpen}
        onCreated={invalidatePlaybooks}
        onError={handleError}
      />
    </div>
  );
}

function PlaybookDialog({
  isOpen,
  onOpenChange,
  onCreated,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [framework, setFramework] = useState("");
  const [description, setDescription] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      createPlaybook({
        name,
        framework: framework || null,
        description: description || null,
      }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setName("");
      setFramework("");
      setDescription("");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New playbook">
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextField
          label="Framework"
          placeholder="e.g. MEDDIC, BANT"
          value={framework}
          onChange={setFramework}
        />
        <TextArea
          label="Description"
          value={description}
          onChange={setDescription}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
            isDisabled={!name.trim()}
          >
            Create playbook
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
