// Command palette result types (Prompt 7). See docs/implementation/
// ERP_COMMAND_SURFACE_007.md. Deliberately a flat, minimal-field union —
// every result, regardless of source, must expose only what's needed to
// identify it and navigate to it (Part 5: "return minimal safe metadata,
// not large records").
import type { AppIconName } from "@/components/app-icon";
import type { ModuleId } from "@/lib/navigation/types";

export type SearchResultType = "navigation" | "record" | "action" | "recent";

export type SearchResult = {
  id: string;
  type: SearchResultType;
  label: string;
  description?: string;
  href: string;
  icon?: AppIconName;
  moduleId?: ModuleId;
  /** Only present on navigation results — used for local scoring, never sent to a server. */
  keywords?: string[];
};

export type SearchResultGroup = {
  type: SearchResultType;
  label: string;
  results: SearchResult[];
};
