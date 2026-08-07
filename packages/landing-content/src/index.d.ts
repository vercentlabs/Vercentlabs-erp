export type ModuleHeroVariant = "screenshot-led" | "workflow-led" | "dashboard-led" | "operational-sequence";

export interface CapabilityGroup {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  /** Requirement-count allocation for this group — see capability-registry.js. */
  requirementCount: number;
  workflowSlug?: string;
}

export interface BusinessProblem {
  title: string;
  description: string;
}

export interface BusinessOutcome {
  title: string;
  description: string;
}

export interface ConnectedModuleRef {
  moduleKey: string;
  relationship: string;
}

export interface ReportingCapability {
  name: string;
  measures: string;
  audience: string;
}

export interface AutomationCapability {
  title: string;
  description: string;
}

export interface GovernanceCapability {
  title: string;
  description: string;
}

export interface ModuleWorkflowStep {
  step: string;
  detail: string;
}

export interface ModulePrimaryWorkflow {
  name: string;
  trigger: string;
  steps: ModuleWorkflowStep[];
  approvals: string[];
  automatedActions: string[];
  connectedModuleKeys: string[];
  outcome: string;
}

export interface ModuleFaq {
  question: string;
  answer: string;
}

export interface ModuleScreenshotRefs {
  primary?: string;
  secondary?: string;
}

export interface ModuleConversion {
  heading: string;
  ctaLabel: string;
}

export interface LandingModule {
  key: string;
  name: string;
  description: string;
  availability: string;
  navGroup: string;
  personas: string[];
  painPoints: string[];
  bestAngle: string;
  accentColor: { hex: string; soft: string; sourcedFromProduct: boolean };
  directDefinition: string;
  heroVariant: ModuleHeroVariant;
  searchIntent: string;
  metaDescription: string;
  businessProblems: BusinessProblem[];
  businessOutcomes: BusinessOutcome[];
  capabilityGroups: CapabilityGroup[];
  primaryWorkflow: ModulePrimaryWorkflow;
  connectedModules: ConnectedModuleRef[];
  reporting: ReportingCapability[];
  automation: AutomationCapability[];
  governance: GovernanceCapability[];
  implementationConsiderations: string[];
  faqs: ModuleFaq[];
  screenshots: ModuleScreenshotRefs;
  conversion: ModuleConversion;
}

export const LANDING_MODULES: readonly LandingModule[];
export function getLandingModule(key: string): LandingModule | null;
export function getModulesByNavGroup(navGroup: string): LandingModule[];

export interface WorkflowSequenceStep {
  step: string;
  moduleKey: string;
  detail: string;
}

export interface WorkflowFaq {
  question: string;
  answer: string;
}

export interface LandingWorkflow {
  slug: string;
  name: string;
  modules: string[];
  summary: string;
  iaPriority: "P0" | "P1" | "P2";
  /** The following fields are only populated for the 6 routed workflows (ROUTED_WORKFLOW_SLUGS). */
  /** A direct-answer sentence distinct from `summary` — rendered in DirectDefinition, never the same text as the hero subhead. */
  directDefinition?: string;
  trigger?: string;
  participants?: string[];
  sequence?: WorkflowSequenceStep[];
  automatedActions?: string[];
  approvals?: string[];
  exceptions?: string[];
  visibility?: string[];
  businessValue?: string[];
  faqs?: WorkflowFaq[];
  screenshotId?: string;
}

export const LANDING_WORKFLOWS: readonly LandingWorkflow[];
export const ROUTED_WORKFLOW_SLUGS: readonly string[];
export function getWorkflowsForModule(moduleKey: string): LandingWorkflow[];
export function getWorkflow(slug: string): LandingWorkflow | null;
export function getRoutedWorkflows(): LandingWorkflow[];

