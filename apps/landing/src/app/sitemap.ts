import type { MetadataRoute } from "next";

import { erpModules, industries } from "@/content/erp";
import { absoluteUrl } from "@/lib/site-config";

const publicRoutes = [
  ["/", 1],
  ["/features", 0.9],
  ["/modules", 0.9],
  ["/how-it-works", 0.85],
  ["/industries", 0.85],
  ["/customers", 0.8],
  ["/security", 0.75],
  ["/pricing", 0.75],
  ["/comparison", 0.7],
  ["/api-developers", 0.65],
  ["/partner", 0.65],
  ["/about", 0.6],
  ["/careers", 0.45],
  ["/changelog", 0.55],
  ["/help", 0.5],
  ["/contact", 0.7],
  ["/privacy", 0.3],
  ["/terms", 0.3],
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...publicRoutes.map(([route, priority]) => ({
      url: absoluteUrl(route),
      changeFrequency:
        route === "/changelog" ? ("weekly" as const) : ("monthly" as const),
      priority,
    })),
    ...erpModules.map((item) => ({
      url: absoluteUrl("/modules/" + item.slug),
      changeFrequency: "monthly" as const,
      priority: 0.72,
    })),
    ...industries.map((item) => ({
      url: absoluteUrl("/industries/" + item.slug),
      changeFrequency: "monthly" as const,
      priority: 0.68,
    })),
  ];
}
