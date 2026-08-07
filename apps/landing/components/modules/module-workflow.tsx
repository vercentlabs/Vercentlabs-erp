import type { ModulePrimaryWorkflow, LandingModule } from "@vercentlabs/landing-content";
import { Stack, Grid } from "@/components/layout/container";
import { Text, Heading } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";

/**
 * The "at least one end-to-end workflow where this module is central"
 * requirement — trigger, steps, approvals, automation, connected modules, and
 * outcome, all visible in server-rendered HTML.
 */
export function ModuleWorkflow({ workflow, accentColor, connectedModules }: { workflow: ModulePrimaryWorkflow; accentColor: string; connectedModules: readonly LandingModule[] }) {
  return (
    <Stack gap={8}>
      <div>
        <Text variant="label">Trigger</Text>
        <Text variant="body" className="mt-1">
          {workflow.trigger}
        </Text>
      </div>

      <ol className="flex flex-col gap-0">
        {workflow.steps.map((step, index) => (
          <li key={step.step} className={`flex gap-4 border-(--color-border-default) py-4 ${index > 0 ? "border-t" : ""}`}>
            <span
              className="tabular-data flex h-7 w-7 flex-none items-center justify-center rounded-(--radius-control) text-xs font-semibold text-(--color-text-inverse)"
              style={{ backgroundColor: accentColor }}
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <div>
              <Text variant="label">{step.step}</Text>
              <Text variant="bodySmall" className="mt-0.5">
                {step.detail}
              </Text>
            </div>
          </li>
        ))}
      </ol>

      <Grid columns={2} gap={8}>
        <div>
          <Heading level="h3">Approvals</Heading>
          <ul className="mt-2 flex flex-col gap-1.5">
            {workflow.approvals.map((item) => (
              <li key={item} className="text-sm text-(--color-text-secondary)">
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <Heading level="h3">Automated actions</Heading>
          <ul className="mt-2 flex flex-col gap-1.5">
            {workflow.automatedActions.map((item) => (
              <li key={item} className="text-sm text-(--color-text-secondary)">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </Grid>

      {connectedModules.length > 0 ? (
        <div>
          <Heading level="h3">Connected modules in this workflow</Heading>
          <div className="mt-2 flex flex-wrap gap-2">
            {connectedModules.map((connected) => (
              <ModuleTag key={connected.key} name={connected.name} accentColor={connected.accentColor.hex} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-(--radius-panel) border border-(--color-border-brand) bg-(--color-bg-elevated) p-5">
        <Text variant="label">Outcome</Text>
        <Text variant="body" className="mt-1">
          {workflow.outcome}
        </Text>
      </div>
    </Stack>
  );
}
