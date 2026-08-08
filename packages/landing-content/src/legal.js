/**
 * Privacy Policy and Terms of Use — Phase 8. Content here is grounded in a
 * real audit of what apps/landing actually collects and does (not a generic
 * template): every data point named below was verified against the real
 * source (lib/attribution.ts, lib/analytics.ts, lib/web-vitals.ts,
 * lib/lead-observability.ts, lib/rate-limit.ts, lib/crm-capture.ts,
 * components/marketing/demo-form.tsx, components/resources/
 * requirements-checklist.tsx, app/book-demo/thank-you/thank-you-effects.tsx)
 * during this phase's cookie-storage-audit.md and repository-release-audit.md
 * work — not copied from a generic privacy-policy template.
 *
 * Legal facts referenced (India's Digital Personal Data Protection Act, 2023
 * and its 2025 Rules) were verified via live web search against current
 * sources during this phase — see docs/landing-redesign/phase-8/
 * legal-readiness.md for citations and retrieval date. This is NOT legal
 * advice and does NOT replace review by qualified counsel — see that same
 * document for the specific items requiring company/counsel confirmation
 * before this policy can be treated as final (registered office address,
 * LLPIN, confirmed live contact mailboxes, and a definitive governing-law/
 * jurisdiction clause).
 *
 * Contact emails are pulled from COMPANY_IDENTITY (metadata.js) and
 * interpolated directly into the page text below — a real Cycle 2 legal
 * review found the original draft *referenced* "the email address below"
 * and "our company identity documentation" without either ever actually
 * resolving to a real, visible address anywhere on the live page, leaving
 * visitors with no real way to exercise a data-subject right. Fixed by
 * importing the single source of truth and rendering it for real, rather
 * than pointing at a promise. See docs/landing-redesign/phase-8/
 * decision-log.md.
 */
import { COMPANY_IDENTITY } from "./metadata.js";

