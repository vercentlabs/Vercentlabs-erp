const isProduction = process.env.NODE_ENV === "production";

// Marketing site CSP: no third-party checkout/payment origins are needed here
// (that's apps/web's concern), so this is intentionally tighter than apps/web's.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https://*.google-analytics.com https://www.googletagmanager.com",
  "object-src 'none'",
  // 'unsafe-inline' is required in every environment, matching apps/web's proven
  // CSP: Next.js emits its own inline bootstrap/hydration <script> tags on every
  // page. A stricter nonce-based policy needs middleware to mint a per-request
  // nonce — out of scope for this phase's foundation; see docs/landing-redesign/phase-2/phase-3-brief.md.
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com" + (isProduction ? "" : " 'unsafe-eval'"),
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
  "worker-src 'self'",
].join("; ");

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Required: repo-root server.js boots this app from its standalone build
  // (see server.js and infrastructure/docker/Dockerfile.landing).
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  transpilePackages: ["@vercentlabs/landing-content", "@vercentlabs/shared-types"],
  images: {
    formats: ["image/avif", "image/webp"],
    // No remote product screenshots yet — all approved images ship from
    // apps/landing/public. Extend this list only when a real remote source exists.
    remotePatterns: [],
  },
  async redirects() {
    return [
      // /security is canonical (docs/landing-redesign/phase-1/information-architecture.md,
      // Tier 4) — /product/security is kept only as a redirect for anyone who types the
      // /product/{page} pattern by analogy with the other platform pages.
      { source: "/product/security", destination: "/security", permanent: true },
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
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          ...(isProduction
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
      {
        // The component-review route must never be indexed, even if robots.ts is bypassed.
        source: "/design-system",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        source: "/design-system/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        // The post-submission confirmation must never be indexed — carries a
        // per-submission request id in its query string, not real content.
        source: "/book-demo/thank-you",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
