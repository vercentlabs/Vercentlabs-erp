import type { ReactNode } from "react";
import type { LandingModule, LandingWorkflow } from "@vercentlabs/landing-content";
import { Stack, Grid, Inline } from "@/components/layout/container";
import { Text, Heading } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";

/**
 * The workflow page's full 14-part body: trigger, participants, the numbered
 * cross-module sequence, automated actions, approvals, exceptions,
 * visibility, and business value. Modeled on ModuleWorkflow
 * (components/modules/module-workflow.tsx) but reads the richer routed-
 * workflow shape (packages/landing-content/src/workflows.js) instead of a
 * module's single primaryWorkflow.
 */
export function WorkflowSequence({
  workflow,
  resolveModule,
  sequenceMedia,
}: {
  workflow: LandingWorkflow;
  resolveModule: (key: string) => LandingModule | undefined;
  /** When provided, replaces the numbered step-by-step list with this single media
   * element instead — e.g. one screenshot standing in for a not-yet-recorded product
   * video walking through the flow. Everything else (trigger, participants,
   * approvals, automated actions, exceptions, visibility, business value) still
   * renders normally; this only swaps out the long text breakdown specifically. */
  sequenceMedia?: ReactNode;
}) {
  return (
    <Stack gap={10}>
      <div>
        <Text variant="label">Trigger</Text>
        <Text variant="body" className="mt-1">
          {workflow.trigger}
        </Text>
      </div>

      {workflow.participants && workflow.participants.length > 0 ? (
        <div>
          <Text variant="label">Participants</Text>
          <Text variant="bodySmall" className="mt-1">
            {workflow.participants.join(" · ")}
          </Text>
        </div>
      ) : null}

      {sequenceMedia ?? (
        <ol className="flex flex-col gap-0">
          {(workflow.sequence ?? []).map((step, index) => {
            const stepModule = resolveModule(step.moduleKey);
            return (
              <li key={step.step} className={`flex gap-4 border-(--color-border-default) py-4 ${index > 0 ? "border-t" : ""}`}>
                <span
                  className="tabular-data flex h-7 w-7 flex-none items-center justify-center rounded-(--radius-control) bg-(--color-bg-brand) text-xs font-semibold text-(--color-text-inverse)"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <div className="flex-1">
                  <Inline gap={2} className="items-baseline">
                    <Text variant="label">{step.step}</Text>
                    {stepModule ? <ModuleTag name={stepModule.name} accentColor={stepModule.accentColor.hex} /> : null}
                  </Inline>
                  <Text variant="bodySmall" className="mt-0.5">
                    {step.detail}
                  </Text>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <Grid columns={2} gap={8}>
        <div>
          <Heading level="h3">Approvals</Heading>
          {workflow.approvals && workflow.approvals.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {workflow.approvals.map((item) => (
                <li key={item} className="text-sm text-(--color-text-secondary)">
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <Text variant="bodySmall" className="mt-2">
              No explicit approval gate in this workflow — governed by the release/status checks in its sequence above.
            </Text>
          )}
        </div>
        <div>
          <Heading level="h3">Automated actions</Heading>
          <ul className="mt-2 flex flex-col gap-1.5">
            {(workflow.automatedActions ?? []).map((item) => (
              <li key={item} className="text-sm text-(--color-text-secondary)">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </Grid>

      {workflow.exceptions && workflow.exceptions.length > 0 ? (
        <div className="rounded-(--radius-panel) border border-(--color-border-default) bg-(--color-bg-subtle) p-5">
          <Text variant="label">Exceptions &amp; honest limits</Text>
          <ul className="mt-2 flex flex-col gap-2">
            {workflow.exceptions.map((item) => (
              <li key={item} className="text-sm leading-relaxed text-(--color-text-secondary)">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Grid columns={2} gap={8}>
        <div>
          <Heading level="h3">Visibility</Heading>
          <ul className="mt-2 flex flex-col gap-1.5">
            {(workflow.visibility ?? []).map((item) => (
              <li key={item} className="text-sm text-(--color-text-secondary)">
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <Heading level="h3">Business value</Heading>
          <ul className="mt-2 flex flex-col gap-1.5">
            {(workflow.businessValue ?? []).map((item) => (
              <li key={item} className="text-sm text-(--color-text-secondary)">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </Grid>
    </Stack>
  );
}