export const PRIVACY_PAGE = Object.freeze({
  slug: "/privacy",
  title: "Privacy Policy",
  metaDescription: "How Vercentlabs collects, uses, and protects information submitted through this website.",
  lastReviewedAt: "2026-08-08",
  sections: [
    {
      id: "who-we-are",
      heading: "Who this policy covers",
      paragraphs: [
        "This Privacy Policy explains how Vercentlabs LLP (\"Vercentlabs\", \"we\", \"us\") collects, uses, and protects information when you visit this website (the \"Site\") or submit a request through it. It does not cover the Vercentlabs ERP application itself, which has its own in-product privacy and data-handling terms provided separately to customers as part of onboarding.",
        "We are an India-based limited liability partnership. Where this policy references a specific data-protection law, it refers to India's Digital Personal Data Protection Act, 2023 (the \"DPDPA\") and its associated rules, which are being brought into force in phases through 2027 — see \"Applicable law\" below.",
      ],
    },
    {
      id: "what-we-collect",
      heading: "Information you provide to us",
      paragraphs: [
        "When you submit the demo-request form on this Site (/book-demo), you may provide: first and last name, work email address, phone number, company name, job title, industry, company size, the modules or workflows you're interested in, a short description of the problem you're trying to solve, a preferred contact time, and consent to be contacted. Only first name, email, phone, company name, and consent are required — every other field is optional, and we don't ask for anything we don't have a real, stated use for (see our public form-friction audit methodology, which governs what fields this form is allowed to ask for).",
        "This information is submitted voluntarily, only when you choose to request a demo. We do not require an account, a login, or any information to browse the rest of the Site, read our resource content, or use the ERP requirements checklist.",
      ],
    },
    {
      id: "automatic-collection",
      heading: "Information collected automatically",
      paragraphs: [
        "First-touch attribution: when you first arrive at this Site, we record which campaign parameters (if any) brought you here (utm_source, utm_medium, utm_campaign, utm_content, utm_term), the page you landed on, a broad referrer category (direct, search, social, referral, or email), and a timestamp. This is stored only in your browser's local storage on this Site's own domain — not in a cookie, and not shared with any third party by itself. It is included with a demo-request submission (if you make one) so our sales team understands how you found us. It is never overwritten by a later visit; if you first arrive via one campaign and return later via another, the original attribution is preserved.",
        "Technical performance signals: we collect anonymous page-performance metrics (Largest Contentful Paint, Interaction to Next Paint, Cumulative Layout Shift) to understand how fast the Site loads for real visitors. These are reported with a normalized route pattern (e.g. \"/modules/[slug]\", never the literal page URL with any query string), a rounded metric value, and a quality rating — never your name, IP address, or any other identifying information. As of the date of this policy, this data has no third-party analytics backend attached to it — it is collected by our own code but not yet transmitted anywhere; this will be updated if that changes.",
        "Server logs: like most websites, our servers automatically log basic request information (timestamp, a randomly generated request ID, response status, and processing duration) for the purpose of diagnosing failures and preventing abuse of the demo-request form. We do not log the content of your submission — only whether it succeeded, failed validation, or failed for a technical reason. Your IP address is used to apply a simple rate limit against automated abuse of the form.",
        "Abuse-prevention fingerprint: if you submit the demo-request form, a one-way cryptographic hash (not your raw IP address or browser identifier) derived from your IP address and browser type is included with the submission and retained alongside it in our CRM, solely to help detect duplicate or automated submissions. This hash cannot be reversed back into your original IP address or used to identify you outside the context of that one submission. A hidden \"honeypot\" field is also included in the form, invisible to real visitors — if it's filled in (a strong signal of automated form-filling software rather than a person), the submission is rejected and never reaches our CRM at all.",
        "ERP requirements checklist progress: if you use the interactive requirements checklist (/resources/erp-requirements-checklist), which capability areas you've marked as reviewed is stored only in your browser's local storage. It is never sent to us, never included in any analytics event, and never leaves your device.",
      ],
    },
    {
      id: "cookies",
      heading: "Cookies and similar technologies",
      paragraphs: [
        "This Site does not set any cookies. We use browser local storage and session storage only, and only for the first-party purposes described above (attribution, checklist progress, and preventing a duplicate confirmation event if you refresh the demo-confirmation page). We do not use any third-party tracking script, advertising pixel, or analytics tag that sets a cookie or a cross-site identifier. See our published cookie and storage audit for the full technical detail behind this statement.",
      ],
    },
    {
      id: "how-we-use-it",
      heading: "How we use your information",
      paragraphs: [
        "We use the information you submit through the demo-request form solely to respond to your request: to schedule and prepare for a demo call, to route your enquiry to the right specialist based on the modules or industry you indicated, and to follow up about your evaluation. We do not sell your information, and we do not use it for advertising targeting.",
        "Your submission is delivered to our own customer relationship management (CRM) system — the same Vercentlabs ERP platform this website describes — via a signed, authenticated request from this website's server directly to that system. It is not routed through, or shared with, any third-party marketing or advertising platform.",
      ],
    },
    {
      id: "sharing",
      heading: "Who we share information with",
      paragraphs: [
        "We do not sell, rent, or share your information with third parties for their own marketing purposes. Your demo-request information is stored in our own CRM system, operated by Vercentlabs, and is accessible only to Vercentlabs personnel involved in responding to your request.",
        "We may disclose information if required to do so by law, or to protect the rights, property, or safety of Vercentlabs, our users, or others.",
      ],
    },
    {
      id: "retention",
      heading: "Data retention",
      paragraphs: [
        "We retain demo-request information for as long as reasonably necessary to respond to your enquiry and, if you become a customer, as part of your account relationship — governed at that point by your customer agreement rather than this policy. If you'd like your demo-request information deleted and you have not become a customer, contact us using the details below.",
      ],
    },
    {
      id: "your-rights",
      heading: "Your rights",
      paragraphs: [
        `You may ask us to confirm what information we hold about you, to correct inaccurate information, or to delete information you've submitted, by emailing ${COMPANY_IDENTITY.privacyContactEmail}. We will respond within a reasonable time. If you are located in India, these rights are informed by the DPDPA's provisions for data principals as they come into force; we intend to honor requests of this kind regardless of the exact phase of the Act's implementation.`,
      ],
    },
    {
      id: "security",
      heading: "Security",
      paragraphs: [
        "Demo-request submissions are transmitted over an encrypted connection and authenticated with a signed request between this website and our CRM system, so a submission can't be forged or intercepted by a third party in transit. We apply standard web security practices to this Site, including a restrictive content security policy, security response headers, and rate limiting on the demo-request endpoint to reduce automated abuse.",
      ],
    },
    {
      id: "childrens-privacy",
      heading: "Children's privacy",
      paragraphs: [
        "This Site and the Vercentlabs ERP product are intended for business use by adults evaluating enterprise software on behalf of an organization. We do not knowingly collect information from children, and this Site is not directed at them.",
      ],
    },
    {
      id: "applicable-law",
      heading: "Applicable law",
      paragraphs: [
        "This policy is written with reference to India's Digital Personal Data Protection Act, 2023, which is being implemented in phases (key rules were notified in November 2025, with full provisions — including detailed consent, notice, and security obligations — scheduled to take effect by May 2027). We will review and update this policy as those provisions come into force. Nothing in this policy is intended as legal advice; it describes our actual practices as verified against our own code and infrastructure.",
      ],
    },
    {
      id: "changes",
      heading: "Changes to this policy",
      paragraphs: [
        "We may update this policy as our practices change or as applicable law evolves. The date at the top of this page reflects the last review. Material changes will be reflected here with an updated date.",
      ],
    },
    {
      id: "contact",
      heading: "Contact us",
      paragraphs: [
        `Questions about this policy, or requests regarding your information, can be sent to ${COMPANY_IDENTITY.privacyContactEmail}. For general support, use ${COMPANY_IDENTITY.supportContactEmail}.`,
      ],
    },
  ],
});

