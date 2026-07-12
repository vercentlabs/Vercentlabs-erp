import type { MetadataRoute } from "next";

import { erpModules, industries } from "@/content/erp";
import { absoluteUrl } from "@/lib/landing-config";

const lastModified = new Date("2026-07-12");

const staticRoutes = [
  { path: "/", priority: 1 },
  { path: "/features", priority: 0.9 },
  { path: "/modules", priority: 0.9 },
  { path: "/how-it-works", priority: 0.85 },
  { path: "/industries", priority: 0.85 },
  { path: "/security", priority: 0.8 },
  { path: "/pricing", priority: 0.75 },
  { path: "/comparison", priority: 0.7 },
  { path: "/api-developers", priority: 0.7 },
  { path: "/partner", priority: 0.7 },
  { path: "/customers", priority: 0.65 },
  { path: "/about", priority: 0.65 },
  { path: "/careers", priority: 0.55 },
  { path: "/changelog", priority: 0.55 },
  { path: "/help", priority: 0.6 },
  { path: "/contact", priority: 0.75 },
  { path: "/status", priority: 0.45 },
  { path: "/privacy", priority: 0.3 },
  { path: "/terms", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const staticEntries: MetadataRoute.Sitemap = staticRoutes.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified,
    changeFrequency: route.path === "/changelog" ? "weekly" : "monthly",
    priority: route.priority,
  }));

  const moduleEntries: MetadataRoute.Sitemap = erpModules.map((erpModule) => ({
    url: absoluteUrl("/modules/" + erpModule.slug),
    lastModified,
    changeFrequency: "monthly" as const,
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
