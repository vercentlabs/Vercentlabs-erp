"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  Select,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { createSalesTeam, updateSalesTeam } from "../api/teams-api";
import type { SalesTeam } from "../types";

export function TeamDialog({
  isOpen,
  onOpenChange,
  team,
  managerOptions,
  pipelineOptions,
  parentTeamOptions,
  onSaved,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  team: SalesTeam | null;
  managerOptions: SelectOption[];
  pipelineOptions: SelectOption[];
  parentTeamOptions: SelectOption[];
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const [code, setCode] = useState(team?.code ?? "");
  const [name, setName] = useState(team?.name ?? "");
  const [managerUserId, setManagerUserId] = useState(team?.managerUserId ?? "");
  const [parentTeamId, setParentTeamId] = useState(team?.parentTeamId ?? "");
  const [defaultPipelineId, setDefaultPipelineId] = useState(
    team?.defaultPipelineId ?? "",
  );
  const [currencyCode, setCurrencyCode] = useState(team?.currencyCode ?? "");

  const [seededFor, setSeededFor] = useState<SalesTeam | null | undefined>(
    undefined,
  );
  if (isOpen && team !== seededFor) {
    setSeededFor(team);
    setCode(team?.code ?? "");
    setName(team?.name ?? "");
    setManagerUserId(team?.managerUserId ?? "");
    setParentTeamId(team?.parentTeamId ?? "");
    setDefaultPipelineId(team?.defaultPipelineId ?? "");
    setCurrencyCode(team?.currencyCode ?? "");
  }

  const input = {
    code,
    name,
    managerUserId: managerUserId || null,
    parentTeamId: parentTeamId || null,
    defaultPipelineId: defaultPipelineId || null,
    currencyCode: currencyCode || null,
  };
  const mutation = useMutation({
    mutationFn: () =>
      team
        ? updateSalesTeam(team.id, input, team.updatedAt)
        : createSalesTeam(input),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError,
  });

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={team ? `Edit ${team.name}` : "New sales team"}
    >
      <div className="flex flex-col gap-4">
        <TextField label="Code" isRequired value={code} onChange={setCode} />
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select
          label="Parent team"
          options={parentTeamOptions}
          selectedKey={parentTeamId}
          onSelectionChange={(key) => setParentTeamId(String(key ?? ""))}
        />
        <Select
          label="Manager"
          options={managerOptions}
          selectedKey={managerUserId}
          onSelectionChange={(key) => setManagerUserId(String(key ?? ""))}
        />
        <Select
          label="Default pipeline"
          options={pipelineOptions}
          selectedKey={defaultPipelineId}
          onSelectionChange={(key) => setDefaultPipelineId(String(key ?? ""))}
        />
        <TextField
          label="Currency code"
          placeholder="e.g. INR, USD"
          value={currencyCode}
          onChange={setCurrencyCode}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
            isDisabled={!code.trim() || !name.trim()}
          >
            {team ? "Save changes" : "Create team"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