export const TERMS_PAGE = Object.freeze({
  slug: "/terms",
  title: "Terms of Use",
  metaDescription: "The terms that govern your use of the Vercentlabs website.",
  lastReviewedAt: "2026-08-08",
  sections: [
    {
      id: "scope",
      heading: "Scope of these terms",
      paragraphs: [
        "These Terms of Use (\"Terms\") govern your access to and use of this website (the \"Site\"), operated by Vercentlabs LLP (\"Vercentlabs\", \"we\", \"us\"). They apply to the public marketing website only. If you become a Vercentlabs ERP customer, your use of the product itself is governed by a separate customer agreement provided to you as part of onboarding — these Terms do not replace, and are not, a subscription agreement, service-level agreement, or data processing agreement.",
      ],
    },
    {
      id: "acceptance",
      heading: "Acceptance",
      paragraphs: [
        "By accessing or using this Site, you agree to these Terms. If you do not agree, please do not use the Site.",
      ],
    },
    {
      id: "use-of-site",
      heading: "Permitted use",
      paragraphs: [
        "You may access and use this Site to learn about Vercentlabs ERP, review its content, and request a product demonstration. You agree not to use the Site in any way that could damage, disable, or impair it, or interfere with any other party's use of it — including attempting to submit the demo-request form in an automated, abusive, or fraudulent manner.",
      ],
    },
    {
      id: "intellectual-property",
      heading: "Intellectual property",
      paragraphs: [
        "All content on this Site — including text, graphics, product screenshots, and the Vercentlabs name and logo — is the property of Vercentlabs or its licensors and is protected by applicable intellectual property laws. You may view and print pages from this Site for your own personal or internal business evaluation use, but may not reproduce, distribute, or create derivative works from this content for any other purpose without our written permission.",
      ],
    },
    {
      id: "accuracy",
      heading: "Accuracy and availability of information",
      paragraphs: [
        "We make reasonable efforts to keep the information on this Site accurate and current, including the product capability descriptions, module counts, and comparison content. However, this Site is provided for general informational purposes, and product capabilities, availability, and specifications may change. Nothing on this Site constitutes a binding offer or contractual commitment — a specific implementation scope is determined only through direct engagement with our team.",
        "We do not guarantee that this Site will be available at all times or free from errors, and we may modify, suspend, or discontinue any part of it without notice.",
      ],
    },
    {
      id: "demo-requests",
      heading: "Demo requests",
      paragraphs: [
        "Submitting the demo-request form is a request for information and a scheduling enquiry — it is not a purchase, a binding order, or the start of a contractual relationship. We will use the information you provide to respond to your request as described in our Privacy Policy.",
      ],
    },
    {
      id: "comparison-content",
      heading: "Comparison and editorial content",
      paragraphs: [
        "Where this Site compares Vercentlabs ERP to other products, we aim to present factual, source-referenced, and neutrally framed information, reviewed periodically for accuracy. Competitor products, features, and pricing can change after our review date; we encourage you to verify any competitor-specific claim directly with that vendor before relying on it.",
      ],
    },
    {
      id: "external-links",
      heading: "Links to other websites",
      paragraphs: [
        "This Site may link to external websites (for example, source citations on our comparison and resource pages) that are not operated by us. We are not responsible for the content, accuracy, or practices of any external site, and linking to it does not imply endorsement.",
      ],
    },
    {
      id: "disclaimers",
      heading: "Disclaimers",
      paragraphs: [
        "This Site and its content are provided \"as is\" without warranties of any kind, express or implied, to the fullest extent permitted by applicable law. This section, and the limitation-of-liability section below, are drafted conservatively and are intended for review by qualified counsel before this Site is treated as final for a specific commercial launch.",
      ],
    },
    {
      id: "limitation-of-liability",
      heading: "Limitation of liability",
      paragraphs: [
        "To the fullest extent permitted by applicable law, Vercentlabs will not be liable for any indirect, incidental, or consequential damages arising from your use of this Site. Nothing in these Terms limits any liability that cannot be limited under applicable law.",
      ],
    },
    {
      id: "governing-law",
      heading: "Governing law",
      paragraphs: [
        "These Terms are governed by the laws of India. The specific courts with jurisdiction over any dispute will be confirmed in a future revision of these Terms pending company/counsel confirmation of the appropriate venue.",
      ],
    },
    {
      id: "changes",
      heading: "Changes to these terms",
      paragraphs: [
        "We may update these Terms from time to time. The date at the top of this page reflects the last review. Continued use of the Site after a change constitutes acceptance of the updated Terms.",
      ],
    },
    {
      id: "contact",
      heading: "Contact us",
      paragraphs: [
        `Questions about these Terms can be sent to ${COMPANY_IDENTITY.supportContactEmail}.`,
      ],
    },
  ],
});
