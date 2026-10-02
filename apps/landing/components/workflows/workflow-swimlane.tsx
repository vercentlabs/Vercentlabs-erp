import type { CSSProperties } from "react";
import { getLandingModule } from "@vercentlabs/landing-content";
import { ModuleChip } from "@/components/ui/tag";

export interface SwimlaneStep {
  step: string;
  moduleKey: string;
  detail: string;
}

function moduleLabel(key: string) {
  const landingModule = getLandingModule(key);
  return { name: landingModule?.displayName ?? key, accent: landingModule?.accentColor.hex ?? "var(--vl-brand)" };
}

/**
 * A workflow as module swimlanes: one lane per module, one column per step,
 * and a connector that drops into a new lane wherever the record crosses a
 * module boundary.
 *
 * The lane diagram (lg and up) is decorative and hidden from assistive tech;
 * the ordered step list below it is the real content at every width — on
 * narrow screens it carries the module handoffs inline. Repeated cell styles
 * live in globals.css (vl-lane-*, vl-step-*) because the homepage renders
 * several of these at once.
 */
export function WorkflowSwimlane({ steps, stepHeading = "h4" }: { steps: SwimlaneStep[]; /** Heading level for step names, so they nest under the surrounding heading. */ stepHeading?: "h3" | "h4" }) {
  const StepHeading = stepHeading;
  const lanes = [...new Set(steps.map((step) => step.moduleKey))];
  const laneOf = (step: SwimlaneStep) => lanes.indexOf(step.moduleKey);
  const layout = { "--lane-columns": steps.length, "--lane-rows": lanes.length } as CSSProperties;

  const path = steps
    .map((step, index) => {
      const x = index * 100 + 50;
      const y = laneOf(step) * 100 + 50;
      if (index === 0) return `M ${x} ${y}`;
      const previousY = laneOf(steps[index - 1]) * 100 + 50;
      return previousY === y ? `H ${x}` : `H ${x - 50} V ${y} H ${x}`;
    })
    .join(" ");

  return (
    <div style={layout}>
      <div className="vl-lane-grid hidden lg:grid" aria-hidden="true">
        {lanes.map((key, laneIndex) => {
          const lane = moduleLabel(key);
          return (
            <div key={key} className="vl-lane-row" style={{ gridRow: laneIndex + 1 }}>
              <ModuleChip name={lane.name} accentColor={lane.accent} />
            </div>
          );
        })}
        <svg className="vl-lane-svg" viewBox={`0 0 ${steps.length * 100} ${lanes.length * 100}`} preserveAspectRatio="none">
          <path className="vl-lane-path" d={path} pathLength={1} fill="none" stroke="var(--vl-ink)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
        {steps.map((step, index) => (
          <div
            key={`${step.step}-${index}`}
            className="vl-lane-chip"
            style={{ gridRow: laneOf(step) + 1, gridColumn: index + 2, borderTopColor: moduleLabel(step.moduleKey).accent }}
          >
            <span className="vl-index">{String(index + 1).padStart(2, "0")}</span>
            {step.step}
          </div>
        ))}
      </div>

      <ol className="vl-step-list">
        {steps.map((step, index) => {
          const lane = moduleLabel(step.moduleKey);
          const previous = index > 0 ? steps[index - 1] : null;
          const handoff = previous && previous.moduleKey !== step.moduleKey ? moduleLabel(previous.moduleKey) : null;
          return (
            <li key={`${step.step}-${index}`} className="vl-step">
              {handoff ? (
                <p className="vl-step-handoff">
                  <span aria-hidden="true">↳ </span>
                  Handoff: {handoff.name} to {lane.name}
                </p>
              ) : null}
              <span className="vl-index vl-step-number">{String(index + 1).padStart(2, "0")}</span>
              <StepHeading className="vl-step-title">
                {step.step} <ModuleChip name={lane.name} accentColor={lane.accent} className="ml-2 align-middle" />
              </StepHeading>
              <p className="vl-step-detail">{step.detail}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
