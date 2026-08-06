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

export const ANALYTICS_EVENTS: readonly [
  "homepage_view",
  "demo_form_start",
  "demo_form_validation_error",
  "demo_form_submit",
  "demo_form_success",
  "demo_form_error",
  "product_demo_complete",
  "product_tour_play",
  "module_page_view",
  "industry_page_view",
];

export const SITE_IDENTITY: { name: string; productName: string; titleTemplate: string; category: string };
export const POSITIONING: { heroHeadline: string; heroSubhead: string; promise: string };

// --- Homepage content model (homepage.js) ---

/** Every analyticsId value declared on a homepage section or CTA in homepage.js. */
export type HomepageAnalyticsId =
  | "hero_view"
  | "hero_primary_cta_click"
  | "hero_secondary_cta_click"
  | "problem_section_view"
  | "workflow_view"
  | "module_group_view"
  | "breadth_section_view"
  | "workflow_interaction"
  | "role_value_view"
  | "automation_section_view"
  | "security_section_view"
  | "implementation_section_view"
  | "buyer_questions_view"
  | "final_cta_view"
  | "final_cta_click";

export interface HomepageCta {
  label: string;
  href: string;
  analyticsId: HomepageAnalyticsId;
}

export interface HomepageSectionBase {
  id: string;
  eyebrow?: string;
  heading: string;
  supportingText?: string;
  analyticsId: HomepageAnalyticsId;
}

export const HOMEPAGE_METADATA: { title: string; description: string; lastReviewed: string };

export interface HeroContent extends HomepageSectionBase {
  primaryCta: HomepageCta;
  secondaryCta: HomepageCta;
  evidence: { label: string; value: string }[];
  screenshotId: string;
}
export const HERO: HeroContent;

export interface ProblemSection extends HomepageSectionBase {
  items: { title: string; description: string }[];
}
export const PROBLEM_SECTION: ProblemSection;

export interface ConnectedSystemSection extends HomepageSectionBase {
  steps: { label: string; module: string; detail: string }[];
}
export const CONNECTED_SYSTEM_SECTION: ConnectedSystemSection;

export interface ModuleArchitectureSection extends HomepageSectionBase {
  groupSummaries: { groupKey: string; outcome: string }[];
}
export const MODULE_ARCHITECTURE_SECTION: ModuleArchitectureSection;

export interface BreadthSection extends HomepageSectionBase {
  breakdown: { label: string; value: string; description: string }[];
}
export const BREADTH_SECTION: BreadthSection;

export interface FlagshipWorkflowSection extends HomepageSectionBase {
  workflowSlug: string;
  screenshotIds: string[];
  steps: { step: string; department: string; systemAction: string }[];
}
export const FLAGSHIP_WORKFLOW_SECTION: FlagshipWorkflowSection;

export interface RoleValueSection extends HomepageSectionBase {
  roles: { role: string; gains: string }[];
}
export const ROLE_VALUE_SECTION: RoleValueSection;

export interface AutomationSection extends HomepageSectionBase {
  items: { title: string; description: string }[];
}
export const AUTOMATION_SECTION: AutomationSection;

export interface SecuritySection extends HomepageSectionBase {
  items: { title: string; description: string }[];
}
export const SECURITY_SECTION: SecuritySection;

export interface ImplementationSection extends HomepageSectionBase {
  steps: { step: string; title: string; description: string }[];
}
export const IMPLEMENTATION_SECTION: ImplementationSection;

export interface BuyerQuestionsSection extends HomepageSectionBase {
  questions: { question: string; answer: string }[];
}
export const BUYER_QUESTIONS_SECTION: BuyerQuestionsSection;

export interface FinalCtaSection extends HomepageSectionBase {
  primaryCta: HomepageCta;
}
export const FINAL_CTA_SECTION: FinalCtaSection;

export const HOMEPAGE_SECTIONS: readonly HomepageSectionBase[];

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
