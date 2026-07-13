# Vercent ERP Landing Application

Production marketing application for Vercent ERP, built with Next.js App Router, TypeScript and Tailwind CSS.

## Local development

Run from the repository root:

- pnpm dev:landing
- pnpm lint:landing
- pnpm typecheck:landing
- pnpm build:landing

## Required production configuration

Set these values in the deployment platform, never in committed .env files:

- NEXT_PUBLIC_SITE_URL: canonical HTTPS website origin.
- NEXT_PUBLIC_ERP_APP_URL: authenticated ERP application origin when deployed.
- NEXT_PUBLIC_CONTACT_EMAIL: public contact address.
- FORM_ALLOWED_ORIGINS: comma-separated allowed website origins.
- UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN: distributed form rate limiting.
- LEAD_WEBHOOK_URL and LEAD_WEBHOOK_SECRET: secure contact delivery.
- Optional SIGNUP_WEBHOOK_URL and SIGNUP_WEBHOOK_SECRET: separate design-partner delivery.

## Production release gate

A release is ready only after lint, TypeScript, production build and route smoke tests pass; the canonical domain uses HTTPS; forms are connected to a verified destination; rate limiting is configured; monitoring is enabled; and legal/security claims have been reviewed by the responsible owner.
