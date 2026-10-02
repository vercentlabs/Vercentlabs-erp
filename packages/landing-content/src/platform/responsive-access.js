import { CTAS } from "../navigation.js";

/**
 * /product/mobile ("Responsive Access") — the browser-based, responsive interface; not a native app. The export keeps its original name for API stability.
 * Product statements must stay inside the approved launch capability register
 * (capabilities/launch-capabilities.js).
 */
export const MOBILE_PAGE = Object.freeze({
  slug: "/product/mobile",
  title: "Responsive Access",
  metaDescription:
    "Vercentlabs ERP runs in the browser with a responsive interface that adapts to desktop, tablet, and phone screens — no app to install. It is not a native mobile app.",
  directDefinition:
    "Responsive access to Vercentlabs ERP means the same browser-based application adapts its layout to desktop, tablet, and phone screens, with the same sign-in, permissions, and data — it is not a native mobile app and does not work offline.",
  eyebrow: "Responsive access",
  heading: "The same ERP in any modern browser, on any screen size.",
  supportingText:
    "Vercentlabs ERP is a web application with a responsive interface. There is no native mobile app and no offline mode at launch — this page says exactly what that means.",
  sections: [
    {
      id: "responsive-ui",
      heading: "What responsive access covers",
      items: [
        { title: "Responsive interface", description: "Screens adapt to desktop, tablet, and phone browsers." },
        { title: "Clear loading, empty, and error states", description: "The interface shows when something is loading, when there's nothing to show yet, and when something went wrong." },
      ],
    },
    {
      id: "same-security",
      heading: "Same sign-in and access rules",
      items: [
        { title: "One account, every device", description: "The same sign-in, session management, roles, and permissions apply whatever screen you use." },
      ],
    },
    {
      id: "mobile-gaps",
      heading: "What it is not",
      supportingText: "There is no native iOS or Android app, no offline mode, and no device-specific features such as biometric sign-in at launch. Everything runs in the browser and needs a connection.",
      items: [],
    },
  ],
  connectedModuleKeys: ["crm", "support", "hr-payroll"],
  faqs: [
    { question: "Is there a Vercentlabs mobile app?", answer: "No. Vercentlabs ERP runs in the browser with a responsive interface for desktop, tablet, and phone screens; there is no native mobile app at launch." },
    { question: "Does Vercentlabs ERP work offline?", answer: "No. It's a web application and needs an internet connection." },
  ],
  primaryCta: CTAS.talkToSpecialist,
  finalCtaHeading: "See Vercentlabs ERP on your own devices with an ERP specialist.",
});
