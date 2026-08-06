export interface LandingModule {
  key: string;
  name: string;
  description: string;
  availability: string;
  navGroup: string;
  personas: string[];
  painPoints: string[];
  capabilityGroups: string[];
  bestAngle: string;
  accentColor: { hex: string; soft: string; sourcedFromProduct: boolean };
}

export const LANDING_MODULES: readonly LandingModule[];
export function getLandingModule(key: string): LandingModule | null;
export function getModulesByNavGroup(navGroup: string): LandingModule[];

export interface LandingWorkflow {
  slug: string;
  name: string;
  modules: string[];
  summary: string;
  iaPriority: "P0" | "P1" | "P2";
}

export const LANDING_WORKFLOWS: readonly LandingWorkflow[];
export function getWorkflowsForModule(moduleKey: string): LandingWorkflow[];

export interface LandingIcp {
  slug: string;
  industrySlug: string;
  name: string;
  triggerEvent: string;
  primaryModules: string[];
  primaryWorkflow: string;
}

export const LANDING_ICPS: readonly LandingIcp[];
export function getIcp(slug: string): LandingIcp | null;

export interface NavGroup {
  key: string;
  label: string;
  moduleKeys: string[];
}

export const MODULE_NAV_GROUPS: readonly NavGroup[];

export interface NavItem {
  label: string;
  href: string;
  children?: readonly { label: string; href: string }[];
}

export const PRIMARY_NAV: readonly NavItem[];

export interface Cta {
  label: string;
  href: string;
}

export const CTAS: {
  primary: Cta;
  exploreProduct: Cta;
  exploreModules: Cta;
  watchTour: Cta;
  seeHowItWorks: Cta;
  talkToSpecialist: Cta;
};

export const ANALYTICS_EVENTS: readonly string[];

export const SITE_IDENTITY: { name: string; productName: string; titleTemplate: string; category: string };
export const POSITIONING: { heroHeadline: string; heroSubhead: string; promise: string };

export const COLOR_TOKENS: Record<string, string>;
export const RADIUS_TOKENS: Record<string, number>;
export const SPACING_SCALE: readonly number[];
export const SHADOW_TOKENS: Record<string, string>;
export const CONTAINER_TOKENS: { maxWidth: number; gridColumns: number };
export const BREAKPOINT_TOKENS: Record<string, number>;
export const MOTION_TOKENS: {
  hoverLiftPx: number;
  durationFastMs: number;
  durationBaseMs: number;
  easing: string;
  respectsReducedMotion: boolean;
};
export const TYPOGRAPHY_TOKENS: {
  fontFamily: string;
  headlineTrackingEm: number;
  bodyLineHeight: number;
  numericVariant: string;
};

export const SEMANTIC_BACKGROUND: Record<"page" | "subtle" | "inverse" | "elevated" | "brand" | "selected", string>;
export const SEMANTIC_TEXT: Record<"primary" | "secondary" | "muted" | "inverse" | "brand" | "link" | "disabled", string>;
export const SEMANTIC_BORDER: Record<"default" | "strong" | "subtle" | "brand" | "error" | "focus", string>;
export const SEMANTIC_STATE: Record<
  "success" | "successSoft" | "warning" | "warningSoft" | "error" | "errorSoft" | "information" | "informationSoft" | "focus" | "disabled",
  string
>;
export const SEMANTIC_PRODUCT: Record<"frame" | "chrome" | "canvas" | "annotation" | "highlight", string>;
