import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// ERP app CSP: broader than apps/landing's marketing CSP because the app
// shell talks to its own API routes and, longer-term, payment/checkout
// origins for POS/billing — extend this list only when a real requirement
// lands, never speculatively.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https://*.razorpay.com",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com" +
    (isProduction ? "" : " 'unsafe-eval'"),
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "worker-src 'self'",
].join("; ");
// A CRM web form's hosted page (/f/{key}) is meant to be embedded in the organization's own website, so it — and only it — may be
// framed by any https site. (Browsers follow CSP frame-ancestors over X-Frame-Options.)
const embeddableFormPolicy = contentSecurityPolicy.replace("frame-ancestors 'none'", "frame-ancestors https: http://localhost:*");

const nextConfig: NextConfig = {
  // A verification build can write elsewhere (NEXT_DIST_DIR) so it never disturbs a running dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // infrastructure/docker/Dockerfile.web expects .next/standalone with
  // apps/web/server.js as the runnable entrypoint — do not change this
  // without updating that Dockerfile.
  output: "standalone",
  // An image build (infrastructure/docker/Dockerfile.web) skips Next's own type check — every change is type-checked separately — and
  // collects page data with fewer workers, so the build fits a build machine's memory.
  typescript: { ignoreBuildErrors: process.env.NEXT_BUILD_SKIP_TYPECHECK === "1" },
  // An image is built once, so Turbopack's on-disk build cache (minutes of writing, never read again) is not kept there.
  ...(process.env.NEXT_BUILD_CPUS
    ? { experimental: { cpus: Number(process.env.NEXT_BUILD_CPUS), turbopackFileSystemCacheForBuild: false } }
    : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  // The dev-mode indicator badge defaults to the bottom-left corner, which
  // is exactly where the primary sidebar's profile control now lives (see
  // src/shell/primary-sidebar) — it visually and pointer-event overlaps
  // the profile menu button. Disabled rather than worked around.
  devIndicators: false,
  // The PDF stack (@react-pdf/renderer, pure Node) is loaded at runtime from
  // the document-engine workspace package, never bundled.
  // The PDF fonts (Noto Sans, Noto Sans Devanagari) are read from disk by the document engine at run time.
  outputFileTracingIncludes: {
    "/api/**/*": ["../../packages/document-engine/fonts/**/*"],
  },
  serverExternalPackages: [
    "@vercentlabs/document-engine",
    "@react-pdf/renderer",
  ],
  transpilePackages: [
    "@vercentlabs/api",
    "@vercentlabs/database",
    "@vercentlabs/design-system",
    "@vercentlabs/design-tokens",
    "@vercentlabs/permissions",
    "@vercentlabs/shared-types",
  ],
  // Old CRM addresses (CRM plan 5.9): the per-record import pages and the companies report now live in Import data and Reports.
  async redirects() {
    return [
      { source: "/crm/leads/import", destination: "/crm/data/import-export?type=leads", permanent: true },
      { source: "/crm/accounts/import", destination: "/crm/data/import-export?type=companies", permanent: true },
      { source: "/crm/contacts/import", destination: "/crm/data/import-export?type=contacts", permanent: true },
      { source: "/crm/opportunities/import", destination: "/crm/data/import-export?type=deals", permanent: true },
      { source: "/crm/accounts/report", destination: "/crm/reports?report=companies", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          ...(isProduction
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
      {
        source: "/f/:key",
        headers: [
          { key: "Content-Security-Policy", value: embeddableFormPolicy },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
      // The chat's embed script is loaded by the organization's site.
      {
        source: "/api/crm/public/chat/:key/widget.js",
        headers: [{ key: "Cross-Origin-Resource-Policy", value: "cross-origin" }],
      },
      // A website chat (CRM plan 5.8) is framed by the organization's site in the same way.
      {
        source: "/chat/:key",
        headers: [
          { key: "Content-Security-Policy", value: embeddableFormPolicy },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
