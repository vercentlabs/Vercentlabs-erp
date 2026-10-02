import Link from "next/link";
import {
  MODULE_NAV_GROUPS,
  PLATFORM_FOUNDATION_SECTION,
  PRODUCT_OVERVIEW_PAGE,
  getLandingModule,
  getRoutedWorkflows,
  type LandingModule,
} from "@vercentlabs/landing-content";
import { WorkflowModulePath } from "@/components/workflows/workflow-module-path";

/**
 * /product's system architecture: three stacked layers — the business
 * modules, the documented workflows that connect them, and the Shared
 * Platform they all run on. Every label is HTML text and every module and
 * workflow is a link; the layer rails are decoration.
 */
export function SystemArchitecture() {
  const layer = (key: string) => PRODUCT_OVERVIEW_PAGE.architecture.layers.find((item) => item.key === key);
  const modules = MODULE_NAV_GROUPS.flatMap((group) => group.moduleKeys)
    .map((key) => getLandingModule(key))
    .filter((landingModule): landingModule is LandingModule => landingModule !== null);
  const workflows = getRoutedWorkflows().filter((workflow) => new Set(workflow.sequence?.map((step) => step.moduleKey)).size > 1);

  const rows = [
    {
      key: "modules",
      body: (
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
          {modules.map((landingModule) => (
            <li key={landingModule.key}>
              <Link
                href={`/modules/${landingModule.key}`}
                prefetch={false}
                className="block border-t-[3px] bg-(--color-bg-page) px-2.5 py-2 text-[0.82rem] font-semibold text-(--color-text-primary) hover:text-(--color-text-brand)"
                style={{ borderTopColor: landingModule.accentColor.hex }}
              >
                {landingModule.displayName}
              </Link>
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: "workflows",
      body: (
        <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {workflows.map((workflow) => (
            <li key={workflow.slug} className="border-l-2 border-(--color-border-strong) pl-3">
              <Link href={`/workflows/${workflow.slug}`} prefetch={false} className="text-sm font-semibold text-(--color-text-primary) hover:text-(--color-text-brand)">
                {workflow.name}
              </Link>
              <WorkflowModulePath slug={workflow.slug} showSteps={false} className="mt-2" />
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: "platform",
      body: (
        <ul className="flex flex-wrap content-start items-start gap-1.5 self-start">
          {PLATFORM_FOUNDATION_SECTION.families.map((family) => (
            <li key={family.key} className="border border-white/25 px-2.5 py-1.5 text-[0.82rem] font-medium text-white">
              {family.title}
            </li>
          ))}
        </ul>
      ),
    },
  ];

  return (
    <div className="border border-(--color-border-strong)">
      {rows.map((row, index) => {
        const copy = layer(row.key);
        const inverse = row.key === "platform";
        return (
          <section
            key={row.key}
            aria-labelledby={`architecture-layer-${row.key}`}
            className={
              inverse
                ? "grid grid-cols-1 gap-4 bg-(--vl-brand) p-5 text-white sm:p-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8"
                : "grid grid-cols-1 gap-4 border-b border-(--color-border-strong) bg-(--vl-paper-strong) p-5 sm:p-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8"
            }
          >
            <div>
              <span className={inverse ? "vl-index vl-index-inverse" : "vl-index text-(--color-text-brand)"}>Layer {String(index + 1).padStart(2, "0")}</span>
              <h3 id={`architecture-layer-${row.key}`} className="mt-1.5 text-lg font-semibold tracking-[-0.03em]">
                {copy?.title}
              </h3>
              <p className={inverse ? "mt-1.5 text-sm leading-[1.55] text-white/80" : "mt-1.5 text-sm leading-[1.55] text-(--color-text-secondary)"}>{copy?.description}</p>
            </div>
            {row.body}
          </section>
        );
      })}
    </div>
  );
}