export interface LandingIcp {
  slug: string;
  industrySlugs: string[];
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
  "module_hero_cta_click",
  "module_workflow_view",
  "module_related_link_click",
  "module_mid_cta_click",
  "module_final_cta_click",
  "platform_page_view",
  "platform_cta_click",
  "modules_index_view",
  "industries_index_view",
  "industry_final_cta_click",
  "solutions_index_view",
  "solution_page_view",
  "solution_cta_click",
  "workflows_index_view",
  "workflow_page_view",
  "workflow_cta_click",
  "implementation_page_view",
  "implementation_cta_click",
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

export const HOMEPAGE_METADATA: { title: string; description: string };

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

// --- Capability traceability registry (capability-registry.js) ---

/**
 * One real, evidence-grounded capability group (module-specific or shared-platform)
 * carrying an honest requirement-count allocation. See
 * docs/landing-redesign/phase-4/capability-traceability.md for the methodology —
 * this is a structural allocation consistent with the settled 1,039 total
 * (CLAUDE.md), not an independently re-derived count.
 */
export interface CapabilityGroupRecord {
  id: string;
  name: string;
  moduleId?: string;
  platformArea?: string;
  description: string;
  requirementCount: number;
  workflowSlugs: string[];
  publicPage: string;
  publicSection: string;
  searchTopics: string[];
}

export const CAPABILITY_GROUPS: readonly CapabilityGroupRecord[];
export function getCapabilityGroupsForModule(moduleKey: string): CapabilityGroupRecord[];
export function getCapabilityGroupsForPlatformArea(platformArea: string): CapabilityGroupRecord[];
export function getTotalRequirementCount(): number;
export function getModuleRequirementTotal(): number;
export function getPlatformRequirementTotal(): number;

// --- Platform and product-overview content (platform-pages.js) ---

/** A CTA whose analytics event isn't one of the homepage's fixed section IDs. */
export interface PageCta {
  label: string;
  href: string;
}

export interface PlatformFeatureItem {
  title: string;
  description: string;
}

export interface PlatformPageSection {
  id: string;
  eyebrow?: string;
  heading: string;
  supportingText?: string;
  items: PlatformFeatureItem[];
}

export interface PlatformPageContent {
  slug: string;
  title: string;
  metaDescription: string;
  directDefinition: string;
  eyebrow: string;
  heading: string;
  supportingText: string;
  heroScreenshotId?: string;
  sections: PlatformPageSection[];
  connectedModuleKeys: string[];
  faqs?: ModuleFaq[];
  primaryCta: PageCta;
  /** Hand-written, not derived from `title` — a naive title.toLowerCase() breaks on acronym titles ("Mobile ERP" -> "mobile erp"). */
  finalCtaHeading: string;
}

export const PLATFORM_PAGE: PlatformPageContent;
export const AUTOMATION_PAGE: PlatformPageContent;
export const ANALYTICS_PAGE: PlatformPageContent;
export const MOBILE_PAGE: PlatformPageContent;
export const INTEGRATIONS_PAGE: PlatformPageContent;
export const SECURITY_PAGE: PlatformPageContent;
export const PLATFORM_PAGES: readonly PlatformPageContent[];

export interface ProductOverviewSection {
  id: string;
  eyebrow?: string;
  heading: string;
  supportingText?: string;
  items?: PlatformFeatureItem[];
}

export interface ProductOverviewPage {
  slug: string;
  title: string;
  metaDescription: string;
  directDefinition: string;
  eyebrow: string;
  heading: string;
  supportingText: string;
  heroScreenshotId?: string;
  sections: ProductOverviewSection[];
  faqs: ModuleFaq[];
  primaryCta: PageCta;
}

export const PRODUCT_OVERVIEW_PAGE: ProductOverviewPage;

export interface OperatingStack {
  id: string;
  name: string;
  description: string;
  moduleKeys: string[];
}

export interface ModulesIndexPage {
  slug: string;
  title: string;
  metaDescription: string;
  directDefinition: string;
  eyebrow: string;
  heading: string;
  supportingText: string;
  operatingStacks: OperatingStack[];
  primaryCta: PageCta;
}

export const MODULES_INDEX_PAGE: ModulesIndexPage;

// --- Buyer roles (buyer-roles.js) ---

export interface BuyerRole {
  slug: string;
  title: string;
  concernSummary: string;
  primaryConcerns: string[];
  relevantModuleKeys: string[];
  proofPoint: string;
}

export const BUYER_ROLES: readonly BuyerRole[];
export function getBuyerRole(slug: string): BuyerRole | null;
export function getBuyerRolesBySlugs(slugs: string[]): BuyerRole[];

// --- Industry pages (industries.js) ---

export interface IndustryModuleStackEntry {
  moduleKey: string;
  role: string;
}

export interface IndustryPage {
  slug: string;
  icpSlug: string;
  name: string;
  directDefinition: string;
  operatingModel: string;
  challenges: string[];
  moduleStack: IndustryModuleStackEntry[];
  primaryWorkflowSlug?: string;
  buyerRoleSlugs: string[];
  evidenceHighlights: string[];
  screenshots: { primary?: string };
  faqs: ModuleFaq[];
  metaDescription: string;
  searchIntent: string;
  conversion: ModuleConversion;
}

export const LANDING_INDUSTRIES: readonly IndustryPage[];
export function getIndustry(slug: string): IndustryPage | null;
export function getIndustriesForModule(moduleKey: string): IndustryPage[];
export function getIndustriesForWorkflow(workflowSlug: string): IndustryPage[];

// --- Solution pages (solutions.js) ---

export interface SolutionApproachItem {
  title: string;
  description: string;
  moduleKey?: string;
}

export interface SolutionPage {
  slug: string;
  name: string;
  /** A direct-answer sentence distinct from `problemStatement` — rendered in DirectDefinition, never the same text as the hero subhead. */
  directDefinition: string;
  problemStatement: string;
  before: string;
  after: string;
  approach: SolutionApproachItem[];
  /** The one paired platform page this solution differentiates against — an absolute path, e.g. "/product/automation". */
  relatedPlatformPageSlug: string;
  relatedModuleKeys: string[];
  relatedWorkflowSlugs: string[];
  /** Only present where a real approved screenshot honestly illustrates this page's approach claims — see solutions.js's header comment. */
  screenshotId?: string;
  faqs: ModuleFaq[];
  metaDescription: string;
  searchIntent: string;
  conversion: ModuleConversion;
}

export const LANDING_SOLUTIONS: readonly SolutionPage[];
export function getSolution(slug: string): SolutionPage | null;
export function getSolutionsForModule(moduleKey: string): SolutionPage[];

// --- Implementation & migration page (implementation.js) ---

export interface ImplementationPhase {
  id: string;
  name: string;
  description: string;
  activities: string[];
  typicalOutputs: string[];
  /** Only set on the Data Migration phase. */
  migrationChecklist?: string[];
}

export interface ImplementationPage {
  slug: string;
  title: string;
  metaDescription: string;
  directDefinition: string;
  searchIntent: string;
  eyebrow: string;
  heading: string;
  supportingText: string;
  phases: ImplementationPhase[];
  faqs: ModuleFaq[];
  conversion: ModuleConversion;
}

export const IMPLEMENTATION_PAGE: ImplementationPage;

// --- Content freshness registry (freshness.js) ---

export interface ContentFreshness {
  /** ISO date (YYYY-MM-DD) of the route's first real, substantive commit. */
  publishedAt: string;
  /** ISO date of the most recent significant content change (never a build timestamp). */
  lastModifiedAt: string;
  /** ISO date this route was last manually reviewed, even if unchanged. */
  lastReviewedAt: string;
  /** Plain-language statement of what the last significant change actually was. */
  reviewReason: string;
}

export const CONTENT_FRESHNESS: Readonly<Record<string, ContentFreshness>>;
export function getFreshness(path: string): ContentFreshness;
export function hasFreshness(path: string): boolean;
