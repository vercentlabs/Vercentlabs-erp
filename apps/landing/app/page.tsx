import { HOMEPAGE_METADATA, BUYER_QUESTIONS_SECTION } from "@vercentlabs/landing-content";
import { HomepageViewTracker } from "@/components/analytics/homepage-view-tracker";
import {
  HomeHero,
  HomeConnectedErp,
  HomeProblem,
  HomeWorkflow,
  HomeModules,
  HomePlatform,
  HomeRoleValue,
  HomeBreadth,
  HomeEvaluation,
  HomeImplementation,
  HomeSecurity,
  HomeFaq,
  HomeFinalCta,
} from "@/components/home";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, softwareApplicationJsonLd } from "@/lib/seo/json-ld";

export const metadata = buildPageMetadata({
  title: HOMEPAGE_METADATA.title,
  description: HOMEPAGE_METADATA.description,
  path: "/",
});

const softwareApplication = softwareApplicationJsonLd(HOMEPAGE_METADATA.description);

const faqPageJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: BUYER_QUESTIONS_SECTION.questions.map((item) => ({
    "@type": "Question",
    name: item.question,
    acceptedAnswer: { "@type": "Answer", text: item.answer },
  })),
};

/**
 * Homepage composition. Section order is the narrative: what it is → what it
 * connects → why that matters → how work moves → what's included → what sits
 * underneath → what it means for each team → how broad it is → how to
 * evaluate it → how adoption works → whether it can be trusted → objections →
 * the next step. Each section owns its markup and view event in components/home.
 */
export default function HomePage() {
  return (
    <>
      <HomepageViewTracker />
      <HomeHero />
      <HomeConnectedErp />
      <HomeProblem />
      <HomeWorkflow />
      <HomeModules />
      <HomePlatform />
      <HomeRoleValue />
      <HomeBreadth />
      <HomeEvaluation />
      <HomeImplementation />
      <HomeSecurity />
      <HomeFaq />
      <HomeFinalCta />
      <script {...jsonLdScriptProps(softwareApplication)} />
      <script {...jsonLdScriptProps(faqPageJsonLd)} />
    </>
  );
}
