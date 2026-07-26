# Vercentlabs ERP Landing Application

Production public website for Vercentlabs ERP, built with Next.js App Router,
TypeScript and Tailwind CSS.

## Local development

Run from the repository root:

- `pnpm dev:landing`
- `pnpm test:landing`
- `pnpm lint:landing`
- `pnpm typecheck:landing`
- `pnpm build:landing`
- `pnpm test:landing:e2e` after a production build
- `pnpm test:landing:browser` after installing Playwright Chromium

## Public journeys

The website has two server-delivered lead journeys:

- `/contact` posts to `/api/contact`.
- `/book-demo` posts to `/api/demo`.

Both use same-origin checks, bounded JSON parsing, server validation, a honeypot,
minimum completion time, trusted-proxy fingerprinting, distributed rate limiting
and signed delivery into CRM capture or a generic webhook. `/api/signup` is kept
only as a deprecated compatibility alias for `/api/demo`.

A successful demo request continues to `/request-received`. It does not claim
that an account, trial or email-verification token has been created. Secure ERP
account registration lives in the authenticated web application.

## Required production configuration

Set these values in the deployment platform, never in committed `.env` files:

- `NEXT_PUBLIC_SITE_URL`: canonical HTTPS website origin.
- `NEXT_PUBLIC_ERP_APP_URL`: authenticated ERP origin when registration is live.
- `NEXT_PUBLIC_CONTACT_EMAIL`: public contact address.
- `FORM_ALLOWED_ORIGINS`: comma-separated allowed website origins.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: distributed rate limiting.
- `TRUSTED_PROXY_IP_HEADER`: trusted reverse-proxy client-IP header.
- `CRM_CAPTURE_URL` and `CRM_CAPTURE_PROXY_SECRET`, or a signed
  `LEAD_WEBHOOK_URL` and `LEAD_WEBHOOK_SECRET`.
- Optional `DEMO_CRM_CAPTURE_URL` or `DEMO_WEBHOOK_URL` pair for a separate
  demo destination.

## Production verification

`pnpm test:landing:e2e` starts the built Next.js application against local mock
rate-limit and CRM services. It verifies public routes, security headers,
contact and demo delivery, signed CRM capture, invalid origins, invalid content
types, validation, honeypot behaviour and rate limiting.

`pnpm test:landing:browser` launches real Chromium against the production build.
It checks responsive overflow at five viewport widths, mobile focus containment,
skip navigation, keyboard tabs, interactive approval preview, reduced-motion
behaviour and both public form journeys. Install the browser once with
`pnpm --filter @vercentlabs/landing exec playwright install chromium`.

A release is ready only after tests, lint, TypeScript, production build,
production API and browser-journey verification, repository release verification and deployed
health/readiness smoke checks pass. Production environment validation must also
pass with real secrets and HTTPS destinations.
