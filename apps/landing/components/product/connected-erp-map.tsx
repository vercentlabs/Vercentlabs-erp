import Link from "next/link";
import type { CSSProperties } from "react";
import {
  CONNECTED_ERP_SECTION,
  LANDING_MODULES,
  MODULE_NAV_GROUPS,
  PLATFORM_FOUNDATION_SECTION,
  SITE_IDENTITY,
  type LandingModule,
} from "@vercentlabs/landing-content";
import { cx } from "@/lib/utils";

/**
 * The Vercentlabs signature visual: every business module hangs off one ERP
 * core and sits on the Shared Platform. Module order follows the module nav
 * groups, split evenly either side of the core.
 *
 * Built from HTML text and CSS, with no client JavaScript: module names are
 * real links, the traced route is stated in the caption, and the connector
 * lines are decorative. The route motion (globals.css, vl-route-*) runs a few
 * cycles and is disabled under prefers-reduced-motion; the static map reads
 * the same.
 */
export function ConnectedErpMap({ className, showPurpose = true }: { className?: string; showPurpose?: boolean }) {
  const ordered = MODULE_NAV_GROUPS.flatMap((group) => group.moduleKeys)
    .map((key) => LANDING_MODULES.find((landingModule) => landingModule.key === key))
    .filter((landingModule): landingModule is LandingModule => Boolean(landingModule));
  const half = Math.ceil(ordered.length / 2);
  const columns = [
    { side: "left" as const, modules: ordered.slice(0, half) },
    { side: "right" as const, modules: ordered.slice(half) },
  ];
  const { route } = CONNECTED_ERP_SECTION;
  const routeNames = route.moduleKeys.map((key) => LANDING_MODULES.find((landingModule) => landingModule.key === key)?.displayName ?? key);
  const core = CONNECTED_ERP_SECTION.layers.find((layer) => layer.key === "core");
  const platform = CONNECTED_ERP_SECTION.layers.find((layer) => layer.key === "platform");

  return (
    <figure
      className={cx("relative [--map-spine:2.25rem] sm:[--map-spine:3rem]", className)}
      aria-labelledby="connected-erp-map-caption"
    >
      {/* ERP core */}
      <div className="relative z-10 flex items-center justify-between gap-4 bg-(--vl-ink) px-4 py-3 text-white sm:px-5">
        <span className="text-sm font-semibold tracking-[-0.02em]">{SITE_IDENTITY.productName}</span>
        <span className="vl-index vl-index-inverse hidden sm:inline">{core?.label}</span>
      </div>

      <div className="relative grid grid-cols-[minmax(0,1fr)_var(--map-spine)_minmax(0,1fr)] py-3 sm:py-4">
        {/* Spine: the ERP core running between every module and the platform. */}
        <span className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-(--vl-ink)" aria-hidden="true" />
        {columns.map((column) => (
          <ul
            key={column.side}
            className={cx("grid content-start gap-2 sm:gap-2.5", column.side === "left" ? "col-start-1" : "col-start-3")}
          >
            {column.modules.map((landingModule) => {
              const routeIndex = route.moduleKeys.indexOf(landingModule.key);
              const onRoute = routeIndex >= 0;
              return (
                <li key={landingModule.key}>
                  <Link
                    href={`/modules/${landingModule.key}`}
                    prefetch={false}
                    data-route-step={onRoute ? routeIndex + 1 : undefined}
                    className="vl-map-tile group"
                    style={{ "--tile-accent": landingModule.accentColor.hex, "--route-index": routeIndex } as CSSProperties}
                  >
                    <span className="h-2.5 w-2.5 self-start mt-[0.32rem]" style={{ backgroundColor: landingModule.accentColor.hex }} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[0.82rem] font-semibold leading-tight text-(--color-text-primary) sm:text-sm">
                          {landingModule.displayName}
                        </span>
                        {onRoute ? (
                          <span className="vl-index shrink-0 text-(--color-text-brand)" aria-hidden="true">
                            {String(routeIndex + 1).padStart(2, "0")}
                          </span>
                        ) : null}
                      </span>
                      {showPurpose ? (
                        <span className="mt-0.5 hidden text-[0.75rem] leading-snug text-(--color-text-secondary) sm:block">
                          {landingModule.purpose}
                        </span>
                      ) : null}
                    </span>
                    <span className="vl-map-link" data-side={column.side} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
      </div>

      {/* Shared Platform foundation */}
      <div className="relative z-10 bg-(--vl-brand) px-4 py-3 text-white sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-sm font-semibold tracking-[-0.02em]">{platform?.label}</span>
          <span className="text-[0.75rem] text-white/80">
            {PLATFORM_FOUNDATION_SECTION.families.map((family) => family.title).join(" · ")}
          </span>
        </div>
      </div>

      <figcaption id="connected-erp-map-caption" className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[0.8rem] leading-snug text-(--color-text-secondary)">
        <span className="font-semibold text-(--color-text-primary)">{CONNECTED_ERP_SECTION.mapCaption}</span>
        <span>
          {route.label}: {routeNames.join(" → ")}.
        </span>
      </figcaption>
    </figure>
  );
}
