import type { MetadataRoute } from "next";

import { absoluteUrl, landingConfig } from "@/lib/landing-config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/signup/verify", "/login"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: landingConfig.siteUrl,
  };
}
