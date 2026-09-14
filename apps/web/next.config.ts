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
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'" + (isProduction ? "" : " 'unsafe-eval'"),
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "worker-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // infrastructure/docker/Dockerfile.web expects .next/standalone with
  // apps/web/server.js as the runnable entrypoint — do not change this
  // without updating that Dockerfile.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  transpilePackages: [
    "@vercentlabs/api",
    "@vercentlabs/database",
    "@vercentlabs/design-system",
    "@vercentlabs/design-tokens",
    "@vercentlabs/permissions",
    "@vercentlabs/shared-types",
  ],
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
    ];
  },
};

export default nextConfig;
