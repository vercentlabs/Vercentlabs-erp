import type { MetadataRoute } from "next";

import { erpModules, industries } from "@/content/erp";
import { absoluteUrl } from "@/lib/site-config";

const lastModified = new Date("2026-07-12");

const staticRoutes = [
  { path: "/", priority: 1, changeFrequency: "weekly" as const },
  { path: "/product", priority: 0.95, changeFrequency: "weekly" as const },
  { path: "/features", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/modules", priority: 0.9, changeFrequency: "monthly" as const },
  {
    path: "/how-it-works",
    priority: 0.85,
    changeFrequency: "monthly" as const,
  },
  { path: "/industries", priority: 0.85, changeFrequency: "monthly" as const },
  { path: "/pricing", priority: 0.85, changeFrequency: "monthly" as const },
  { path: "/comparison", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/security", priority: 0.75, changeFrequency: "monthly" as const },
  {
    path: "/api-developers",
    priority: 0.7,
    changeFrequency: "monthly" as const,
  },
  { path: "/partner", priority: 0.65, changeFrequency: "monthly" as const },
  { path: "/about", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/contact", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/help", priority: 0.55, changeFrequency: "monthly" as const },
  { path: "/careers", priority: 0.45, changeFrequency: "monthly" as const },
  { path: "/changelog", priority: 0.5, changeFrequency: "weekly" as const },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" as const },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const staticEntries: MetadataRoute.Sitemap = staticRoutes.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const moduleEntries: MetadataRoute.Sitemap = erpModules.map((erpModule) => ({
    url: absoluteUrl("/modules/" + erpModule.slug),
    lastModified,
    changeFrequency: "monthly",
    priority: 0.72,
  }));

  const industryEntries: MetadataRoute.Sitemap = industries.map((industry) => ({
    url: absoluteUrl("/industries/" + industry.slug),
    lastModified,
    changeFrequency: "monthly",
    priority: 0.68,
  }));

  return [...staticEntries, ...moduleEntries, ...industryEntries];
}
