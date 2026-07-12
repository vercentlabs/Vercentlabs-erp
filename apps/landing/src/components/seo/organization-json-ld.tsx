import { absoluteUrl, landingConfig } from "@/lib/landing-config";

export default function OrganizationJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": absoluteUrl("/#organization"),
        name: landingConfig.companyName,
        url: landingConfig.siteUrl,
        email: landingConfig.contactEmail,
        logo: absoluteUrl("/brand/logo.png"),
      },
      {
        "@type": "WebSite",
        "@id": absoluteUrl("/#website"),
        name: landingConfig.productName,
        url: landingConfig.siteUrl,
        publisher: {
          "@id": absoluteUrl("/#organization"),
        },
      },
      {
        "@type": "SoftwareApplication",
        name: landingConfig.productName,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: landingConfig.description,
        url: landingConfig.siteUrl,
        creator: {
          "@id": absoluteUrl("/#organization"),
        },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
      }}
    />
  );
}
