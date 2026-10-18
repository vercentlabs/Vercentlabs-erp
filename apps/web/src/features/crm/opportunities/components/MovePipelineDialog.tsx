"use client";

// Move an open deal into another pipeline (CRM plan 5.1): into the stage chosen, else that pipeline's first. The new stage's
// requirements apply as with any move, and the move is recorded in the deal's stage history.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, Select, TextField } from "@vercentlabs/design-system";

import { errorMessage, moveOpportunityToPipeline, type Opportunity, type OpportunityPipelineOption } from "../api/opportunities-api";

export function MovePipelineDialog({ isOpen, onOpenChange, opportunity, pipelines, onDone }: {
  isOpen: boolean; onOpenChange: (isOpen: boolean) => void; opportunity: Opportunity; pipelines: OpportunityPipelineOption[]; onDone: () => void;
}) {
  const others = pipelines.filter((entry) => entry.id !== opportunity.pipelineId);
  const [pipelineId, setPipelineId] = useState(others[0]?.id ?? "");
  const [stageId, setStageId] = useState("");
  const [note, setNote] = useState("");
  const target = others.find((entry) => entry.id === pipelineId);
  const move = useMutation({
    mutationFn: () => moveOpportunityToPipeline(opportunity.id, { pipelineId, stageId: stageId || undefined, note: note.trim() || undefined, expectedUpdatedAt: opportunity.updatedAt }),
    onSuccess: () => { onDone(); onOpenChange(false); },
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Move ${opportunity.name} to another pipeline`}
      description={`It is now in ${opportunity.pipelineName ?? "its pipeline"}, at ${opportunity.stageName ?? "its stage"}. Its value, owner and history stay as they are.`}>
      <div className="flex flex-col gap-4">
        {move.isError && <p role="alert" className="text-sm text-danger">{errorMessage(move.error, "The deal could not be moved.")}</p>}
        <Select label="Pipeline" isRequired selectedKey={pipelineId || null} onSelectionChange={(key) => { setPipelineId(String(key)); setStageId(""); }}
          options={others.map((entry) => ({ value: entry.id, label: entry.name }))} />
        {target && (
          <Select label="Stage" selectedKey={stageId || "first"} onSelectionChange={(key) => setStageId(String(key) === "first" ? "" : String(key))}
            options={[{ value: "first", label: `Its first stage (${target.stages[0]?.name ?? "—"})` }, ...target.stages.map((stage) => ({ value: stage.id, label: `${stage.name} · ${stage.probability}%` }))]} />
        )}
        <TextField label="Note (optional)" value={note} onChange={setNote} maxLength={500} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" isLoading={move.isPending} isDisabled={!pipelineId} onPress={() => move.mutate()}>Move deal</Button>
        </div>
      </div>
    </Dialog>
  );
}
