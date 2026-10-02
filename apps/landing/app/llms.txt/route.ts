import {
  LANDING_MODULES,
  PLATFORM_PAGES,
  LANDING_INDUSTRIES,
  LANDING_SOLUTIONS,
  ROUTED_WORKFLOW_SLUGS,
  getWorkflow,
  RESOURCE_GUIDES,
  STANDALONE_GLOSSARY_SLUGS,
  GLOSSARY_TERMS,
  VERCENTLABS_VS_ODOO,
  LAUNCH_CAPABILITY_SUMMARY,
  POSITIONING,
} from "@vercentlabs/landing-content";
import { SITE, absoluteUrl } from "@/lib/site";

/**
 * llms.txt — NOT a ranking mechanism and not treated as one anywhere on
 * this site. This is
 * an optional interoperability artifact: a plain-text index of real,
 * canonical routes, generated from the same content data every other page
 * reads from — so it can't silently drift out of sync with the live site
 * the way a hand-maintained static file could. No content here that isn't
 * already public on an indexable page; no hidden material.
 */
function buildLlmsTxt(): string {
  const glossaryTerm = (slug: string) => GLOSSARY_TERMS.find((t) => t.standalone && t.slug === slug);

  const lines: string[] = [
    `# ${SITE.productName}`,
    "",
    `> ${SITE.productName} is ${SITE.category.toLowerCase().replace("erp", "ERP")} — ${POSITIONING.masterPromise.charAt(0).toLowerCase()}${POSITIONING.masterPromise.slice(1, -1)}, with ${LAUNCH_CAPABILITY_SUMMARY}.`,
    "",
    `${POSITIONING.descriptor} It is a multi-tenant, multi-company web application made by ${SITE.name}.`,
    "",
    "## Product",
    `- [Product overview](${absoluteUrl("/product")})`,
    ...PLATFORM_PAGES.map((page) => `- [${page.title}](${absoluteUrl(page.slug)})`),
    "",
    "## Modules",
    ...LANDING_MODULES.map((moduleInfo) => `- [${moduleInfo.displayName}](${absoluteUrl(`/modules/${moduleInfo.key}`)})`),
    "",
    "## Industry use cases",
    ...LANDING_INDUSTRIES.map((industry) => `- [${industry.name}](${absoluteUrl(`/industries/${industry.slug}`)})`),
    "",
    "## Solutions",
    ...LANDING_SOLUTIONS.map((solution) => `- [${solution.name}](${absoluteUrl(`/solutions/${solution.slug}`)})`),
    "",
    "## Workflows",
    ...ROUTED_WORKFLOW_SLUGS.map((slug) => {
      const workflow = getWorkflow(slug);
      return workflow ? `- [${workflow.name}](${absoluteUrl(`/workflows/${slug}`)})` : "";
    }).filter(Boolean),
    "",
    "## Implementation",
    `- [Implementation journey](${absoluteUrl("/implementation")})`,
    "",
    "## Resources",
    ...RESOURCE_GUIDES.map((guide) => `- [${guide.title}](${absoluteUrl(`/resources/${guide.slug}`)})`),
    `- [Glossary](${absoluteUrl("/resources/glossary")})`,
    "",
    "## Glossary",
    ...STANDALONE_GLOSSARY_SLUGS.map((slug) => {
      const term = glossaryTerm(slug);
      return term ? `- [${term.term}](${absoluteUrl(`/resources/glossary/${slug}`)})` : "";
    }).filter(Boolean),
    "",
    "## Compare",
    `- [Vercentlabs vs. ${VERCENTLABS_VS_ODOO.competitor}](${absoluteUrl(`/compare/${VERCENTLABS_VS_ODOO.slug}`)})`,
  ];

  return lines.join("\n") + "\n";
}

export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
