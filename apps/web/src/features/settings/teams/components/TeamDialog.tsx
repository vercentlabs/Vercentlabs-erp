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

  // A new team's code is made from its name on the server; an existing team's code can be changed here.
  const input = {
    ...(team ? { code } : {}),
    name,
    managerUserId: managerUserId || null,
    parentTeamId: parentTeamId || null,
    defaultPipelineId: defaultPipelineId || null,
    currencyCode: currencyCode.trim().toUpperCase() || null,
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
      description="People in a team share its leads (round robin and team queues), and its manager sees the team's records."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim() || (Boolean(team) && !code.trim())}>
            {team ? "Save changes" : "Create team"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Team name" isRequired className={team ? undefined : "sm:col-span-2"} value={name} onChange={setName} placeholder="For example: West Zone Sales" />
        {team && <TextField label="Code" isRequired value={code} onChange={setCode} description="Used in imports and reports." />}
        <Select label="Manager" options={managerOptions} selectedKey={managerUserId} onSelectionChange={(key) => setManagerUserId(String(key ?? ""))}
          description="Sees and manages the team's records." />
        <Select label="Parent team" options={parentTeamOptions} selectedKey={parentTeamId} onSelectionChange={(key) => setParentTeamId(String(key ?? ""))}
          description="For regions: a zone inside a bigger team." />
        <Select label="Default pipeline" options={pipelineOptions} selectedKey={defaultPipelineId} onSelectionChange={(key) => setDefaultPipelineId(String(key ?? ""))}
          description="Where the team's new deals start." />
        <TextField label="Currency" placeholder="Same as the company" value={currencyCode} onChange={(value) => setCurrencyCode(value.toUpperCase().slice(0, 3))}
          description="Three letters, e.g. INR or USD." />
      </div>
    </Dialog>
  );
}
